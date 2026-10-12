import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    mapConversationStatusBuckets,
    resolveDashboardRange,
} from "./dashboard-panel";

describe("resolveDashboardRange", () => {
    it("defaults to 7d when custom dates are invalid", () => {
        const r = resolveDashboardRange({ period: "custom" });
        assert.equal(r.period, "7d");
        assert.ok(r.from.getTime() < r.to.getTime());
    });

    it("honors custom range", () => {
        const r = resolveDashboardRange({
            period: "custom",
            from: "2026-10-01T00:00:00.000Z",
            to: "2026-10-10T00:00:00.000Z",
        });
        assert.equal(r.period, "custom");
        assert.equal(r.from.toISOString(), "2026-10-01T00:00:00.000Z");
    });

    it("today starts at local midnight", () => {
        const r = resolveDashboardRange({ period: "today" });
        assert.equal(r.period, "today");
        assert.equal(r.from.getHours(), 0);
    });
});

describe("mapConversationStatusBuckets", () => {
    it("maps open/pending/closed without inventing statuses", () => {
        const b = mapConversationStatusBuckets([
            { status: "open", assignedToId: null },
            { status: "open", assignedToId: "u1" },
            { status: "pending", assignedToId: null },
            { status: "closed", assignedToId: "u1" },
        ]);
        assert.equal(b.awaiting, 1);
        assert.equal(b.inService, 1);
        assert.equal(b.awaitingClient, 1);
        assert.equal(b.resolved, 1);
        assert.equal(b.total, 4);
    });
});
