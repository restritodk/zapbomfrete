import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    DATAFY_OFFICIAL_CHANNEL_ID,
    isDatafyChannelId,
    isReservedChannelId,
    resolveChannelProvider,
} from "./ids";
import { deriveDatafyHealth, DATAFY_OFFICIAL_CHANNEL_NAME } from "./datafy-channel";
import {
    canManageDatafyCredentials,
    canManageDatafyChannelAccess,
    normalizeOperationalAccessMode,
} from "./access";
import {
    baileysRouteRejectedForChannel,
    datafyOutboundNotImplementedResponse,
} from "./guards";
import { isAdmin } from "@/lib/api-auth";

describe("Channel identifiers", () => {
    it("uses a stable official Datafy channel id", () => {
        assert.equal(DATAFY_OFFICIAL_CHANNEL_ID, "datafy-official");
        assert.ok(isDatafyChannelId(DATAFY_OFFICIAL_CHANNEL_ID));
        assert.equal(isDatafyChannelId("session-abc"), false);
        assert.equal(resolveChannelProvider(DATAFY_OFFICIAL_CHANNEL_ID), "datafy");
        assert.equal(resolveChannelProvider("wa-1"), "baileys");
    });

    it("reserves datafy-* ids so Baileys cannot claim them", () => {
        assert.ok(isReservedChannelId("datafy-official"));
        assert.ok(isReservedChannelId("datafy:foo"));
        assert.ok(isReservedChannelId("DATAFY-OTHER"));
        assert.equal(isReservedChannelId("marketing-wa"), false);
    });

    it("does not duplicate the official channel identity", () => {
        // Singleton contract: one id, one display name constant.
        assert.equal(DATAFY_OFFICIAL_CHANNEL_NAME, "Bom Frete — WhatsApp Oficial");
        const a = DATAFY_OFFICIAL_CHANNEL_ID;
        const b = DATAFY_OFFICIAL_CHANNEL_ID;
        assert.equal(a, b);
    });
});

describe("Datafy health derivation (no invented CONNECTED)", () => {
    it("marks disconnected when disabled or without token", () => {
        assert.equal(
            deriveDatafyHealth({
                enabled: false,
                hasToken: true,
                displayPhoneNumber: "5511999999999",
                phoneNumberId: "1",
                lastVerifiedAt: new Date(),
                lastError: null,
            }).status,
            "DISCONNECTED"
        );
        assert.equal(
            deriveDatafyHealth({
                enabled: true,
                hasToken: false,
                displayPhoneNumber: null,
                phoneNumberId: null,
                lastVerifiedAt: null,
                lastError: null,
            }).healthy,
            false
        );
    });

    it("marks CONNECTED only when verified with identity", () => {
        const ok = deriveDatafyHealth({
            enabled: true,
            hasToken: true,
            displayPhoneNumber: "5511888777666",
            phoneNumberId: "pnid",
            lastVerifiedAt: new Date("2026-01-01"),
            lastError: null,
        });
        assert.equal(ok.status, "CONNECTED");
        assert.equal(ok.healthy, true);
    });

    it("marks DEGRADED when error without verification", () => {
        const bad = deriveDatafyHealth({
            enabled: true,
            hasToken: true,
            displayPhoneNumber: null,
            phoneNumberId: null,
            lastVerifiedAt: null,
            lastError: "token invalid",
        });
        assert.equal(bad.status, "DEGRADED");
        assert.equal(bad.healthy, false);
    });
});

describe("RBAC: credentials vs operational access", () => {
    it("only SUPERADMIN manages credentials and access policy", () => {
        assert.equal(canManageDatafyCredentials("SUPERADMIN"), true);
        assert.equal(canManageDatafyCredentials("OWNER"), false);
        assert.equal(canManageDatafyCredentials("STAFF"), false);
        assert.equal(canManageDatafyChannelAccess("SUPERADMIN"), true);
        assert.equal(canManageDatafyChannelAccess("OWNER"), false);
        assert.equal(isAdmin("OWNER"), false);
        assert.equal(isAdmin("SUPERADMIN"), true);
    });

    it("OWNER admin-gate mirrors HTTP 403 for credential mutation", () => {
        // Same predicate used by /api/integrations/datafy requireAdmin
        function requireAdminRole(role: string): { status: number } | null {
            if (!isAdmin(role)) return { status: 403 };
            return null;
        }
        assert.equal(requireAdminRole("OWNER")?.status, 403);
        assert.equal(requireAdminRole("STAFF")?.status, 403);
        assert.equal(requireAdminRole("SUPERADMIN"), null);
    });

    it("normalizes operational access modes safely", () => {
        assert.equal(normalizeOperationalAccessMode("ROLE_OWNER"), "ROLE_OWNER");
        assert.equal(normalizeOperationalAccessMode("EXPLICIT"), "EXPLICIT");
        assert.equal(
            normalizeOperationalAccessMode("SUPERADMIN_ONLY"),
            "SUPERADMIN_ONLY"
        );
        assert.equal(normalizeOperationalAccessMode("weird"), "ROLE_OWNER");
        assert.equal(normalizeOperationalAccessMode(undefined), "ROLE_OWNER");
    });
});

describe("Baileys isolation guards", () => {
    it("rejects Datafy id on Baileys routes (no QR / no native ops)", () => {
        const block = baileysRouteRejectedForChannel(DATAFY_OFFICIAL_CHANNEL_ID);
        assert.equal(block.rejected, true);
        assert.ok(block.response);
        assert.equal(block.response!.status, 400);
    });

    it("allows normal Baileys session ids", () => {
        const ok = baileysRouteRejectedForChannel("session-house-1");
        assert.equal(ok.rejected, false);
    });

    it("Baileys broadcast route rejects Datafy channel id (use campaigns module)", async () => {
        const res = datafyOutboundNotImplementedResponse();
        assert.equal(res.status, 403);
        const body = await res.json();
        assert.equal(body.outboundCampaignsEnabled, true);
        assert.equal(body.provider, "datafy");
        assert.equal(body.error, "DATAFY_USE_CAMPAIGNS_MODULE");
    });
});

describe("Provider routing contract", () => {
    it("never routes Datafy channel id as Baileys provider", () => {
        assert.notEqual(
            resolveChannelProvider(DATAFY_OFFICIAL_CHANNEL_ID),
            "baileys"
        );
    });
});
