import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    assessRealSendReadiness,
    hasApprovedTemplateContent,
    purposeAllowsServiceWindowFreeform,
} from "./send-readiness";
import { isWithinServiceWindow } from "@/modules/datafy/chat/window";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { resolveChannelProvider } from "@/modules/channels/ids";

/**
 * Contract tests for the Datafy real-send path (audit Pendência 1).
 * No live API calls — verifies gates and modality rules only.
 */
describe("Datafy real-send audit contracts", () => {
    it("simulation dryRun must never share the real-send readiness path for marketing without template", () => {
        const blocked = assessRealSendReadiness({
            purpose: "marketing",
            consentEligibleCount: 5,
            openWindowCount: 5,
            hasApprovedTemplate: false,
            hasFreeformBody: true,
        });
        assert.equal(blocked.realSendReady, false);
        assert.equal(blocked.modality, "none");
    });

    it("APPROVED template enables real send for all consent-eligible (modality A)", () => {
        const a = assessRealSendReadiness({
            purpose: "marketing",
            consentEligibleCount: 3,
            openWindowCount: 0,
            hasApprovedTemplate: true,
            hasFreeformBody: false,
        });
        assert.equal(a.realSendReady, true);
        assert.equal(a.modality, "template_approved");
        assert.equal(a.technicallySendableCount, 3);
    });

    it("24h window is based on last inbound timestamp", () => {
        const now = new Date("2026-10-10T15:00:00.000Z");
        const open = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        const closed = new Date(now.getTime() - 25 * 60 * 60 * 1000);
        assert.equal(isWithinServiceWindow(open, now), true);
        assert.equal(isWithinServiceWindow(closed, now), false);
        assert.equal(isWithinServiceWindow(null, now), false);
    });

    it("freeform window is denied for marketing purpose", () => {
        assert.equal(purposeAllowsServiceWindowFreeform("marketing"), false);
        assert.equal(purposeAllowsServiceWindowFreeform("utility"), true);
    });

    it("bulletin parts require APPROVED reusable templates for modality A", () => {
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
                        templateApprovalStatus: "PENDING",
                        readyForRealSend: false,
                    },
                ],
            }),
            false
        );
    });

    it("group-sourced phones do not change the Datafy send provider", () => {
        assert.equal(
            resolveChannelProvider(DATAFY_OFFICIAL_CHANNEL_ID),
            "datafy"
        );
        assert.notEqual(
            resolveChannelProvider(DATAFY_OFFICIAL_CHANNEL_ID),
            "baileys"
        );
    });
});
