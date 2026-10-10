import type { BulletinPart, CampaignMessagePart } from "./types";
import { META_TEMPLATE_BODY_MAX } from "./types";

export type ApprovedTemplateLite = {
    name: string;
    language: string;
    status: string;
    category?: string;
    components?: unknown[];
};

/**
 * Associate bulletin parts with templates.
 *
 * Strategy (honest / Meta-compliant):
 * 1) Prefer an APPROVED template whose BODY text equals the part body (re-usable exact match).
 * 2) Otherwise leave part blocked for real send until the user submits that part for Meta approval.
 *
 * We never wrap the whole part in a single free variable to bypass approval.
 */
export function associatePartsWithTemplates(
    parts: BulletinPart[],
    templates: ApprovedTemplateLite[],
    opts?: { purpose?: string }
): CampaignMessagePart[] {
    const approved = templates.filter(
        (t) => String(t.status || "").toUpperCase() === "APPROVED"
    );

    const bodyOf = (t: ApprovedTemplateLite): string | null => {
        if (!Array.isArray(t.components)) return null;
        for (const c of t.components) {
            const comp = c as { type?: string; text?: string };
            if (String(comp.type || "").toUpperCase() === "BODY" && comp.text) {
                return comp.text;
            }
        }
        return null;
    };

    const byBody = new Map<string, ApprovedTemplateLite>();
    for (const t of approved) {
        const body = bodyOf(t);
        if (body) byBody.set(normalizeBody(body), t);
    }

    const categoryHint =
        opts?.purpose === "utility" ? "UTILITY" : "MARKETING";

    return parts.map((p) => {
        if (p.charCount > META_TEMPLATE_BODY_MAX) {
            return {
                ...toCampaignPart(p),
                readyForRealSend: false,
                blockReason: `Parte com ${p.charCount} caracteres (limite Meta: ${META_TEMPLATE_BODY_MAX})`,
            };
        }

        const match = byBody.get(normalizeBody(p.bodyText));
        if (match) {
            return {
                ...toCampaignPart(p),
                templateName: match.name,
                templateLanguage: match.language || "pt_BR",
                templateCategory: match.category || categoryHint,
                templateApprovalStatus: "APPROVED",
                templateComponents: match.components || null,
                variableMapping: { body: [] },
                readyForRealSend: true,
                blockReason: null,
            };
        }

        // Keep prior association if already APPROVED on the part
        if (
            p.templateName &&
            String(p.templateApprovalStatus || "").toUpperCase() === "APPROVED"
        ) {
            return {
                ...toCampaignPart(p),
                readyForRealSend: true,
                blockReason: null,
            };
        }

        return {
            ...toCampaignPart(p),
            templateName: p.templateName || null,
            templateLanguage: p.templateLanguage || "pt_BR",
            templateCategory: p.templateCategory || categoryHint,
            templateApprovalStatus: p.templateApprovalStatus || null,
            readyForRealSend: false,
            blockReason:
                p.blockReason ||
                "Sem template APPROVED compatível — envie esta parte para aprovação da Meta ou use simulação",
        };
    });
}

function normalizeBody(s: string): string {
    return s.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function toCampaignPart(p: BulletinPart): CampaignMessagePart {
    return {
        index: p.index,
        label: p.label,
        bodyText: p.bodyText,
        loadIndexes: p.loadIndexes,
        charCount: p.charCount,
        templateName: p.templateName,
        templateLanguage: p.templateLanguage,
        templateCategory: p.templateCategory,
        templateApprovalStatus: p.templateApprovalStatus,
        templateComponents: p.templateComponents,
        variableMapping: p.variableMapping,
        readyForRealSend: p.readyForRealSend,
        blockReason: p.blockReason,
    };
}

export function allPartsReadyForRealSend(parts: CampaignMessagePart[]): boolean {
    return parts.length > 0 && parts.every((p) => p.readyForRealSend);
}

export function partsBlockingReasons(parts: CampaignMessagePart[]): string[] {
    return parts
        .filter((p) => !p.readyForRealSend)
        .map(
            (p) =>
                `Parte ${p.index + 1}: ${p.blockReason || "Template não aprovado"}`
        );
}
