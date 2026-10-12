import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    formatCampaignDateParts,
    resolveCampaignFinishedAt,
    resolveCampaignStartedAt,
    periodToDateRange,
} from "./datetime";

describe("mass-dispatch datetime", () => {
    it("does not invent startedAt from missing value", () => {
        assert.equal(resolveCampaignStartedAt({}), null);
        assert.equal(resolveCampaignStartedAt({ startedAt: null }), null);
    });

    it("finishedAt uses completedAt for completed", () => {
        assert.equal(
            resolveCampaignFinishedAt({
                status: "completed",
                completedAt: "2026-10-12T20:00:00.000Z",
                cancelledAt: null,
            }),
            "2026-10-12T20:00:00.000Z"
        );
    });

    it("finishedAt uses cancelledAt for cancelled, not completedAt", () => {
        assert.equal(
            resolveCampaignFinishedAt({
                status: "cancelled",
                completedAt: "2026-10-12T20:00:00.000Z",
                cancelledAt: "2026-10-12T19:00:00.000Z",
            }),
            "2026-10-12T19:00:00.000Z"
        );
    });

    it("running/scheduled/paused have no finish", () => {
        for (const status of ["running", "scheduled", "paused", "draft"]) {
            assert.equal(
                resolveCampaignFinishedAt({
                    status,
                    completedAt: "2026-10-12T20:00:00.000Z",
                    cancelledAt: null,
                }),
                null
            );
        }
    });

    it("formats date and time parts in pt-BR", () => {
        const parts = formatCampaignDateParts("2026-10-12T20:12:08.000Z");
        assert.ok(parts);
        assert.match(parts!.date, /^\d{2}\/\d{2}\/\d{4}$/);
        assert.match(parts!.time, /^\d{2}:\d{2}:\d{2}$/);
    });

    it("period today returns a from bound", () => {
        const r = periodToDateRange("today", new Date("2026-10-12T20:00:00.000Z"));
        assert.ok(r.from);
        assert.ok(r.to);
    });
});
