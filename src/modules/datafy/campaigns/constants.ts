export const CAMPAIGN_ORG_DEFAULT = "default";

export const CAMPAIGN_STATUSES = [
    "draft",
    "scheduled",
    "preparing",
    "running",
    "paused",
    "completed",
    "completed_with_errors",
    "cancelled",
    "failed",
] as const;

export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_PURPOSES = [
    "marketing",
    "utility",
    "authentication",
    "transactional",
    "other",
] as const;

export type CampaignPurpose = (typeof CAMPAIGN_PURPOSES)[number];

export const RECIPIENT_STATUSES = [
    "pending",
    "skipped",
    "queued",
    "sending",
    "accepted",
    "sent",
    "delivered",
    "read",
    "failed",
    "cancelled",
    "unknown_after_send",
] as const;

export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

/** Valid state transitions for Datafy campaigns. */
export const CAMPAIGN_TRANSITIONS: Record<CampaignStatus, CampaignStatus[]> = {
    draft: ["scheduled", "preparing", "cancelled"],
    scheduled: ["draft", "preparing", "cancelled"],
    preparing: ["running", "paused", "cancelled", "failed"],
    running: [
        "paused",
        "completed",
        "completed_with_errors",
        "cancelled",
        "failed",
    ],
    paused: ["running", "preparing", "cancelled"],
    completed: [],
    completed_with_errors: [],
    cancelled: [],
    failed: ["draft"],
};

export function canTransition(
    from: string,
    to: string
): from is CampaignStatus {
    if (!(from in CAMPAIGN_TRANSITIONS)) return false;
    return CAMPAIGN_TRANSITIONS[from as CampaignStatus].includes(
        to as CampaignStatus
    );
}

/** Delivery status rank — never regress except failed. */
export const RECIPIENT_STATUS_RANK: Record<string, number> = {
    pending: 0,
    skipped: 0,
    queued: 1,
    sending: 2,
    accepted: 3,
    sent: 4,
    delivered: 5,
    read: 6,
    failed: 7,
    cancelled: 0,
    unknown_after_send: 3,
};

export const DEFAULT_CAMPAIGN_DELAY_MS = 1200;
export const DEFAULT_CAMPAIGN_BATCH_SIZE = 5;
export const CAMPAIGN_LOCK_TTL_MS = 90_000;
export const WORKER_TICK_MS = 4_000;

/** CRM field tokens allowed in variable mapping. */
export const VARIABLE_TOKENS = [
    "fullName",
    "company",
    "city",
    "state",
    "waId",
    "category",
] as const;
