import {
    computeInterRecipientDelayMs,
    shouldDelayAfterRecipient,
    sleepMs,
} from "./broadcast-delay";

export type BroadcastSendResult = "sent" | "failed";

export type BroadcastRunnerResult = {
    sent: number;
    failed: number;
    cancelled: number;
    /** JIDs that actually started sendOne (sent or failed). */
    processedJids: string[];
    /** JIDs never started because of cancel. */
    cancelledJids: string[];
    status: "completed" | "cancelled";
};

export type BroadcastRunnerDeps = {
    recipients: string[];
    delayMs: number;
    signal: AbortSignal;
    sendOne: (jid: string, index: number) => Promise<BroadcastSendResult>;
    /** Injectable sleep (defaults to interruptible sleepMs). */
    sleep?: (
        ms: number,
        signal?: AbortSignal
    ) => Promise<"completed" | "aborted">;
    /** Injectable delay calculator (defaults to production jitter). */
    computeDelay?: (baseMs: number) => number;
    onBeforeSend?: (jid: string, index: number) => void | Promise<void>;
    onAfterSend?: (
        jid: string,
        index: number,
        result: BroadcastSendResult
    ) => void | Promise<void>;
};

/**
 * Sequential broadcast send loop with cancel-safe race guards.
 *
 * - Checks AbortSignal BEFORE starting each recipient (no new send after cancel).
 * - Does NOT abort an in-flight sendOne (Baileys may finish).
 * - Inter-recipient delay is interruptible via the same signal.
 */
export async function runBroadcastSendLoop(
    deps: BroadcastRunnerDeps
): Promise<BroadcastRunnerResult> {
    const {
        recipients,
        delayMs,
        signal,
        sendOne,
        onBeforeSend,
        onAfterSend,
    } = deps;
    const sleep = deps.sleep ?? sleepMs;
    const computeDelay = deps.computeDelay ?? ((base: number) => computeInterRecipientDelayMs(base));

    let sent = 0;
    let failed = 0;
    const processedJids: string[] = [];
    let cancelled = false;

    for (let i = 0; i < recipients.length; i++) {
        // Race guard: cancel recognized → never start the next recipient
        if (signal.aborted) {
            cancelled = true;
            const cancelledJids = recipients.slice(i);
            return {
                sent,
                failed,
                cancelled: cancelledJids.length,
                processedJids,
                cancelledJids,
                status: "cancelled",
            };
        }

        const jid = recipients[i];
        await onBeforeSend?.(jid, i);

        // Re-check after async onBeforeSend (another cancel window)
        if (signal.aborted) {
            cancelled = true;
            const cancelledJids = recipients.slice(i);
            return {
                sent,
                failed,
                cancelled: cancelledJids.length,
                processedJids,
                cancelledJids,
                status: "cancelled",
            };
        }

        const result = await sendOne(jid, i);
        processedJids.push(jid);
        if (result === "sent") sent++;
        else failed++;
        await onAfterSend?.(jid, i, result);

        // Cancel during/after sendMessage: current recipient already counted; stop before delay/next
        if (signal.aborted) {
            cancelled = true;
            const cancelledJids = recipients.slice(i + 1);
            return {
                sent,
                failed,
                cancelled: cancelledJids.length,
                processedJids,
                cancelledJids,
                status: "cancelled",
            };
        }

        if (shouldDelayAfterRecipient(i, recipients.length)) {
            const waitMs = computeDelay(delayMs);
            const sleepResult = await sleep(waitMs, signal);
            if (sleepResult === "aborted" || signal.aborted) {
                cancelled = true;
                const cancelledJids = recipients.slice(i + 1);
                return {
                    sent,
                    failed,
                    cancelled: cancelledJids.length,
                    processedJids,
                    cancelledJids,
                    status: "cancelled",
                };
            }
        }
    }

    return {
        sent,
        failed,
        cancelled: 0,
        processedJids,
        cancelledJids: [],
        status: cancelled ? "cancelled" : "completed",
    };
}
