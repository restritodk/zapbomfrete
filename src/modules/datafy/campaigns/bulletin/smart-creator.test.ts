import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    analyzeBulletin,
    analysisToEditableDraft,
    duplicateLoad,
    emptyLoad,
    reindexLoads,
    serializeBulletinDraft,
} from "./analyze";
import {
    composeReusableBulletinParts,
    allPartsReadyForRealSend,
} from "./templates";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    buildV2BulletinTemplateSubmissions,
} from "./library";
import { COTTON_8_LOADS_RAW, buildNLoadsBulletin } from "./fixtures/cotton-8-loads";

function approvedAll() {
    return BULLETIN_TEMPLATE_LIBRARY.map((s) => ({
        name: s.preferredName,
        language: "pt_BR",
        status: "APPROVED",
        category: "MARKETING",
        components: [{ type: "BODY", text: s.bodyTextForApproval }],
    }));
}

function approvedV1Only() {
    return approvedAll().filter((t) => !t.name.includes("v2"));
}

describe("Smart creator — import volumes", () => {
    it("imports 1 load", () => {
        const a = analyzeBulletin(buildNLoadsBulletin(1));
        assert.equal(a.loadCount, 1);
        assert.ok(a.loads[0].fields.origem);
        assert.ok(a.loads[0].fields.frete);
    });

    it("imports 3 loads preserving order", () => {
        const a = analyzeBulletin(buildNLoadsBulletin(3));
        assert.equal(a.loadCount, 3);
        assert.match(a.loads[0].fields.origem || "", /Cidade1/);
        assert.match(a.loads[2].fields.origem || "", /Cidade3/);
    });

    it("imports COTTON 8 loads with distinct freights and windows", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        assert.equal(a.loadCount, 8);
        assert.match(a.title, /COTTON/i);
        assert.ok(a.general.groupUrl?.includes("chat.whatsapp.com"));

        const fretes = a.loads.map((l) => l.fields.frete || "");
        assert.ok(fretes.some((f) => /280/.test(f)));
        assert.ok(fretes.some((f) => /320/.test(f)));
        assert.ok(fretes.some((f) => /410/.test(f)));

        const janelas = a.loads.map((l) => l.fields.janela || "");
        assert.ok(janelas.some((j) => /D\+5/i.test(j)));
        assert.ok(janelas.some((j) => /15\/10/.test(j)));

        const veiculos = a.loads.map((l) => l.fields.veiculo || "");
        assert.ok(veiculos.some((v) => /RODOTREM/i.test(v)));
        assert.ok(veiculos.some((v) => /BITREM/i.test(v)));
        assert.ok(veiculos.some((v) => /CARRETA/i.test(v)));

        const maps = a.loads.map((l) => l.fields.localizacaoUrl || "");
        assert.equal(new Set(maps.filter(Boolean)).size, 8);

        const pedagios = a.loads.map((l) => l.fields.pedagio || "");
        assert.ok(pedagios.some((p) => /INCLUSO/i.test(p)));
        assert.ok(pedagios.some((p) => /NÃO INCLUSO|NAO INCLUSO/i.test(p)));

        // Load with unrecognized line kept
        const load5 = a.loads[4];
        assert.ok(
            load5.unrecognizedLines.some((l) => /balança|balanca/i.test(l)) ||
                /balança|balanca/i.test(load5.fields.observacoes || "")
        );
    });

    it("imports 30 loads without artificial cap", () => {
        const a = analyzeBulletin(buildNLoadsBulletin(30));
        assert.equal(a.loadCount, 30);
        assert.equal(a.loads[29].index, 29);
        assert.match(a.loads[29].fields.origem || "", /Cidade30/);
    });
});

