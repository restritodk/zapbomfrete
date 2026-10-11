import { CRM_ORG_DEFAULT } from "../constants";

export { CRM_ORG_DEFAULT };

/** Internal CRM statuses (Phase 4/5 — keep compatible). */
export const CRM_CONSENT_STATUS = {
    UNKNOWN: "unknown",
    GRANTED: "granted",
    DENIED: "denied",
    /** Revoked / opt-out — blocks marketing */
    OPTED_OUT: "opted_out",
} as const;

/** Audit decision codes (Phase 9). */
export const CONSENT_DECISION = {
    GRANTED: "GRANTED",
    DENIED: "DENIED",
    REVOKED: "REVOKED",
    UNKNOWN: "UNKNOWN",
} as const;

export type ConsentDecisionCode =
    (typeof CONSENT_DECISION)[keyof typeof CONSENT_DECISION];

export const CONSENT_PURPOSE = {
    MARKETING_OFFERS: "marketing_offers",
} as const;

export const CONSENT_SOURCE = {
    INTERACTIVE_BUTTON: "interactive_button",
    KEYWORD_OPT_OUT: "keyword_opt_out",
    MANUAL_EVIDENCE: "manual_evidence",
    SYSTEM: "system",
} as const;

export const CONSENT_BUTTON_IDS = {
    GRANT: "consent_grant_offers",
    DENY: "consent_deny_offers",
} as const;

/** Meta QUICK_REPLY text max length. */
export const META_QUICK_REPLY_TEXT_MAX = 25;
export const META_QUICK_REPLY_MAX_BUTTONS = 3;

export const DEFAULT_CONSENT_BUTTONS = [
    {
        type: "QUICK_REPLY" as const,
        text: "Sim, quero ofertas",
        payload: CONSENT_BUTTON_IDS.GRANT,
    },
    {
        type: "QUICK_REPLY" as const,
        text: "Não quero receber",
        payload: CONSENT_BUTTON_IDS.DENY,
    },
];

export const DEFAULT_CONSENT_REQUEST_BODY =
    "*Recebimento de ofertas de frete*\n\nVocê autoriza o Bom Frete a enviar ofertas e atualizações de embarque pelo WhatsApp?\n\nVocê pode alterar esta escolha a qualquer momento.";

/** Unequivocal opt-out keywords (normalized uppercase, no accents). */
export const OPT_OUT_KEYWORDS = [
    "PARAR",
    "SAIR",
    "CANCELAR",
    "NAO RECEBER",
    "STOP",
    "UNSUBSCRIBE",
] as const;

export function decisionToCrmStatus(
    decision: ConsentDecisionCode
): string {
    switch (decision) {
        case CONSENT_DECISION.GRANTED:
            return CRM_CONSENT_STATUS.GRANTED;
        case CONSENT_DECISION.DENIED:
            return CRM_CONSENT_STATUS.DENIED;
        case CONSENT_DECISION.REVOKED:
            return CRM_CONSENT_STATUS.OPTED_OUT;
        default:
            return CRM_CONSENT_STATUS.UNKNOWN;
    }
}

export function crmStatusToDecision(status: string): ConsentDecisionCode {
    switch (status) {
        case CRM_CONSENT_STATUS.GRANTED:
            return CONSENT_DECISION.GRANTED;
        case CRM_CONSENT_STATUS.DENIED:
            return CONSENT_DECISION.DENIED;
        case CRM_CONSENT_STATUS.OPTED_OUT:
            return CONSENT_DECISION.REVOKED;
        default:
            return CONSENT_DECISION.UNKNOWN;
    }
}

export function consentStatusLabel(status: string): string {
    switch (status) {
        case "granted":
            return "Concedido";
        case "denied":
            return "Recusado";
        case "opted_out":
            return "Revogado / opt-out";
        case "unknown":
            return "Sem consentimento";
        default:
            return status;
    }
}

export function consentSourceLabel(source: string | null | undefined): string {
    switch (source) {
        case CONSENT_SOURCE.INTERACTIVE_BUTTON:
            return "Botão interativo";
        case CONSENT_SOURCE.KEYWORD_OPT_OUT:
            return "Resposta escrita";
        case CONSENT_SOURCE.MANUAL_EVIDENCE:
            return "Registro manual com evidência";
        case CONSENT_SOURCE.SYSTEM:
            return "Sistema";
        case "manual":
            return "Manual (CRM)";
        case "manual_opt_out":
            return "Opt-out manual";
        default:
            return source || "—";
    }
}
