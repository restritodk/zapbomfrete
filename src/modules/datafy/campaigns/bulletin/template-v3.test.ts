import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatafyApiError } from "@/modules/datafy/client";
import { analyzeBulletin } from "./analyze";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    buildBulletinTemplateSubmission,
    buildV3BulletinTemplateSubmissions,
    countPositionalVars,
    fillTemplatePreview,
    hasSequentialPlaceholders,
    LOAD_SLOT_FIELDS_V3,
} from "./library";
import {
    expandSlotCoverage,
    filledLoadFieldKeys,
    uncoveredFilledFields,
} from "./field-map";
import {
    buildTemplateCreatePayload,
    formatMetaTemplateApiError,
} from "./template-submit-payload";
import { composeReusableBulletinParts, valuesForLoad } from "./templates";
import type { BulletinLoad } from "./types";

const SAMPLE_SEP = "────────────────────";

function richLoad(n: number): string {
    return [
        `🚛 Carga ${n}`,
        `Origem: Cidade A${n}`,
        `Local de carregamento: FAZ ${n}`,
        `Destino: Cidade B${n}`,
        `Terminal: Porto ${n}`,
        `Janela: D+${n}`,
        `Veículo: RODOTREM`,
        `Quantidade: ${n}`,
        `Frete: R$ ${100 + n},00/TON`,
        `Localização: https://maps.app.goo.gl/abc${n}`,
        `Pedágio: PEDAGIO INCLUSO`,
        `Observações: Obs carga ${n}`,
    ].join("\n");
}

