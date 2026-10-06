import { DisconnectReason } from "@whiskeysockets/baileys";

export type SessionConnStatus =
    | "DISCONNECTED"
    | "CONNECTING"
    | "SCAN_QR"
    | "CONNECTED"
    | "STOPPED"
    | "LOGGED_OUT";

/** Statuses where startSession must be a no-op (already live / connecting). */
export const ACTIVE_OR_CONNECTING: ReadonlySet<string> = new Set([
    "CONNECTED",
    "CONNECTING",
    "SCAN_QR",
]);

/**
 * Per-instance connection lifecycle guard.
 * Ensures at most one init in flight, one reconnect timer, and generation-scoped events.
 */
export class ConnectionLifecycle {
    private generation = 0;
    private activeGeneration = 0;
    private initPromise: Promise<void> | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectTimerGeneration = -1;
    isStopped = false;
    status: SessionConnStatus = "DISCONNECTED";
    /** Generations for which open-side service binds already ran. */
    private servicesBoundGeneration = -1;

    get currentGeneration(): number {
        return this.activeGeneration;
    }

    get hasInitInFlight(): boolean {
        return this.initPromise !== null;
    }

    get hasReconnectTimer(): boolean {
        return this.reconnectTimer !== null;
    }

    /** True if an event from this generation should still be applied. */
    isCurrentGeneration(generation: number): boolean {
        return !this.isStopped && generation === this.activeGeneration;
    }

    shouldBindServices(generation: number): boolean {
        if (!this.isCurrentGeneration(generation)) return false;
        if (this.servicesBoundGeneration === generation) return false;
        this.servicesBoundGeneration = generation;
        return true;
    }

    /**
     * Run init exclusively. Concurrent callers await the same promise.
     * `factory` receives the generation token for the new socket.
     */
    async runExclusiveInit(factory: (generation: number) => Promise<void>): Promise<void> {
        if (this.isStopped) return;

        if (this.initPromise) {
            return this.initPromise;
        }

        // Already live or waiting for QR/open — never spawn a second socket
        if (
            this.status === "CONNECTED" ||
            this.status === "SCAN_QR" ||
            this.status === "CONNECTING"
        ) {
            return;
        }

        this.initPromise = (async () => {
            this.clearReconnectTimer();
            const generation = ++this.generation;
            this.activeGeneration = generation;
            this.status = "CONNECTING";
            try {
                await factory(generation);
            } catch (err) {
                // Init failed before open — allow a future start/reconnect
                if (this.isCurrentGeneration(generation) && !this.isStopped) {
                    this.status = "DISCONNECTED";
                }
                throw err;
            }
        })().finally(() => {
            this.initPromise = null;
        });

        return this.initPromise;
    }

    clearReconnectTimer(): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
            this.reconnectTimerGeneration = -1;
        }
    }

    /**
     * Schedule a single reconnect. Cancels any previous timer first.
     * Fires only if still current generation and not stopped.
     */
    scheduleReconnect(delayMs: number, onFire: () => void): void {
        this.clearReconnectTimer();
        if (this.isStopped) return;

        const gen = this.activeGeneration;
        this.reconnectTimerGeneration = gen;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.reconnectTimerGeneration = -1;
            if (this.isStopped) return;
            if (gen !== this.activeGeneration) return;
            onFire();
        }, delayMs);
    }

    /**
     * Invalidate all pending work (shutdown / restart).
     * Bumps generation so stale socket events are ignored.
     */
    invalidate(opts: { stop: boolean }): void {
        this.clearReconnectTimer();
        this.generation += 1;
        this.activeGeneration = this.generation;
        this.servicesBoundGeneration = -1;
        if (opts.stop) {
            this.isStopped = true;
            this.status = "STOPPED";
        }
        // In-flight init will finish but its events become stale via generation check
    }

    /** Allow a stopped instance to start again (manager startSession). */
    resumeForStart(): void {
        this.isStopped = false;
        if (this.status === "STOPPED" || this.status === "LOGGED_OUT") {
            this.status = "DISCONNECTED";
        }
    }

    markConnected(generation: number): boolean {
        if (!this.isCurrentGeneration(generation)) return false;
        this.status = "CONNECTED";
        return true;
    }

    markScanQr(generation: number): boolean {
        if (!this.isCurrentGeneration(generation)) return false;
        this.status = "SCAN_QR";
        return true;
    }

    markDisconnected(generation: number): boolean {
        if (!this.isCurrentGeneration(generation)) return false;
        this.status = "DISCONNECTED";
        return true;
    }

    markLoggedOut(generation: number): boolean {
        if (!this.isCurrentGeneration(generation)) return false;
        this.isStopped = true;
        this.clearReconnectTimer();
        this.status = "LOGGED_OUT";
        return true;
    }

    markStopped(generation: number): boolean {
        if (generation !== this.activeGeneration && !this.isStopped) {
            // Explicit stop may already have bumped generation via invalidate
        }
        this.isStopped = true;
        this.clearReconnectTimer();
        this.status = "STOPPED";
        return true;
    }
}

/** Safe disconnect summary — never includes credentials or key material. */
export function describeDisconnect(lastDisconnect: unknown): {
    code: number | undefined;
    reason: string | undefined;
    conflictType: string | undefined;
} {
    const err = (lastDisconnect as { error?: any } | undefined)?.error;
    const code: number | undefined = err?.output?.statusCode;
    const payload = err?.output?.payload;
    const data = err?.data;
    const rawType = payload?.type ?? data?.type;
    const conflictType = typeof rawType === "string" ? rawType.slice(0, 64) : undefined;

    let reason: string | undefined;
    if (typeof code === "number") {
        reason = (DisconnectReason as Record<number, string>)[code] || String(code);
    }

    return { code, reason, conflictType };
}

/** AuthState wipe is ONLY allowed on loggedOut. */
export function shouldWipeAuthState(disconnectCode: number | undefined): boolean {
    return disconnectCode === DisconnectReason.loggedOut;
}

/** Whether this close should schedule an automatic reconnect. */
export function shouldScheduleReconnect(opts: {
    isStopped: boolean;
    disconnectCode: number | undefined;
    reconnectCount: number;
    maxAttempts: number;
}): boolean {
    if (opts.isStopped) return false;
    if (shouldWipeAuthState(opts.disconnectCode)) return false;
    return opts.reconnectCount <= opts.maxAttempts;
}
