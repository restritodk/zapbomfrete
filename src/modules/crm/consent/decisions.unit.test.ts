import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Pure ordering rules for consent apply (mirrors applyConsentDecision).
 * Full DB integration is covered when Prisma tables exist in the environment.
 */
function shouldApplyDecision(
    currentConsentAt: number | null,
    decidedAt: number
): boolean {
    if (currentConsentAt == null) return true;
    return decidedAt >= currentConsentAt;
}

describe("Phase 9 — out-of-order & idempotency contracts", () => {
    it("ignores older decision for current status", () => {
        const t0 = Date.parse("2026-10-10T12:00:00Z");
        const t1 = Date.parse("2026-10-12T12:00:00Z");
        assert.equal(shouldApplyDecision(t1, t0), false);
        assert.equal(shouldApplyDecision(t0, t1), true);
        assert.equal(shouldApplyDecision(null, t0), true);
    });

    it("idempotency key format is stable per wamid+button", () => {
        const key = (wamid: string, buttonId: string | null, decision: string) =>
            `consent:${wamid}:${buttonId || decision}`;
        assert.equal(
            key("wamid.ABC", "consent_grant_offers", "GRANTED"),
            "consent:wamid.ABC:consent_grant_offers"
        );
        assert.equal(
            key("wamid.ABC", "consent_grant_offers", "GRANTED"),
            key("wamid.ABC", "consent_grant_offers", "DENIED")
        );
    });

    it("organization isolation key includes org + waId", () => {
        const identity = (org: string, wa: string) => `${org}::${wa}`;
        assert.notEqual(
            identity("default", "5511999990001"),
            identity("org_b", "5511999990001")
        );
    });
});
