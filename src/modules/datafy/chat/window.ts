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
