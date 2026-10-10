/** Shared Datafy / Meta Cloud API types (Phase 1 — no send campaigns). */

export type DatafyMessageStatusValue =
    | "received"
    | "sent"
    | "delivered"
    | "read"
    | "failed";

export interface DatafyMeResponse {
    cliente_id?: string;
    phone_number_id?: string;
    waba_id?: string;
    business_id?: string;
}

export interface DatafyTemplate {
    id: string;
    name: string;
    language: string;
    status: string;
    category?: string;
    components?: unknown[];
    rejected_reason?: string;
}

export interface DatafyTemplatesResponse {
    data: DatafyTemplate[];
    paging?: {
        cursors?: { before?: string; after?: string };
        next?: string;
    };
}

export interface DatafyHttpErrorBody {
    statusCode?: number;
    message?: string;
    error?: {
        message?: string;
        type?: string;
        code?: number;
        fbtrace_id?: string;
    };
}

export interface DatafyWebhookEnvelope {
    object?: string;
    entry?: Array<{
        id?: string;
        changes?: Array<{
            field?: string;
            value?: DatafyWebhookValue;
        }>;
    }>;
}

export interface DatafyWebhookValue {
    messaging_product?: string;
    metadata?: {
        display_phone_number?: string;
        phone_number_id?: string;
    };
    contacts?: Array<{
        profile?: { name?: string };
        wa_id?: string;
        user_id?: string;
    }>;
    messages?: Array<{
        from?: string;
        from_user_id?: string;
        id?: string;
        timestamp?: string;
        type?: string;
        text?: { body?: string };
        image?: Record<string, unknown>;
        audio?: Record<string, unknown>;
        video?: Record<string, unknown>;
        document?: Record<string, unknown>;
        sticker?: Record<string, unknown>;
        location?: Record<string, unknown>;
        interactive?: Record<string, unknown>;
        reaction?: Record<string, unknown>;
        [key: string]: unknown;
    }>;
    statuses?: Array<{
        id?: string;
        status?: string;
        timestamp?: string;
        recipient_id?: string;
        conversation?: {
            id?: string;
            expiration_timestamp?: string;
            origin?: { type?: string };
        };
        pricing?: {
            billable?: boolean;
            pricing_model?: string;
            type?: string;
            category?: string;
        };
        errors?: Array<{
            code?: number;
            title?: string;
            message?: string;
            error_data?: { details?: string };
            href?: string;
        }>;
    }>;
}

export interface DatafyPublicStatus {
    provider: "datafy";
    enabled: boolean;
    configured: boolean;
    hasChannelToken: boolean;
    hasWebhookSecret: boolean;
    channelTokenMasked: string | null;
    webhookSecretMasked: string | null;
    phoneNumberId: string | null;
    wabaId: string | null;
    businessId: string | null;
    displayPhoneNumber: string | null;
    clienteId: string | null;
    webhookUrl: string;
    /** True when webhookUrl uses https:// (required in production). */
    webhookUrlIsHttps: boolean;
    webhookConfigured: boolean;
    lastVerifiedAt: string | null;
    lastError: string | null;
    /** Phase 1: outbound campaigns via Datafy are intentionally disabled. */
    outboundCampaignsEnabled: false;
    encryptionKeySource: "datafy" | "auth_secret" | "none";
}

export const DATAFY_WEBHOOK_EVENTS = [
    "messages",
    "message_template_status_update",
    "phone_number_quality_update",
    "account_update",
    "smb_message_echoes",
] as const;

export type DatafyWebhookEventName = (typeof DATAFY_WEBHOOK_EVENTS)[number];
