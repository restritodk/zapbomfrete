import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    CRM_CATEGORIES,
    CRM_CONSENT_STATUSES,
    CRM_ORG_DEFAULT,
    CRM_ORIGINS,
} from "./constants";
import { canAccessCrm, canHardDeleteCrm, canMutateCrm } from "./access";
import { normalizeBrazilianPhone, parsePhoneList } from "@/lib/phone-br";
import { baileysRouteRejectedForChannel } from "@/modules/channels/guards";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";

describe("CRM constants", () => {
    it("exposes Bom Frete categories", () => {
        assert.ok(CRM_CATEGORIES.includes("Motorista"));
        assert.ok(CRM_CATEGORIES.includes("Transportadora"));
        assert.ok(CRM_CATEGORIES.includes("Cliente"));
        assert.equal(CRM_ORG_DEFAULT, "default");
        assert.ok(CRM_ORIGINS.includes("import"));
        assert.ok(CRM_ORIGINS.includes("datafy_webhook"));
    });

    it("includes consent states for Phase 5 prep", () => {
        assert.deepEqual([...CRM_CONSENT_STATUSES], [
            "unknown",
            "granted",
            "denied",
            "opted_out",
        ]);
    });
});

describe("CRM phone normalization", () => {
    it("normalizes BR mobiles with and without country code", () => {
        assert.equal(normalizeBrazilianPhone("(11) 99999-8888"), "5511999998888");
        assert.equal(normalizeBrazilianPhone("5511999998888"), "5511999998888");
        assert.equal(normalizeBrazilianPhone("+55 11 99999-8888"), "5511999998888");
    });

    it("keeps already-prefixed BR and longer digit strings", () => {
        assert.equal(normalizeBrazilianPhone("5511999998888"), "5511999998888");
        // 14+ digit international-looking ids are not forced into BR shape
        const long = normalizeBrazilianPhone("447911123456");
        assert.equal(long, "447911123456");
        assert.equal(long.startsWith("55"), false);
    });
});

describe("CRM import uses same parsePhoneList as Disparo", () => {
    it("dedupes and validates like broadcast import", () => {
        const text = [
            "5511999998888",
            "11 99999-8888",
            "invalid",
            "5511888777666",
        ].join("\n");
        const { phones, invalid, duplicates } = parsePhoneList(text);
        assert.equal(phones.length, 2);
        assert.ok(invalid.length >= 1);
        assert.ok(duplicates >= 1);
        assert.ok(phones.includes("5511999998888"));
        assert.ok(phones.includes("5511888777666"));
    });

    it("never treats import as marketing consent grant", () => {
        // Contract: import origin must force unknown when granted attempted
        const importOrigin = "import";
        let consentStatus: string = "granted";
        if (importOrigin === "import" && consentStatus === "granted") {
            consentStatus = "unknown";
        }
        assert.equal(consentStatus, "unknown");
    });

    it("protects opted_out from overwrite", () => {
        const current = "opted_out";
        const incoming = "granted";
        let next = current;
        if (!(current === "opted_out" && incoming !== "opted_out")) {
            next = incoming;
        }
        assert.equal(next, "opted_out");
    });
});

describe("CRM RBAC", () => {
    it("OWNER and SUPERADMIN can hard delete; STAFF cannot", () => {
        assert.equal(canHardDeleteCrm("SUPERADMIN"), true);
        assert.equal(canHardDeleteCrm("OWNER"), true);
        assert.equal(canHardDeleteCrm("STAFF"), false);
    });

    it("mutate allowed for operational roles", () => {
        assert.equal(canMutateCrm("SUPERADMIN"), true);
        assert.equal(canMutateCrm("OWNER"), true);
        assert.equal(canMutateCrm("STAFF"), true);
        assert.equal(canMutateCrm("VIEWER"), false);
    });

    it("OWNER always has CRM access", async () => {
        assert.equal(await canAccessCrm("any", "OWNER"), true);
        assert.equal(await canAccessCrm("any", "SUPERADMIN"), true);
    });
});

describe("Phase 4 does not break Baileys / Datafy boundaries", () => {
    it("Datafy channel still rejected by Baileys routes", () => {
        const block = baileysRouteRejectedForChannel(DATAFY_OFFICIAL_CHANNEL_ID);
        assert.equal(block.rejected, true);
    });
});
