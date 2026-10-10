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
    if (opts.contentKind === "bulletin" && opts.messageParts?.length) {
        // readyForRealSend must be true — APPROVED alone is not enough
        // (incomplete_fields / body overflow keep status APPROVED with ready=false)
        return opts.messageParts.every(
            (p) =>
                Boolean(p.templateName) &&
                String(p.templateApprovalStatus || "").toUpperCase() ===
                    "APPROVED" &&
                p.readyForRealSend === true
        );
    }
    return (
        Boolean(opts.templateName) &&
        String(opts.templateApprovalStatus || "").toUpperCase() === "APPROVED"
    );
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
    const needsTemplateCount = Math.max(
        0,
        consentEligibleCount - openWindowCount
    );
    const purposeAllowsServiceWindow = purposeAllowsServiceWindowFreeform(
        opts.purpose
    );

    let modality: SendModality = "none";
    let realSendReady = false;
    let technicallySendableCount = 0;
    let blockReason: string | null = null;
    let statusLabel = "Envio real indisponível";

    if (consentEligibleCount <= 0) {
        blockReason =
            "Nenhum destinatário com consentimento válido para envio real. “Apto” aqui exige autorização no CRM — não implica disponibilidade técnica.";
        statusLabel = "Bloqueado — sem consentimento elegível";
    } else if (opts.hasApprovedTemplate) {
        modality = "template_approved";
        realSendReady = true;
        technicallySendableCount = consentEligibleCount;
        statusLabel =
            "Pronto — Modalidade A (template APPROVED via API Datafy)";
    } else if (
        purposeAllowsServiceWindow &&
        opts.hasFreeformBody &&
        openWindowCount > 0
    ) {
        modality = "service_window";
        realSendReady = true;
        technicallySendableCount = openWindowCount;
        statusLabel =
            "Pronto — Modalidade B (janela 24h · resposta livre). Campanhas comerciais (marketing) não usam esta via.";
        if (needsTemplateCount > 0) {
            statusLabel += ` ${needsTemplateCount} destinatário(s) sem janela ficarão bloqueados no envio.`;
        }
    } else if (!opts.hasApprovedTemplate && !purposeAllowsServiceWindow) {
        blockReason =
            "Modalidade C — sem template APPROVED. Divulgação comercial exige template aprovado; a janela de atendimento não contorna regras de marketing.";
        statusLabel = "Bloqueado — falta template APPROVED (marketing)";
    } else if (!opts.hasApprovedTemplate && purposeAllowsServiceWindow) {
        if (!opts.hasFreeformBody) {
            blockReason =
                "Modalidade C — sem template APPROVED e sem texto livre para resposta na janela 24h.";
        } else if (openWindowCount <= 0) {
            blockReason =
                "Modalidade C — sem template APPROVED e nenhum destinatário com janela de atendimento aberta (últimas 24h).";
        } else {
            blockReason = "Modalidade C — envio real indisponível.";
        }
        statusLabel = "Bloqueado — sem autorização técnica";
    } else {
        blockReason = "Modalidade C — envio real indisponível.";
        statusLabel = "Bloqueado — sem autorização técnica";
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

    const convos = await prisma.datafyConversation.findMany({
        where: { waId: { in: normalized } },
        select: { waId: true, lastCustomerMessageAt: true },
    });
    const byWa = new Map(
        convos.map((c) => [c.waId, c.lastCustomerMessageAt] as const)
    );

    let openWindowCount = 0;
    for (const wa of normalized) {
        if (isWithinServiceWindow(byWa.get(wa) ?? null)) {
            openWindowCount++;
        }
    }
    return {
        openWindowCount,
        needsTemplateCount: normalized.length - openWindowCount,
    };
}

export async function recipientHasOpenServiceWindow(
    waId: string
): Promise<boolean> {
    const normalized = normalizeWaId(waId);
    if (!normalized) return false;
    const convo = await prisma.datafyConversation.findFirst({
        where: { waId: normalized },
        select: { lastCustomerMessageAt: true },
    });
    return isWithinServiceWindow(convo?.lastCustomerMessageAt ?? null);
}
