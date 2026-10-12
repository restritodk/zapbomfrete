import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    getRejectionDisplay,
    isPlaceholderRejectionReason,
    normalizeRejectionReason,
} from "./rejection-reason";

describe("rejection-reason display rules", () => {
    it("APPROVED + NONE → does not show rejection", () => {
        const d = getRejectionDisplay("APPROVED", "NONE");
        assert.equal(d.show, false);
        assert.equal(d.message, null);
    });

    it("APPROVED + null → does not show rejection", () => {
        const d = getRejectionDisplay("APPROVED", null);
        assert.equal(d.show, false);
    });

    it("APPROVED + stale reason → does not show rejection", () => {
        const d = getRejectionDisplay("APPROVED", "INVALID_FORMAT");
        assert.equal(d.show, false);
    });

    it("REJECTED + valid reason → shows reason", () => {
        const d = getRejectionDisplay("REJECTED", "INVALID_FORMAT");
        assert.equal(d.show, true);
        assert.equal(d.message, "INVALID_FORMAT");
    });

    it("REJECTED + NONE → shows neutral message, never NONE", () => {
        const d = getRejectionDisplay("REJECTED", "NONE");
        assert.equal(d.show, true);
        assert.ok(d.message);
        assert.notEqual(d.message, "NONE");
        assert.match(d.message!, /não informou/i);
    });

    it("PENDING + NONE → does not show rejection", () => {
        assert.equal(getRejectionDisplay("PENDING", "NONE").show, false);
        assert.equal(getRejectionDisplay("pending", "none").show, false);
    });

    it("PAUSED/DISABLED → do not show rejection", () => {
        assert.equal(getRejectionDisplay("PAUSED", "NONE").show, false);
        assert.equal(getRejectionDisplay("DISABLED", "x").show, false);
    });

    it("normalizes placeholders", () => {
        assert.equal(isPlaceholderRejectionReason("NONE"), true);
        assert.equal(isPlaceholderRejectionReason("none"), true);
        assert.equal(isPlaceholderRejectionReason(""), true);
        assert.equal(isPlaceholderRejectionReason(null), true);
        assert.equal(normalizeRejectionReason("NONE"), null);
        assert.equal(normalizeRejectionReason("  INVALID  "), "INVALID");
    });
});
