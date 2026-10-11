import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatafyApiError } from "@/modules/datafy/client";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    LOAD_SLOT_FIELDS_V3,
    META_BODY_CLOSING_STATIC,
    buildBulletinTemplateSubmission,
} from "./library";
import {
    bodyEndsWithVariable,
    bodyStartsWithVariable,
    buildTemplateCreatePayload,
    ensureBodyVariableBoundaries,
    formatMetaTemplateApiError,
    significantBoundaryChars,
} from "./template-submit-payload";

describe("v3 BODY boundaries — Meta 2388299", () => {
    const v3Names = [
        "boletim_v3_1_carga",
        "boletim_v3_2_cargas",
        "boletim_v3_3_cargas",
    ] as const;

    for (const name of v3Names) {
        it(`${name}: significant start/end, vars, length, examples, payload equals validated BODY`, () => {
            const spec = BULLETIN_TEMPLATE_LIBRARY.find(
                (s) => s.preferredName === name
            )!;
            assert.ok(spec);
            const sub = buildBulletinTemplateSubmission(spec);
            const body = sub.bodyText;

            const bounds = significantBoundaryChars(body);
            assert.notEqual(bounds.first, "{");
            assert.notEqual(bounds.first, "");
            assert.notEqual(bounds.last, "}");
            assert.match(bounds.first, /[*\wÀ-ú]/i);
            assert.match(bounds.last, /[.\wÀ-ú]/i);

            assert.equal(bodyStartsWithVariable(body), false);
            assert.equal(bodyEndsWithVariable(body), false);
            // Trailing punctuation after {{n}} must still count as ending with var
            assert.equal(bodyEndsWithVariable("x {{12}}."), true);
            assert.equal(bodyEndsWithVariable("x {{12}}"), true);

            assert.ok(body.includes(META_BODY_CLOSING_STATIC));
            assert.ok(body.length <= 1024, `${name} len ${body.length}`);
            assert.equal(sub.exampleRow.length, sub.variableCount);
            assert.deepEqual(spec.slotFields, LOAD_SLOT_FIELDS_V3);

            const built = buildTemplateCreatePayload({
                name: sub.name,
                category: "MARKETING",
                bodyText: sub.bodyText,
                exampleRow: sub.exampleRow,
            });
            assert.equal(built.ok, true, name);
            if (!built.ok) return;

            const sent = built.payload.components[0].text;
            // Validated BODY === BODY sent to Datafy
            assert.equal(sent, body);
            assert.equal(bodyEndsWithVariable(sent), false);
            assert.equal(bodyStartsWithVariable(sent), false);
            assert.equal(
                built.payload.components[0].example?.body_text[0].length,
                sub.variableCount
            );
            assert.match(sent, /\{\{1\}\}/);
            assert.match(
                sent,
                new RegExp(`\\{\\{${sub.variableCount}\\}\\}`)
            );
            assert.ok(!/\{\{\d+\}\}$/.test(sent.trim()));
            assert.ok(sent.trim().endsWith(META_BODY_CLOSING_STATIC) || sent.includes(META_BODY_CLOSING_STATIC));
        });
    }

    it("ensureBodyVariableBoundaries upgrades punctuation-only ending (stale DB)", () => {
        const stale =
            "*ATUALIZAÇÃO*\nOrigem: {{1}}\nMapa: {{2}}.";
        assert.equal(bodyEndsWithVariable(stale), true);
        const fixed = ensureBodyVariableBoundaries(stale);
        assert.equal(bodyEndsWithVariable(fixed), false);
        assert.ok(fixed.includes(META_BODY_CLOSING_STATIC));
        assert.ok(!/\{\{\d+\}\}[.!?]*\s*$/.test(fixed.trim()) || fixed.includes("Confirme"));
    });

    it("formats 2388299 with guidance about meaningful static text", () => {
        const err = new DatafyApiError(
            "Variables can't be at the start or end of the template.",
            400,
            {
                error: {
                    message:
                        "Variables can't be at the start or end of the template.",
                    code: 100,
                    error_subcode: 2388299,
                },
            }
        );
        const f = formatMetaTemplateApiError(err);
        assert.equal(f.subcode, 2388299);
        assert.match(f.guidance || "", /pontua[cç][aã]o|significativo|\{\{n\}\}/i);
    });

    it("formats 2388293 still available (density)", () => {
        const err = new DatafyApiError("too many", 400, {
            error: {
                message: "This template has too many variables for its length.",
                code: 100,
                error_subcode: 2388293,
            },
        });
        const f = formatMetaTemplateApiError(err);
        assert.equal(f.subcode, 2388293);
        assert.match(f.guidance || "", /variáveis demais/i);
    });
});
