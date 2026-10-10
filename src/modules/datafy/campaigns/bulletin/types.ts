/** Meta Cloud API template BODY limit (chars). */
export const META_TEMPLATE_BODY_MAX = 1024;

/** Reserve space for " — PARTE X/Y" suffixes when packing. */
export const BULLETIN_PART_SAFETY_MARGIN = 48;

/** Reasonable import limits (not an artificial load count of 8/15). */
export const BULLETIN_IMPORT_MAX_CHARS = 100_000;
export const BULLETIN_IMPORT_MAX_LOADS = 200;

/**
 * Structured fields per load. All optional — never invent values.
 * Legacy v1 templates use a subset; v2 templates use the rich set.
 */
export type BulletinLoadFields = {
    origem?: string;
    localCarregamento?: string;
    destino?: string;
    terminal?: string;
    janela?: string;
    veiculo?: string;
    quantidade?: string;
    frete?: string;
    lote?: string;
    localizacaoUrl?: string;
    pedagio?: string;
    rotaPedagio?: string;
    observacoes?: string;
    grupoUrl?: string;
    /** Remaining free text / lines not mapped to structured fields */
    detalhes?: string;
};

export type BulletinFieldKey = keyof BulletinLoadFields;

export type BulletinAmbiguousField = {
    loadIndex: number;
    field: BulletinFieldKey | "unknown";
    raw: string;
    reason: string;
};

export type BulletinLoad = {
    index: number;
    text: string;
    /** Best-effort structured fields — never invent missing ones */
    fields: BulletinLoadFields;
    /** Lines kept for human review (not silently dropped) */
    unrecognizedLines: string[];
    ambiguous: BulletinAmbiguousField[];
    charCount: number;
    exceedsLimit: boolean;
    /** Completeness for UI badges (0–1) */
    completeness: number;
};

export type BulletinGeneralMeta = {
    title: string;
    operationType?: string;
    groupUrl?: string;
    /** ISO date or free expression from the bulletin header */
    referenceDate?: string;
    generalNotes?: string;
};

export type BulletinPart = {
    index: number;
    label: string;
    bodyText: string;
    loadIndexes: number[];
    charCount: number;
    /** Template association (filled in Phase 6C) */
    templateName?: string | null;
    templateLanguage?: string | null;
    templateCategory?: string | null;
    templateApprovalStatus?: string | null;
    templateComponents?: unknown;
    variableMapping?: { body?: string[]; header?: string[] } | null;
    readyForRealSend?: boolean;
    blockReason?: string | null;
};

export type BulletinAnalysis = {
    title: string;
    rawText: string;
    general: BulletinGeneralMeta;
    loads: BulletinLoad[];
    parts: BulletinPart[];
    loadCount: number;
    partCount: number;
    warnings: string[];
    totalChars: number;
    /** Global unrecognized header/footer lines */
    unrecognizedLines: string[];
};

export type CampaignMessagePart = {
    index: number;
    label: string;
    /** Filled preview (template body + variable values) for UI */
    bodyText: string;
    loadIndexes: number[];
    charCount: number;
    templateName?: string | null;
    templateLanguage?: string | null;
    templateCategory?: string | null;
    templateApprovalStatus?: string | null;
    templateComponents?: unknown;
    /** Literal values for Meta positional params (not CRM tokens) */
    variableMapping?: { body?: string[]; header?: string[] } | null;
    headerImageUrl?: string | null;
    headerImageHandle?: string | null;
    readyForRealSend?: boolean;
    blockReason?: string | null;
    /** Library spec id e.g. boletim_2_cargas or boletim_v2_1_carga */
    libraryTemplateId?: string | null;
    /** Policy note e.g. UTILITY used for load broadcast */
    policyWarning?: string | null;
    /** Compatibility: ready | missing_template | param_overflow | incomplete_fields */
    compatibility?:
        | "ready"
        | "missing_template"
        | "param_overflow"
        | "incomplete_fields"
        | "blocked";
};

/** Editable draft shape for the smart creator UI / API. */
export type BulletinEditableDraft = {
    rawText: string;
    general: BulletinGeneralMeta;
    loads: BulletinLoad[];
    warnings: string[];
    confirmed: boolean;
};