describe("Smart creator — fields & safety", () => {
    it("keeps optional fields empty without inventing", () => {
        const raw = [
            "BOLETIM",
            "────────────────────",
            "Origem: Cuiaba/MT",
            "Destino: Santos/SP",
        ].join("\n");
        const a = analyzeBulletin(raw);
        assert.equal(a.loadCount, 1);
        assert.equal(a.loads[0].fields.frete, undefined);
        assert.equal(a.loads[0].fields.veiculo, undefined);
        assert.ok(a.loads[0].fields.origem);
    });

    it("recognizes date formats and D+N expressions", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const janelas = a.loads.map((l) => l.fields.janela || "").join("|");
        assert.match(janelas, /D\+/i);
        assert.match(janelas, /\d{1,2}\/\d{1,2}/);
    });

    it("preserves incomplete text for review", () => {
        const a = analyzeBulletin(
            ["T", "────────────────────", "Texto incompleto sem labels"].join(
                "\n"
            )
        );
        assert.equal(a.loadCount, 1);
        assert.ok(
            a.loads[0].unrecognizedLines.length > 0 ||
                a.loads[0].fields.observacoes ||
                a.loads[0].fields.detalhes
        );
    });

    it("duplicate and edit loads via helpers", () => {
        const a = analyzeBulletin(buildNLoadsBulletin(2));
        const draft = analysisToEditableDraft(a);
        const dup = duplicateLoad(draft.loads[0], draft.loads.length);
        dup.fields.frete = "R$ 999,00/TON";
        let loads = reindexLoads([...draft.loads, dup]);
        assert.equal(loads.length, 3);
        assert.equal(loads[2].fields.frete, "R$ 999,00/TON");
        loads = reindexLoads([loads[0], emptyLoad(1), loads[2]]);
        assert.equal(loads.length, 3);
        assert.equal(loads[1].completeness, 0);
        const serialized = serializeBulletinDraft({
            general: draft.general,
            loads,
        });
        assert.match(serialized, /999/);
        const again = analyzeBulletin(serialized);
        assert.ok(again.loadCount >= 2);
    });
});

describe("Smart creator — template packing & gates", () => {
    it("splits 8 loads across reusable templates", () => {
        const a = analyzeBulletin(COTTON_8_LOADS_RAW);
        const parts = composeReusableBulletinParts(a, approvedAll(), {
            purpose: "marketing",
        });
        assert.ok(parts.length >= 3);
        const totalLoads = parts.reduce((s, p) => s + p.loadIndexes.length, 0);
        assert.equal(totalLoads, 8);
        assert.ok(parts.every((p) => p.templateName?.includes("boletim")));
        assert.equal(allPartsReadyForRealSend(parts), true);
        // Prefer v2 when available
        assert.ok(parts.some((p) => p.libraryTemplateId?.includes("v2")));
    });

    it("falls back to v1 when only legacy APPROVED", () => {
        const a = analyzeBulletin(buildNLoadsBulletin(3));
        const parts = composeReusableBulletinParts(a, approvedV1Only(), {
            purpose: "marketing",
        });
        assert.equal(parts.length, 1);
        assert.equal(parts[0].templateName, "boletim_3_cargas");
        assert.ok(parts[0].policyWarning);
    });

    it("blocks real send without APPROVED templates", () => {
        const a = analyzeBulletin(buildNLoadsBulletin(1));
        const parts = composeReusableBulletinParts(a, [], {
            purpose: "marketing",
        });
        assert.equal(parts[0].readyForRealSend, false);
        assert.equal(parts[0].compatibility, "missing_template");
        assert.equal(allPartsReadyForRealSend(parts), false);
    });

    it("v2 BODY submissions stay within Meta 1024", () => {
        const v2 = buildV2BulletinTemplateSubmissions();
        assert.equal(v2.length, 3);
        for (const s of v2) {
            assert.ok(s.bodyCharCount <= 1024, s.name);
            assert.equal(s.checks.readyForManualSubmit, true);
            assert.equal(s.generation, 2);
        }
    });

    it("idempotent synthetic packing: same loads → same part count", () => {
        const a1 = analyzeBulletin(COTTON_8_LOADS_RAW);
        const a2 = analyzeBulletin(COTTON_8_LOADS_RAW);
        const p1 = composeReusableBulletinParts(a1, approvedAll());
        const p2 = composeReusableBulletinParts(a2, approvedAll());
        assert.equal(p1.length, p2.length);
        assert.deepEqual(
            p1.map((p) => p.loadIndexes),
            p2.map((p) => p.loadIndexes)
        );
    });
});
