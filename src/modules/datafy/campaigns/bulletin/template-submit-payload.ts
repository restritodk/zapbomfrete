/**
 * Build / validate Meta template creation payloads for Datafy
 * POST /v1/{waba_id}/message_templates
 *
 * Meta rules enforced here:
 * - BODY must not start or end with a {{n}} placeholder
 * - example.body_text is [[...]] with one string per variable, in order
 * - examples non-empty; count must match variables
 */

import { countPositionalVars, sanitizeTemplateParam } from "./library";
import { META_TEMPLATE_BODY_MAX } from "./types";
import type { DatafyApiError } from "@/modules/datafy/client";

export type TemplateCreatePayload = {
    name: string;
    language: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    components: Array<{
        type: "BODY";
        text: string;
        example?: { body_text: string[][] };
    }>;
};

export type PayloadValidation = {
    ok: boolean;
    errors: string[];
    warnings: string[];
    bodyText: string;
    variableCount: number;
    exampleRow: string[];
    endsWithVariable: boolean;
    startsWithVariable: boolean;
};

const ENDS_WITH_VAR = /\{\{\d+\}\}\s*$/;
const STARTS_WITH_VAR = /^\s*\{\{\d+\}\}/;

/** Meta: body must not begin or end with a parameter placeholder. */
export function ensureBodyVariableBoundaries(bodyText: string): string {
    let text = (bodyText || "").replace(/\r\n/g, "\n").trimEnd();
    if (!text.trim()) return text;
    if (STARTS_WITH_VAR.test(text)) {
        text = `Atualizacao: ${text.trimStart()}`;
    }
    if (ENDS_WITH_VAR.test(text)) {
        // Trailing static text required by Meta (error_subcode ~2388299)
        text = `${text}.`;
    }
    return text;
}

export function validateTemplateBodyAndExamples(
    bodyText: string,
    exampleRow: string[]
): PayloadValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const fixed = ensureBodyVariableBoundaries(bodyText);
    const variableCount = countPositionalVars(fixed);
    const startsWithVariable = STARTS_WITH_VAR.test(fixed);
    const endsWithVariable = ENDS_WITH_VAR.test(fixed);

    if (!fixed.trim()) {
        errors.push("BODY vazio.");
    }
    if (fixed.length > META_TEMPLATE_BODY_MAX) {
        errors.push(
            `BODY com ${fixed.length} caracteres excede o limite Meta de ${META_TEMPLATE_BODY_MAX}.`
        );
    }
    if (startsWithVariable) {
        errors.push(
            "O BODY não pode começar com variável {{n}} (regra Meta)."
        );
    }
    if (endsWithVariable) {
        errors.push(
            "O BODY não pode terminar com variável {{n}} (regra Meta). Adicione texto estático após a última variável."
        );
    }

    const cleaned = exampleRow.map((v) => sanitizeTemplateParam(v));
    if (variableCount > 0 && cleaned.length !== variableCount) {
        errors.push(
            `Exemplos (${cleaned.length}) ≠ variáveis (${variableCount}).`
        );
    }
    if (cleaned.some((v) => !v.trim())) {
        errors.push("Exemplos não podem ser vazios.");
    }
    if (fixed !== (bodyText || "").replace(/\r\n/g, "\n").trimEnd()) {
        warnings.push(
            "BODY ajustado automaticamente para não começar/terminar com variável."
        );
    }

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        bodyText: fixed,
        variableCount,
        exampleRow: cleaned,
        endsWithVariable,
        startsWithVariable,
    };
}

export function buildTemplateCreatePayload(opts: {
    name: string;
    language?: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    bodyText: string;
    exampleRow: string[];
}): { ok: true; payload: TemplateCreatePayload; warnings: string[] } | {
    ok: false;
    errors: string[];
    warnings: string[];
} {
    const validation = validateTemplateBodyAndExamples(
        opts.bodyText,
        opts.exampleRow
    );
    if (!validation.ok) {
        return {
            ok: false,
            errors: validation.errors,
            warnings: validation.warnings,
        };
    }

    const components: TemplateCreatePayload["components"] = [
        {
            type: "BODY",
            text: validation.bodyText,
            ...(validation.variableCount > 0
                ? {
                      example: {
                          body_text: [validation.exampleRow],
                      },
                  }
                : {}),
        },
    ];

    // Omit parameter_format — POSITIONAL is Meta/Datafy default; sending it
    // is optional and some mirrors reject unknown fields.
    return {
        ok: true,
        warnings: validation.warnings,
        payload: {
            name: opts.name,
            language: opts.language || "pt_BR",
            category: opts.category,
            components,
        },
    };
}

export type FormattedMetaApiError = {
    message: string;
    code: number | null;
    subcode: number | null;
    fbtraceId: string | null;
    userTitle: string | null;
    userMsg: string | null;
    guidance: string | null;
};

/** Extract Meta/Datafy error details without leaking tokens. */
export function formatMetaTemplateApiError(
    err: DatafyApiError | Error | unknown
): FormattedMetaApiError {
    const api = err as DatafyApiError;
    const body = api?.body || null;
    const nested = (body?.error || null) as {
        message?: string;
        code?: number;
        error_subcode?: number;
        fbtrace_id?: string;
        error_user_title?: string;
        error_user_msg?: string;
    } | null;
    const errCode = typeof nested?.code === "number" ? nested.code : null;
    const subcode =
        typeof nested?.error_subcode === "number" ? nested.error_subcode : null;
    const fbtraceId =
        typeof nested?.fbtrace_id === "string" ? nested.fbtrace_id : null;
    const userTitle =
        typeof nested?.error_user_title === "string"
            ? nested.error_user_title
            : null;
    const userMsg =
        typeof nested?.error_user_msg === "string"
            ? nested.error_user_msg
            : null;
    const rawMessage =
        userMsg ||
        nested?.message ||
        body?.message ||
        (err instanceof Error ? err.message : "Erro na API Datafy/Meta");

    let guidance: string | null = null;
    if (
        subcode === 2388299 ||
        /end with a parameter|begin with a parameter|começar|terminar com variável/i.test(
            rawMessage
        )
    ) {
        guidance =
            "O texto do BODY não pode começar nem terminar com {{n}}. Inclua texto fixo antes/depois da variável.";
    } else if (subcode === 2388043 || /invalid parameter/i.test(rawMessage)) {
        guidance =
            "Verifique BODY, example.body_text (uma string por variável), nome técnico (a-z0-9_) e se o nome+idioma já existe.";
    } else if (/already exists|já existe/i.test(rawMessage)) {
        guidance =
            "Já existe conteúdo para este nome/idioma. Use outro nome técnico ou edite o template existente.";
    } else if (/example|INVALID_FORMAT/i.test(rawMessage)) {
        guidance =
            "Informe example.body_text com exatamente uma amostra por variável, na ordem {{1}}…{{n}}.";
    }

    const parts = [
        rawMessage,
        errCode != null ? `código ${errCode}` : null,
        subcode != null ? `subcódigo ${subcode}` : null,
        fbtraceId ? `fbtrace_id ${fbtraceId}` : null,
    ].filter(Boolean);

    return {
        message: parts.join(" · "),
        code: errCode,
        subcode,
        fbtraceId,
        userTitle,
        userMsg,
        guidance,
    };
}
