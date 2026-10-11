import {
    DEFAULT_CONSENT_BUTTONS,
    META_QUICK_REPLY_MAX_BUTTONS,
    META_QUICK_REPLY_TEXT_MAX,
} from "./constants";

export type ConsentQuickReplyButton = {
    type: "QUICK_REPLY";
    text: string;
    /** Stable id used when classifying webhook replies (stored locally). */
    payload: string;
};

export type TemplateButtonsConfig = {
    enabled: boolean;
    purpose: "consent_offers";
    buttons: ConsentQuickReplyButton[];
};

export function defaultConsentButtonsConfig(): TemplateButtonsConfig {
    return {
        enabled: true,
        purpose: "consent_offers",
        buttons: DEFAULT_CONSENT_BUTTONS.map((b) => ({ ...b })),
    };
}

export function parseButtonsConfig(raw: unknown): TemplateButtonsConfig | null {
    if (!raw || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    if (o.enabled !== true) {
        return {
            enabled: false,
            purpose: "consent_offers",
            buttons: DEFAULT_CONSENT_BUTTONS.map((b) => ({ ...b })),
        };
    }
    const buttonsRaw = Array.isArray(o.buttons) ? o.buttons : DEFAULT_CONSENT_BUTTONS;
    const buttons: ConsentQuickReplyButton[] = [];
    for (const b of buttonsRaw) {
        if (!b || typeof b !== "object") continue;
        const row = b as Record<string, unknown>;
        const text = String(row.text || "").trim();
        const payload = String(row.payload || "").trim();
        if (!text) continue;
        buttons.push({
            type: "QUICK_REPLY",
            text,
            payload: payload || `btn_${buttons.length + 1}`,
        });
    }
    return {
        enabled: true,
        purpose: "consent_offers",
        buttons: buttons.length
            ? buttons
            : DEFAULT_CONSENT_BUTTONS.map((b) => ({ ...b })),
    };
}

export type ButtonsValidation = {
    ok: boolean;
    errors: string[];
    warnings: string[];
    config: TemplateButtonsConfig | null;
};

export function validateButtonsConfig(
    raw: unknown
): ButtonsValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    const config = parseButtonsConfig(raw);
    if (!config || !config.enabled) {
        return { ok: true, errors: [], warnings: [], config };
    }
    if (config.buttons.length < 1) {
        errors.push("Ative ao menos um botão ou desative a seção.");
    }
    if (config.buttons.length > META_QUICK_REPLY_MAX_BUTTONS) {
        errors.push(
            `Máximo de ${META_QUICK_REPLY_MAX_BUTTONS} botões QUICK_REPLY (Meta).`
        );
    }
    for (const b of config.buttons) {
        if (b.text.length > META_QUICK_REPLY_TEXT_MAX) {
            errors.push(
                `Texto do botão "${b.text.slice(0, 20)}…" excede ${META_QUICK_REPLY_TEXT_MAX} caracteres.`
            );
        }
        if (!b.text.trim()) {
            errors.push("Texto do botão não pode ser vazio.");
        }
    }
    return {
        ok: errors.length === 0,
        errors,
        warnings,
        config,
    };
}

/**
 * Official Meta/Datafy BUTTONS component for template create.
 * Does not invent endpoints — QUICK_REPLY only.
 */
export function buildButtonsComponent(
    config: TemplateButtonsConfig | null | undefined
): Record<string, unknown> | null {
    if (!config?.enabled || !config.buttons.length) return null;
    const v = validateButtonsConfig(config);
    if (!v.ok || !v.config) return null;
    return {
        type: "BUTTONS",
        buttons: v.config.buttons.map((b) => ({
            type: "QUICK_REPLY",
            text: b.text,
        })),
    };
}

export function buttonsPreviewLines(
    config: TemplateButtonsConfig | null | undefined
): string[] {
    if (!config?.enabled) return [];
    return config.buttons.map((b) => `[${b.text}]`);
}
