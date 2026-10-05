import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    BROADCAST_DELAY_DEFAULT_MS,
    BROADCAST_DELAY_MAX_MS,
    BROADCAST_DELAY_MIN_MS,
    computeInterRecipientDelayMs,
    normalizeBroadcastDelayMs,
    shouldDelayAfterRecipient,
    sleepMs,
} from "./broadcast-delay";

describe("normalizeBroadcastDelayMs", () => {
    it("keeps 3s / 3.5s / 5s as exact milliseconds", () => {
        assert.equal(normalizeBroadcastDelayMs(3000), 3000);
        assert.equal(normalizeBroadcastDelayMs(3500), 3500);
        assert.equal(normalizeBroadcastDelayMs(5000), 5000);
        assert.equal(normalizeBroadcastDelayMs("3500"), 3500);
        assert.equal(normalizeBroadcastDelayMs("3500.4"), 3500);
        assert.equal(normalizeBroadcastDelayMs(3500.6), 3501);
    });

    it("does not use integer truncation that would destroy decimals before rounding", () => {
        // Number preserves fraction; Math.round then applies
        assert.equal(normalizeBroadcastDelayMs(3499.6), 3500);
        assert.notEqual(normalizeBroadcastDelayMs("3.5"), 3); // would be wrong if treated as seconds via parseInt
    });

    it("rejects invalid values and clamps to allowed bounds", () => {
        assert.equal(normalizeBroadcastDelayMs(NaN), BROADCAST_DELAY_DEFAULT_MS);
        assert.equal(normalizeBroadcastDelayMs(Infinity), BROADCAST_DELAY_DEFAULT_MS);
        assert.equal(normalizeBroadcastDelayMs(-100), BROADCAST_DELAY_DEFAULT_MS);
        assert.equal(normalizeBroadcastDelayMs(0), BROADCAST_DELAY_DEFAULT_MS);
        assert.equal(normalizeBroadcastDelayMs("abc"), BROADCAST_DELAY_DEFAULT_MS);
        assert.equal(normalizeBroadcastDelayMs(500), BROADCAST_DELAY_MIN_MS);
        assert.equal(normalizeBroadcastDelayMs(60_000), BROADCAST_DELAY_MAX_MS);
    });
});

describe("computeInterRecipientDelayMs", () => {
    it("never returns less than the configured base (3s / 3.5s / 5s)", () => {
        const bases = [3000, 3500, 5000];
        for (const base of bases) {
            for (let i = 0; i < 200; i++) {
                const wait = computeInterRecipientDelayMs(base, () => Math.random());
                assert.ok(
                    wait >= base,
                    `wait ${wait} must be >= base ${base}`
                );
                assert.ok(
                    wait < base + base * 0.5,
                    `wait ${wait} must be < base*1.5 (${base * 1.5})`
                );
            }
        }
    });

    it("jitter only increases the interval (random=0 => exact base; random→1 => base + floor(0.5*base)-ish)", () => {
        assert.equal(computeInterRecipientDelayMs(5000, () => 0), 5000);
        assert.equal(computeInterRecipientDelayMs(5000, () => 0.999999), 5000 + Math.floor(0.999999 * 2500));
        assert.equal(computeInterRecipientDelayMs(3500, () => 0), 3500);
        // Values below base are impossible with additive jitter
        for (let i = 0; i < 100; i++) {
            assert.ok(computeInterRecipientDelayMs(5000, () => i / 100) >= 5000);
        }
    });

    it("normalizes invalid bases before applying jitter", () => {
        assert.equal(computeInterRecipientDelayMs(NaN, () => 0), BROADCAST_DELAY_DEFAULT_MS);
        assert.equal(computeInterRecipientDelayMs(100, () => 0), BROADCAST_DELAY_MIN_MS);
    });
});

describe("shouldDelayAfterRecipient", () => {
    it("has no delay before the first or after the last", () => {
        assert.equal(shouldDelayAfterRecipient(0, 1), false);
        assert.equal(shouldDelayAfterRecipient(0, 4), true);
        assert.equal(shouldDelayAfterRecipient(2, 4), true);
        assert.equal(shouldDelayAfterRecipient(3, 4), false);
        assert.equal(shouldDelayAfterRecipient(-1, 4), false);
    });
});

describe("sleepMs without cancel", () => {
    it("completes normally when no AbortSignal is provided", async () => {
        const result = await sleepMs(5);
        assert.equal(result, "completed");
    });
});

describe("sequential gap contract (mathematical)", () => {
    it("simulates finished→wait→nextStarted gaps always >= configured minimum", () => {
        const base = 3500;
        const finishes = [1_000, 2_000, 3_000]; // relative ms marks after each recipient finishes
        let cursor = 0;
        const starts: number[] = [];
        for (let i = 0; i < finishes.length; i++) {
            starts.push(cursor);
            const finished = cursor + 50; // pretend send took 50ms
            void finished;
            if (shouldDelayAfterRecipient(i, finishes.length)) {
                const wait = computeInterRecipientDelayMs(base, () => 0.25);
                assert.ok(wait >= base);
                cursor = cursor + 50 + wait;
            } else {
                cursor = cursor + 50;
            }
        }
        // Gaps between start[i+1] and (start[i]+50 finish) >= base
        for (let i = 0; i < starts.length - 1; i++) {
            const prevFinish = starts[i] + 50;
            const gap = starts[i + 1] - prevFinish;
            assert.ok(gap >= base, `gap ${gap} < ${base}`);
        }
    });
});
