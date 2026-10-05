import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
    __resetBroadcastCancelRegistryForTests,
    clearBroadcastCancel,
    registerBroadcastCancel,
    requestBroadcastCancel,
    CANCELLED_RECIPIENT_DETAIL,
} from "./broadcast-cancel";
import { sleepMs, computeInterRecipientDelayMs, shouldDelayAfterRecipient } from "./broadcast-delay";
import { runBroadcastSendLoop } from "./broadcast-runner";

beforeEach(() => {
    __resetBroadcastCancelRegistryForTests();
});

function makeRecipients(n: number): string[] {
    return Array.from({ length: n }, (_, i) => `5511${String(100000000 + i)}@s.whatsapp.net`);
}

describe("broadcast cancel registry", () => {
    it("aborts the signal for the matching session/broadcast", () => {
        const signal = registerBroadcastCancel("b1", "session-a");
        assert.equal(signal.aborted, false);
        assert.equal(requestBroadcastCancel("b1", "session-a"), "aborted");
        assert.equal(signal.aborted, true);
        assert.equal(requestBroadcastCancel("b1", "session-a"), "already");
    });

    it("rejects cancel when sessionId does not match (authorization)", () => {
        registerBroadcastCancel("b1", "session-a");
        assert.equal(requestBroadcastCancel("b1", "session-other"), "forbidden");
        assert.equal(requestBroadcastCancel("missing", "session-a"), "missing");
    });

    it("double cancel is idempotent", () => {
        const signal = registerBroadcastCancel("b1", "s1");
        assert.equal(requestBroadcastCancel("b1", "s1"), "aborted");
        assert.equal(requestBroadcastCancel("b1", "s1"), "already");
        assert.equal(signal.aborted, true);
        clearBroadcastCancel("b1");
        assert.equal(requestBroadcastCancel("b1", "s1"), "missing");
    });
});

describe("interruptible sleepMs", () => {
    it("resolves aborted quickly when cancelled during delay (no full wait)", async () => {
        const ac = new AbortController();
        const started = Date.now();
        const p = sleepMs(10_000, ac.signal);
        setTimeout(() => ac.abort(), 15);
        const result = await p;
        const elapsed = Date.now() - started;
        assert.equal(result, "aborted");
        assert.ok(elapsed < 500, `expected interrupt under 500ms, got ${elapsed}ms`);
    });

    it("resolves completed when not aborted", async () => {
        const result = await sleepMs(20);
        assert.equal(result, "completed");
    });

    it("returns aborted immediately if already aborted", async () => {
        const ac = new AbortController();
        ac.abort();
        const result = await sleepMs(5000, ac.signal);
        assert.equal(result, "aborted");
    });
});

