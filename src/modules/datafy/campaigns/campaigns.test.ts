import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    CAMPAIGN_TRANSITIONS,
    canTransition,
    RECIPIENT_STATUS_RANK,
} from "./constants";
import {
    evaluateEligibility,
    skipReasonLabel,
} from "./eligibility";
import {
    isSyntheticContactId,
    previewRecipients,
} from "./recipients";
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
        const { phones, invalid, duplicates } = parsePhoneList(
            "11999998888\n5511888777666\n11999998888\nabc"
        );
        assert.equal(phones.length, 2);
        assert.ok(invalid.length >= 1);
        assert.equal(duplicates, 1);
    });
});

describe("Import/group phones for Datafy audience", () => {
    it("marks synthetic contacts as not_in_crm (not missing_consent)", () => {
        assert.equal(isSyntheticContactId("synth:5511999998888"), true);
        assert.equal(isSyntheticContactId("clxyz123"), false);

        const preview = previewRecipients(
            [
                {
                    id: "synth:5511999998888",
                    waId: "5511999998888",
                    fullName: null,
                    company: null,
                    city: null,
                    state: null,
                    category: null,
                    origin: "import",
                    active: true,
                    consentStatus: "unknown",
                },
                {
                    id: "crm1",
                    waId: "5511888777666",
                    fullName: "Com consentimento",
                    company: null,
                    city: "Curitiba",
                    state: "PR",
                    category: null,
                    origin: "manual",
                    active: true,
                    consentStatus: "granted",
                },
            ],
            { purpose: "marketing", requireConsent: true }
        );
        assert.equal(preview.eligibleCount, 1);
        assert.equal(preview.excludedCount, 1);
        assert.equal(preview.excluded[0].reason, "not_in_crm");
        assert.equal(preview.exclusionBreakdown.not_in_crm, 1);
        assert.equal(preview.simulationEligibleCount, 2);
        assert.equal(skipReasonLabel("not_in_crm"), "Número não encontrado no CRM");
    });

    it("lists mixed exclusion reasons and opt-out", () => {
        const preview = previewRecipients(
            [
                {
                    id: "crm-ok",
                    waId: "5511999998888",
                    fullName: "Ok",
                    company: null,
                    city: null,
                    state: null,
                    category: null,
                    origin: "manual",
                    active: true,
                    consentStatus: "granted",
                },
                {
                    id: "crm-miss",
                    waId: "5511888777666",
                    fullName: "Sem consent",
                    company: null,
                    city: null,
                    state: null,
                    category: null,
                    origin: "manual",
                    active: true,
                    consentStatus: "unknown",
                },
                {
                    id: "crm-out",
                    waId: "5511777666555",
                    fullName: "Opt out",
                    company: null,
                    city: null,
                    state: null,
                    category: null,
                    origin: "manual",
                    active: true,
                    consentStatus: "opted_out",
                },
                {
                    id: "synth:5511666555444",
                    waId: "5511666555444",
                    fullName: null,
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
        assert.equal(preview.exclusionBreakdown.missing_consent, 1);
        assert.equal(preview.exclusionBreakdown.opted_out, 1);
        assert.equal(preview.exclusionBreakdown.not_in_crm, 1);
        assert.equal(preview.simulationEligibleCount, 3);
    });

    it("simulationRelaxConsent allows missing consent but not opt-out", () => {
        const rMiss = evaluateEligibility(
            {
                id: "synth:5511999998888",
                waId: "5511999998888",
                fullName: null,
                company: null,
                city: null,
                state: null,
                category: null,
                origin: "import",
                active: true,
                consentStatus: "unknown",
            },
            {
                purpose: "marketing",
                requireConsent: true,
                simulationRelaxConsent: true,
            }
        );
        assert.equal(rMiss.ok, true);

        const rOut = evaluateEligibility(
            {
                id: "1",
                waId: "5511888777666",
                fullName: null,
                company: null,
                city: null,
                state: null,
                category: null,
                origin: "manual",
                active: true,
                consentStatus: "opted_out",
            },
            {
                purpose: "marketing",
                requireConsent: true,
                simulationRelaxConsent: true,
            }
        );
        assert.equal(rOut.ok, false);
        if (!rOut.ok) assert.equal(rOut.reason, "opted_out");
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
