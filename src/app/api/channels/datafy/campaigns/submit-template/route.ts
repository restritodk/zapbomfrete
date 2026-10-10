import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCampaignEdit } from "@/modules/datafy/campaigns/auth-gate";
import { datafyProvider, DatafyApiError } from "@/modules/datafy";
import { loadDatafyConfig } from "@/modules/datafy/config";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";
import { prepareTemplateBodyFromCopy } from "@/modules/datafy/campaigns/variables";

export const dynamic = "force-dynamic";

const schema = z.object({
    name: z.string().min(3).max(512),
    language: z.string().default("pt_BR"),
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
    bodyText: z.string().min(1).max(1024),
    headerImageHandle: z.string().nullable().optional(),
});

function toTemplateName(raw: string) {
    return raw
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 512);
}

/**
 * Submit a custom campaign body (+ optional IMAGE header) as a Meta template via Datafy.
 * Result is PENDING until Meta approves — real sends must wait.
 */
export async function POST(request: NextRequest) {
    const gate = await requireCampaignEdit(request);
    if (gate.error) return gate.error;

    try {
        const body = await request.json().catch(() => null);
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Payload inválido" },
                { status: 400 }
            );
        }

        const cfg = await loadDatafyConfig();
        let wabaId = cfg.wabaId;
        if (!wabaId) {
            const verified = await datafyProvider.verifyConnection();
            wabaId = verified.me?.waba_id || null;
        }
        if (!wabaId) {
            return NextResponse.json(
                { status: false, message: "waba_id indisponível" },
                { status: 400 }
            );
        }

        const prepared = prepareTemplateBodyFromCopy(parsed.data.bodyText);
        const templateName =
            toTemplateName(parsed.data.name) ||
            `campanha_${Date.now().toString(36)}`;

        const components: unknown[] = [];
        if (parsed.data.headerImageHandle) {
            components.push({
                type: "HEADER",
                format: "IMAGE",
                example: {
                    header_handle: [parsed.data.headerImageHandle],
                },
            });
        }
        components.push({
            type: "BODY",
            text: prepared.bodyText,
            ...(prepared.exampleRow.length
                ? { example: { body_text: [prepared.exampleRow] } }
                : {}),
        });

        const client = await datafyProvider.createClient();
        const created = await client.createTemplate(wabaId, {
            name: templateName,
            language: parsed.data.language || "pt_BR",
            category: parsed.data.category,
            components,
        });

        return NextResponse.json({
            status: true,
            data: {
                templateName,
                templateId: created.id || null,
                approvalStatus: created.status || "PENDING",
                category: created.category || parsed.data.category,
                language: parsed.data.language || "pt_BR",
                bodyText: prepared.bodyText,
                bodyTokens: prepared.bodyTokens,
                message:
                    "Template enviado para análise da Meta. O disparo real só é possível após aprovação (APPROVED).",
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