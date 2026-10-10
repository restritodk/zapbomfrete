export const CRM_ORG_DEFAULT = "default";

export const CRM_CATEGORIES = [
    "Motorista",
    "Transportadora",
    "Cliente",
    "Parceiro",
    "Prospect",
    "Outros",
] as const;

export type CrmCategory = (typeof CRM_CATEGORIES)[number];

export const CRM_CONSENT_STATUSES = [
    "unknown",
    "granted",
    "denied",
    "opted_out",
] as const;

export type CrmConsentStatus = (typeof CRM_CONSENT_STATUSES)[number];

export const CRM_ORIGINS = [
    "manual",
    "import",
    "datafy_webhook",
    "baileys",
] as const;
