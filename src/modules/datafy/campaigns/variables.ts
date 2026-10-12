import type { VARIABLE_TOKENS } from "./constants";

/** Recipient-side fields (who receives the message). */
export type RecipientVariableFields = {
    fullName?: string | null;
    /** WhatsApp profile name from conversation/webhook when CRM name missing */
    waProfileName?: string | null;
    waId?: string | null;
    category?: string | null;
    /** @deprecated Do not use for {{company}}/{{city}}/{{state}} — sender profile only */
    company?: string | null;
    city?: string | null;
    state?: string | null;
};

/** Sender-side fields (Bom Frete / business that sends). */
export type SenderVariableFields = {
    company?: string | null;
    city?: string | null;
    state?: string | null;
};

export type CampaignVariableContext = {
    recipient: RecipientVariableFields;
    sender: SenderVariableFields;
};

type Mapping = {
    body?: string[];
    header?: string[];
};

/** Resolve display name for {{fullName}} without inventing fake names. */
export function resolveRecipientDisplayName(
    recipient: RecipientVariableFields
): string {
    const crm = String(recipient.fullName || "").trim();
    if (crm) return crm;
    const wa = String(recipient.waProfileName || "").trim();
    if (wa && !/^usu[aá]rio\s+desconhecido$/i.test(wa)) return wa;
    return "";
}

export function buildVariableValueMap(
    ctx: CampaignVariableContext
): Record<string, string> {
    return {
        fullName: resolveRecipientDisplayName(ctx.recipient),
        company: String(ctx.sender.company || "").trim(),
        city: String(ctx.sender.city || "").trim(),
        state: String(ctx.sender.state || "").trim(),
        waId: String(ctx.recipient.waId || "").trim(),
        category: String(ctx.recipient.category || "").trim(),
    };
}

/**
 * Build Meta/Datafy template components from CRM field tokens.
 * {{fullName}} → recipient; {{company}}/{{city}}/{{state}} → sender profile.
 */
export function buildTemplateComponents(
    mapping: Mapping | null | undefined,
    contactOrCtx: RecipientVariableFields | CampaignVariableContext,
    opts?: {
        headerImageUrl?: string | null;
        headerImageMediaId?: string | null;
        sender?: SenderVariableFields;
    }
): unknown[] {
    const ctx: CampaignVariableContext =
        "recipient" in contactOrCtx && "sender" in contactOrCtx
            ? contactOrCtx
            : {
                  recipient: contactOrCtx,
                  sender: opts?.sender || {
                      company: contactOrCtx.company,
                      city: contactOrCtx.city,
                      state: contactOrCtx.state,
                  },
              };

    const map = buildVariableValueMap(ctx);
    const components: unknown[] = [];

    const resolve = (token: string) => {
        const key = token.replace(/^\{\{|\}\}$/g, "").trim();
        if (key in map) {
            const v = map[key];
            // Meta body params cannot be empty strings — use space-safe fallback
            if (key === "fullName") return v || "Cliente";
            return v || "—";
        }
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

/**
 * Substitui tokens no texto livre. Preserva emojis e UTF-8.
 * Ausentes → string vazia (não inventa dados).
 */
export function renderCampaignFreeform(
    raw: string,
    contactOrCtx: RecipientVariableFields | CampaignVariableContext,
    sender?: SenderVariableFields
): string {
    const ctx: CampaignVariableContext =
        contactOrCtx &&
        typeof contactOrCtx === "object" &&
        "recipient" in contactOrCtx &&
        "sender" in contactOrCtx
            ? contactOrCtx
            : {
                  recipient: contactOrCtx as RecipientVariableFields,
                  sender: sender || {
                      company: (contactOrCtx as RecipientVariableFields)
                          .company,
                      city: (contactOrCtx as RecipientVariableFields).city,
                      state: (contactOrCtx as RecipientVariableFields).state,
                  },
              };

    const map = buildVariableValueMap(ctx);
    return String(raw || "").replace(
        /\{\{(fullName|company|city|state|waId|category)\}\}/gi,
        (_m, key: string) => {
            const found = Object.keys(map).find(
                (x) => x.toLowerCase() === String(key).toLowerCase()
            );
            return found ? map[found] : "";
        }
    );
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
        fullName: "Paulo",
        company: "Bom Frete Transportes",
        city: "Rondonópolis",
        state: "MT",
        waId: "5566999999999",
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

/** Preview helper with explicit sample recipient + real sender profile. */
export function renderCampaignPreview(
    raw: string,
    opts: {
        sampleRecipient?: RecipientVariableFields;
        sender: SenderVariableFields;
    }
): string {
    return renderCampaignFreeform(raw, {
        recipient: opts.sampleRecipient || {
            fullName: "Paulo",
            waId: "5566999999999",
        },
        sender: opts.sender,
    });
}

export type VariableToken = (typeof VARIABLE_TOKENS)[number];
