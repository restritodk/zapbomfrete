import type { VARIABLE_TOKENS } from "./constants";

type ContactFields = {
    fullName?: string | null;
    company?: string | null;
    city?: string | null;
    state?: string | null;
    waId?: string | null;
    category?: string | null;
};

type Mapping = {
    body?: string[];
    header?: string[];
};

/**
 * Build Meta/Datafy template components from CRM field tokens.
 * Tokens like "{{fullName}}" or "fullName" are resolved per contact.
 * Literal strings (not matching known tokens) are sent as-is.
 */
export function buildTemplateComponents(
    mapping: Mapping | null | undefined,
    contact: ContactFields,
    opts?: {
        headerImageUrl?: string | null;
        headerImageMediaId?: string | null;
    }
): unknown[] {
    const components: unknown[] = [];

    const resolve = (token: string) => {
        const key = token.replace(/^\{\{|\}\}$/g, "").trim();
        const map: Record<string, string> = {
            fullName: contact.fullName || "Cliente",
            company: contact.company || "",
            city: contact.city || "",
            state: contact.state || "",
            waId: contact.waId || "",
            category: contact.category || "",
        };
        if (key in map) return map[key];
        return token;
    };

    if (opts?.headerImageMediaId || opts?.headerImageUrl) {
        components.push({
            type: "header",
            parameters: [
                {
                    type: "image",
                    image: opts.headerImageMediaId
                        ? { id: opts.headerImageMediaId }
                        : { link: opts.headerImageUrl },
                },
            ],
        });
    } else if (mapping?.header?.length) {
        components.push({
            type: "header",
            parameters: mapping.header.map((t) => ({
                type: "text",
                text: resolve(t),
            })),
        });
    }
    if (mapping?.body?.length) {
        components.push({
            type: "body",
            parameters: mapping.body.map((t) => ({
                type: "text",
                text: resolve(t),
            })),
        });
    }
    return components;
}

/** Convert CRM tokens in free text to positional {{1}} {{2}} for Meta templates. */
export function prepareTemplateBodyFromCopy(raw: string): {
    bodyText: string;
    bodyTokens: string[];
    exampleRow: string[];
} {
    const tokenOrder: string[] = [];
    const bodyText = raw.replace(
        /\{\{(fullName|company|city|state|waId|category)\}\}/gi,
        (_m, key: string) => {
            const normalized = key;
            let idx = tokenOrder.indexOf(normalized);
            if (idx === -1) {
                tokenOrder.push(normalized);
                idx = tokenOrder.length - 1;
            }
            return `{{${idx + 1}}}`;
        }
    );
    const examples: Record<string, string> = {
        fullName: "Maria",
        company: "Transportadora Exemplo",
        city: "Curitiba",
        state: "PR",
        waId: "5541999999999",
        category: "Motorista",
    };
    return {
        bodyText,
        bodyTokens: tokenOrder,
        exampleRow: tokenOrder.map((t) => examples[t] || "Exemplo"),
    };
}

export function countBodyVariablesFromTemplateComponents(
    components: unknown
): number {
    if (!Array.isArray(components)) return 0;
    for (const c of components) {
        const comp = c as { type?: string; text?: string };
        if (String(comp.type || "").toUpperCase() === "BODY" && comp.text) {
            const matches = comp.text.match(/\{\{\d+\}\}|\{\{[a-zA-Z_]+\}\}/g);
            return matches?.length || 0;
        }
    }
    return 0;
}

export type VariableToken = (typeof VARIABLE_TOKENS)[number];
