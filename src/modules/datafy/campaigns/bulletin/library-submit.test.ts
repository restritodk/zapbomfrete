import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    buildAllBulletinTemplateSubmissions,
    buildBulletinTemplateSubmission,
    countPositionalVars,
    fillTemplatePreview,
} from "./library";
import { composeReusableBulletinParts } from "./templates";
import { analyzeBulletin } from "./analyze";

describe("Bulletin library ready for Meta approval", () => {
    it("exposes exactly 3 MARKETING pt_BR models within Meta limits", () => {
        const all = buildAllBulletinTemplateSubmissions();
        assert.equal(all.length, 3);
        for (const s of all) {
            assert.equal(s.language, "pt_BR");
            assert.equal(s.category, "MARKETING");
            assert.equal(s.parameter_format, "POSITIONAL");
            assert.ok(s.bodyCharCount <= 1024);
            assert.equal(s.exampleRow.length, s.variableCount);
            assert.equal(
                countPositionalVars(s.bodyText),
                s.variableCount
            );
            assert.equal(s.checks.readyForManualSubmit, true);
            assert.ok(s.previewFilled.length > 20);
            assert.equal(s.previewFilled.includes("{{"), false);
        }
        assert.deepEqual(
            all.map((x) => x.name),
            ["boletim_1_carga", "boletim_2_cargas", "boletim_3_cargas"]
        );
    });

    it("does not use PENDING templates for real-send composition", () => {
        const raw = [
            "BOLETIM",
            "────────────────────",
            "🚛 Carga 1",
            "Origem: A",
            "Destino: B",
            "Terminal: T",
            "Lote: L1",
            "Localização: https://maps.app.goo.gl/x",
            "Pedágio: OK",
        ].join("\n");
        const analysis = analyzeBulletin(raw);
        const pendingOnly = BULLETIN_TEMPLATE_LIBRARY.map((s) => ({
            name: s.preferredName,
            language: "pt_BR",
            status: "PENDING",
            category: "MARKETING",
            components: [{ type: "BODY", text: s.bodyTextForApproval }],
        }));
        const parts = composeReusableBulletinParts(analysis, pendingOnly, {
            purpose: "marketing",
        });
        assert.equal(parts[0].readyForRealSend, false);
        assert.equal(parts[0].compatibility, "missing_template");
    });

    it("fills different daily values without changing template name", () => {
        const spec = BULLETIN_TEMPLATE_LIBRARY[0];
        const sub = buildBulletinTemplateSubmission(spec);
        const dayA = fillTemplatePreview(sub.bodyText, [
            "Cidade A",
            "Porto A",
            "Term A",
            "L1",
            "https://maps.app.goo.gl/a",
            "Tag",
            "Dia 1",
        ]);
        const dayB = fillTemplatePreview(sub.bodyText, [
            "Cidade B",
            "Porto B",
            "Term B",
            "L2",
            "https://maps.app.goo.gl/b",
            "Tag",
            "Dia 2",
        ]);
        assert.notEqual(dayA, dayB);
        assert.match(dayA, /Cidade A/);
        assert.match(dayB, /Cidade B/);
    });
});
