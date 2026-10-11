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
    it("exposes v1+v2+v3 MARKETING pt_BR models within Meta limits", () => {
        const all = buildAllBulletinTemplateSubmissions();
        assert.equal(all.length, 9);
        for (const s of all) {
            assert.equal(s.language, "pt_BR");
            assert.equal(s.category, "MARKETING");
            assert.equal(s.parameter_format, "POSITIONAL");
            assert.ok(
                s.bodyCharCount <= 1024,
                `${s.name} BODY ${s.bodyCharCount}`
            );
            assert.equal(s.exampleRow.length, s.variableCount);
            assert.equal(
                countPositionalVars(s.bodyText),
                s.variableCount
            );
            // v2 kept for history but not ready for new Meta submit (2388293)
            if (s.generation === 2) {
                assert.equal(s.checks.readyForManualSubmit, false);
            } else {
                assert.equal(s.checks.readyForManualSubmit, true);
            }
            assert.ok(s.previewFilled.length > 20);
            assert.equal(s.previewFilled.includes("{{"), false);
        }
        const names = all.map((x) => x.name);
        assert.ok(names.includes("boletim_1_carga"));
        assert.ok(names.includes("boletim_v2_1_carga"));
        assert.ok(names.includes("boletim_v3_1_carga"));
        assert.ok(names.includes("boletim_v3_3_cargas"));
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
        const spec = BULLETIN_TEMPLATE_LIBRARY.find(
            (s) => s.id === "boletim_v2_1_carga"
        )!;
        const sub = buildBulletinTemplateSubmission(spec);
        const base = [...sub.exampleRow];
        const dayA = fillTemplatePreview(sub.bodyText, [
            "Cidade A",
            ...base.slice(1),
        ]);
        const dayB = fillTemplatePreview(sub.bodyText, [
            "Cidade B",
            ...base.slice(1),
        ]);
        assert.notEqual(dayA, dayB);
        assert.match(dayA, /Cidade A/);
        assert.match(dayB, /Cidade B/);
    });
});
