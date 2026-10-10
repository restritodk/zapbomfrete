import type { CampaignMessagePart } from "./bulletin/types";

/** Resolve ordered send parts from campaign fields (bulletin or legacy single). */
export function resolveCampaignParts(campaign: {
    contentKind?: string | null;
    messageBody?: string | null;
    messageParts?: unknown;
    templateName?: string | null;
    templateLanguage?: string | null;
    templateCategory?: string | null;
    templateApprovalStatus?: string | null;
    templateComponents?: unknown;
    variableMapping?: unknown;
    headerImageUrl?: string | null;
    headerImageHandle?: string | null;
}): CampaignMessagePart[] {
    if (Array.isArray(campaign.messageParts) && campaign.messageParts.length) {
        return (campaign.messageParts as CampaignMessagePart[]).map((p, i) => ({
            ...p,
            index: typeof p.index === "number" ? p.index : i,
            charCount: p.charCount ?? (p.bodyText || "").length,
        }));
    }

    const body = (campaign.messageBody || "").trim();
    return [
        {
            index: 0,
            label: "Mensagem",
            bodyText: body,
            loadIndexes: [0],
            charCount: body.length,
            templateName: campaign.templateName,
            templateLanguage: campaign.templateLanguage || "pt_BR",
            templateCategory: campaign.templateCategory,
            templateApprovalStatus: campaign.templateApprovalStatus,
            templateComponents: campaign.templateComponents,
            variableMapping: (campaign.variableMapping || { body: [] }) as {
                body?: string[];
                header?: string[];
            },
            headerImageUrl: campaign.headerImageUrl,
            headerImageHandle: campaign.headerImageHandle,
            readyForRealSend:
                String(campaign.templateApprovalStatus || "").toUpperCase() ===
                    "APPROVED" && Boolean(campaign.templateName),
            blockReason: campaign.templateName
                ? null
                : "Template não configurado",
        },
    ];
}

export function partClientMessageId(
    campaignId: string,
    waId: string,
    partIndex: number
): string {
    return `camp_${campaignId}_${waId}_p${partIndex}`;
}
