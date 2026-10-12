import {
    CAMPAIGN_BUTTON_TITLE_UI_MAX,
    CONSENT_BUTTON_IDS,
    DEFAULT_CONSENT_BUTTONS,
    DEFAULT_CONSENT_BUTTON_TITLES,
    META_CTA_URL_DISPLAY_TEXT_MAX,
    META_INTERACTIVE_REPLY_TITLE_MAX,
    META_QUICK_REPLY_MAX_BUTTONS,
} from "./constants";
import { validateWhatsappGroupInviteUrl } from "./group-invite-url";

export type ConsentButtonPlacementPref =
    | "last_only"
    | "per_template_approved";

export type CampaignUrlButton = {
    enabled: boolean;
    title: string;
    url: string;
};

export type CampaignConsentButtons = {
    enabled: boolean;
    purpose: "consent_offers";
    /** Where freeform / preference applies in multi-message campaigns. */
    placement?: ConsentButtonPlacementPref;
    buttons: Array<{
        id: string;
        title: string;
    }>;
    /** Third button — external WhatsApp group invite (CTA URL). */
    urlButton?: CampaignUrlButton;
};

export function defaultCampaignUrlButton(
    defaultUrl?: string | null
): CampaignUrlButton {
    return {
        enabled: false,
        title: DEFAULT_CONSENT_BUTTON_TITLES.groupInvite.slice(
            0,
            META_CTA_URL_DISPLAY_TEXT_MAX
        ),
        url: String(defaultUrl || "").trim(),
    };
}

export function defaultCampaignConsentButtons(
    defaultGroupUrl?: string | null
): CampaignConsentButtons {
    return {
        enabled: false,
        purpose: "consent_offers",
        placement: "last_only",
        buttons: DEFAULT_CONSENT_BUTTONS.map((b) => ({
            id: b.payload,
            title: b.text.slice(0, CAMPAIGN_BUTTON_TITLE_UI_MAX),
        })),
        urlButton: defaultCampaignUrlButton(defaultGroupUrl),
    };
}

export function parseCampaignConsentButtons(
    raw: unknown,
    defaultGroupUrl?: string | null
): CampaignConsentButtons {
    const fallback = defaultCampaignConsentButtons(defaultGroupUrl);
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
        // Skip legacy EXTRA reply when migrating to urlButton
        if (id === CONSENT_BUTTON_IDS.EXTRA || id === CONSENT_BUTTON_IDS.GROUP_INVITE) {
            continue;
        }
        buttons.push({
            id: id || `btn_${buttons.length + 1}`,
            title: title.slice(0, CAMPAIGN_BUTTON_TITLE_UI_MAX),
        });
    }
    if (!buttons.length) {
        buttons.push(...fallback.buttons);
    }
    const placementRaw = String(o.placement || "").trim();
    const placement: ConsentButtonPlacementPref =
        placementRaw === "per_template_approved"
            ? "per_template_approved"
            : "last_only";

    let urlButton = defaultCampaignUrlButton(
        defaultGroupUrl || fallback.urlButton?.url
    );
    const ub = o.urlButton;
    if (ub && typeof ub === "object") {
        const u = ub as Record<string, unknown>;
        urlButton = {
            enabled: u.enabled === true,
            title: String(u.title || DEFAULT_CONSENT_BUTTON_TITLES.groupInvite)
                .trim()
                .slice(0, META_CTA_URL_DISPLAY_TEXT_MAX) ||
                DEFAULT_CONSENT_BUTTON_TITLES.groupInvite,
            url: String(u.url || defaultGroupUrl || "").trim(),
        };
    }

    return {
        enabled,
        purpose: "consent_offers",
        placement,
        buttons: buttons.slice(0, META_QUICK_REPLY_MAX_BUTTONS),
        urlButton,
    };
}

export function validateCampaignConsentButtons(
    cfg: CampaignConsentButtons
): { ok: boolean; errors: string[] } {
    if (!cfg.enabled) return { ok: true, errors: [] };
    const errors: string[] = [];
    if (cfg.buttons.length < 1 || cfg.buttons.length > META_QUICK_REPLY_MAX_BUTTONS) {
        errors.push(
            `Informe de 1 a ${META_QUICK_REPLY_MAX_BUTTONS} botões de resposta.`
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
    if (cfg.urlButton?.enabled) {
        if (!cfg.urlButton.title.trim()) {
            errors.push("Informe o texto do botão de link do grupo.");
        }
        if (cfg.urlButton.title.length > META_CTA_URL_DISPLAY_TEXT_MAX) {
            errors.push(
                `Texto do botão de link excede ${META_CTA_URL_DISPLAY_TEXT_MAX} caracteres (limite Meta CTA).`
            );
        }
        const v = validateWhatsappGroupInviteUrl(cfg.urlButton.url);
        if (!v.ok) errors.push(v.error);
    }
    return { ok: errors.length === 0, errors };
}

/** Reply buttons only (QUICK_REPLY / interactive reply) — never includes URL CTA. */
export function toInteractiveSendButtons(cfg: CampaignConsentButtons): Array<{
    id: string;
    title: string;
}> {
    if (!cfg.enabled) return [];
    return cfg.buttons
        .filter(
            (b) =>
                b.id !== CONSENT_BUTTON_IDS.GROUP_INVITE &&
                b.id !== CONSENT_BUTTON_IDS.EXTRA
        )
        .map((b) => ({
            id: b.id,
            title: b.title.slice(0, META_INTERACTIVE_REPLY_TITLE_MAX),
        }));
}

export function getEnabledUrlButton(
    cfg: CampaignConsentButtons
): CampaignUrlButton | null {
    if (!cfg.enabled || !cfg.urlButton?.enabled) return null;
    const v = validateWhatsappGroupInviteUrl(cfg.urlButton.url);
    if (!v.ok) return null;
    return {
        enabled: true,
        title: cfg.urlButton.title.slice(0, META_CTA_URL_DISPLAY_TEXT_MAX),
        url: v.normalized,
    };
}

/** Preview rows: reply titles + optional URL CTA (display only). */
export function toPreviewButtons(
    cfg: CampaignConsentButtons
): Array<{ title: string; kind: "reply" | "url" }> {
    if (!cfg.enabled) return [];
    const rows: Array<{ title: string; kind: "reply" | "url" }> = cfg.buttons.map(
        (b) => ({ title: b.title, kind: "reply" as const })
    );
    if (cfg.urlButton?.enabled && cfg.urlButton.title.trim()) {
        rows.push({ title: cfg.urlButton.title.trim(), kind: "url" });
    }
    return rows;
}
