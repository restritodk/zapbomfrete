import {
    CONSENT_BUTTON_IDS,
    CONSENT_DECISION,
    OPT_OUT_KEYWORDS,
    type ConsentDecisionCode,
} from "./constants";

function stripAccents(s: string): string {
    return s.normalize("NFD").replace(/\p{M}/gu, "");
}

export function normalizeConsentText(raw: string | null | undefined): string {
    return stripAccents(String(raw || ""))
        .toUpperCase()
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export type ClassifiedConsentReply =
    | {
          kind: "grant" | "deny" | "revoke";
          decision: ConsentDecisionCode;
          matchedBy: "button_id" | "button_title" | "keyword";
      }
    | { kind: "none" };

const GRANT_TITLES = [
    normalizeConsentText("Tenho interesse"),
    normalizeConsentText("Sim, quero receber"),
    normalizeConsentText("Sim, quero ofertas"),
    normalizeConsentText("Sim, quero receber ofertas"),
    normalizeConsentText("Quero receber ofertas"),
    normalizeConsentText("Sim quero ofertas"),
    normalizeConsentText("Sim quero receber"),
];

const DENY_TITLES = [
    normalizeConsentText("Não tenho interesse"),
    normalizeConsentText("Nao tenho interesse"),
    normalizeConsentText("Não quero receber"),
    normalizeConsentText("Nao quero receber"),
    normalizeConsentText("Não quero ofertas"),
    normalizeConsentText("Nao quero ofertas"),
];

/**
 * Classify interactive button reply or free-text for consent.
 * Free-text never grants — only unequivocal opt-out keywords revoke/deny.
 */
export function classifyConsentReply(opts: {
    buttonId?: string | null;
    buttonTitle?: string | null;
    textBody?: string | null;
    previousStatus?: string | null;
}): ClassifiedConsentReply {
    const id = String(opts.buttonId || "").trim().toLowerCase();
    if (
        id === CONSENT_BUTTON_IDS.GRANT ||
        id === CONSENT_BUTTON_IDS.GRANT_LEGACY ||
        id === "consent_yes"
    ) {
        return {
            kind: "grant",
            decision: CONSENT_DECISION.GRANTED,
            matchedBy: "button_id",
        };
    }
    if (
        id === CONSENT_BUTTON_IDS.DENY ||
        id === CONSENT_BUTTON_IDS.DENY_LEGACY ||
        id === "consent_no" ||
        id === "consent_deny"
    ) {
        const prev = opts.previousStatus || "unknown";
        const decision =
            prev === "granted"
                ? CONSENT_DECISION.REVOKED
                : CONSENT_DECISION.DENIED;
        return {
            kind: prev === "granted" ? "revoke" : "deny",
            decision,
            matchedBy: "button_id",
        };
    }

    const titleNorm = normalizeConsentText(opts.buttonTitle);
    if (titleNorm && GRANT_TITLES.includes(titleNorm)) {
        return {
            kind: "grant",
            decision: CONSENT_DECISION.GRANTED,
            matchedBy: "button_title",
        };
    }
    if (titleNorm && DENY_TITLES.includes(titleNorm)) {
        const prev = opts.previousStatus || "unknown";
        return {
            kind: prev === "granted" ? "revoke" : "deny",
            decision:
                prev === "granted"
                    ? CONSENT_DECISION.REVOKED
                    : CONSENT_DECISION.DENIED,
            matchedBy: "button_title",
        };
    }

    const textNorm = normalizeConsentText(opts.textBody);
    if (!textNorm) return { kind: "none" };

    for (const kw of OPT_OUT_KEYWORDS) {
        if (textNorm === kw || textNorm.startsWith(`${kw} `)) {
            const prev = opts.previousStatus || "unknown";
            return {
                kind: prev === "granted" ? "revoke" : "deny",
                decision:
                    prev === "granted"
                        ? CONSENT_DECISION.REVOKED
                        : CONSENT_DECISION.DENIED,
                matchedBy: "keyword",
            };
        }
    }

    // Ambiguous free text — never auto-grant
    return { kind: "none" };
}
