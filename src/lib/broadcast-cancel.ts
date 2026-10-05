/**
 * In-process cancel registry for running broadcasts.
 * Shared via globalThis so the API route and the background send loop
 * see the same AbortController in the custom Node server.
 */

export const CANCELLED_RECIPIENT_DETAIL = "Não enviado — disparo cancelado";

type CancelEntry = {
    controller: AbortController;
    sessionId: string;
};

type GlobalCancelStore = {
    __broadcastCancelRegistry?: Map<string, CancelEntry>;
};

function getRegistry(): Map<string, CancelEntry> {
    const g = globalThis as GlobalCancelStore;
    if (!g.__broadcastCancelRegistry) {
        g.__broadcastCancelRegistry = new Map();
    }
    return g.__broadcastCancelRegistry;
}

/** Register (or replace) a cancel controller for a running broadcast. */
export function registerBroadcastCancel(broadcastId: string, sessionId: string): AbortSignal {
    const registry = getRegistry();
    const prev = registry.get(broadcastId);
    if (prev && !prev.controller.signal.aborted) {
        // Replace without aborting a previous unrelated run of the same id (shouldn't happen)
    }
    const controller = new AbortController();
    registry.set(broadcastId, { controller, sessionId });
    return controller.signal;
}

/**
 * Request cancel for a broadcast in a given WA session.
 * Returns:
 * - "aborted" if signal was triggered now
 * - "already" if already aborted
 * - "missing" if no in-memory controller (loop may have finished)
 * - "forbidden" if sessionId does not match the registered session
 */
export function requestBroadcastCancel(
    broadcastId: string,
    sessionId: string
): "aborted" | "already" | "missing" | "forbidden" {
    const entry = getRegistry().get(broadcastId);
    if (!entry) return "missing";
    if (entry.sessionId !== sessionId) return "forbidden";
    if (entry.controller.signal.aborted) return "already";
    entry.controller.abort();
    return "aborted";
}

export function clearBroadcastCancel(broadcastId: string): void {
    getRegistry().delete(broadcastId);
}

export function getBroadcastCancelSignal(broadcastId: string): AbortSignal | null {
    return getRegistry().get(broadcastId)?.controller.signal ?? null;
}

/** Test helper — clears all registrations. */
export function __resetBroadcastCancelRegistryForTests(): void {
    getRegistry().clear();
}
