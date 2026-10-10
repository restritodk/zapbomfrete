import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildEstimateCopy,
    CAMPAIGN_DELAY_MS_MAX,
    CAMPAIGN_DELAY_MS_MIN,
    DEFAULT_CAMPAIGN_DELAY_MS,
    DEFAULT_CAMPAIGN_DELAY_SEC,
    delaySecondsFromMs,
    effectiveRetryDelayMs,
    estimateWaitMs,
    formatDurationPt,
    isSendSlotEligible,
    nextEligibleAfterClaim,
    normalizeCampaignDelayMs,
    parseDelaySeconds,
} from "./pacing";
import { META_FREEFORM_TEXT_MAX } from "./bulletin/types";

/** In-memory stand-in for claimCampaignSendSlot (tests A/B/C/E/F/G without DB). */
function createMemoryPacer(initialDelayMs: number) {
    let status: "running" | "paused" | "cancelled" = "running";
    let nextSendEligibleAt: Date | null = null;
    let delayMs = initialDelayMs;
    const attemptStarts: number[] = [];

    function claim(now: Date): {
        ok: boolean;
        claimedAt?: Date;
        nextEligibleAt?: Date;
        reason?: string;
    } {
        if (status !== "running") {
            return { ok: false, reason: "not_running" };
        }
        if (!isSendSlotEligible(nextSendEligibleAt, now)) {
            return { ok: false, reason: "not_eligible" };
        }
        // Simulate atomic compare-and-set
        const snapshot = nextSendEligibleAt?.getTime() ?? null;
        if (
            snapshot !== null &&
            snapshot > now.getTime()
        ) {
            return { ok: false, reason: "not_eligible" };
        }
        const next = nextEligibleAfterClaim(now, delayMs);
        nextSendEligibleAt = next;
        attemptStarts.push(now.getTime());
        return { ok: true, claimedAt: now, nextEligibleAt: next };
    }

    return {
        attemptStarts,
        get nextSendEligibleAt() {
            return nextSendEligibleAt;
        },
        setStatus(s: typeof status) {
            status = s;
        },
        setDelayMs(ms: number) {
            delayMs = ms;
        },
        /** Simulate PM2 restart: only persisted nextSendEligibleAt remains. */
        restart() {
            /* status + nextSendEligibleAt persist; in-memory timers do not */
        },
        claim,
        /** Two workers race at the same instant — only one may win. */
        raceClaim(now: Date) {
            const a = claim(now);
            const b = claim(now);
            return { a, b };
        },
    };
}

describe("campaign pacing — delay normalization", () => {
    it("Test D — rejects invalid seconds (0, negative, decimal, <3, >60)", () => {
        assert.equal(parseDelaySeconds(0).ok, false);
        assert.equal(parseDelaySeconds(-1).ok, false);
        assert.equal(parseDelaySeconds(2).ok, false);
        assert.equal(parseDelaySeconds(61).ok, false);
        assert.equal(parseDelaySeconds(10.5).ok, false);
        assert.equal(parseDelaySeconds("abc").ok, false);
        const ok = parseDelaySeconds(10);
        assert.equal(ok.ok, true);
        if (ok.ok) {
            assert.equal(ok.delayMs, 10_000);
            assert.equal(ok.seconds, 10);
        }
    });

    it("normalizes ms and guards double-conversion (10_000_000 → default)", () => {
        assert.equal(normalizeCampaignDelayMs(10_000), 10_000);
        assert.equal(normalizeCampaignDelayMs(3_000), CAMPAIGN_DELAY_MS_MIN);
        assert.equal(normalizeCampaignDelayMs(60_000), CAMPAIGN_DELAY_MS_MAX);
        assert.equal(
            normalizeCampaignDelayMs(10_000_000),
            DEFAULT_CAMPAIGN_DELAY_MS
        );
        assert.equal(
            normalizeCampaignDelayMs(1200, { allowLegacyBelowMin: true }),
            CAMPAIGN_DELAY_MS_MIN
        );
        assert.equal(delaySecondsFromMs(10_000), 10);
        assert.equal(DEFAULT_CAMPAIGN_DELAY_SEC, 10);
    });
});

