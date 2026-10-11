/**
 * Technical send readiness for Datafy campaigns (modalities A / B / C).
 *
 * A — APPROVED template via official Cloud API
 * B — Free-form reply inside open 24h service window (non-marketing only)
 * C — Neither → real send blocked
 *
 * Consent eligibility is separate: "apto" ≠ autorizado tecnicamente.
 */

import { prisma } from "@/lib/prisma";
import {
    brazilianWaIdVariants,
    isWithinServiceWindow,
    normalizeWaId,
} from "@/modules/datafy/chat/window";

export type SendModality = "template_approved" | "service_window" | "none";

export type TemplatePartLite = {
    templateName?: string | null;
    templateApprovalStatus?: string | null;
    readyForRealSend?: boolean;
};

export type RealSendAssessment = {
    /** Consent-authorized recipients (CRM), not technical sendability */
    consentEligibleCount: number;
    openWindowCount: number;
    /** Consent-eligible without open 24h window (need template) */
    needsTemplateCount: number;
    hasApprovedTemplate: boolean;
    purposeAllowsServiceWindow: boolean;
    hasFreeformBody: boolean;
    modality: SendModality;
    realSendReady: boolean;
    /** Recipients that can technically receive a real message under current content */
    technicallySendableCount: number;
    blockReason: string | null;
    statusLabel: string;
};

/** Marketing / "other" must not use the service window to bypass commercial rules. */
export function purposeAllowsServiceWindowFreeform(
    purpose: string | null | undefined
): boolean {
    const p = String(purpose || "").toLowerCase();
    return p === "utility" || p === "transactional";
}

export function hasApprovedTemplateContent(opts: {
    contentKind?: string | null;
    templateName?: string | null;
    templateApprovalStatus?: string | null;
    messageParts?: TemplatePartLite[] | null;
}): boolean {
    const campaignLevelApproved =
        Boolean(opts.templateName) &&
        String(opts.templateApprovalStatus || "").toUpperCase() === "APPROVED";

    if (opts.contentKind === "bulletin" && opts.messageParts?.length) {
        // readyForRealSend must be true — APPROVED alone is not enough
        // (incomplete_fields / body overflow keep status APPROVED with ready=false)
        const partsReady = opts.messageParts.every(
            (p) =>
                Boolean(p.templateName) &&
                String(p.templateApprovalStatus || "").toUpperCase() ===
                    "APPROVED" &&
                p.readyForRealSend === true
        );
        // Campaign-level APPROVED covers boletim completo + fallback fora da janela
        return partsReady || campaignLevelApproved;
    }
    return campaignLevelApproved;
}

/** Meta Cloud API interactive body limit (reply buttons). */
export const META_INTERACTIVE_BODY_MAX = 1024;

/**
 * Per-recipient send decision for utility/transactional campaigns.
 * Freeform body on utility/transactional → send immediately (disparador).
 * APPROVED template remains available as alternative.
 */
export type RecipientSendMode = "template" | "freeform" | "skip_no_window";

export function resolveRecipientSendMode(opts: {
    hasApprovedTemplate: boolean;
    purposeAllowsFreeform: boolean;
    hasFreeformBody: boolean;
    windowOpen: boolean;
}): RecipientSendMode {
    const freeformOk =
        opts.purposeAllowsFreeform && opts.hasFreeformBody;
    // Utilidade/Transacional: texto livre dispara para todos os elegíveis
    if (freeformOk) return "freeform";
    if (opts.hasApprovedTemplate) return "template";
    return "skip_no_window";
}

