import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeBulletin, estimateMessageTotal, packParts } from "./analyze";
import {
    associatePartsWithTemplates,
    allPartsReadyForRealSend,
} from "./templates";
import { META_TEMPLATE_BODY_MAX } from "./types";

const SAMPLE_SEP = "────────────────────";

function makeLoad(n: number, extra = ""): string {
    return [
        `🚛 Carga ${n}`,
        `Origem: Cidade A${n}`,
        `Destino: Cidade B${n}`,
        `Terminal: Porto ${n}`,
        `Lote: L${n}00`,
        `Localização: https://maps.app.goo.gl/abc${n}`,
        `Grupo: https://chat.whatsapp.com/Invite${n}`,
        `Pedágio: Tag OK`,
        extra,
    ].join("\n");
}

describe("Bulletin analyzer — single & multi load", () => {
    it("parses one load with links and emojis", () => {
        const raw = [
            "ATUALIZAÇÃO DE EMBARQUE COTTON ✅",
            SAMPLE_SEP,
            makeLoad(1),
        ].join("\n");
        const a = analyzeBulletin(raw);
        assert.equal(a.loadCount, 1);
        assert.equal(a.partCount, 1);
        assert.match(a.parts[0].bodyText, /maps\.app\.goo\.gl/);
        assert.match(a.parts[0].bodyText, /chat\.whatsapp\.com/);
        assert.match(a.parts[0].bodyText, /✅|🚛/);
        assert.ok(a.loads[0].fields.origem);
        assert.ok(a.loads[0].fields.destino);
    });

    it("splits six loads preserving order", () => {
        const chunks = ["ATUALIZAÇÃO DE EMBARQUE COTTON"];
        for (let i = 1; i <= 6; i++) {
            chunks.push(SAMPLE_SEP, makeLoad(i));
        }
        const a = analyzeBulletin(chunks.join("\n"));
        assert.equal(a.loadCount, 6);
        assert.ok(a.partCount >= 1);
        const joined = a.parts.map((p) => p.bodyText).join("\n");
        for (let i = 1; i <= 6; i++) {
            assert.match(joined, new RegExp(`Carga ${i}`));
        }
        // order: carga 1 before carga 6
        assert.ok(joined.indexOf("Carga 1") < joined.indexOf("Carga 6"));
    });

    it("packs dozens of loads into multiple parts under Meta limit", () => {
        const chunks = ["BOLETIM FRETE SUL 🚚"];
        for (let i = 1; i <= 40; i++) {
            chunks.push(SAMPLE_SEP, makeLoad(i, `Obs livre linha ${i}\nextra`));
        }
        const a = analyzeBulletin(chunks.join("\n"));
        assert.equal(a.loadCount, 40);
        assert.ok(a.partCount >= 2);
        for (const p of a.parts) {
            assert.ok(
                p.charCount <= META_TEMPLATE_BODY_MAX ||
                    a.warnings.some((w) => w.includes("excede")),
                `part ${p.index} chars=${p.charCount}`
            );
        }
        if (a.partCount > 1) {
            assert.match(a.parts[0].label, /PARTE 1\//);
            assert.match(
                a.parts[a.partCount - 1].label,
                new RegExp(`PARTE ${a.partCount}/${a.partCount}`)
            );
        }
    });

    it("preserves blank-line free text and separators", () => {
        const raw = [
            "BOLETIM TESTE",
            "",
            "Intro livre antes das cargas 🔥",
            SAMPLE_SEP,
            makeLoad(1),
            SAMPLE_SEP,
            "Texto livre entre blocos",
            makeLoad(2).replace("🚛 Carga 2", "🚛 Carga 2\nnota"),
        ].join("\n");
        const a = analyzeBulletin(raw);
        assert.ok(a.loadCount >= 2);
        const all = a.parts.map((p) => p.bodyText).join("\n");
        assert.match(all, /Texto livre entre blocos|Intro livre|🔥/);
    });

    it("flags individual load over Meta limit without truncating", () => {
        const huge = "X".repeat(META_TEMPLATE_BODY_MAX + 50);
        const raw = ["TITULO", SAMPLE_SEP, `🚛 Over\n${huge}`].join("\n");
        const a = analyzeBulletin(raw);
        assert.equal(a.loads[0].exceedsLimit, true);
        assert.ok(a.loads[0].text.includes(huge.slice(0, 20)));
        assert.ok(a.warnings.some((w) => /excede/i.test(w)));
        assert.equal(a.parts[0].bodyText.includes(huge.slice(0, 20)), true);
    });

    it("estimates total messages", () => {
        assert.equal(estimateMessageTotal(100, 3), 300);
    });
});

describe("Bulletin template association", () => {
    it("marks ready when APPROVED template body matches part", () => {
        const a = analyzeBulletin(
            ["TITULO", SAMPLE_SEP, makeLoad(1)].join("\n")
        );
        const body = a.parts[0].bodyText;
        const associated = associatePartsWithTemplates(a.parts, [
            {
                name: "boletim_cotton_p1",
                language: "pt_BR",
                status: "APPROVED",
                category: "UTILITY",
                components: [{ type: "BODY", text: body }],
            },
        ]);
        assert.equal(associated[0].readyForRealSend, true);
        assert.equal(allPartsReadyForRealSend(associated), true);
    });

    it("blocks real send when template pending / missing", () => {
        const a = analyzeBulletin(
            ["TITULO", SAMPLE_SEP, makeLoad(1)].join("\n")
        );
        const associated = associatePartsWithTemplates(a.parts, [
            {
                name: "other",
                language: "pt_BR",
                status: "PENDING",
                components: [{ type: "BODY", text: a.parts[0].bodyText }],
            },
        ]);
        assert.equal(associated[0].readyForRealSend, false);
        assert.ok(associated[0].blockReason);
    });
});

describe("packParts unit", () => {
    it("never splits a load across parts", () => {
        const loads = [
            {
                index: 0,
                text: "A".repeat(400),
                fields: {},
                charCount: 400,
                exceedsLimit: false,
            },
            {
                index: 1,
                text: "B".repeat(400),
                fields: {},
                charCount: 400,
                exceedsLimit: false,
            },
            {
                index: 2,
                text: "C".repeat(400),
                fields: {},
                charCount: 400,
                exceedsLimit: false,
            },
        ];
        const { parts } = packParts("T", loads, 1024);
        for (const p of parts) {
            for (const idx of p.loadIndexes) {
                assert.match(p.bodyText, new RegExp(loads[idx].text.slice(0, 10)));
            }
        }
        const allIdx = parts.flatMap((p) => p.loadIndexes).sort();
        assert.deepEqual(allIdx, [0, 1, 2]);
    });
});
