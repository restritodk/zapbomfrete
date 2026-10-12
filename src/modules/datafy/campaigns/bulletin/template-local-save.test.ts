import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONSENT_BUTTON_IDS } from "@/modules/crm/consent/constants";
import {
    nextEditorStep,
    prevEditorStep,
    type TemplateEditorDraft,
} from "./template-editor-helpers";
import {
    buildLocalTemplateCreatePayload,
    buttonsDraftToPayload,
    clientValidateTemplateDraft,
    countTemplateBodyChars,
    formatLocalTemplateZodError,
    localTemplateCreateSchema,
    sanitizeTechnicalNameInput,
} from "./template-local-save";
import { META_BODY_MAX, validateTemplateDraft } from "./template-validation";

function draft(
    overrides: Partial<TemplateEditorDraft> = {}
): TemplateEditorDraft {
    return {
        technicalName: "boletim_frete_1",
        displayName: "Boletim frete 1",
        category: "MARKETING",
        headerText: "",
        bodyText: "Origem: {{1}}\nDestino: {{2}}\nFrete: {{3}}",
        footerText: "",
        buttons: {
            enabled: true,
            grantText: "Sim, quero ofertas",
            denyText: "Não quero receber",
        },
        fieldMappings: ["origem", "destino", "frete"],
        exampleRow: ["Lucas/MT", "Rodo/MT", "R$ 280/t"],
        loadsPerMessage: 1,
        description: "Teste local",
        ...overrides,
    };
}

describe("template-local-save — quatro etapas e nome técnico", () => {
    it("persiste technicalName ao montar o payload (etapa 1 → 4)", () => {
        let state = draft({ technicalName: "" });
        state = {
            ...state,
            technicalName: sanitizeTechnicalNameInput("boletim_frete_1"),
        };
        assert.equal(state.technicalName, "boletim_frete_1");

        // Navegação de etapas não altera o draft
        let step = "info" as const;
        step = nextEditorStep(step);
        step = nextEditorStep(step);
        step = nextEditorStep(step);
        assert.equal(step, "review");
        assert.equal(prevEditorStep(step), "vars");

        const payload = buildLocalTemplateCreatePayload(state);
        assert.equal(payload.technicalName, "boletim_frete_1");
        assert.equal(payload.action, "create");
        assert.notEqual(payload.technicalName, "");
    });

    it("rejeita salvar sem nome técnico com mensagem clara", () => {
        const result = clientValidateTemplateDraft(
            draft({ technicalName: "" })
        );
        assert.equal(result.ok, false);
        assert.equal(
            result.fieldErrors.technicalName,
            "Informe o nome técnico do template."
        );
        assert.equal(result.firstStep, "info");
    });

    it("placeholder sanitization não inventa nome técnico", () => {
        assert.equal(sanitizeTechnicalNameInput(""), "");
        assert.equal(
            sanitizeTechnicalNameInput("Boletim Frete 1!"),
            "boletimfrete1"
        );
    });
});

describe("template-local-save — categorias e corpo", () => {
    it("aceita categoria UTILITY", () => {
        const payload = buildLocalTemplateCreatePayload(
            draft({ category: "UTILITY" })
        );
        const parsed = localTemplateCreateSchema.safeParse(payload);
        assert.equal(parsed.success, true);
        assert.equal(payload.category, "UTILITY");
    });

    it("aceita categoria MARKETING", () => {
        const payload = buildLocalTemplateCreatePayload(
            draft({ category: "MARKETING" })
        );
        assert.equal(
            localTemplateCreateSchema.safeParse(payload).success,
            true
        );
    });

    it("corpo próximo ao limite (1020) passa", () => {
        const pad = "A".repeat(1000);
        const body = `${pad} {{1}} fim.`; // ~1000 + vars
        assert.ok(countTemplateBodyChars(body) <= META_BODY_MAX);
        const result = clientValidateTemplateDraft(
            draft({
                bodyText: body,
                fieldMappings: ["origem"],
                exampleRow: ["X"],
            })
        );
        assert.equal(result.ok, true, result.messages.join("; "));
    });

    it("conta emojis por code point (não UTF-16)", () => {
        const withEmoji = "🚛".repeat(10) + " texto";
        assert.equal(countTemplateBodyChars(withEmoji), 10 + 6);
        assert.ok(withEmoji.length > countTemplateBodyChars(withEmoji));
    });

    it("corpo acima de 1024 falha com mensagem útil", () => {
        const body = "X".repeat(META_BODY_MAX + 5);
        const result = clientValidateTemplateDraft(
            draft({
                bodyText: body,
                fieldMappings: [],
                exampleRow: [],
            })
        );
        assert.equal(result.ok, false);
        assert.match(
            result.fieldErrors.bodyText || "",
            /excede o limite permitido/i
        );
    });
});

