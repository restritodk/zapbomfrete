import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    canUseTemplateAsFreeformFallback,
    expectedBodyParamCount,
    formatMeta132000Message,
    isMeta132000Error,
    validateTemplateBodyParamCount,
} from "./template-params";

describe("template BODY params — Meta #132000", () => {
    it("detects expected count from BODY text", () => {
        assert.equal(
            expectedBodyParamCount({
                bodyText: "A {{1}} B {{2}} C {{12}}",
            }),
            3
        );
    });

    it("blocks 1 CRM token vs 3 BODY params (production freeform+fallback)", () => {
        const check = validateTemplateBodyParamCount({
            templateName: "boletim_v3_3_cargas",
            language: "pt_BR",
            bodyText: "Origem {{1}}\nDestino {{2}}\nFrete {{3}}",
            variableMapping: { body: ["fullName"] },
        });
        assert.equal(check.ok, false);
        assert.equal(check.expected, 3);
        assert.equal(check.provided, 1);
        assert.equal(check.code, 132000);
        assert.match(check.message || "", /132000/);
    });

    it("allows static 0-param template with empty mapping", () => {
        const check = validateTemplateBodyParamCount({
            templateName: "aviso_utilidade",
            bodyText: "Olá, sua carga foi atualizada.",
            variableMapping: { body: [] },
        });
        assert.equal(check.ok, true);
    });

    it("rejects unknown boletim name as freeform fallback", () => {
        assert.equal(
            canUseTemplateAsFreeformFallback({
                templateName: "boletim_v3_2_cargas",
                variableMapping: { body: [] },
            }),
            false
        );
    });

    it("formats user-facing 132000 message", () => {
        const msg = formatMeta132000Message({
            templateName: "boletim_v3_2_cargas",
            language: "pt_BR",
            expected: 12,
            provided: 0,
        });
        assert.match(msg, /quantidade específica de parâmetros/i);
        assert.match(msg, /boletim_v3_2_cargas/);
        assert.match(msg, /12/);
    });

    it("detects 132000 from API message and body code", () => {
        assert.equal(
            isMeta132000Error({
                message:
                    "(#132000) Number of parameters does not match the expected number of params",
            }),
            true
        );
        assert.equal(
            isMeta132000Error({
                body: { error: { code: 132000, message: "x" } },
            }),
            true
        );
    });

    it("preserves freeform 8-load paste as non-template (no silent param invent)", () => {
        const pasted = [
            "🚛 BOLETIM COTTON",
            "1) CAMPO VERDE-MT → CUBATÃO-SP",
            "Frete R$ 420,00",
            "https://maps.example/1",
            "8) ÚLTIMA CARGA",
        ].join("\n");
        assert.equal(expectedBodyParamCount({ bodyText: pasted }), 0);
        // Pasted freeform must not be treated as a parameterized template BODY
        const check = validateTemplateBodyParamCount({
            templateName: null,
            bodyText: pasted,
            variableMapping: { body: [] },
        });
        assert.equal(check.ok, true);
        assert.equal(check.expected, 0);
    });
});
