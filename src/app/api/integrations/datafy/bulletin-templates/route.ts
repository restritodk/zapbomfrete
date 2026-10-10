import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { canAccessDatafyChannel } from "@/modules/channels/access";
import { datafyProvider, DatafyApiError } from "@/modules/datafy";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";
import { loadDatafyConfig } from "@/modules/datafy/config";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    buildBulletinTemplateSubmission,
    findBulletinSpecByName,
} from "@/modules/datafy/campaigns/bulletin/library";

export const dynamic = "force-dynamic";

const postSchema = z.object({
    /** Preferred name e.g. boletim_1_carga */
    name: z.string().min(3).max(64),
    /**
     * Explicit confirmation — never auto-submit.
     * Must be true to call Datafy/Meta.
     */
    confirmSubmit: z.literal(true),
});

async function requireDatafyTemplateAccess(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return {
            error: NextResponse.json(
                { status: false, message: "Unauthorized" },
                { status: 401 }
            ),
        };
    }
    const allowed =
        isAdmin(user.role) ||
        (await canAccessDatafyChannel(user.id, user.role));
    if (!allowed) {
        return {
            error: NextResponse.json(
                { status: false, message: "Forbidden" },
                { status: 403 }
            ),
        };
    }
    return { user };
}

/**
 * GET — library specs + remote Meta status (via Datafy) for the 3 bulletin templates.
 * Does not submit anything.
 */
export async function GET(request: NextRequest) {
    const gate = await requireDatafyTemplateAccess(request);
    if (gate.error) return gate.error;

    const library = BULLETIN_TEMPLATE_LIBRARY.map((spec) =>
        buildBulletinTemplateSubmission(spec)
    );

    const remoteByName: Record<
        string,
        {
            id?: string;
            name: string;
            status: string;
            category?: string;
            language?: string;
            rejected_reason?: string | null;
        }
    > = {};

    let remoteError: string | null = null;
    try {
        const statuses = ["APPROVED", "PENDING", "REJECTED"] as const;
        const pages = await Promise.all(
            statuses.map((status) =>
                datafyProvider
                    .listTemplates({ status, limit: 80 })
                    .catch(() => ({ data: [] as unknown[] }))
            )
        );
        for (const page of pages) {
            const rows = Array.isArray(page?.data) ? page.data : [];
            for (const raw of rows) {
                const t = raw as {
                    id?: string;
                    name?: string;
                    status?: string;
                    category?: string;
                    language?: string;
                    rejected_reason?: string | null;
                };
                if (!t.name) continue;
                const spec = findBulletinSpecByName(t.name);
                if (!spec) continue;
                const lang = String(t.language || "pt_BR");
                if (lang !== "pt_BR" && lang !== "pt_br") continue;
                // Prefer APPROVED over PENDING/REJECTED when duplicates
                const prev = remoteByName[spec.preferredName];
                const rank = (s: string) =>
                    s === "APPROVED" ? 3 : s === "PENDING" ? 2 : 1;
                if (
                    !prev ||
                    rank(String(t.status || "").toUpperCase()) >
                        rank(String(prev.status || "").toUpperCase())
                ) {
                    remoteByName[spec.preferredName] = {
                        id: t.id,
                        name: t.name,
                        status: String(t.status || "UNKNOWN").toUpperCase(),
                        category: t.category,
                        language: lang,
                        rejected_reason: t.rejected_reason ?? null,
                    };
                }
            }
        }
    } catch (e) {
        remoteError =
            e instanceof DatafyApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "Falha ao consultar templates remotos";
    }

    return NextResponse.json({
        status: true,
        data: {
            language: "pt_BR",
            category: "MARKETING",
            submissionChannel: "datafy_api",
            metaNote:
                "A Datafy encaminha POST message_templates à Meta. Aprovação final é da Meta (PENDING → APPROVED/REJECTED).",
            library,
            remote: remoteByName,
            remoteError: remoteError ? redactSecrets(remoteError) : null,
        },
    });
}

/**
 * POST — manually submit ONE library template for Meta approval via Datafy.
 * Requires confirmSubmit: true. Never called automatically.
 * SUPERADMIN only (credential-bearing mutation).
 */
export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json(
            { status: false, message: "Unauthorized" },
            { status: 401 }
        );
    }
    if (!isAdmin(user.role)) {
        return NextResponse.json(
            {
                status: false,
                message:
                    "Apenas SUPERADMIN pode submeter templates oficiais à Meta via Datafy",
            },
            { status: 403 }
        );
    }

    const body = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            {
                status: false,
                message:
                    "Informe name + confirmSubmit: true para submeter manualmente",
            },
            { status: 400 }
        );
    }

    const spec = findBulletinSpecByName(parsed.data.name);
    if (!spec) {
        return NextResponse.json(
            { status: false, message: "Modelo de boletim desconhecido" },
            { status: 400 }
        );
    }

    const submission = buildBulletinTemplateSubmission(spec);
    if (!submission.checks.readyForManualSubmit) {
        return NextResponse.json(
            {
                status: false,
                message: "Modelo não está pronto para submissão",
                data: { checks: submission.checks },
            },
            { status: 400 }
        );
    }

    try {
        const cfg = await loadDatafyConfig();
        let wabaId = cfg.wabaId;
        if (!wabaId) {
            const verified = await datafyProvider.verifyConnection();
            wabaId = verified.me?.waba_id || null;
        }
        if (!wabaId) {
            return NextResponse.json(
                { status: false, message: "waba_id indisponível — verifique a integração" },
                { status: 400 }
            );
        }

        const client = await datafyProvider.createClient();
        const created = await client.createTemplate(wabaId, {
            name: submission.name,
            language: submission.language,
            category: submission.category,
            parameter_format: submission.parameter_format,
            components: [
                {
                    type: "BODY",
                    text: submission.bodyText,
                    example: { body_text: [submission.exampleRow] },
                },
            ],
        });

        return NextResponse.json({
            status: true,
            data: {
                templateName: submission.name,
                templateId: created.id || null,
                approvalStatus: String(created.status || "PENDING").toUpperCase(),
                category: created.category || submission.category,
                language: submission.language,
                message:
                    "Template enviado à Meta via Datafy. Acompanhe o status (PENDING/APPROVED/REJECTED). Campanhas reais só com APPROVED.",
            },
        });
    } catch (e) {
        const message =
            e instanceof DatafyApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "Falha ao submeter template";
        return NextResponse.json(
            { status: false, message: redactSecrets(message) },
            { status: e instanceof DatafyApiError ? e.statusCode : 500 }
        );
    }
}