describe("bulletin v3 templates — Meta density fix (2388293)", () => {
    it("exposes boletim_v3_* with 6/12/18 variables and sequential placeholders", () => {
        const v3 = BULLETIN_TEMPLATE_LIBRARY.filter((s) => s.generation === 3);
        assert.equal(v3.length, 3);
        assert.deepEqual(
            v3.map((s) => s.variableCount),
            [6, 12, 18]
        );
        for (const spec of v3) {
            assert.ok(hasSequentialPlaceholders(spec.bodyTextForApproval));
            assert.equal(
                countPositionalVars(spec.bodyTextForApproval),
                spec.variableCount
            );
            assert.equal(spec.slotFields.length, 6);
            assert.deepEqual(spec.slotFields, LOAD_SLOT_FIELDS_V3);
            assert.ok(!/^\s*\{\{\d+\}\}/.test(spec.bodyTextForApproval));
            assert.ok(!/\{\{\d+\}\}\s*$/.test(spec.bodyTextForApproval.trim()));
            assert.ok(spec.bodyTextForApproval.length <= 1024);
        }
    });

    it("examples match variables and payload is valid for Meta create", () => {
        for (const sub of buildV3BulletinTemplateSubmissions()) {
            assert.equal(sub.exampleRow.length, sub.variableCount);
            assert.equal(sub.checks.examplesMatchVars, true);
            assert.equal(sub.checks.readyForManualSubmit, true);
            assert.ok(sub.bodyCharCount <= 1024);
            const built = buildTemplateCreatePayload({
                name: sub.name,
                category: "MARKETING",
                bodyText: sub.bodyText,
                exampleRow: sub.exampleRow,
            });
            assert.equal(built.ok, true, sub.name);
            if (!built.ok) continue;
            const body = built.payload.components[0].text;
            assert.ok(!/\{\{\d+\}\}$/.test(body.trim()));
            assert.equal(
                built.payload.components[0].example?.body_text[0].length,
                sub.variableCount
            );
            const preview = fillTemplatePreview(body, sub.exampleRow);
            assert.equal(preview.includes("{{"), false);
            assert.match(preview, /Sapezal|RODOTREM|mapa|observ/i);
        }
    });

    it("preserves freight fields via composites in valuesForLoad", () => {
        const load: BulletinLoad = {
            index: 0,
            text: "",
            fields: {
                origem: "Sapezal/MT",
                localCarregamento: "FAZ SAUDADES",
                destino: "Rondonopolis/MT",
                terminal: "ALG COOPERBEM",
                janela: "D+5 UTEIS",
                veiculo: "RODOTREM",
                quantidade: "2",
                frete: "R$ 280,00/TON",
                localizacaoUrl: "https://maps.app.goo.gl/exemplo",
                pedagio: "PEDAGIO INCLUSO NO FRETE",
                observacoes: "Sem observacoes",
            },
            unrecognizedLines: [],
            ambiguous: [],
            charCount: 0,
            exceedsLimit: false,
            completeness: 1,
        };
        const vals = valuesForLoad(load, LOAD_SLOT_FIELDS_V3);
        assert.equal(vals.length, 6);
        assert.match(vals[0], /Sapezal/);
        assert.match(vals[0], /FAZ SAUDADES/);
        assert.match(vals[1], /Rondonopolis/);
        assert.match(vals[1], /COOPERBEM/);
        assert.equal(vals[2], "D+5 UTEIS");
        assert.match(vals[3], /RODOTREM/);
        assert.match(vals[3], /2/);
        assert.match(vals[4], /280/);
        assert.match(vals[4], /INCLUSO/);
        assert.match(vals[5], /maps\.app/);
        assert.match(vals[5], /observ/i);

        const covered = expandSlotCoverage(LOAD_SLOT_FIELDS_V3);
        const filled = filledLoadFieldKeys(load.fields);
        assert.equal(uncoveredFilledFields(filled, LOAD_SLOT_FIELDS_V3).length, 0);
        assert.ok(covered.includes("origem"));
        assert.ok(covered.includes("localCarregamento"));
        assert.ok(covered.includes("pedagio"));
    });

    it("composes 1, 2 and 3 loads with v3 APPROVED templates", () => {
        for (const n of [1, 2, 3] as const) {
            const chunks = ["BOLETIM V3"];
            for (let i = 1; i <= n; i++) {
                chunks.push(SAMPLE_SEP, richLoad(i));
            }
            const analysis = analyzeBulletin(chunks.join("\n"));
            const name =
                n === 1
                    ? "boletim_v3_1_carga"
                    : n === 2
                      ? "boletim_v3_2_cargas"
                      : "boletim_v3_3_cargas";
            const spec = BULLETIN_TEMPLATE_LIBRARY.find((s) => s.id === name)!;
            const parts = composeReusableBulletinParts(
                analysis,
                [
                    {
                        name: spec.preferredName,
                        language: "pt_BR",
                        status: "APPROVED",
                        category: "MARKETING",
                        components: [
                            { type: "BODY", text: spec.bodyTextForApproval },
                        ],
                    },
                ],
                { purpose: "marketing" }
            );
            assert.equal(parts.length, 1, `loads=${n}`);
            assert.equal(parts[0].templateName, name);
            assert.equal(parts[0].readyForRealSend, true);
            assert.equal(
                parts[0].variableMapping?.body?.length,
                n * 6
            );
            assert.match(parts[0].bodyText, /Cidade A1/);
            assert.match(parts[0].bodyText, /FAZ 1/);
            assert.match(parts[0].bodyText, /Porto 1/);
        }
    });

    it("keeps v1/v2 names unchanged for existing campaign compatibility", () => {
        const names = BULLETIN_TEMPLATE_LIBRARY.map((s) => s.preferredName);
        assert.ok(names.includes("boletim_1_carga"));
        assert.ok(names.includes("boletim_v2_1_carga"));
        assert.ok(names.includes("boletim_v3_1_carga"));
        const v2 = buildBulletinTemplateSubmission(
            BULLETIN_TEMPLATE_LIBRARY.find((s) => s.id === "boletim_v2_1_carga")!
        );
        // v2 not proposed for new Meta submit (density risk)
        assert.equal(v2.checks.readyForManualSubmit, false);
        assert.ok(v2.checks.notes.some((n) => /2388293|v3/i.test(n)));
    });

    it("formats Meta error 2388293 with user guidance", () => {
        const err = new DatafyApiError(
            "This template has too many variables for its length.",
            400,
            {
                error: {
                    message:
                        "This template has too many variables for its length. Reduce the number of variables or increase the message length.",
                    code: 100,
                    error_subcode: 2388293,
                    fbtrace_id: "trace_density",
                },
            }
        );
        const f = formatMetaTemplateApiError(err);
        assert.equal(f.code, 100);
        assert.equal(f.subcode, 2388293);
        assert.equal(f.fbtraceId, "trace_density");
        assert.match(
            f.guidance || "",
            /variáveis demais em relação ao texto fixo/i
        );
        assert.match(f.message, /2388293|too many variables/i);
    });

    it("formats Meta error 2388299 (BODY ends with variable)", () => {
        const err = new DatafyApiError("Invalid parameter", 400, {
            error: {
                message: "Invalid parameter",
                code: 100,
                error_subcode: 2388299,
                error_user_msg:
                    "O texto do corpo não pode terminar com uma variável.",
                fbtrace_id: "trace_endvar",
            },
        });
        const f = formatMetaTemplateApiError(err);
        assert.equal(f.subcode, 2388299);
        assert.ok(f.guidance);
        assert.match(f.guidance || "", /começar nem terminar/i);
    });
});
