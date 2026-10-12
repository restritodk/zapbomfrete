/**
 * Meta/Datafy often returns rejected_reason: "NONE" even for APPROVED templates.
 * Only REJECTED templates should surface a rejection UI.
 */

export function isPlaceholderRejectionReason(
    raw: string | null | undefined
): boolean {
    const s = String(raw ?? "").trim();
    if (!s) return true;
    return /^none$/i.test(s);
}

/** Meaningful reason text, or null for empty / NONE placeholders. */
export function normalizeRejectionReason(
    raw: string | null | undefined
): string | null {
    const s = String(raw ?? "").trim();
    if (!s || isPlaceholderRejectionReason(s)) return null;
    return s;
}

export type RejectionDisplay = {
    show: boolean;
    message: string | null;
};

/**
 * UI decision for the rejection block.
 * - APPROVED / PENDING / PAUSED / DISABLED → never show
 * - REJECTED + real reason → show reason
 * - REJECTED + NONE/empty → show neutral copy (never literal "NONE")
 */
export function getRejectionDisplay(
    status: string | null | undefined,
    rawReason: string | null | undefined
): RejectionDisplay {
    const st = String(status || "").toUpperCase();
    if (st !== "REJECTED") {
        return { show: false, message: null };
    }
    const normalized = normalizeRejectionReason(rawReason);
    if (normalized) {
        return { show: true, message: normalized };
    }
    return {
        show: true,
        message:
            "A Meta não informou um motivo detalhado para a rejeição.",
    };
}
