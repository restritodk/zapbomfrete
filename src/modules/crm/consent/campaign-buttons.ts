import {
    CAMPAIGN_BUTTON_TITLE_UI_MAX,
    CONSENT_BUTTON_IDS,
    DEFAULT_CONSENT_BUTTONS,
    META_INTERACTIVE_REPLY_TITLE_MAX,
    META_QUICK_REPLY_MAX_BUTTONS,
} from "./constants";

export type CampaignConsentButtons = {
    enabled: boolean;
    purpose: "consent_offers";
    buttons: Array<{
        id: string;
        title: string;
    }>;
};

export function defaultCampaignConsentButtons(): CampaignConsentButtons {
    return {
        enabled: false,
        purpose: "consent_offers",
        buttons: DEFAULT_CONSENT_BUTTONS.map((b) => ({
            id: b.payload,
            title: b.text.slice(0, CAMPAIGN_BUTTON_TITLE_UI_MAX),
        })),
    };
}

export function parseCampaignConsentButtons(
    raw: unknown
): CampaignConsentButtons {
    const fallback = defaultCampaignConsentButtons();
    if (!raw || typeof raw !== "object") return fallback;
    const o = raw as Record<string, unknown>;
    const enabled = o.enabled === true;
    const buttonsRaw = Array.isArray(o.buttons) ? o.buttons : [];
    const buttons: CampaignConsentButtons["buttons"] = [];
    for (const b of buttonsRaw) {
        if (!b || typeof b !== "object") continue;
        const row = b as Record<string, unknown>;
        const title = String(row.title || row.text || "").trim();
        const id = String(row.id || row.payload || "").trim();
        if (!title) continue;
        buttons.push({
            id: id || `btn_${buttons.length + 1}`,
            title: title.slice(0, CAMPAIGN_BUTTON_TITLE_UI_MAX),
        });
    }
    if (!buttons.length) {
        return { ...fallback, enabled };
    }
    return {
        enabled,
        purpose: "consent_offers",
        buttons: buttons.slice(0, META_QUICK_REPLY_MAX_BUTTONS),
    };
}

export function validateCampaignConsentButtons(
    cfg: CampaignConsentButtons
): { ok: boolean; errors: string[] } {
    if (!cfg.enabled) return { ok: true, errors: [] };
    const errors: string[] = [];
    if (cfg.buttons.length < 1 || cfg.buttons.length > META_QUICK_REPLY_MAX_BUTTONS) {
        errors.push(
            `Informe de 1 a ${META_QUICK_REPLY_MAX_BUTTONS} botões.`
        );
    }
    for (const b of cfg.buttons) {
        if (!b.title.trim()) errors.push("Título do botão não pode ser vazio.");
        if (b.title.length > CAMPAIGN_BUTTON_TITLE_UI_MAX) {
            errors.push(
                `Botão "${b.title.slice(0, 12)}…" excede ${CAMPAIGN_BUTTON_TITLE_UI_MAX} caracteres.`
            );
        }
    }
    const ids = cfg.buttons.map((b) => b.id);
    if (!ids.includes(CONSENT_BUTTON_IDS.GRANT) && !ids.includes(CONSENT_BUTTON_IDS.DENY)) {
        // Allow custom ids but warn via errors only if empty ids
    }
    return { ok: errors.length === 0, errors };
}

/** Payload for Datafy sendInteractiveButtons */
export function toInteractiveSendButtons(cfg: CampaignConsentButtons): Array<{
    id: string;
    title: string;
}> {
    if (!cfg.enabled) return [];
    return cfg.buttons.map((b) => ({
        id: b.id,
        title: b.title.slice(0, META_INTERACTIVE_REPLY_TITLE_MAX),
    }));
}
