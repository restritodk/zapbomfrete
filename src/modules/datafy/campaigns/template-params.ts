/**
 * Template BODY parameter contract — prevent Meta error 132000.
 * (#132000) Number of parameters does not match the expected number of params
 */

import { countBodyVariablesFromTemplateComponents } from "./variables";

export const META_TEMPLATE_PARAM_MISMATCH_CODE = 132000;

export function countNumberedPlaceholdersInText(body: string): number {
    const found = new Set<number>();
    const re = /\{\{(\d+)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(body || "")))) {
        found.add(Number(m[1]));
    }
    return found.size;
}

/** Prefer numbered placeholders; fall back to component scan (named or numbered). */
export function expectedBodyParamCount(opts: {
    bodyText?: string | null;
    templateComponents?: unknown;
}): number {
    const fromText = countNumberedPlaceholdersInText(opts.bodyText || "");
    if (fromText > 0) return fromText;
    return countBodyVariablesFromTemplateComponents(opts.templateComponents);
}

export function providedBodyParamCount(
    mapping: { body?: unknown[] | null } | null | undefined
): number {
    if (!mapping || !Array.isArray(mapping.body)) return 0;
    return mapping.body.length;
}

export type TemplateParamCheck = {
    ok: boolean;
    expected: number;
    provided: number;
    templateName: string | null;
    language: string | null;
    code: typeof META_TEMPLATE_PARAM_MISMATCH_CODE | null;
    message: string | null;
};

export function validateTemplateBodyParamCount(opts: {
    templateName?: string | null;
    language?: string | null;
    bodyText?: string | null;
    templateComponents?: unknown;
    variableMapping?: { body?: unknown[] | null } | null;
}): TemplateParamCheck {
    const expected = expectedBodyParamCount({
        bodyText: opts.bodyText,
        templateComponents: opts.templateComponents,
    });
    const provided = providedBodyParamCount(opts.variableMapping);
    const name = opts.templateName || null;
    if (expected === 0) {
        // Static BODY — must not send body parameters
        if (provided === 0) {
            return {
                ok: true,
                expected: 0,
                provided: 0,
                templateName: name,
                language: opts.language || null,
                code: null,
                message: null,
            };
        }
        return {
            ok: false,
            expected: 0,
            provided,
            templateName: name,
            language: opts.language || null,
            code: META_TEMPLATE_PARAM_MISMATCH_CODE,
            message: `O template ${name || "selecionado"} não exige parâmetros no BODY, mas o payload enviaria ${provided}. Remova o mapeamento de variáveis.`,
        };
    }
    if (provided === expected) {
        return {
            ok: true,
            expected,
            provided,
            templateName: name,
            language: opts.language || null,
            code: null,
            message: null,
        };
    }
    return {
        ok: false,
        expected,
        provided,
        templateName: name,
        language: opts.language || null,
        code: META_TEMPLATE_PARAM_MISMATCH_CODE,
        message: `O template ${name || "selecionado"} exige ${expected} parâmetro(s) no BODY, mas o payload tem ${provided}. Verifique os campos obrigatórios antes de iniciar o envio. (Meta #132000)`,
    };
}

/** User-facing explanation for Meta/Datafy 132000 (and preventive blocks). */
export function formatMeta132000Message(opts: {
    templateName?: string | null;
    language?: string | null;
    expected?: number | null;
    provided?: number | null;
    apiMessage?: string | null;
}): string {
    const base =
        "O template selecionado exige uma quantidade específica de parâmetros. Verifique os campos obrigatórios antes de iniciar o envio.";
    const bits = [
        base,
        opts.templateName ? `Template: ${opts.templateName}` : null,
        opts.language ? `Idioma: ${opts.language}` : null,
        opts.expected != null && opts.provided != null
            ? `Esperados: ${opts.expected} · Enviados: ${opts.provided}`
            : null,
        opts.apiMessage && /132000/.test(opts.apiMessage)
            ? null
            : opts.apiMessage
              ? opts.apiMessage.slice(0, 160)
              : null,
    ].filter(Boolean);
    return bits.join(" ");
}

export function extractMetaErrorCode(
    body: unknown
): number | null {
    if (!body || typeof body !== "object") return null;
    const err = (body as { error?: { code?: number } }).error;
    if (typeof err?.code === "number") return err.code;
    const top = (body as { code?: number }).code;
    return typeof top === "number" ? top : null;
}

export function isMeta132000Error(opts: {
    message?: string | null;
    errorCode?: number | null;
    body?: unknown;
}): boolean {
    if (opts.errorCode === META_TEMPLATE_PARAM_MISMATCH_CODE) return true;
    if (extractMetaErrorCode(opts.body) === META_TEMPLATE_PARAM_MISMATCH_CODE)
        return true;
    return /#?\(?132000\)?|Number of parameters does not match/i.test(
        String(opts.message || "")
    );
}

/**
 * Fallback APPROVED templates for Envio Direto must be 0-param (static)
 * or have a mapping that exactly matches expected BODY params.
 * Never silently attach a multi-var boletim template to pasted freeform.
 *
 * If BODY/components are unknown, refuse — safer than guessing 0 params.
 */
export function canUseTemplateAsFreeformFallback(opts: {
    templateName?: string | null;
    bodyText?: string | null;
    templateComponents?: unknown;
    variableMapping?: { body?: unknown[] | null } | null;
}): boolean {
    const hasStructure =
        Boolean(opts.bodyText && String(opts.bodyText).trim()) ||
        (Array.isArray(opts.templateComponents) &&
            opts.templateComponents.length > 0);
    if (!hasStructure) {
        // Name heuristics: boletim / cargas templates almost always need params
        const n = String(opts.templateName || "").toLowerCase();
        if (/boletim|embarque|carga|frete/.test(n)) return false;
        return false;
    }
    const check = validateTemplateBodyParamCount({
        templateName: opts.templateName,
        bodyText: opts.bodyText,
        templateComponents: opts.templateComponents,
        variableMapping: opts.variableMapping || { body: [] },
    });
    return check.ok;
}
