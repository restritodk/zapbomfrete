/**
 * Prefer live waManager status over DB so Sessions/QR, Groups and
 * Datafy campaign Step 2 share the same connection truth.
 * Does not start, stop or recreate sessions.
 *
 * waManager is loaded lazily to avoid starting cron/side-effects in unit tests.
 */

export function isBaileysConnectedStatus(
    status: string | null | undefined
): boolean {
    return String(status || "").toUpperCase() === "CONNECTED";
}

export function resolveBaileysLiveStatus(
    sessionId: string,
    dbStatus?: string | null
): string {
    try {
        // Lazy require — keeps this module side-effect free for tests
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { waManager } = require("@/modules/whatsapp/manager") as {
            waManager: { getInstance: (id: string) => { status?: string } | undefined };
        };
        const live = waManager.getInstance(sessionId)?.status;
        if (live) return String(live).toUpperCase();
    } catch {
        /* manager unavailable during edge bundling / tests — fall back to DB */
    }
    return String(dbStatus || "DISCONNECTED").toUpperCase();
}