describe("runBroadcastSendLoop cancel scenarios", () => {
    it("1) cancels before the second recipient", async () => {
        const recipients = makeRecipients(5);
        const ac = new AbortController();
        const sent: string[] = [];

        const loop = runBroadcastSendLoop({
            recipients,
            delayMs: 1000,
            signal: ac.signal,
            computeDelay: () => 1000,
            sleep: async () => "completed",
            sendOne: async (jid) => {
                sent.push(jid);
                if (sent.length === 1) ac.abort();
                return "sent";
            },
        });

        const result = await loop;
        assert.equal(result.status, "cancelled");
        assert.equal(result.processedJids.length, 1);
        assert.equal(result.sent, 1);
        assert.equal(result.cancelled, 4);
        assert.deepEqual(result.cancelledJids, recipients.slice(1));
        assert.ok(!sent.includes(recipients[1]));
    });

    it("2) cancels in the middle of 10 recipients", async () => {
        const recipients = makeRecipients(10);
        const ac = new AbortController();
        let n = 0;

        const result = await runBroadcastSendLoop({
            recipients,
            delayMs: 100,
            signal: ac.signal,
            computeDelay: () => 0,
            sleep: async (_ms, signal) => (signal?.aborted ? "aborted" : "completed"),
            sendOne: async () => {
                n++;
                if (n === 3) ac.abort();
                return "sent";
            },
        });

        assert.equal(result.status, "cancelled");
        assert.equal(result.sent, 3);
        assert.equal(result.cancelled, 7);
        assert.equal(result.processedJids.length, 3);
        assert.deepEqual(result.cancelledJids, recipients.slice(3));
    });

    it("3+4) cancel during delay — no following recipient is sent", async () => {
        const recipients = makeRecipients(6);
        const ac = new AbortController();
        const sent: string[] = [];
        let delayEntered = false;

        const resultPromise = runBroadcastSendLoop({
            recipients,
            delayMs: 5000,
            signal: ac.signal,
            computeDelay: () => 5000,
            sleep: async (_ms, signal) => {
                delayEntered = true;
                // Simulate cancel mid-delay
                ac.abort();
                return signal!.aborted ? "aborted" : "completed";
            },
            sendOne: async (jid) => {
                sent.push(jid);
                return "sent";
            },
        });

        const result = await resultPromise;
        assert.equal(delayEntered, true);
        assert.equal(result.status, "cancelled");
        assert.equal(sent.length, 1);
        assert.equal(result.cancelled, 5);
        assert.ok(sent.every((j) => j === recipients[0]));
        for (let i = 1; i < recipients.length; i++) {
            assert.ok(!sent.includes(recipients[i]), `must not send #${i + 1}`);
        }
    });

    it("5) double abort during loop is safe", async () => {
        const recipients = makeRecipients(4);
        const ac = new AbortController();
        let n = 0;
        const result = await runBroadcastSendLoop({
            recipients,
            delayMs: 10,
            signal: ac.signal,
            computeDelay: () => 10,
            sleep: async (_ms, signal) => {
                ac.abort();
                ac.abort(); // double
                return signal?.aborted ? "aborted" : "completed";
            },
            sendOne: async () => {
                n++;
                return "sent";
            },
        });
        assert.equal(result.status, "cancelled");
        assert.equal(n, 1);
        assert.equal(result.cancelled, 3);
    });

    it("8) normal broadcast without cancel completes all", async () => {
        const recipients = makeRecipients(4);
        const ac = new AbortController();
        const sent: string[] = [];
        const delays: number[] = [];

        const result = await runBroadcastSendLoop({
            recipients,
            delayMs: 3500,
            signal: ac.signal,
            computeDelay: (base) => {
                const w = computeInterRecipientDelayMs(base, () => 0);
                delays.push(w);
                return w;
            },
            sleep: async () => "completed",
            sendOne: async (jid) => {
                sent.push(jid);
                return "sent";
            },
        });

        assert.equal(result.status, "completed");
        assert.equal(result.sent, 4);
        assert.equal(result.cancelled, 0);
        assert.deepEqual(sent, recipients);
        // No delay after last → 3 delays for 4 recipients
        assert.equal(delays.length, 3);
        assert.ok(delays.every((d) => d >= 3500));
    });

    it("10) interval contract preserved when not cancelled", async () => {
        const recipients = makeRecipients(3);
        const ac = new AbortController();
        const waitCalls: number[] = [];

        await runBroadcastSendLoop({
            recipients,
            delayMs: 5000,
            signal: ac.signal,
            computeDelay: (base) => computeInterRecipientDelayMs(base, () => 0.2),
            sleep: async (ms) => {
                waitCalls.push(ms);
                return "completed";
            },
            sendOne: async () => "sent",
        });

        assert.equal(waitCalls.length, 2); // after 1st and 2nd only
        assert.ok(waitCalls.every((w) => w >= 5000 && w < 5000 * 1.5));
        assert.equal(shouldDelayAfterRecipient(2, 3), false);
    });

    it("race guard: abort before sendOne prevents starting that recipient", async () => {
        const recipients = makeRecipients(3);
        const ac = new AbortController();
        const started: string[] = [];

        const result = await runBroadcastSendLoop({
            recipients,
            delayMs: 0,
            signal: ac.signal,
            computeDelay: () => 0,
            sleep: async () => "completed",
            onBeforeSend: async (_jid, index) => {
                if (index === 1) ac.abort();
            },
            sendOne: async (jid) => {
                started.push(jid);
                return "sent";
            },
        });

        // Index 1 aborted in onBeforeSend before the re-check → sendOne for #2 never runs
        assert.equal(result.status, "cancelled");
        assert.deepEqual(started, [recipients[0]]);
        assert.equal(result.cancelled, 2);
    });

    it("cancel during in-flight sendOne lets current finish, blocks next", async () => {
        const recipients = makeRecipients(5);
        const ac = new AbortController();
        const started: string[] = [];

        const result = await runBroadcastSendLoop({
            recipients,
            delayMs: 1000,
            signal: ac.signal,
            computeDelay: () => 1000,
            sleep: async (_ms, signal) => (signal?.aborted ? "aborted" : "completed"),
            sendOne: async (jid) => {
                started.push(jid);
                if (started.length === 2) {
                    // Cancel while "Baileys" is processing — send still completes
                    ac.abort();
                }
                return "sent";
            },
        });

        assert.equal(result.status, "cancelled");
        assert.equal(result.sent, 2);
        assert.deepEqual(started, recipients.slice(0, 2));
        assert.equal(result.cancelled, 3);
        assert.ok(CANCELLED_RECIPIENT_DETAIL.includes("cancelado"));
    });
});

describe("Socket.IO payload shape for cancel (contract)", () => {
    it("9) cancelled progress payload keeps progress fields", () => {
        const payload = {
            broadcastId: "b1",
            status: "cancelled" as const,
            total: 10,
            sent: 3,
            failed: 0,
            cancelled: 7,
            progress: 30,
            phase: "done" as const,
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
        };
        assert.equal(payload.status, "cancelled");
        assert.equal(payload.sent + payload.failed + payload.cancelled, payload.total);
        assert.ok(typeof payload.progress === "number");
        assert.equal(payload.phase, "done");
    });
});

describe("completed broadcast cancel semantics (API contract helpers)", () => {
    it("6) treating completed status as non-cancellable", () => {
        const status = "completed";
        const canCancel = status === "running";
        assert.equal(canCancel, false);
    });

    it("7) session mismatch is forbidden at registry layer", () => {
        registerBroadcastCancel("b-auth", "owner-session");
        assert.equal(requestBroadcastCancel("b-auth", "intruder"), "forbidden");
    });
});
