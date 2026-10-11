import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
    requireCampaignEdit,
    requireCampaignLaunch,
} from "@/modules/datafy/campaigns/auth-gate";
import { datafyProvider, DatafyApiError } from "@/modules/datafy";
import { loadDatafyConfig } from "@/modules/datafy/config";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";
import { buildMetaApprovalProposal } from "@/modules/datafy/campaigns/bulletin/meta-approval";
import {
    findManagedByTechnicalName,
    listEffectiveManagedTemplates,
    markSubmitted,
    syncRemoteStatuses,
} from "@/modules/datafy/campaigns/bulletin/managed-registry";
import {
    buildBulletinTemplateSubmission,
    findBulletinSpecByName,
} from "@/modules/datafy/campaigns/bulletin/library";
import {
    buildTemplateCreatePayload,
    formatMetaTemplateApiError,
} from "@/modules/datafy/campaigns/bulletin/template-submit-payload";

export const dynamic = "force-dynamic";

const proposeSchema = z.object({
    action: z.literal("propose"),
    draft: z
        .object({
            rawText: z.string().optional(),
            general: z.any(),
            loads: z.array(z.any()).min(1),
            warnings: z.array(z.string()).optional(),
            confirmed: z.boolean().optional(),
        })
        .passthrough(),
});

const submitSchema = z.object({
    action: z.literal("submit"),
    technicalName: z.string().min(3).max(64),
    confirmSubmit: z.literal(true),
    /** Dry-run: validate and simulate PENDING without calling Datafy */
    simulateOnly: z.boolean().optional(),
});

const refreshSchema = z.object({
    action: z.literal("refresh"),
});

async function remoteStatusMap() {
    const library = await listEffectiveManagedTemplates();
    const map: Record<
        string,
        {
            remoteStatus?: string | null;
            remoteTemplateId?: string | null;
            remoteRejectedReason?: string | null;
            lastSubmittedAt?: Date | string | null;
        }
    > = {};
    for (const t of library) {
        map[t.technicalName.toLowerCase()] = {
            remoteStatus: t.remoteStatus,
            remoteTemplateId: t.remoteTemplateId,
            remoteRejectedReason: t.remoteRejectedReason,
            lastSubmittedAt: t.lastSubmittedAt,
        };
    }

    // Enrich from Datafy list (no real send)
    try {
        for (const status of ["APPROVED", "PENDING", "REJECTED", "PAUSED"] as const) {
            const page = await datafyProvider.listTemplates({
                status,
                limit: 100,
            });
            for (const row of page.data || []) {
                if (!row.name) continue;
                const key = row.name.toLowerCase();
                map[key] = {
                    ...map[key],
                    remoteStatus: row.status || status,
                    remoteTemplateId: row.id || map[key]?.remoteTemplateId,
                    remoteRejectedReason:
                        row.rejected_reason ?? map[key]?.remoteRejectedReason,
                };
            }
        }
        await syncRemoteStatuses(
            Object.fromEntries(
                Object.entries(map)
                    .filter(([, v]) => v.remoteStatus)
                    .map(([name, v]) => [
                        name,
                        {
                            id: v.remoteTemplateId || undefined,
                            status: String(v.remoteStatus),
                            rejected_reason: v.remoteRejectedReason,
                        },
                    ])
            )
        );
    } catch {
        /* listing optional when Datafy offline */
    }

    return map;
}

