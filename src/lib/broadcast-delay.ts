/**
 * Broadcast inter-recipient delay helpers (server + tests).
 * Delay is always expressed in milliseconds.
 */

export const BROADCAST_DELAY_MIN_MS = 1000;
export const BROADCAST_DELAY_MAX_MS = 15000;
export const BROADCAST_DELAY_DEFAULT_MS = 2000;

/** Max additive jitter as a fraction of the base delay (never reduces the base). */
export const BROADCAST_DELAY_JITTER_FRACTION = 0.5;

/**
 * Parse and clamp a configured delay.
 * Accepts numbers or numeric strings (e.g. "3500", "3500.0").
 * Uses Number() — never parseInt — so fractional ms are not truncated before rounding.
 */
export function normalizeBroadcastDelayMs(raw: unknown): number {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        return BROADCAST_DELAY_DEFAULT_MS;
    }
    const ms = Math.round(n);
    if (ms < BROADCAST_DELAY_MIN_MS) return BROADCAST_DELAY_MIN_MS;
    if (ms > BROADCAST_DELAY_MAX_MS) return BROADCAST_DELAY_MAX_MS;
    return ms;
}

/**
 * Compute wait between recipient N and N+1.
 * Guarantees: result >= baseDelayMs (after normalize).
 * Jitter only ADDS up to +50% of the base (exclusive upper bound via Math.floor(random * 0.5 * base)).
 */
export function computeInterRecipientDelayMs(
    baseDelayMs: number,
    random: () => number = Math.random
): number {
    const base = normalizeBroadcastDelayMs(baseDelayMs);
    const r = typeof random === "function" ? random() : Math.random();
    const unit = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0;
    const jitter = Math.floor(unit * (base * BROADCAST_DELAY_JITTER_FRACTION));
    return base + jitter;
}

/**
 * Sleep that can be interrupted by AbortSignal (used between recipients).
 * Resolves `"completed"` when the full wait elapsed, `"aborted"` if cancelled.
 * Never rejects on abort — callers check the return value / signal.
 */
export function sleepMs(
    ms: number,
    signal?: AbortSignal
): Promise<"completed" | "aborted"> {
    const wait = Math.max(0, Math.round(ms));
    if (signal?.aborted) return Promise.resolve("aborted");
    if (wait === 0) return Promise.resolve("completed");

    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            if (signal) signal.removeEventListener("abort", onAbort);
            resolve("completed");
        }, wait);

        const onAbort = () => {
            clearTimeout(timer);
            resolve("aborted");
        };

        if (signal) {
            signal.addEventListener("abort", onAbort, { once: true });
        }
    });
}

/**
 * Whether a delay should run after finishing recipient index `i`
 * in a list of `total` processable recipients.
 * No delay before the first; no delay after the last.
 */
export function shouldDelayAfterRecipient(index: number, total: number): boolean {
    return total > 1 && index >= 0 && index < total - 1;
}