describe("campaign pacing — real interval between attempt starts", () => {
    it("Test A — 3s: next attempt not before +3000ms", () => {
        const p = createMemoryPacer(3_000);
        const t0 = new Date("2026-10-10T10:00:00.000Z");
        assert.equal(p.claim(t0).ok, true);
        assert.equal(p.claim(new Date(t0.getTime() + 2_999)).ok, false);
        assert.equal(p.claim(new Date(t0.getTime() + 3_000)).ok, true);
        assert.deepEqual(p.attemptStarts, [t0.getTime(), t0.getTime() + 3_000]);
    });

    it("Test B — 10s: five recipients respect minimum spacing", () => {
        const p = createMemoryPacer(10_000);
        const t0 = new Date("2026-10-10T10:00:00.000Z").getTime();
        for (let i = 0; i < 5; i++) {
            const at = new Date(t0 + i * 10_000);
            assert.equal(p.claim(at).ok, true, `recipient ${i}`);
            // too early for next
            if (i < 4) {
                assert.equal(
                    p.claim(new Date(at.getTime() + 9_999)).ok,
                    false
                );
            }
        }
        assert.equal(p.attemptStarts.length, 5);
        for (let i = 1; i < 5; i++) {
            assert.ok(
                p.attemptStarts[i]! - p.attemptStarts[i - 1]! >= 10_000,
                `gap ${i}`
            );
        }
    });

    it("Test C — 60s: next attempt not before +60000ms", () => {
        const p = createMemoryPacer(60_000);
        const t0 = new Date("2026-10-10T10:00:00.000Z");
        assert.equal(p.claim(t0).ok, true);
        assert.equal(p.claim(new Date(t0.getTime() + 59_999)).ok, false);
        assert.equal(p.claim(new Date(t0.getTime() + 60_000)).ok, true);
    });

    it("Test E — two workers at same instant: only one claim succeeds", () => {
        const p = createMemoryPacer(10_000);
        const now = new Date("2026-10-10T10:00:00.000Z");
        const { a, b } = p.raceClaim(now);
        assert.equal(a.ok, true);
        assert.equal(b.ok, false);
        assert.equal(p.attemptStarts.length, 1);
    });

    it("Test F — restart keeps nextSendEligibleAt (no early send)", () => {
        const p = createMemoryPacer(10_000);
        const t0 = new Date("2026-10-10T10:00:00.000Z");
        assert.equal(p.claim(t0).ok, true);
        p.restart();
        assert.equal(p.claim(new Date(t0.getTime() + 5_000)).ok, false);
        assert.equal(p.claim(new Date(t0.getTime() + 10_000)).ok, true);
    });

    it("Test G — pause/resume does not burst accumulated sends", () => {
        const p = createMemoryPacer(10_000);
        const t0 = new Date("2026-10-10T10:00:00.000Z");
        assert.equal(p.claim(t0).ok, true);
        p.setStatus("paused");
        assert.equal(p.claim(new Date(t0.getTime() + 10_000)).ok, false);
        // Resume after long pause — first send allowed only when eligible
        p.setStatus("running");
        // Eligibility from prior claim still in future relative to t0+5s
        assert.equal(p.claim(new Date(t0.getTime() + 5_000)).ok, false);
        // After interval elapsed, one send — not a burst of many
        assert.equal(p.claim(new Date(t0.getTime() + 10_000)).ok, true);
        assert.equal(p.claim(new Date(t0.getTime() + 10_000)).ok, false);
        assert.equal(p.attemptStarts.length, 2);
    });

    it("Test H — complete bulletin (1 part): interval between recipients only", () => {
        const partsPerRecipient = 1; // 8 cargas in one message
        const recipients = 3;
        const delayMs = 10_000;
        const wait = estimateWaitMs(recipients * partsPerRecipient, delayMs);
        assert.equal(wait, 20_000);
        const p = createMemoryPacer(delayMs);
        const t0 = new Date("2026-10-10T10:00:00.000Z").getTime();
        for (let i = 0; i < recipients; i++) {
            assert.equal(p.claim(new Date(t0 + i * delayMs)).ok, true);
        }
        assert.equal(p.attemptStarts.length, 3);
    });

    it("Test I — split bulletin parts: interval between each part send", () => {
        const parts = 3;
        const delayMs = 5_000;
        const p = createMemoryPacer(delayMs);
        const t0 = new Date("2026-10-10T10:00:00.000Z").getTime();
        // Same recipient, 3 parts → 3 attempt starts spaced by delay
        for (let i = 0; i < parts; i++) {
            assert.equal(p.claim(new Date(t0 + i * delayMs)).ok, true);
        }
        assert.equal(estimateWaitMs(parts, delayMs), 10_000);
        assert.equal(p.attemptStarts.length, 3);
    });

    it("Test J — Datafy 429 uses max(campaignDelay, providerRetry)", () => {
        assert.equal(effectiveRetryDelayMs(10_000, 5), 10_000);
        assert.equal(effectiveRetryDelayMs(10_000, 45), 45_000);
        assert.equal(effectiveRetryDelayMs(3_000, null), 3_000);
    });

    it("Test K — freeform limit 5000 remains independent of template 1024", () => {
        assert.equal(META_FREEFORM_TEXT_MAX, 5000);
        assert.ok(META_FREEFORM_TEXT_MAX > 1024);
    });
});

describe("campaign pacing — estimate copy", () => {
    it("formats wait duration in Portuguese", () => {
        assert.equal(formatDurationPt(10_000), "10 segundos");
        assert.equal(formatDurationPt(90_000), "1 minuto e 30 segundos");
        assert.equal(formatDurationPt(120_000), "2 minutos");
    });

    it("builds estimate for 100 messages @ 10s ≈ 16m30s wait", () => {
        const copy = buildEstimateCopy({
            recipientCount: 100,
            partsPerRecipient: 1,
            delaySeconds: 10,
        });
        assert.match(copy, /100 mensagens/);
        assert.match(copy, /16 minutos e 30 segundos/);
        assert.equal(estimateWaitMs(100, 10_000), 99 * 10_000);
    });
});
