import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    assessRealSendReadiness,
    hasApprovedTemplateContent,
    purposeAllowsServiceWindowFreeform,
    purposeUsesBaileysFreeform,
    resolveRecipientSendMode,
} from "./send-readiness";

describe("Send readiness modalities", () => {
    it("allows marketing only with APPROVED template (A)", () => {
        const a = assessRealSendReadiness({
            purpose: "marketing",
            consentEligibleCount: 10,
            openWindowCount: 10,
            hasApprovedTemplate: true,
            hasFreeformBody: true,
        });
        assert.equal(a.realSendReady, true);
        assert.equal(a.modality, "template_approved");
        assert.equal(a.technicallySendableCount, 10);
        assert.equal(a.needsTemplateCount, 0);
    });

    it("blocks marketing with open window but no template (C)", () => {
        const a = assessRealSendReadiness({
            purpose: "marketing",
            consentEligibleCount: 5,
            openWindowCount: 5,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(a.realSendReady, false);
        assert.equal(a.modality, "none");
        assert.match(a.blockReason || "", /template APPROVED|marketing/i);
    });

    it("allows utility freeform only for open 24h windows", () => {
        const a = assessRealSendReadiness({
            purpose: "utility",
            consentEligibleCount: 8,
            openWindowCount: 3,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(a.realSendReady, true);
        assert.equal(a.modality, "service_window");
        assert.equal(a.technicallySendableCount, 3);
        assert.equal(a.needsTemplateCount, 5);
    });

    it("blocks utility freeform when every window is closed", () => {
        const a = assessRealSendReadiness({
            purpose: "utility",
            consentEligibleCount: 2,
            openWindowCount: 0,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(a.realSendReady, false);
        assert.equal(a.technicallySendableCount, 0);
        assert.match(a.blockReason || "", /131047|janela/i);
    });

    it("distinguishes consent eligible from technical readiness", () => {
        const a = assessRealSendReadiness({
            purpose: "marketing",
            consentEligibleCount: 1,
            openWindowCount: 0,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(a.consentEligibleCount, 1);
        assert.equal(a.realSendReady, false);
        assert.equal(a.technicallySendableCount, 0);
    });

    it("detects approved bulletin parts", () => {
        assert.equal(
            hasApprovedTemplateContent({
                contentKind: "bulletin",
                messageParts: [
                    {
                        templateName: "boletim_1_carga",
                        templateApprovalStatus: "APPROVED",
                        readyForRealSend: true,
                    },
                ],
            }),
            true
        );
        assert.equal(
            hasApprovedTemplateContent({
                contentKind: "bulletin",
                messageParts: [
                    {
                        templateName: "boletim_1_carga",
                        templateApprovalStatus: "APPROVED",
                        readyForRealSend: false,
                    },
                ],
            }),
            false,
            "APPROVED alone must not authorize incomplete/overflow parts"
        );
        assert.equal(
            purposeAllowsServiceWindowFreeform("marketing"),
            false
        );
        assert.equal(purposeAllowsServiceWindowFreeform("utility"), true);
        assert.equal(purposeUsesBaileysFreeform("texto_livre"), true);
        assert.equal(purposeUsesBaileysFreeform("utility"), false);
    });

    it("sends texto livre to every eligible number without a template or window", () => {
        const a = assessRealSendReadiness({
            purpose: "texto_livre",
            consentEligibleCount: 12,
            openWindowCount: 0,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(a.realSendReady, true);
        assert.equal(a.modality, "baileys_freeform");
        assert.equal(a.technicallySendableCount, 12);
        assert.equal(a.needsTemplateCount, 0);
        assert.equal(a.blockReason, null);
    });

    it("blocks texto livre without a message body", () => {
        const a = assessRealSendReadiness({
            purpose: "texto_livre",
            consentEligibleCount: 4,
            openWindowCount: 0,
            hasApprovedTemplate: false,
            hasFreeformBody: false,
        });
        assert.equal(a.realSendReady, false);
        assert.equal(a.technicallySendableCount, 0);
        assert.match(a.blockReason || "", /Etapa 1|texto/i);
    });

    it("accepts campaign-level APPROVED fallback on complete bulletin parts", () => {
        assert.equal(
            hasApprovedTemplateContent({
                contentKind: "bulletin",
                templateName: "aviso_utilidade",
                templateApprovalStatus: "APPROVED",
                messageParts: [
                    {
                        templateName: null,
                        templateApprovalStatus: null,
                        readyForRealSend: true,
                    },
                ],
            }),
            true
        );
    });

    it("resolves freeform only inside the window, otherwise template", () => {
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
        assert.equal(
            resolveRecipientSendMode({
                hasApprovedTemplate: false,
                purposeAllowsFreeform: true,
                hasFreeformBody: true,
                windowOpen: false,
            }),
            "skip_no_window"
        );
    });
});