export async function GET(request: NextRequest) {
    const gate = await requireCampaignEdit(request);
    if (gate.error) return gate.error;
    try {
        const map = await remoteStatusMap();
        return NextResponse.json({
            status: true,
            data: {
                templates: Object.entries(map).map(([name, v]) => ({
                    technicalName: name,
                    ...v,
                })),
            },
        });
    } catch (e) {
        return NextResponse.json(
            {
                status: false,
                message: redactSecrets(
                    e instanceof Error ? e.message : "Falha ao listar status"
                ),
            },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const action = body?.action as string | undefined;

    if (action === "propose") {
        const gate = await requireCampaignEdit(request);
        if (gate.error) return gate.error;
        const parsed = proposeSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Payload inválido para proposta" },
                { status: 400 }
            );
        }
        try {
            const map = await remoteStatusMap();
            const proposal = buildMetaApprovalProposal(
                parsed.data.draft as Parameters<
                    typeof buildMetaApprovalProposal
                >[0],
                map
            );
            return NextResponse.json({ status: true, data: { proposal } });
        } catch (e) {
            return NextResponse.json(
                {
                    status: false,
                    message: redactSecrets(
                        e instanceof Error ? e.message : "Falha na proposta"
                    ),
                },
                { status: 500 }
            );
        }
    }

    if (action === "refresh") {
        const gate = await requireCampaignEdit(request);
        if (gate.error) return gate.error;
        const parsed = refreshSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Payload inválido" },
                { status: 400 }
            );
        }
        try {
            const map = await remoteStatusMap();
            return NextResponse.json({
                status: true,
                data: {
                    templates: Object.entries(map).map(([name, v]) => ({
                        technicalName: name,
                        ...v,
                    })),
                },
            });
        } catch (e) {
            return NextResponse.json(
                {
                    status: false,
                    message: redactSecrets(
                        e instanceof Error ? e.message : "Falha ao atualizar"
                    ),
                },
                { status: 500 }
            );
        }
    }

    if (action === "submit") {
        const gate = await requireCampaignLaunch(request);
        if (gate.error) return gate.error;
        const parsed = submitSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    status: false,
                    message:
                        "Informe technicalName, confirmSubmit: true e action: submit",
                },
                { status: 400 }
            );
        }

        const name = parsed.data.technicalName;
        const spec = findBulletinSpecByName(name);
        const managed = await findManagedByTechnicalName(name);
        const submission = spec
            ? buildBulletinTemplateSubmission(spec)
            : managed
              ? {
                    name: managed.technicalName,
                    language: "pt_BR" as const,
                    category: managed.category as "MARKETING",
                    parameter_format: "POSITIONAL" as const,
                    bodyText: managed.bodyText,
                    exampleRow: managed.exampleRow as string[],
                    variableCount: (managed.exampleRow as string[]).length,
                    bodyCharCount: managed.bodyText.length,
                    loadsPerMessage: managed.loadsPerMessage as 1 | 2 | 3,
                    generation: (managed.technicalName.includes("v3")
                        ? 3
                        : managed.technicalName.includes("v2")
                          ? 2
                          : 1) as 1 | 2 | 3,
                    description: managed.description || "",
                    previewFilled: managed.bodyText,
                    checks: {
                        bodyWithinLimit: managed.bodyText.length <= 1024,
                        examplesMatchVars: true,
                        categoryMarketing: managed.category === "MARKETING",
                        languagePtBr: true,
                        readyForManualSubmit:
                            managed.bodyText.length <= 1024 &&
                            managed.category === "MARKETING",
                        notes: [],
                    },
                }
              : null;

        if (!submission || !submission.checks.readyForManualSubmit) {
            return NextResponse.json(
                {
                    status: false,
                    message:
                        "Modelo inválido para submissão (limites Meta ou categoria).",
                    data: { notes: submission?.checks.notes || [] },
                },
                { status: 400 }
            );
        }

        const existingStatus = String(
            managed?.remoteStatus || ""
        ).toUpperCase();
        if (
            existingStatus === "PENDING" ||
            existingStatus === "APPROVED" ||
            existingStatus === "REJECTED"
        ) {
            return NextResponse.json(
                {
                    status: false,
                    message:
                        existingStatus === "APPROVED"
                            ? "Template já APPROVED — não reenvie o mesmo nome/idioma."
                            : existingStatus === "PENDING"
                              ? "Template já PENDING — aguarde a Meta ou atualize o status."
                              : "Template rejeitado pela Meta — ajuste a estrutura ou use outro nome técnico. Não há reenvio automático.",
                    data: {
                        approvalStatus: existingStatus,
                        templateId: managed?.remoteTemplateId || null,
                    },
                },
                { status: 409 }
            );
        }

        // Simulated path for automated tests / dry confirmation UI
        if (parsed.data.simulateOnly) {
            await markSubmitted(submission.name, {
                id: `sim_${Date.now()}`,
                status: "PENDING",
            });
            return NextResponse.json({
                status: true,
                data: {
                    simulated: true,
                    templateName: submission.name,
                    templateId: null,
                    approvalStatus: "PENDING",
                    category: submission.category,
                    language: "pt_BR",
                    message:
                        "Simulação: submissão registrada como PENDING (nenhuma chamada real à Datafy/Meta).",
                },
            });
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
                    {
                        status: false,
                        message: "waba_id indisponível — verifique a integração Datafy",
                    },
                    { status: 400 }
                );
            }

            const built = buildTemplateCreatePayload({
                name: submission.name,
                language: "pt_BR",
                category: "MARKETING",
                bodyText: submission.bodyText,
                exampleRow: submission.exampleRow,
            });
            if (!built.ok) {
                return NextResponse.json(
                    {
                        status: false,
                        message: built.errors.join(" "),
                        data: {
                            errors: built.errors,
                            warnings: built.warnings,
                            guidance:
                                "Corrija o BODY/exemplos antes de reenviar à Meta.",
                        },
                    },
                    { status: 400 }
                );
            }

            const client = await datafyProvider.createClient();
            const created = await client.createTemplate(wabaId, {
                name: built.payload.name,
                language: built.payload.language,
                category: built.payload.category,
                components: built.payload.components,
            });

            await markSubmitted(submission.name, {
                id: created.id,
                status: created.status || "PENDING",
            });

            return NextResponse.json({
                status: true,
                data: {
                    simulated: false,
                    templateName: submission.name,
                    templateId: created.id || null,
                    approvalStatus: String(
                        created.status || "PENDING"
                    ).toUpperCase(),
                    category: created.category || "MARKETING",
                    language: "pt_BR",
                    warnings: built.warnings,
                    message:
                        "Template enviado à Meta via Datafy (PENDING). HTTP 200 ≠ APPROVED — o disparo real só após aprovação.",
                },
            });
        } catch (e) {
            const formatted = formatMetaTemplateApiError(e);
            const message = redactSecrets(formatted.message);
            return NextResponse.json(
                {
                    status: false,
                    message,
                    data: {
                        code: formatted.code,
                        subcode: formatted.subcode,
                        fbtraceId: formatted.fbtraceId,
                        userTitle: formatted.userTitle
                            ? redactSecrets(formatted.userTitle)
                            : null,
                        userMsg: formatted.userMsg
                            ? redactSecrets(formatted.userMsg)
                            : null,
                        guidance: formatted.guidance,
                    },
                },
                { status: e instanceof DatafyApiError ? e.statusCode : 500 }
            );
        }
    }

    return NextResponse.json(
        { status: false, message: "action inválida" },
        { status: 400 }
    );
}
