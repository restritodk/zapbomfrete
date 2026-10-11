import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeBulletin, analysisToEditableDraft } from "./analyze";
import { COTTON_8_LOADS_RAW } from "./fixtures/cotton-8-loads";
import {
    assessSingleBalloonTemplate,
    buildMetaApprovalProposal,
    mapRemoteToUiStatus,
    normalizeMetaTemplateEvent,
} from "./meta-approval";
import {
    META_FREEFORM_TEXT_MAX,
    META_TEMPLATE_BODY_MAX,
} from "./types";
import { buildBulletinTemplateSubmission } from "./library";
import { BULLETIN_TEMPLATE_LIBRARY } from "./library";
import { canLaunchDatafyCampaigns } from "../access";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { resolveChannelProvider } from "@/modules/channels/ids";
import {
    CAMPAIGN_DELAY_MS_MIN,
    CAMPAIGN_DELAY_MS_MAX,
    normalizeCampaignDelayMs,
} from "../pacing";

describe("meta approval — single balloon & COTTON 8", () => {
    it("preserves COTTON 8 loads in draft text", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        assert.equal(a.loadCount, 8);
        const draft = analysisToEditableDraft(a);
        assert.equal(draft.loads.length, 8);
        const proposal = buildMetaApprovalProposal(draft);
        assert.ok(proposal.fullText.includes("FRETE:") || proposal.fullText.length > 0);
        assert.equal(proposal.loadCount, 8);
        assert.ok(proposal.fullTextCharCount > META_TEMPLATE_BODY_MAX);
        assert.ok(proposal.fullTextCharCount <= META_FREEFORM_TEXT_MAX);
    });

    it("blocks single-balloon Meta template for 2628-class bulletins", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const draft = analysisToEditableDraft(a);
        const proposal = buildMetaApprovalProposal(draft);
        assert.equal(proposal.singleBalloon.possibleAsSingleTemplate, false);
        assert.ok(
            proposal.singleBalloon.blockReasons.some((r) =>
                r.includes(String(META_TEMPLATE_BODY_MAX))
            )
        );
        // Must not invent a submittable "full text" template card
        assert.ok(
            !proposal.libraryProposals.some(
                (p) => p.bodyCharCount === proposal.fullTextCharCount
            )
        );
    });

    it("exactly 1024 chars: single balloon possible; 1025 blocked", () => {
        const ok = assessSingleBalloonTemplate(
            "X".repeat(META_TEMPLATE_BODY_MAX),
            1
        );
        assert.equal(ok.possibleAsSingleTemplate, true);
        const bad = assessSingleBalloonTemplate(
            "X".repeat(META_TEMPLATE_BODY_MAX + 1),
            1
        );
        assert.equal(bad.possibleAsSingleTemplate, false);
    });

    it("generates library proposals within Meta BODY limit (MARKETING)", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const draft = analysisToEditableDraft(a);
        const proposal = buildMetaApprovalProposal(draft);
        assert.ok(proposal.libraryProposals.length >= 1);
        for (const p of proposal.libraryProposals) {
            assert.ok(p.bodyCharCount <= META_TEMPLATE_BODY_MAX);
            assert.equal(p.category, "MARKETING");
            assert.equal(p.language, "pt_BR");
        }
        assert.equal(proposal.recommendedCategory, "MARKETING");
    });

    it("library submission validation stays within official limits", () => {
        for (const spec of BULLETIN_TEMPLATE_LIBRARY.filter(
            (s) => s.generation === 3
        )) {
            const sub = buildBulletinTemplateSubmission(spec);
            assert.equal(sub.checks.bodyWithinLimit, true);
            assert.ok(sub.bodyCharCount <= 1024);
            assert.equal(sub.checks.readyForManualSubmit, true);
        }
    });
});

describe("meta approval — status mapping & webhook", () => {
    it("maps remote statuses to UI states", () => {
        assert.equal(mapRemoteToUiStatus("APPROVED"), "approved");
        assert.equal(mapRemoteToUiStatus("PENDING"), "pending");
        assert.equal(mapRemoteToUiStatus("REJECTED"), "rejected");
        assert.equal(mapRemoteToUiStatus("PAUSED"), "paused");
        assert.equal(mapRemoteToUiStatus(null), "draft");
    });

    it("normalizes message_template_status_update (approved + rejected)", () => {
        const approved = normalizeMetaTemplateEvent({
            event: "APPROVED",
            message_template_id: "123",
            message_template_name: "boletim_v2_1_carga",
            message_template_language: "pt_BR",
        });
        assert.equal(approved.status, "APPROVED");
        assert.equal(approved.name, "boletim_v2_1_carga");

        const rejected = normalizeMetaTemplateEvent({
            event: "REJECTED",
            message_template_name: "boletim_v2_1_carga",
            reason: "INVALID_FORMAT",
        });
        assert.equal(rejected.status, "REJECTED");
        assert.equal(rejected.rejectedReason, "INVALID_FORMAT");
    });

    it("blocks re-submit when already PENDING, APPROVED or REJECTED", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const draft = analysisToEditableDraft(a);
        const pending = buildMetaApprovalProposal(draft, {
            boletim_v3_1_carga: { remoteStatus: "PENDING" },
        });
        const cardP = pending.libraryProposals.find(
            (p) => p.technicalName === "boletim_v3_1_carga"
        );
        assert.ok(cardP);
        assert.equal(cardP!.canSubmit, false);
        assert.match(cardP!.submitBlockReason || "", /PENDING/i);

        const approved = buildMetaApprovalProposal(draft, {
            boletim_v3_1_carga: { remoteStatus: "APPROVED" },
        });
        const cardA = approved.libraryProposals.find(
            (p) => p.technicalName === "boletim_v3_1_carga"
        );
        assert.equal(cardA!.canSubmit, false);
        assert.match(cardA!.submitBlockReason || "", /APPROVED/i);

        const rejected = buildMetaApprovalProposal(draft, {
            boletim_v3_1_carga: { remoteStatus: "REJECTED" },
        });
        const cardR = rejected.libraryProposals.find(
            (p) => p.technicalName === "boletim_v3_1_carga"
        );
        assert.equal(cardR!.canSubmit, false);
        assert.match(cardR!.submitBlockReason || "", /Rejeitado|estrutura/i);
    });

    it("ready_to_submit when no remote status", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const draft = analysisToEditableDraft(a);
        const proposal = buildMetaApprovalProposal(draft, {});
        const card = proposal.libraryProposals.find((p) => p.canSubmit);
        assert.ok(card, "at least one submittable v2 model");
        assert.equal(card!.uiStatus, "ready_to_submit");
    });
});

describe("meta approval — campaign gates & isolation", () => {
    it("RBAC: OWNER/SUPERADMIN can launch; STAFF cannot", () => {
        assert.equal(canLaunchDatafyCampaigns("OWNER"), true);
        assert.equal(canLaunchDatafyCampaigns("SUPERADMIN"), true);
        assert.equal(canLaunchDatafyCampaigns("STAFF"), false);
    });

    it("Datafy channel never routes as Baileys", () => {
        assert.equal(
            resolveChannelProvider(DATAFY_OFFICIAL_CHANNEL_ID),
            "datafy"
        );
    });

    it("pacing interval bounds still 3–60s", () => {
        assert.equal(normalizeCampaignDelayMs(10_000), 10_000);
        assert.equal(CAMPAIGN_DELAY_MS_MIN, 3_000);
        assert.equal(CAMPAIGN_DELAY_MS_MAX, 60_000);
    });
});
