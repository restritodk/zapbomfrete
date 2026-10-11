import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    assessRealSendReadiness,
    hasApprovedTemplateContent,
    purposeAllowsServiceWindowFreeform,
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

    it("allows utility freeform inside open window (B)", () => {
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

    it("blocks utility without window and without template", () => {
        const a = assessRealSendReadiness({
            purpose: "utility",
            consentEligibleCount: 2,
            openWindowCount: 0,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(a.realSendReady, false);
        assert.match(a.blockReason || "", /janela/i);
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

    it("resolves hybrid freeform vs template per recipient window", () => {
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
