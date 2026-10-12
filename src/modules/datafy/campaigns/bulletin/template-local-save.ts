/**
 * Local library save contract for Novo/Editar template.
 * Does not submit to Meta / Datafy approval.
 */

import { z } from "zod";
import { CONSENT_BUTTON_IDS } from "@/modules/crm/consent/constants";
import {
    META_BODY_MAX,
    META_NAME_RE,
    countTemplateBodyChars,
    validateTemplateDraft,
    type TemplateDraftInput,
} from "./template-validation";
import type {
    EditorStepId,
    TemplateEditorDraft,
} from "./template-editor-helpers";

export { countTemplateBodyChars };

export const localTemplateButtonsSchema = z
    .object({
        enabled: z.boolean(),
        purpose: z.string().optional(),
        buttons: z
            .array(
                z.object({
                    type: z.string().optional(),
                    text: z.string().max(25),
                    payload: z.string().max(64).optional(),
                })
            )
            .max(3)
            .optional(),
    })
    .optional()
    .nullable();

/** Zod contract for POST action=create (local library only). */
export const localTemplateCreateSchema = z.object({
    action: z.literal("create"),
    technicalName: z
        .string()
        .trim()
        .min(3, "Informe o nome técnico do template.")
        .max(64, "Nome técnico deve ter no máximo 64 caracteres."),
    displayName: z
        .string()
        .trim()
        .min(1, "Informe o nome de exibição.")
        .max(120, "Nome de exibição deve ter no máximo 120 caracteres."),
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"], {
        error: "Categoria inválida.",
    }),
    headerText: z.string().max(120).optional().nullable(),
    bodyText: z
        .string()
        .min(1, "Informe o corpo da mensagem.")
        .max(2000, "O corpo excede o limite permitido."),
    footerText: z.string().max(120).optional().nullable(),
    buttons: localTemplateButtonsSchema,
    fieldMappings: z.array(z.string()).max(60),
    exampleRow: z.array(z.string()).max(60),
    loadsPerMessage: z
        .union([z.literal(1), z.literal(2), z.literal(3)])
        .optional(),
    description: z.string().max(500).optional().nullable(),
});

export type LocalTemplateCreateBody = z.infer<typeof localTemplateCreateSchema>;

export type TemplateFieldErrors = Partial<
    Record<
        | "technicalName"
        | "displayName"
        | "category"
        | "bodyText"
        | "headerText"
        | "footerText"
        | "fieldMappings"
        | "exampleRow"
        | "buttons"
        | "loadsPerMessage"
        | "description"
        | "_form",
        string
    >
>;

const FIELD_STEP: Record<keyof TemplateFieldErrors, EditorStepId> = {
    technicalName: "info",
    displayName: "info",
    category: "info",
    loadsPerMessage: "info",
    description: "info",
    bodyText: "content",
    headerText: "content",
    footerText: "content",
    fieldMappings: "vars",
    exampleRow: "vars",
    buttons: "vars",
    _form: "review",
};

export function sanitizeTechnicalNameInput(raw: string): string {
    return String(raw || "")
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "")
        .slice(0, 64);
}

export type EditorButtonsDraft = TemplateEditorDraft["buttons"];

/** Serialize UI button draft into the API / Prisma buttonsJson shape. */
export function buttonsDraftToPayload(d: EditorButtonsDraft) {
    if (!d.enabled) {
        return { enabled: false, purpose: "consent_offers" as const, buttons: [] };
    }
    return {
        enabled: true,
        purpose: "consent_offers" as const,
        buttons: [
            {
                type: "QUICK_REPLY" as const,
                text: d.grantText.trim() || "Sim, quero ofertas",
                payload: CONSENT_BUTTON_IDS.GRANT,
            },
            {
                type: "QUICK_REPLY" as const,
                text: d.denyText.trim() || "Não quero receber",
                payload: CONSENT_BUTTON_IDS.DENY,
            },
        ],
    };
}

/**
 * Build the exact JSON body sent to POST /bulletin-templates (action=create).
 * Strips UI-only keys; never sends undefined.
 */
export function buildLocalTemplateCreatePayload(
    draft: TemplateEditorDraft
): LocalTemplateCreateBody {
    return {
        action: "create",
        technicalName: sanitizeTechnicalNameInput(draft.technicalName),
        displayName: String(draft.displayName || "").trim(),
        category: draft.category,
        headerText: draft.headerText.trim() ? draft.headerText : null,
        bodyText: String(draft.bodyText || "").replace(/\r\n/g, "\n"),
        footerText: draft.footerText.trim() ? draft.footerText : null,
        buttons: buttonsDraftToPayload(draft.buttons),
        fieldMappings: [...draft.fieldMappings],
        exampleRow: [...draft.exampleRow],
        loadsPerMessage: draft.loadsPerMessage,
        description: draft.description.trim() ? draft.description.trim() : null,
    };
}

export function buildLocalTemplatePatchPayload(draft: TemplateEditorDraft) {
    const created = buildLocalTemplateCreatePayload(draft);
    const { action: _a, ...rest } = created;
    return rest;
}

export function formatLocalTemplateZodError(error: z.ZodError): {
    message: string;
    fieldErrors: TemplateFieldErrors;
    firstStep: EditorStepId;
} {
    const fieldErrors: TemplateFieldErrors = {};
    for (const issue of error.issues) {
        const key = String(issue.path[0] || "_form") as keyof TemplateFieldErrors;
        if (!fieldErrors[key]) {
            fieldErrors[key] = mapZodIssueMessage(key, issue.message);
        }
    }
    const ordered = Object.keys(fieldErrors) as Array<keyof TemplateFieldErrors>;
    const firstKey = ordered[0] || "_form";
    const message =
        fieldErrors[firstKey] ||
        "Não foi possível salvar. Verifique os campos e tente novamente.";
    return {
        message,
        fieldErrors,
        firstStep: FIELD_STEP[firstKey] || "review",
    };
}

