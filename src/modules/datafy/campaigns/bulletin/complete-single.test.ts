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
    it("COTTON 8: sizeReady under freeform 5000; preserves verbatim", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        assert.equal(a.loadCount, 8);
        const trimmed = COTTON_8_LOADS_RAW.replace(/\r\n/g, "\n").trim();
        assert.ok(
            trimmed.length > META_TEMPLATE_BODY_MAX,
            "fixture must exceed template BODY 1024"
        );
        assert.ok(trimmed.length <= META_FREEFORM_TEXT_MAX);

        const assessment = assessCompleteBulletin(
            COTTON_8_LOADS_RAW,
            a,
            "utility"
        );
        assert.ok(assessment.withinFreeformLimit);
        assert.equal(assessment.charLimit, META_FREEFORM_TEXT_MAX);
        assert.equal(assessment.sizeReady, true);
        assert.equal(assessment.contentReady, true); // alias of sizeReady
        assert.equal(assessment.realSendContentReady, true);
        assert.equal(assessment.purposeAllowsFreeform, true);

        const parts = composeCompleteBulletinPart(
            COTTON_8_LOADS_RAW,
            a,
            "utility"
        );
        assert.equal(parts.length, 1);
        assert.equal(parts[0].bodyText, trimmed);
        assert.equal(parts[0].charCount, trimmed.length);
        assert.equal(parts[0].loadIndexes?.length, 8);
        assert.equal(parts[0].templateName, null);
        assert.equal(parts[0].readyForRealSend, true);
        assert.ok(parts[0].bodyText.includes("FRETE:"));
        assert.ok(parts[0].bodyText.includes("chat.whatsapp.com"));
    });

    it("marketing: wizard sizeReady OK; real send blocked (no Utility bypass)", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const assessment = assessCompleteBulletin(
            COTTON_8_LOADS_RAW,
            a,
            "marketing"
        );
        // Navigation/config allowed — size under freeform limit
        assert.equal(assessment.sizeReady, true);
        assert.equal(assessment.contentReady, true);
        assert.equal(assessment.realSendContentReady, false);
        assert.equal(assessment.readyForRealSend, false);
        assert.equal(assessment.purposeAllowsFreeform, false);
        assert.equal(assessment.sizeBlockReasons.length, 0);
        assert.ok(
            assessment.realSendBlockReasons.some((r) =>
                /marketing|template/i.test(r)
            )
        );
        assert.ok(
            assessment.explanations.some((e) =>
                e.includes(String(META_TEMPLATE_BODY_MAX))
            )
        );
        const parts = composeCompleteBulletinPart(
            COTTON_8_LOADS_RAW,
            a,
            "marketing"
        );
        assert.equal(parts[0].readyForRealSend, false);
        assert.equal(parts[0].compatibility, "blocked");
        // Content preserved even when real send blocked
        assert.equal(
            parts[0].bodyText,
            COTTON_8_LOADS_RAW.replace(/\r\n/g, "\n").trim()
        );
    });

    it("exactly 5000 chars: sizeReady; 5001: size blocked", () => {
        const exact = "X".repeat(META_FREEFORM_TEXT_MAX);
        const over = "X".repeat(META_FREEFORM_TEXT_MAX + 1);
        const aExact = analyzeBulletin(exact);
        const aOver = analyzeBulletin(over);

        const ok = assessCompleteBulletin(exact, aExact, "utility");
        assert.equal(ok.sizeReady, true);
        assert.equal(ok.withinFreeformLimit, true);
        assert.equal(ok.charCount, META_FREEFORM_TEXT_MAX);

        const bad = assessCompleteBulletin(over, aOver, "utility");
        assert.equal(bad.sizeReady, false);
        assert.equal(bad.contentReady, false);
        assert.equal(bad.withinFreeformLimit, false);
        assert.ok(
            bad.sizeBlockReasons.some((r) =>
                r.includes(String(META_FREEFORM_TEXT_MAX))
            )
        );
        const parts = composeCompleteBulletinPart(over, aOver, "utility");
        assert.equal(parts[0].bodyText.length, over.length);
        assert.equal(parts[0].readyForRealSend, false);
        assert.equal(parts[0].compatibility, "param_overflow");
    });

    it("split templates still block body over Meta 1024", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const split = composeReusableBulletinParts(a, approvedAll(), {
            purpose: "marketing",
        });
        assert.ok(split.length >= 1);
        for (const p of split) {
            if (p.charCount > META_TEMPLATE_BODY_MAX) {
                assert.equal(p.readyForRealSend, false);
            }
        }
        // A single synthetic part over 1024 must remain blocked in template path
        const hugeLoad = analyzeBulletin(
            "🚛 CARGA ÚNICA\n" + "Y".repeat(META_TEMPLATE_BODY_MAX + 50)
        );
        const hugeParts = composeReusableBulletinParts(
            hugeLoad,
            approvedAll(),
            { purpose: "marketing" }
        );
        assert.ok(
            hugeParts.some(
                (p) =>
                    p.charCount > META_TEMPLATE_BODY_MAX ||
                    !p.readyForRealSend
            )
        );
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
            assert.equal(assessment.sizeReady, true);
            const parts = composeCompleteBulletinPart(raw, a, "utility");
            assert.equal(parts.length, 1);
            assert.equal(parts[0].bodyText, raw.trim());
            assert.equal(parts[0].loadIndexes?.length, 20);
        } else {
            assert.equal(assessment.sizeReady, false);
        }
    });

    it("does not auto-split complete_single into multiple parts", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const parts = composeCompleteBulletinPart(
            COTTON_8_LOADS_RAW,
            a,
            "utility"
        );
        assert.equal(parts.length, 1);
        assert.ok(parts[0].charCount > META_TEMPLATE_BODY_MAX);
    });
});
