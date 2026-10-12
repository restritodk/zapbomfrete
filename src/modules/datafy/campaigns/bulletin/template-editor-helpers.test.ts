import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    fillPreviewFromExamples,
    isDraftDirty,
    nextEditorStep,
    prevEditorStep,
    type TemplateEditorDraft,
} from "./template-editor-helpers";

const base = (): TemplateEditorDraft => ({
    technicalName: "boletim_teste",
    displayName: "Teste",
    category: "MARKETING",
    headerText: "",
    bodyText: "Origem: {{1}}\nDestino: {{2}}",
    footerText: "",
    buttons: {
        enabled: false,
        grantText: "Sim, quero ofertas",
        denyText: "Não quero receber",
    },
    fieldMappings: ["origem", "destino"],
    exampleRow: ["A", "B"],
    loadsPerMessage: 1,
    description: "",
});

describe("template-editor-helpers", () => {
    it("detects dirty draft", () => {
        const a = base();
        const b = base();
        assert.equal(isDraftDirty(a, b), false);
        b.bodyText = "alterado";
        assert.equal(isDraftDirty(a, b), true);
        assert.equal(isDraftDirty(a, null), false);
    });

    it("fills preview examples without inventing campaign data", () => {
        const filled = fillPreviewFromExamples("Oi {{1}} — {{2}}", [
            "Lucas",
            "MT",
        ]);
        assert.equal(filled, "Oi Lucas — MT");
        assert.equal(
            fillPreviewFromExamples("Só {{1}} e {{2}}", ["X"]),
            "Só X e {{2}}"
        );
    });

    it("navigates steps without dropping identity", () => {
        assert.equal(nextEditorStep("info"), "content");
        assert.equal(nextEditorStep("review"), "review");
        assert.equal(prevEditorStep("info"), "info");
        assert.equal(prevEditorStep("vars"), "content");
    });
});
