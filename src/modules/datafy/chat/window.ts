/** WhatsApp Cloud API customer service window = 24 hours from last inbound. */

export const DATAFY_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinServiceWindow(
    lastCustomerMessageAt: Date | string | null | undefined,
    now: Date = new Date()
): boolean {
    if (!lastCustomerMessageAt) return false;
    const t =
        lastCustomerMessageAt instanceof Date
            ? lastCustomerMessageAt.getTime()
            : new Date(lastCustomerMessageAt).getTime();
    if (!Number.isFinite(t)) return false;
    return now.getTime() - t < DATAFY_SERVICE_WINDOW_MS;
}

export function serviceWindowExpiresAt(
    lastCustomerMessageAt: Date | string | null | undefined
): Date | null {
    if (!lastCustomerMessageAt) return null;
    const base =
        lastCustomerMessageAt instanceof Date
            ? lastCustomerMessageAt
            : new Date(lastCustomerMessageAt);
    if (Number.isNaN(base.getTime())) return null;
    return new Date(base.getTime() + DATAFY_SERVICE_WINDOW_MS);
}

export function normalizeWaId(raw: string | null | undefined): string {
    return String(raw || "").replace(/\D/g, "");
}

/**
 * BR mobile numbers may be stored with or without the 9th digit after DDD
 * (55 + DD + 9 + 8 vs 55 + DD + 8). Return both forms so window / conversation
 * lookups do not miss an open 24h session.
 */
export function brazilianWaIdVariants(
    raw: string | null | undefined
): string[] {
    const n = normalizeWaId(raw);
    if (!n || n.length < 10) return n ? [n] : [];
    const out = new Set<string>([n]);
    if (n.startsWith("55") && n.length === 13) {
        const ddd = n.slice(2, 4);
        const rest = n.slice(4);
        if (rest.length === 9 && rest.startsWith("9")) {
            out.add(`55${ddd}${rest.slice(1)}`);
        }
    } else if (n.startsWith("55") && n.length === 12) {
        const ddd = n.slice(2, 4);
        const rest = n.slice(4);
        if (rest.length === 8) {
            out.add(`55${ddd}9${rest}`);
        }
    }
    return Array.from(out);
}
