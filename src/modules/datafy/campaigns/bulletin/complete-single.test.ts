import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeBulletin } from "./analyze";
import {
    assessCompleteBulletin,
    composeCompleteBulletinPart,
    deliveryModeNeedsUserChoice,
} from "./complete-single";
import { composeReusableBulletinParts } from "./templates";
import { BULLETIN_TEMPLATE_LIBRARY } from "./library";
import {
    COTTON_8_LOADS_RAW,
    buildNLoadsBulletin,
} from "./fixtures/cotton-8-loads";
import {
    META_FREEFORM_TEXT_MAX,
    META_TEMPLATE_BODY_MAX,
} from "./types";

function approvedAll() {
    return BULLETIN_TEMPLATE_LIBRARY.map((s) => ({
        name: s.preferredName,
        language: "pt_BR",
        status: "APPROVED",
        category: "MARKETING" as const,
    }));
}

describe("complete bulletin — single message modality", () => {
    it("COTTON 8: complete mode preserves raw text verbatim under freeform limit", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        assert.equal(a.loadCount, 8);
        const assessment = assessCompleteBulletin(
            COTTON_8_LOADS_RAW,
            a,
            "utility"
        );
        assert.ok(assessment.withinFreeformLimit);
        assert.ok(assessment.charCount <= META_FREEFORM_TEXT_MAX);
        assert.equal(assessment.purposeAllowsFreeform, true);
        assert.equal(assessment.contentReady, true);

        const parts = composeCompleteBulletinPart(
            COTTON_8_LOADS_RAW,
            a,
            "utility"
        );
        assert.equal(parts.length, 1);
        assert.equal(parts[0].bodyText, COTTON_8_LOADS_RAW.trim());
        assert.equal(parts[0].loadIndexes?.length, 8);
        assert.equal(parts[0].templateName, null);
        assert.equal(parts[0].readyForRealSend, true);
        // No silent re-labeling of the raw paste
        assert.ok(parts[0].bodyText.includes("FRETE:"));
        assert.ok(parts[0].bodyText.includes("chat.whatsapp.com"));
    });

    it("marketing blocks complete single (template required; Meta BODY 1024)", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const assessment = assessCompleteBulletin(
            COTTON_8_LOADS_RAW,
            a,
            "marketing"
        );
        assert.equal(assessment.contentReady, false);
        assert.ok(
            assessment.blockReasons.some((r) => /marketing|template/i.test(r))
        );
        assert.ok(
            assessment.explanations.some((e) =>
                String(META_TEMPLATE_BODY_MAX).includes("1024")
                    ? e.includes("1024")
                    : true
            )
        );
        const parts = composeCompleteBulletinPart(
            COTTON_8_LOADS_RAW,
            a,
            "marketing"
        );
        assert.equal(parts[0].readyForRealSend, false);
    });

    it("oversized text (>4096) is not truncated and is not contentReady", () => {
        const huge = "X".repeat(META_FREEFORM_TEXT_MAX + 100);
        const a = analyzeBulletin(huge);
        const assessment = assessCompleteBulletin(huge, a, "utility");
        assert.equal(assessment.withinFreeformLimit, false);
        assert.equal(assessment.contentReady, false);
        assert.ok(assessment.blockReasons.some((r) => /4096/.test(r)));
        const parts = composeCompleteBulletinPart(huge, a, "utility");
        assert.equal(parts[0].bodyText.length, huge.length);
        assert.equal(parts[0].readyForRealSend, false);
    });

    it("multi-load requires explicit delivery mode choice", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const split = composeReusableBulletinParts(a, approvedAll(), {
            purpose: "marketing",
        });
        assert.ok(split.length >= 2);
        assert.equal(deliveryModeNeedsUserChoice(a, split.length), true);
        assert.equal(
            deliveryModeNeedsUserChoice(
                analyzeBulletin("só uma linha curta sem cargas"),
                1
            ),
            false
        );
    });

    it("20 loads: complete mode keeps one part when under freeform limit", () => {
        const raw = buildNLoadsBulletin(20);
        const a = analyzeBulletin(raw);
        assert.equal(a.loadCount, 20);
        const assessment = assessCompleteBulletin(raw, a, "utility");
        if (raw.length <= META_FREEFORM_TEXT_MAX) {
            assert.equal(assessment.contentReady, true);
            const parts = composeCompleteBulletinPart(raw, a, "utility");
            assert.equal(parts.length, 1);
            assert.equal(parts[0].bodyText, raw.trim());
            assert.equal(parts[0].loadIndexes?.length, 20);
        } else {
            assert.equal(assessment.contentReady, false);
        }
    });
});
