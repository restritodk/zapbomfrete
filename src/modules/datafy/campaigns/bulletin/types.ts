/** Meta Cloud API template BODY limit (chars). */
export const META_TEMPLATE_BODY_MAX = 1024;

/** Reserve space for " — PARTE X/Y" suffixes when packing. */
export const BULLETIN_PART_SAFETY_MARGIN = 48;

export type BulletinLoad = {
    index: number;
    text: string;
    /** Best-effort structured fields — never invent missing ones */
    fields: {
        origem?: string;
        destino?: string;
        terminal?: string;
        lote?: string;
        localizacaoUrl?: string;
        pedagio?: string;
    };
    charCount: number;
    exceedsLimit: boolean;
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
    loads: BulletinLoad[];
    parts: BulletinPart[];
    loadCount: number;
    partCount: number;
    warnings: string[];
    totalChars: number;
};

export type CampaignMessagePart = {
    index: number;
    label: string;
    bodyText: string;
    loadIndexes: number[];
    charCount: number;
    templateName?: string | null;
    templateLanguage?: string | null;
    templateCategory?: string | null;
    templateApprovalStatus?: string | null;
    templateComponents?: unknown;
    variableMapping?: { body?: string[]; header?: string[] } | null;
    headerImageUrl?: string | null;
    headerImageHandle?: string | null;
    readyForRealSend?: boolean;
    blockReason?: string | null;
};
