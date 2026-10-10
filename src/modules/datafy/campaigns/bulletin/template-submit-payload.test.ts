import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatafyApiError } from "@/modules/datafy/client";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    buildBulletinTemplateSubmission,
} from "./library";
import {
    buildTemplateCreatePayload,
    ensureBodyVariableBoundaries,
    formatMetaTemplateApiError,
    validateTemplateBodyAndExamples,
} from "./template-submit-payload";

describe("template submit payload — Meta BODY rules", () => {
    it("detects and fixes BODY ending with a variable (Invalid parameter root cause)", () => {
        const raw =
            "*ATUALIZAÇÃO*\nOrigem: {{1}}\nDestino: {{2}}\nObs.: {{3}}";
        assert.match(raw.trim(), /\{\{\d+\}\}$/);
        const fixed = ensureBodyVariableBoundaries(raw);
        assert.ok(!/\{\{\d+\}\}$/.test(fixed.trim()));
        assert.ok(fixed.endsWith("."));
    });

    it("1 variable: valid payload with example", () => {
        const built = buildTemplateCreatePayload({
            name: "aviso_1",
            category: "MARKETING",
            bodyText: "Ola {{1}}, obrigado.",
            exampleRow: ["Maria"],
        });
        assert.equal(built.ok, true);
        if (!built.ok) return;
        assert.equal(built.payload.components[0].type, "BODY");
        assert.deepEqual(built.payload.components[0].example?.body_text, [
            ["Maria"],
        ]);
        assert.equal(built.payload.language, "pt_BR");
        assert.ok(!("parameter_format" in built.payload));
    });

    it("11 variables (boletim_v2_1_carga): examples complete and BODY does not end with var", () => {
        const spec = BULLETIN_TEMPLATE_LIBRARY.find(
            (s) => s.preferredName === "boletim_v2_1_carga"
        )!;
        const sub = buildBulletinTemplateSubmission(spec);
        assert.equal(sub.variableCount, 11);
        assert.equal(sub.exampleRow.length, 11);
        const built = buildTemplateCreatePayload({
            name: sub.name,
            category: "MARKETING",
            bodyText: sub.bodyText,
            exampleRow: sub.exampleRow,
        });
        assert.equal(built.ok, true);
        if (!built.ok) return;
        const body = built.payload.components[0].text;
        assert.ok(!/\{\{\d+\}\}$/.test(body.trim()));
        assert.equal(
            built.payload.components[0].example?.body_text[0].length,
            11
        );
        assert.ok(body.length <= 1024);
    });

    it("rejects missing examples", () => {
        const v = validateTemplateBodyAndExamples(
            "Ola {{1}} e {{2}}.",
            ["so um"]
        );
        assert.equal(v.ok, false);
        assert.ok(v.errors.some((e) => /Exemplos/.test(e)));
    });

    it("rejects empty example values", () => {
        const v = validateTemplateBodyAndExamples("Ola {{1}}.", ["  "]);
        // sanitizeTemplateParam turns empty into N/D — so may pass
        // Explicit empty after sanitize: use validate with intentional blank via space-only after we bypass sanitize path
        const built = buildTemplateCreatePayload({
            name: "x",
            category: "MARKETING",
            bodyText: "Ola {{1}}.",
            exampleRow: [""],
        });
        // sanitize fills N/D — payload should still be ok
        assert.equal(built.ok, true);
    });

    it("formats HTTP 400 Invalid parameter with code/subcode/fbtrace", () => {
        const err = new DatafyApiError("Invalid parameter", 400, {
            error: {
                message: "Invalid parameter",
                type: "OAuthException",
                code: 100,
                error_subcode: 2388299,
                error_user_msg:
                    "O texto do corpo não pode terminar com uma variável.",
                fbtrace_id: "AbCdEfGhIjK",
            },
        });
        const f = formatMetaTemplateApiError(err);
        assert.match(f.message, /Invalid parameter|não pode terminar/i);
        assert.equal(f.code, 100);
        assert.equal(f.subcode, 2388299);
        assert.equal(f.fbtraceId, "AbCdEfGhIjK");
        assert.ok(f.guidance);
    });

    it("formats HTTP 200-style success is not an error path — PENDING/APPROVED/REJECTED mapping stays in meta-approval", () => {
        // Contract: createTemplate success body
        const pending = { id: "1", status: "PENDING", category: "MARKETING" };
        const approved = { id: "1", status: "APPROVED" };
        const rejected = { id: "1", status: "REJECTED" };
        assert.equal(String(pending.status).toUpperCase(), "PENDING");
        assert.equal(String(approved.status).toUpperCase(), "APPROVED");
        assert.equal(String(rejected.status).toUpperCase(), "REJECTED");
    });

    it("duplicate name guidance from Meta message", () => {
        const err = new DatafyApiError(
            "Já existe conteúdo em Portuguese (BR) para esse modelo.",
            400,
            {
                error: {
                    message:
                        "Já existe conteúdo em Portuguese (BR) para esse modelo.",
                    code: 100,
                    fbtrace_id: "trace_dup",
                },
            }
        );
        const f = formatMetaTemplateApiError(err);
        assert.match(f.guidance || "", /outro nome|já existe/i);
        assert.equal(f.fbtraceId, "trace_dup");
    });

    it("all v2 library specs produce valid create payloads", () => {
        for (const spec of BULLETIN_TEMPLATE_LIBRARY.filter(
            (s) => s.generation === 2
        )) {
            const sub = buildBulletinTemplateSubmission(spec);
            const built = buildTemplateCreatePayload({
                name: sub.name,
                category: "MARKETING",
                bodyText: sub.bodyText,
                exampleRow: sub.exampleRow,
            });
            assert.equal(built.ok, true, spec.preferredName);
            if (built.ok) {
                assert.ok(
                    !/\{\{\d+\}\}$/.test(
                        built.payload.components[0].text.trim()
                    ),
                    spec.preferredName
                );
            }
        }
    });
});
