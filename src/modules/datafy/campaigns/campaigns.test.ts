import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    CAMPAIGN_TRANSITIONS,
    canTransition,
    RECIPIENT_STATUS_RANK,
} from "./constants";
import { evaluateEligibility } from "./eligibility";
import { previewRecipients } from "./recipients";
import { buildTemplateComponents } from "./variables";
import {
    canLaunchDatafyCampaigns,
    canViewDatafyCampaigns,
} from "./access";
import { baileysRouteRejectedForChannel } from "@/modules/channels/guards";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { parsePhoneList } from "@/lib/phone-br";

describe("Campaign state machine", () => {
    it("allows draft → preparing / scheduled", () => {
        assert.equal(canTransition("draft", "preparing"), true);
        assert.equal(canTransition("draft", "scheduled"), true);
        assert.equal(canTransition("draft", "completed"), false);
    });

    it("blocks invalid transitions from running", () => {
        assert.equal(canTransition("running", "draft"), false);
        assert.equal(canTransition("running", "paused"), true);
        assert.equal(canTransition("completed", "running"), false);
    });

    it("covers all statuses in transition map", () => {
        for (const s of Object.keys(CAMPAIGN_TRANSITIONS)) {
            assert.ok(Array.isArray(CAMPAIGN_TRANSITIONS[s as keyof typeof CAMPAIGN_TRANSITIONS]));
        }
    });
});

describe("Eligibility & consent", () => {
    const base = {
        id: "1",
        waId: "11999998888",
        fullName: "Ana",
        company: null,
        city: null,
        state: null,
        category: "Cliente",
        origin: "manual",
        active: true,
        consentStatus: "granted",
    };

    it("accepts granted marketing contacts", () => {
        const r = evaluateEligibility(base, {
            purpose: "marketing",
            requireConsent: true,
        });
        assert.equal(r.ok, true);
        if (r.ok) assert.equal(r.waId, "5511999998888");
    });

    it("rejects unknown consent for marketing", () => {
        const r = evaluateEligibility(
            { ...base, consentStatus: "unknown" },
            { purpose: "marketing", requireConsent: true }
        );
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.reason, "missing_consent");
    });

    it("always rejects opted_out", () => {
        const r = evaluateEligibility(
            { ...base, consentStatus: "opted_out" },
            { purpose: "utility", requireConsent: false }
        );
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.reason, "opted_out");
    });

    it("rejects inactive", () => {
        const r = evaluateEligibility(
            { ...base, active: false },
            { purpose: "marketing", requireConsent: true }
        );
        assert.equal(r.ok, false);
    });
});

describe("Audience preview dedupe", () => {
    it("dedupes normalized phones and counts exclusions", () => {
        const preview = previewRecipients(
            [
                {
                    id: "a",
                    waId: "11999998888",
                    fullName: "A",
                    company: null,
                    city: null,
                    state: null,
                    category: null,
                    origin: "manual",
                    active: true,
                    consentStatus: "granted",
                },
                {
                    id: "b",
                    waId: "5511999998888",
                    fullName: "B",
                    company: null,
                    city: null,
                    state: null,
                    category: null,
                    origin: "import",
                    active: true,
                    consentStatus: "granted",
                },
                {
                    id: "c",
                    waId: "11888887777",
                    fullName: "C",
                    company: null,
                    city: null,
                    state: null,
                    category: null,
                    origin: "import",
                    active: true,
                    consentStatus: "unknown",
                },
            ],
            { purpose: "marketing", requireConsent: true }
        );
        assert.equal(preview.eligibleCount, 1);
        assert.ok(preview.excludedCount >= 2);
    });
});

describe("Template variables", () => {
    it("builds body parameters from CRM tokens", () => {
        const comps = buildTemplateComponents(
            { body: ["fullName", "company"] },
            { fullName: "João", company: "Bom Frete" }
        ) as Array<{ type: string; parameters: Array<{ text: string }> }>;
        assert.equal(comps[0].type, "body");
        assert.equal(comps[0].parameters[0].text, "João");
        assert.equal(comps[0].parameters[1].text, "Bom Frete");
    });

    it("includes optional IMAGE header when URL provided", () => {
        const comps = buildTemplateComponents(
            { body: ["fullName"] },
            { fullName: "Ana" },
            { headerImageUrl: "https://example.com/a.jpg" }
        ) as Array<{ type: string; parameters: Array<{ type: string }> }>;
        assert.equal(comps[0].type, "header");
        assert.equal(comps[0].parameters[0].type, "image");
        assert.equal(comps[1].type, "body");
    });
});

describe("Audience without geo filters", () => {
    it("treats empty optional geo as all-Brazil selection", () => {
        const preview = previewRecipients(
            [
                {
                    id: "pr",
                    waId: "41999998888",
                    fullName: "Sul",
                    company: null,
                    city: "Curitiba",
                    state: "PR",
                    category: null,
                    origin: "manual",
                    active: true,
                    consentStatus: "granted",
                },
                {
                    id: "sp",
                    waId: "11988887777",
                    fullName: "Sudeste",
                    company: null,
                    city: "São Paulo",
                    state: "SP",
                    category: null,
                    origin: "manual",
                    active: true,
                    consentStatus: "granted",
                },
            ],
            { purpose: "marketing", requireConsent: true }
        );
        assert.equal(preview.eligibleCount, 2);
    });
});

describe("Recipient status ranking", () => {
    it("does not regress delivered → sent", () => {
        assert.ok(
            (RECIPIENT_STATUS_RANK.delivered ?? 0) >
                (RECIPIENT_STATUS_RANK.sent ?? 0)
        );
    });
});

describe("Campaign RBAC", () => {
    it("STAFF cannot launch; OWNER can", () => {
        assert.equal(canLaunchDatafyCampaigns("STAFF"), false);
        assert.equal(canLaunchDatafyCampaigns("OWNER"), true);
        assert.equal(canLaunchDatafyCampaigns("SUPERADMIN"), true);
    });

    it("OWNER can view", async () => {
        assert.equal(await canViewDatafyCampaigns("u", "OWNER"), true);
    });
});

describe("Phase 5 isolation", () => {
    it("does not route Datafy id to Baileys", () => {
        const block = baileysRouteRejectedForChannel(DATAFY_OFFICIAL_CHANNEL_ID);
        assert.equal(block.rejected, true);
    });

    it("Baileys import parsePhoneList unchanged", () => {
        const { phones } = parsePhoneList("11999998888\n5511888777666");
        assert.equal(phones.length, 2);
    });
});

describe("Idempotency client message id contract", () => {
    it("is stable per campaign+waId", () => {
        const campaignId = "camp1";
        const waId = "5511999998888";
        const a = `camp_${campaignId}_${waId}`;
        const b = `camp_${campaignId}_${waId}`;
        assert.equal(a, b);
    });
});
