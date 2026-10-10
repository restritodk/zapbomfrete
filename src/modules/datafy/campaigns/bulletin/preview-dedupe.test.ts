import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeBulletin, stripFieldLabelPrefix } from "./analyze";
import { composeReusableBulletinParts } from "./templates";
import { BULLETIN_TEMPLATE_LIBRARY } from "./library";
import {
    COTTON_8_LOADS_RAW,
    buildNLoadsBulletin,
} from "./fixtures/cotton-8-loads";

function approvedAll() {
    return BULLETIN_TEMPLATE_LIBRARY.map((s) => ({
        name: s.preferredName,
        language: "pt_BR",
        status: "APPROVED",
        category: "MARKETING" as const,
    }));
}

describe("preview field dedupe", () => {
    it("strips redundant FRETE/JANELA labels without corrupting place names", () => {
        assert.equal(
            stripFieldLabelPrefix("frete", "FRETE: R$ 420,00"),
            "R$ 420,00"
        );
        assert.equal(
            stripFieldLabelPrefix("janela", "JANELA 13/10/2026"),
            "13/10/2026"
        );
        assert.equal(
            stripFieldLabelPrefix("janela", "JANELA: D+5 ÚTEIS"),
            "D+5 ÚTEIS"
        );
        // Must NOT strip "para" from Paranaguá
        assert.equal(
            stripFieldLabelPrefix("destino", "Paranaguá/PR"),
            "Paranaguá/PR"
        );
        // Must NOT strip TERMINAL from place name without delimiter
        assert.equal(
            stripFieldLabelPrefix("terminal", "TERMINAL CORREA"),
            "TERMINAL CORREA"
        );
        assert.equal(
            stripFieldLabelPrefix("destino", "Destino: Santos/SP"),
            "Santos/SP"
        );
    });

    it("COTTON 8 loads: no Frete:/Janela: double labels; Obs. does not mirror slots", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        assert.equal(a.loadCount, 8);
        const paranagua = a.loads.find((l) =>
            (l.fields.destino || "").includes("Paranagu")
        );
        assert.ok(paranagua, "expected Paranaguá load");
        assert.match(paranagua!.fields.destino || "", /Paranaguá/i);

        for (const load of a.loads) {
            const f = load.fields;
            if (f.frete) {
                assert.ok(
                    !/^frete\s*[:：]/i.test(f.frete),
                    `frete still labeled: ${f.frete}`
                );
            }
            if (f.janela) {
                assert.ok(
                    !/^janela\s*[:：]/i.test(f.janela),
                    `janela still labeled: ${f.janela}`
                );
            }
            if (f.localizacaoUrl && f.observacoes) {
                assert.ok(
                    !f.observacoes.includes(f.localizacaoUrl),
                    `maps duplicated in obs for load ${load.index}`
                );
            }
        }

        const parts = composeReusableBulletinParts(a, approvedAll(), {
            purpose: "marketing",
        });
        assert.ok(parts.length >= 3, "8 loads must split across messages");
        const joined = parts.map((p) => p.bodyText).join("\n");
        assert.ok(!/Frete:\s*FRETE/i.test(joined));
        assert.ok(!/Janela:\s*JANELA/i.test(joined));
        assert.ok(!/Obs\.:\s*[^\n]*Janela:/i.test(joined));
        assert.ok(!/Obs\.:\s*[^\n]*Frete:/i.test(joined));
        assert.ok(/Paranaguá/i.test(joined), "Paranaguá must survive in preview");
        for (const load of a.loads) {
            if (load.fields.origem) {
                assert.ok(
                    joined.includes(load.fields.origem),
                    `missing origem ${load.fields.origem} in preview`
                );
            }
        }
        assert.ok(
            parts.every((p) => p.bodyText.length === p.charCount),
            "charCount must match bodyText (no silent truncation)"
        );
    });

    it("20+ loads: preview parts cover all loads without truncating raw to 500", () => {
        const raw = buildNLoadsBulletin(20);
        const a = analyzeBulletin(raw);
        assert.equal(a.loadCount, 20);
        const parts = composeReusableBulletinParts(a, [], {
            purpose: "marketing",
        });
        assert.ok(parts.length >= 2);
        const covered = new Set(parts.flatMap((p) => p.loadIndexes || []));
        assert.equal(covered.size, 20);
        assert.ok(
            parts.every((p) => p.bodyText.length > 500 || a.loadCount < 3),
            "must not use silent 500-char truncation for missing templates"
        );
        assert.ok(parts.every((p) => p.readyForRealSend === false));
    });

    it("50 loads: analysis keeps all loads and packs multiple parts", () => {
        const raw = buildNLoadsBulletin(50);
        const a = analyzeBulletin(raw);
        assert.equal(a.loadCount, 50);
        assert.ok(a.partCount >= 2);
        const totalInParts = a.parts.reduce(
            (s, p) => s + p.loadIndexes.length,
            0
        );
        assert.equal(totalInParts, 50);
    });
});
