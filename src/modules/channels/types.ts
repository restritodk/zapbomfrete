import type { ChannelProvider } from "./ids";

export type DatafyOperationalAccessMode =
    | "ROLE_OWNER"
    | "EXPLICIT"
    | "SUPERADMIN_ONLY";

export type ChannelHealthStatus =
    | "CONNECTED"
    | "DEGRADED"
    | "DISCONNECTED"
    | "UNAVAILABLE";

/** Public channel descriptor — never includes tokens/secrets. */
export type ChannelDescriptor = {
    id: string;
    provider: ChannelProvider;
    name: string;
    status: string;
    /** Display phone when known (Datafy). Never invented. */
    displayPhoneNumber: string | null;
    shared: boolean;
    official: boolean;
    lastVerifiedAt: string | null;
    healthy: boolean;
    /** Human-readable provider label for UI. */
    providerLabel: string;
    /** Baileys DB cuid when provider=baileys. */
    dbId?: string;
    /** Extra UI hints (no secrets). */
    meta?: {
        lastError?: string | null;
        phoneNumberId?: string | null;
        enabled?: boolean;
        configured?: boolean;
        operationalAccessMode?: DatafyOperationalAccessMode;
    };
};

export type DatafyChannelAccessState = {
    mode: DatafyOperationalAccessMode;
    userIds: string[];
    users: Array<{ id: string; name: string | null; email: string; role: string }>;
};