function mapZodIssueMessage(
    key: keyof TemplateFieldErrors,
    raw: string
): string {
    if (key === "technicalName") {
        if (/too small|min/i.test(raw) || /Informe o nome técnico/i.test(raw)) {
            return "Informe o nome técnico do template.";
        }
        return raw;
    }
    if (key === "displayName") {
        if (/too small|min|Informe/i.test(raw)) {
            return "Informe o nome de exibição.";
        }
        return raw;
    }
    if (key === "bodyText") {
        if (/too big|max|excede/i.test(raw)) {
            return "O corpo excede o limite permitido.";
        }
        if (/too small|min|Informe/i.test(raw)) {
            return "Informe o corpo da mensagem.";
        }
        return raw;
    }
    if (key === "buttons") {
        return "A configuração dos botões está incompleta.";
    }
    if (key === "fieldMappings") {
        return "Revise o mapeamento das variáveis.";
    }
    return raw || "Payload inválido";
}

export function clientValidateTemplateDraft(draft: TemplateEditorDraft): {
    ok: boolean;
    messages: string[];
    fieldErrors: TemplateFieldErrors;
    firstStep: EditorStepId;
    payload: LocalTemplateCreateBody;
} {
    const payload = buildLocalTemplateCreatePayload(draft);
    const fieldErrors: TemplateFieldErrors = {};
    const messages: string[] = [];

    if (!payload.technicalName || payload.technicalName.length < 3) {
        fieldErrors.technicalName = "Informe o nome técnico do template.";
    } else if (!META_NAME_RE.test(payload.technicalName)) {
        fieldErrors.technicalName =
            "Nome técnico inválido: use minúsculas, números e _, começando com letra (3–64).";
    }

    if (!payload.displayName) {
        fieldErrors.displayName = "Informe o nome de exibição.";
    }

    if (!payload.bodyText.trim()) {
        fieldErrors.bodyText = "Informe o corpo da mensagem.";
    } else if (countTemplateBodyChars(payload.bodyText) > META_BODY_MAX) {
        fieldErrors.bodyText = `O corpo excede o limite permitido (${META_BODY_MAX} caracteres).`;
    }

    if (payload.buttons?.enabled) {
        const btns = payload.buttons.buttons || [];
        if (btns.length < 2) {
            fieldErrors.buttons = "A configuração dos botões está incompleta.";
        } else {
            for (const b of btns) {
                if (!b.text?.trim() || b.text.length > 25) {
                    fieldErrors.buttons =
                        "A configuração dos botões está incompleta.";
                    break;
                }
            }
        }
    }

    const zod = localTemplateCreateSchema.safeParse(payload);
    if (!zod.success) {
        const formatted = formatLocalTemplateZodError(zod.error);
        Object.assign(fieldErrors, formatted.fieldErrors);
    }

    // Domain rules (vars / mappings) — same as createCustomTemplate
    if (Object.keys(fieldErrors).length === 0) {
        const domain = validateTemplateDraft(payload as TemplateDraftInput);
        if (!domain.ok) {
            for (const err of domain.errors) {
                messages.push(err);
                if (/nome técnico/i.test(err)) {
                    fieldErrors.technicalName = err;
                } else if (/exibição/i.test(err)) {
                    fieldErrors.displayName = err;
                } else if (/corpo|caracteres/i.test(err)) {
                    fieldErrors.bodyText = err;
                } else if (/mapeamento|variáv/i.test(err)) {
                    fieldErrors.fieldMappings = err;
                } else if (/botão/i.test(err)) {
                    fieldErrors.buttons = err;
                } else {
                    fieldErrors._form = err;
                }
            }
        }
    }

    for (const v of Object.values(fieldErrors)) {
        if (v && !messages.includes(v)) messages.push(v);
    }

    const ordered = (
        Object.keys(fieldErrors) as Array<keyof TemplateFieldErrors>
    ).sort((a, b) => {
        const order: EditorStepId[] = ["info", "content", "vars", "review"];
        return (
            order.indexOf(FIELD_STEP[a]) - order.indexOf(FIELD_STEP[b])
        );
    });
    const firstKey = ordered[0] || "_form";

    return {
        ok: messages.length === 0,
        messages,
        fieldErrors,
        firstStep: FIELD_STEP[firstKey] || "review",
        payload,
    };
}

/** Map API 400 details.flatten() into field errors for the modal. */
export function fieldErrorsFromApiDetails(details: unknown): TemplateFieldErrors {
    if (!details || typeof details !== "object") return {};
    const fe = (details as { fieldErrors?: Record<string, string[]> })
        .fieldErrors;
    if (!fe || typeof fe !== "object") return {};
    const out: TemplateFieldErrors = {};
    for (const [k, msgs] of Object.entries(fe)) {
        if (Array.isArray(msgs) && msgs[0]) {
            out[k as keyof TemplateFieldErrors] = mapZodIssueMessage(
                k as keyof TemplateFieldErrors,
                msgs[0]
            );
        }
    }
    return out;
}

export function firstStepFromFieldErrors(
    fieldErrors: TemplateFieldErrors
): EditorStepId {
    const ordered = (
        Object.keys(fieldErrors) as Array<keyof TemplateFieldErrors>
    ).sort((a, b) => {
        const order: EditorStepId[] = ["info", "content", "vars", "review"];
        return (
            order.indexOf(FIELD_STEP[a]) - order.indexOf(FIELD_STEP[b])
        );
    });
    return FIELD_STEP[ordered[0] || "_form"] || "review";
}