export function assessRealSendReadiness(opts: {
    purpose: string;
    consentEligibleCount: number;
    openWindowCount: number;
    hasApprovedTemplate: boolean;
    hasFreeformBody: boolean;
}): RealSendAssessment {
    const consentEligibleCount = Math.max(0, opts.consentEligibleCount | 0);
    const openWindowCount = Math.min(
        consentEligibleCount,
        Math.max(0, opts.openWindowCount | 0)
    );
    const purposeAllowsServiceWindow = purposeAllowsServiceWindowFreeform(
        opts.purpose
    );

    let modality: SendModality = "none";
    let realSendReady = false;
    let technicallySendableCount = 0;
    let blockReason: string | null = null;
    let statusLabel = "Envio real indisponível";
    let needsTemplateCount = Math.max(
        0,
        consentEligibleCount - openWindowCount
    );

    if (consentEligibleCount <= 0) {
        blockReason =
            "Nenhum destinatário elegível para envio. Importe números válidos ou selecione contatos no CRM.";
        statusLabel = "Bloqueado — sem destinatários elegíveis";
    } else if (
        purposeAllowsServiceWindow &&
        opts.hasFreeformBody
    ) {
        // Utilidade / Transacional + texto (Envio Direto / boletim completo):
        // aprovado para disparo imediato de todos os elegíveis.
        modality = "service_window";
        realSendReady = true;
        technicallySendableCount = consentEligibleCount;
        needsTemplateCount = 0;
        statusLabel = "Aprovado — Envio Direto (Utilidade/Transacional)";
        blockReason = null;
    } else if (opts.hasApprovedTemplate) {
        modality = "template_approved";
        realSendReady = true;
        technicallySendableCount = consentEligibleCount;
        needsTemplateCount = 0;
        statusLabel = "Aprovado — template APPROVED";
    } else if (!purposeAllowsServiceWindow) {
        blockReason =
            "Marketing exige template APPROVED para envio real.";
        statusLabel = "Bloqueado — falta template APPROVED (marketing)";
    } else if (!opts.hasFreeformBody) {
        blockReason =
            "Informe o texto da mensagem na Etapa 1 para liberar o disparo.";
        statusLabel = "Bloqueado — sem texto da mensagem";
    } else {
        blockReason = "Envio real indisponível.";
        statusLabel = "Bloqueado";
    }

    return {
        consentEligibleCount,
        openWindowCount,
        needsTemplateCount,
        hasApprovedTemplate: opts.hasApprovedTemplate,
        purposeAllowsServiceWindow,
        hasFreeformBody: opts.hasFreeformBody,
        modality,
        realSendReady,
        technicallySendableCount,
        blockReason,
        statusLabel,
    };
}

/** Count open 24h windows among consent-eligible waIds. */
export async function countOpenServiceWindows(
    waIds: string[]
): Promise<{ openWindowCount: number; needsTemplateCount: number }> {
    const normalized = Array.from(
        new Set(waIds.map((w) => normalizeWaId(w)).filter((w) => w.length >= 10))
    );
    if (!normalized.length) {
        return { openWindowCount: 0, needsTemplateCount: 0 };
    }

    const lookupKeys = Array.from(
        new Set(normalized.flatMap((w) => brazilianWaIdVariants(w)))
    );

    const convos = await prisma.datafyConversation.findMany({
        where: { waId: { in: lookupKeys } },
        select: { waId: true, lastCustomerMessageAt: true },
    });
    const byWa = new Map(
        convos.map((c) => [c.waId, c.lastCustomerMessageAt] as const)
    );

    let openWindowCount = 0;
    for (const wa of normalized) {
        const open = brazilianWaIdVariants(wa).some((key) =>
            isWithinServiceWindow(byWa.get(key) ?? null)
        );
        if (open) openWindowCount++;
    }
    return {
        openWindowCount,
        needsTemplateCount: normalized.length - openWindowCount,
    };
}

export async function recipientHasOpenServiceWindow(
    waId: string
): Promise<boolean> {
    const keys = brazilianWaIdVariants(waId);
    if (!keys.length) return false;
    const convos = await prisma.datafyConversation.findMany({
        where: { waId: { in: keys } },
        select: { lastCustomerMessageAt: true },
    });
    return convos.some((c) =>
        isWithinServiceWindow(c.lastCustomerMessageAt ?? null)
    );
}
