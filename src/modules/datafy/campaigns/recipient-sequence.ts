/**
 * Recipient-major send ordering for multi-template campaigns.
 *
 * Correct: Dest1→T1,T2,T3 then Dest2→T1,T2,T3 …
 * Wrong:   T1→all dests, then T2→all dests, then T3→all dests
 */

import type { CampaignMessagePart } from "./bulletin/types";

export type ConsentButtonPlacement = "last_only" | "per_template_approved";

export type ApprovedQuickReply = {
    text: string;
    type: string;
    index: number;
};

/** Flatten recipient × parts into send units (recipient-major, part order preserved). */
export function planRecipientMajorSendOrder(opts: {
    recipientIds: string[];
    parts: Array<{ index: number; templateName?: string | null }>;
}): Array<{
    recipientId: string;
    partIndex: number;
    templateName: string | null;
    globalOrder: number;
}> {
    const parts = [...opts.parts].sort((a, b) => a.index - b.index);
    const out: Array<{
        recipientId: string;
        partIndex: number;
        templateName: string | null;
        globalOrder: number;
    }> = [];
    let g = 0;
    for (const recipientId of opts.recipientIds) {
        for (const part of parts) {
            out.push({
                recipientId,
                partIndex: part.index,
                templateName: part.templateName || null,
                globalOrder: g++,
            });
        }
    }
    return out;
}

export function expectedMessageTotal(
    recipientCount: number,
    partCount: number
): number {
    return Math.max(0, recipientCount) * Math.max(1, partCount);
}

/** Extract QUICK_REPLY buttons from Meta/Datafy template components JSON. */
export function extractApprovedQuickReplyButtons(
    components: unknown
): ApprovedQuickReply[] {
    if (!Array.isArray(components)) return [];
    const out: ApprovedQuickReply[] = [];
    for (const raw of components) {
        const c = raw as {
            type?: string;
            buttons?: Array<{ type?: string; text?: string }>;
        };
        if (String(c.type || "").toUpperCase() !== "BUTTONS") continue;
        const buttons = Array.isArray(c.buttons) ? c.buttons : [];
        buttons.forEach((b, i) => {
            const type = String(b.type || "").toUpperCase();
            if (type !== "QUICK_REPLY" && type !== "QUICKREPLY") return;
            const text = String(b.text || "").trim();
            if (!text) return;
            out.push({ text, type: "QUICK_REPLY", index: i });
        });
    }
    return out;
}

export type ApprovedUrlButton = {
    text: string;
    url: string;
    example?: string[];
    index: number;
};

/** Extract URL CTA buttons from approved template components (immutable). */
export function extractApprovedUrlButtons(
    components: unknown
): ApprovedUrlButton[] {
    if (!Array.isArray(components)) return [];
    const out: ApprovedUrlButton[] = [];
    for (const raw of components) {
        const c = raw as {
            type?: string;
            buttons?: Array<{
                type?: string;
                text?: string;
                url?: string;
                example?: string[];
            }>;
        };
        if (String(c.type || "").toUpperCase() !== "BUTTONS") continue;
        const buttons = Array.isArray(c.buttons) ? c.buttons : [];
        buttons.forEach((b, i) => {
            const type = String(b.type || "").toUpperCase();
            if (type !== "URL") return;
            const text = String(b.text || "").trim();
            const url = String(b.url || "").trim();
            if (!text || !url) return;
            out.push({
                text,
                url,
                example: Array.isArray(b.example) ? b.example : undefined,
                index: i,
            });
        });
    }
    return out;
}

export type ConsentPlacementAssessment = {
    /** Preference can be honored for freeform / detached interactive path */
    freeformLastOnlyPossible: boolean;
    /** All non-last templates have zero approved QUICK_REPLY buttons */
    templateLastOnlyPossible: boolean;
    /** Preferred mode that can actually be sent */
    effectivePlacement: ConsentButtonPlacement;
    warnings: string[];
    /** Per-part approved buttons (index = part index) */
    buttonsByPart: ApprovedQuickReply[][];
};

/**
 * Decide whether "buttons only on last message" is technically possible
 * given approved template components.
 */
export function assessConsentButtonPlacement(opts: {
    preference: ConsentButtonPlacement;
    parts: CampaignMessagePart[];
    consentConfigured: boolean;
    freeformModality: boolean;
}): ConsentPlacementAssessment {
    const sorted = [...opts.parts].sort((a, b) => a.index - b.index);
    const buttonsByPart = sorted.map((p) =>
        extractApprovedQuickReplyButtons(p.templateComponents)
    );
    const warnings: string[] = [];

    const nonLastHaveButtons = buttonsByPart
        .slice(0, -1)
        .some((b) => b.length > 0);
    const templateLastOnlyPossible = !nonLastHaveButtons;

    if (opts.preference === "last_only" && nonLastHaveButtons) {
        warnings.push(
            "Um ou mais templates anteriores à última mensagem já possuem botões QUICK_REPLY aprovados pela Meta. Eles serão enviados nesses templates — não podemos removê-los sem alterar o modelo aprovado."
        );
    }

    if (
        opts.consentConfigured &&
        !opts.freeformModality &&
        opts.preference === "last_only"
    ) {
        const lastButtons = buttonsByPart[buttonsByPart.length - 1] || [];
        if (!lastButtons.length) {
            warnings.push(
                "A última mensagem não possui botões aprovados. Os textos da Etapa 1 não podem ser injetados em templates APPROVED. Prepare um template final com botões para aprovação da Meta ou use Envio Direto (texto livre) na janela 24h."
            );
        } else {
            warnings.push(
                "Na última mensagem serão usados os botões QUICK_REPLY aprovados do template (não os textos livres da Etapa 1)."
            );
        }
    }

    const freeformLastOnlyPossible =
        opts.freeformModality && opts.consentConfigured;

    let effectivePlacement: ConsentButtonPlacement = opts.preference;
    if (
        opts.preference === "last_only" &&
        !opts.freeformModality &&
        !templateLastOnlyPossible
    ) {
        effectivePlacement = "per_template_approved";
    }

    return {
        freeformLastOnlyPossible,
        templateLastOnlyPossible,
        effectivePlacement,
        warnings,
        buttonsByPart,
    };
}

/** Assert plan is recipient-major (for tests / defensive checks). */
export function assertRecipientMajorOrder(
    plan: Array<{ recipientId: string; partIndex: number }>
): boolean {
    if (!plan.length) return true;
    const seen = new Map<string, number>();
    let lastRecipient: string | null = null;
    for (const step of plan) {
        if (lastRecipient && step.recipientId !== lastRecipient) {
            // Previous recipient must have finished all parts (no interleaving)
            // When recipient changes, we never return to an earlier recipient.
            if (seen.has(step.recipientId)) return false;
        }
        const prevPart = seen.get(step.recipientId);
        if (prevPart != null && step.partIndex <= prevPart) return false;
        seen.set(step.recipientId, step.partIndex);
        lastRecipient = step.recipientId;
    }
    return true;
}
