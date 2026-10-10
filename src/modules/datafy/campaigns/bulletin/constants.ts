/** sessionStorage key: hand off confirmed bulletin to Disparo em massa */
export const DATAFY_BULLETIN_IMPORT_KEY = "wa_akg_datafy_bulletin_import";

export type BulletinCampaignHandoff = {
    title: string;
    rawText: string;
    purpose: "marketing";
    contentKind: "bulletin";
    draftId?: string;
    loadCount: number;
    general: {
        title: string;
        operationType?: string;
        groupUrl?: string;
        referenceDate?: string;
        generalNotes?: string;
    };
    loads: unknown[];
    createdAt: string;
};
