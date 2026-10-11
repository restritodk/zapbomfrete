import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    assessRealSendReadiness,
    purposeAllowsServiceWindowFreeform,
    resolveRecipientSendMode,
} from "./send-readiness";
import {
    defaultCampaignConsentButtons,
    parseCampaignConsentButtons,
    validateCampaignConsentButtons,
    toInteractiveSendButtons,
} from "@/modules/crm/consent/campaign-buttons";
import { classifyConsentReply } from "@/modules/crm/consent/classify";
import {
    CAMPAIGN_BUTTON_TITLE_UI_MAX,
    META_INTERACTIVE_REPLY_TITLE_MAX,
} from "@/modules/crm/consent/constants";

describe("Envio Direto — purpose gates", () => {
    it("allows freeform for utility and transactional only", () => {
        assert.equal(purposeAllowsServiceWindowFreeform("utility"), true);
        assert.equal(purposeAllowsServiceWindowFreeform("transactional"), true);
        assert.equal(purposeAllowsServiceWindowFreeform("marketing"), false);
        assert.equal(purposeAllowsServiceWindowFreeform("other"), false);
    });

    it("utility with body + open window → realSendReady (Modalidade B)", () => {
        const a = assessRealSendReadiness({
            purpose: "utility",
            consentEligibleCount: 10,
            openWindowCount: 4,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(a.modality, "service_window");
        assert.equal(a.realSendReady, true);
        assert.equal(a.technicallySendableCount, 4);
        assert.equal(a.needsTemplateCount, 6);
    });

    it("utility with body but zero windows → blocked", () => {
        const a = assessRealSendReadiness({
            purpose: "utility",
            consentEligibleCount: 10,
            openWindowCount: 0,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(a.realSendReady, false);
        assert.equal(a.modality, "none");
        assert.match(a.blockReason || "", /janela/i);
    });

    it("transactional mirrors utility freeform readiness", () => {
        const a = assessRealSendReadiness({
            purpose: "transactional",
            consentEligibleCount: 5,
            openWindowCount: 5,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(a.realSendReady, true);
        assert.equal(a.technicallySendableCount, 5);
    });

    it("marketing never uses service window even with open windows", () => {
        const a = assessRealSendReadiness({
            purpose: "marketing",
            consentEligibleCount: 20,
            openWindowCount: 20,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(a.realSendReady, false);
        assert.equal(a.purposeAllowsServiceWindow, false);
    });

    it("approved template enables all consent-eligible (Modalidade A)", () => {
        const a = assessRealSendReadiness({
            purpose: "utility",
            consentEligibleCount: 12,
            openWindowCount: 2,
            hasApprovedTemplate: true,
            hasFreeformBody: true,
        });
        assert.equal(a.modality, "template_approved");
        assert.equal(a.technicallySendableCount, 12);
    });

    it("utility freeform + APPROVED fallback → ready even with 0 windows", () => {
        const a = assessRealSendReadiness({
            purpose: "utility",
            consentEligibleCount: 139,
            openWindowCount: 0,
            hasApprovedTemplate: true,
            hasFreeformBody: true,
        });
        assert.equal(a.realSendReady, true);
        assert.equal(a.technicallySendableCount, 139);
    });

    it("hybrid prefers freeform in open window and template outside", () => {
        assert.equal(
            resolveRecipientSendMode({
                hasApprovedTemplate: true,
                purposeAllowsFreeform: true,
                hasFreeformBody: true,
                windowOpen: true,
            }),
            "freeform"
        );
        assert.equal(
            resolveRecipientSendMode({
                hasApprovedTemplate: true,
                purposeAllowsFreeform: true,
                hasFreeformBody: true,
                windowOpen: false,
            }),
            "template"
        );
    });
});

describe("Envio Direto — consent interactive buttons", () => {
    it("validates titles within Meta interactive limit (20)", () => {
        const cfg = parseCampaignConsentButtons({
            enabled: true,
            buttons: [
                { id: "consent_yes", title: "Tenho interesse" },
                { id: "consent_no", title: "Não tenho interesse" },
            ],
        });
        assert.equal(cfg.enabled, true);
        assert.equal(validateCampaignConsentButtons(cfg).ok, true);
        for (const b of cfg.buttons) {
            assert.ok(b.title.length <= CAMPAIGN_BUTTON_TITLE_UI_MAX);
        }
        const send = toInteractiveSendButtons(cfg);
        assert.equal(send.length, 2);
        assert.equal(send[0].id, "consent_yes");
        assert.ok(send[0].title.length <= META_INTERACTIVE_REPLY_TITLE_MAX);
    });

    it("rejects overlong interactive titles", () => {
        const cfg = parseCampaignConsentButtons({
            enabled: true,
            buttons: [
                {
                    id: "x",
                    title: "x".repeat(CAMPAIGN_BUTTON_TITLE_UI_MAX + 1),
                },
            ],
        });
        assert.equal(cfg.buttons[0]?.title.length, CAMPAIGN_BUTTON_TITLE_UI_MAX);
        // validation on raw overlong before parse:
        const bad = {
            enabled: true,
            purpose: "consent_offers" as const,
            buttons: [
                {
                    id: "x",
                    title: "x".repeat(CAMPAIGN_BUTTON_TITLE_UI_MAX + 1),
                },
            ],
        };
        assert.equal(validateCampaignConsentButtons(bad).ok, false);
    });

    it("disabled config yields no send buttons", () => {
        const d = defaultCampaignConsentButtons();
        assert.equal(d.enabled, false);
        assert.equal(toInteractiveSendButtons(d).length, 0);
    });

    it("classifies Tenho interesse / consent_yes as grant", () => {
        assert.equal(
            classifyConsentReply({
                buttonTitle: "Tenho interesse",
                previousStatus: "unknown",
            }).kind,
            "grant"
        );
        assert.equal(
            classifyConsentReply({
                buttonId: "consent_yes",
                previousStatus: "unknown",
            }).kind,
            "grant"
        );
        assert.equal(
            classifyConsentReply({
                buttonId: "consent_grant_offers",
                previousStatus: "unknown",
            }).kind,
            "grant"
        );
    });
});
