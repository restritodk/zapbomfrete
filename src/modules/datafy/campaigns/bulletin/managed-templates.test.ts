import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    hydrateClientLibrary,
    managedToClientLibrary,
    managedToSpecs,
    type ManagedTemplateView,
} from "./managed-registry";
import { validateTemplateDraft } from "./template-validation";
import { composeReusableBulletinParts } from "./templates";
import { analyzeBulletin } from "./analyze";
import {
    filledLoadFieldKeys,
    uncoveredFilledFields,
} from "./field-map";

function sampleView(
    overrides: Partial<ManagedTemplateView> = {}
): ManagedTemplateView {
    return {
        id: "custom:1",
        kind: "custom",
        builtinId: null,
        source: "db",
        technicalName: "boletim_custom_1",
        displayName: "Custom 1",
        category: "MARKETING",
        language: "pt_BR",
        headerText: null,
        bodyText:
            "*ATUALIZAÇÃO*\nOrigem: {{1}}\nDestino: {{2}}\nFrete: {{3}}",
        footerText: null,
        fieldMappings: ["origem", "destino", "frete"],
        exampleRow: ["A", "B", "R$ 100"],
        loadsPerMessage: 1,
        variableCount: 3,
        bodyCharCount: 40,
        description: "teste",
        previewFilled: "x",
        hidden: false,
        remoteStatus: null,
        remoteTemplateId: null,
        remoteRejectedReason: null,
        lastSubmittedAt: null,
        readyForManualSubmit: true,
        notes: [],
        libraryId: "custom:boletim_custom_1",
        ...overrides,
    };
}

describe("managed templates validation", () => {
    it("rejects invalid technical name and mismatched mappings", () => {
        const bad = validateTemplateDraft({
            technicalName: "1invalido",
            displayName: "X",
            category: "MARKETING",
            bodyText: "Oi {{1}} {{2}}",
            fieldMappings: ["origem"],
            exampleRow: ["a"],
        });
        assert.equal(bad.ok, false);
        assert.ok(bad.errors.some((e) => /técnico/i.test(e)));
        assert.ok(bad.errors.some((e) => /Mapeamentos/i.test(e)));
    });

    it("accepts sequential vars with matching field map", () => {
        const ok = validateTemplateDraft({
            technicalName: "boletim_frete_ok",
            displayName: "Frete OK",
            category: "MARKETING",
            bodyText: "Origem: {{1}}\nDestino: {{2}}\nFrete: {{3}}",
            fieldMappings: ["origem", "destino", "frete"],
            exampleRow: ["LV", "ROO", "280"],
            loadsPerMessage: 1,
        });
        assert.equal(ok.ok, true);
        assert.equal(ok.variableCount, 3);
        assert.ok(ok.previewFilled.includes("LV"));
    });
});

describe("managed library serialize", () => {
    it("round-trips client library for compose match by name", () => {
        const views = [sampleView()];
        const client = managedToClientLibrary(views);
        const hydrated = hydrateClientLibrary(client);
        assert.equal(hydrated[0].preferredName, "boletim_custom_1");
        assert.equal(
            hydrated[0].namePatterns[0].test("boletim_custom_1"),
            true
        );
        assert.deepEqual(managedToSpecs(views)[0].slotFields, [
            "origem",
            "destino",
            "frete",
        ]);
    });
});

describe("compatibility / no silent drop", () => {
    it("flags uncovered filled fields without catch-all", () => {
        const filled = filledLoadFieldKeys({
            origem: "A",
            destino: "B",
            frete: "100",
            pedagio: "incluso",
        });
        const uncovered = uncoveredFilledFields(filled, [
            "origem",
            "destino",
            "frete",
        ]);
        assert.ok(uncovered.includes("pedagio"));
    });

    it("blocks compose when approved template cannot cover fields", () => {
        const raw = [
            "ATUALIZAÇÃO DE EMBARQUE",
            "Carga 1",
            "Origem: Lucas do Rio Verde/MT",
            "Destino: Rondonópolis/MT",
            "Frete: R$ 280/t",
            "Pedágio: por conta do embarcador",
        ].join("\n");
        const analysis = analyzeBulletin(raw);
        const lib = managedToSpecs([
            sampleView({
                technicalName: "boletim_min",
                bodyText: "O: {{1}}\nD: {{2}}\nF: {{3}}",
                fieldMappings: ["origem", "destino", "frete"],
                variableCount: 3,
                exampleRow: ["a", "b", "c"],
            }),
        ]);
        const parts = composeReusableBulletinParts(
            analysis,
            [
                {
                    name: "boletim_min",
                    language: "pt_BR",
                    status: "APPROVED",
                    category: "MARKETING",
                },
            ],
            { purpose: "marketing", library: lib }
        );
        assert.ok(parts.length > 0);
        const blocked = parts.some(
            (p) =>
                p.compatibility === "incomplete_fields" ||
                p.readyForRealSend === false
        );
        assert.equal(blocked, true);
        assert.ok(
            parts.some((p) =>
                /ped[aá]gio/i.test(String(p.blockReason || ""))
            )
        );
    });
});
