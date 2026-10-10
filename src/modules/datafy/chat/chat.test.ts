import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    isWithinServiceWindow,
    normalizeWaId,
    serviceWindowExpiresAt,
    DATAFY_SERVICE_WINDOW_MS,
} from "./window";
import { canManageDatafyCredentials } from "@/modules/channels/access";
import { isAdmin } from "@/lib/api-auth";
import { baileysRouteRejectedForChannel } from "@/modules/channels/guards";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";

describe("Datafy 24h service window", () => {
    it("is closed without customer message", () => {
        assert.equal(isWithinServiceWindow(null), false);
        assert.equal(isWithinServiceWindow(undefined), false);
    });

    it("is open within 24h of last inbound", () => {
        const recent = new Date(Date.now() - 60 * 60 * 1000);
        assert.equal(isWithinServiceWindow(recent), true);
    });

    it("is closed after 24h", () => {
        const old = new Date(Date.now() - DATAFY_SERVICE_WINDOW_MS - 1000);
        assert.equal(isWithinServiceWindow(old), false);
    });

    it("computes expiry", () => {
        const base = new Date("2026-01-01T12:00:00.000Z");
        const exp = serviceWindowExpiresAt(base);
        assert.ok(exp);
        assert.equal(
            exp!.getTime() - base.getTime(),
            DATAFY_SERVICE_WINDOW_MS
        );
    });
});

describe("WA id normalization", () => {
    it("strips non-digits", () => {
        assert.equal(normalizeWaId("+55 (11) 99999-8888"), "5511999998888");
        assert.equal(normalizeWaId("5511999998888"), "5511999998888");
    });
});

describe("Phase 3 auth boundaries", () => {
    it("OWNER cannot manage credentials", () => {
        assert.equal(canManageDatafyCredentials("OWNER"), false);
        assert.equal(isAdmin("OWNER"), false);
        assert.equal(isAdmin("SUPERADMIN"), true);
    });

    it("Datafy channel id never routes to Baileys QR/send", () => {
        const block = baileysRouteRejectedForChannel(DATAFY_OFFICIAL_CHANNEL_ID);
        assert.equal(block.rejected, true);
        assert.equal(block.response?.status, 400);
    });
});

describe("Outbound status ordering semantics", () => {
    const RANK: Record<string, number> = {
        pending: 0,
        accepted: 1,
        sent: 2,
        delivered: 3,
        read: 4,
        failed: 5,
    };

    function shouldApply(current: string, next: string) {
        if (next === "failed") return true;
        return (RANK[next] ?? 0) >= (RANK[current] ?? 0);
    }

    it("does not go backwards delivered -> sent", () => {
        assert.equal(shouldApply("delivered", "sent"), false);
    });

    it("allows sent -> delivered -> read", () => {
        assert.equal(shouldApply("sent", "delivered"), true);
        assert.equal(shouldApply("delivered", "read"), true);
    });

    it("allows failed from any state", () => {
        assert.equal(shouldApply("delivered", "failed"), true);
    });
});

describe("Idempotency keys", () => {
    it("client message ids are unique by construction", () => {
        const a = `cli_${crypto.randomUUID()}`;
        const b = `cli_${crypto.randomUUID()}`;
        assert.notEqual(a, b);
        assert.match(a, /^cli_/);
    });
});