describe("template-local-save — variáveis e botões", () => {
    it("template sem variáveis é válido na biblioteca local", () => {
        const result = clientValidateTemplateDraft(
            draft({
                bodyText: "Mensagem estática sem parâmetros. Obrigado.",
                fieldMappings: [],
                exampleRow: [],
                buttons: {
                    enabled: false,
                    grantText: "Sim, quero ofertas",
                    denyText: "Não quero receber",
                },
            })
        );
        assert.equal(result.ok, true, result.messages.join("; "));
        assert.deepEqual(result.payload.fieldMappings, []);
    });

    it("template com variáveis exige mapeamentos alinhados", () => {
        const result = clientValidateTemplateDraft(
            draft({
                bodyText: "A {{1}} B {{2}}",
                fieldMappings: ["origem", "destino"],
                exampleRow: ["a", "b"],
            })
        );
        assert.equal(result.ok, true, result.messages.join("; "));
        assert.equal(result.payload.fieldMappings.length, 2);
    });

    it("serializa QUICK_REPLY com payloads canônicos de consentimento", () => {
        const buttons = buttonsDraftToPayload({
            enabled: true,
            grantText: "Sim, quero ofertas",
            denyText: "Não quero receber",
        });
        assert.equal(buttons.enabled, true);
        assert.equal(buttons.buttons[0]?.type, "QUICK_REPLY");
        assert.equal(buttons.buttons[0]?.payload, CONSENT_BUTTON_IDS.GRANT);
        assert.equal(buttons.buttons[1]?.payload, CONSENT_BUTTON_IDS.DENY);
        assert.ok((buttons.buttons[0]?.text || "").length <= 25);
        assert.ok((buttons.buttons[1]?.text || "").length <= 25);
    });

    it("erro de validação Zod vira mensagem em português", () => {
        const parsed = localTemplateCreateSchema.safeParse({
            action: "create",
            technicalName: "",
            displayName: "X",
            category: "MARKETING",
            bodyText: "oi",
            fieldMappings: [],
            exampleRow: [],
        });
        assert.equal(parsed.success, false);
        if (parsed.success) return;
        const formatted = formatLocalTemplateZodError(parsed.error);
        assert.equal(
            formatted.message,
            "Informe o nome técnico do template."
        );
        assert.equal(formatted.firstStep, "info");
        assert.notEqual(formatted.message, "Payload inválido");
    });

    it("salvamento bem-sucedido: schema + domain ok", () => {
        const payload = buildLocalTemplateCreatePayload(draft());
        const zod = localTemplateCreateSchema.safeParse(payload);
        assert.equal(zod.success, true);
        const domain = validateTemplateDraft(payload);
        assert.equal(domain.ok, true, domain.errors.join("; "));
    });

    it("preserva dados do draft após falha de validação", () => {
        const original = draft({
            technicalName: "",
            displayName: "Meu boletim",
            bodyText: "Corpo {{1}} ok.",
            fieldMappings: ["origem"],
            exampleRow: ["A"],
            buttons: {
                enabled: true,
                grantText: "Sim, quero ofertas",
                denyText: "Não quero receber",
            },
            category: "UTILITY",
        });
        const snapshot = structuredClone(original);
        const result = clientValidateTemplateDraft(original);
        assert.equal(result.ok, false);
        // Draft de entrada não é mutado
        assert.deepEqual(original, snapshot);
        assert.equal(original.displayName, "Meu boletim");
        assert.equal(original.category, "UTILITY");
        assert.equal(original.buttons.grantText, "Sim, quero ofertas");
        assert.equal(original.bodyText, "Corpo {{1}} ok.");
    });

    it("isolamento: payload não inclui organizationId alienígena", () => {
        const payload = buildLocalTemplateCreatePayload(draft()) as Record<
            string,
            unknown
        >;
        assert.equal("organizationId" in payload, false);
        assert.equal("organizationKey" in payload, false);
        assert.equal(payload.action, "create");
        assert.equal(typeof payload.technicalName, "string");
    });
});
