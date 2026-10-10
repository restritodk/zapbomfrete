import { loadDatafyConfig } from "@/modules/datafy/config";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "./ids";
import { canAccessDatafyChannel, normalizeOperationalAccessMode } from "./access";
import type { ChannelDescriptor, ChannelHealthStatus } from "./types";
import { prisma } from "@/lib/prisma";

export const DATAFY_OFFICIAL_CHANNEL_NAME = "Bom Frete — WhatsApp Oficial";

/**
 * Derive health from real integration state — never invent CONNECTED.
 */
export function deriveDatafyHealth(input: {
    enabled: boolean;
    hasToken: boolean;
    displayPhoneNumber: string | null;
    phoneNumberId: string | null;
    lastVerifiedAt: Date | null;
    lastError: string | null;
}): { status: ChannelHealthStatus; healthy: boolean } {
    if (!input.enabled || !input.hasToken) {
        return { status: "DISCONNECTED", healthy: false };
    }

    const hasIdentity = Boolean(
        input.displayPhoneNumber || input.phoneNumberId
    );

    if (input.lastError && !input.lastVerifiedAt) {
        return { status: "DEGRADED", healthy: false };
    }

    if (input.lastVerifiedAt && hasIdentity) {
        return { status: "CONNECTED", healthy: true };
    }

    if (hasIdentity && !input.lastError) {
        // Configured with phone metadata but not freshly verified.
        return { status: "DEGRADED", healthy: false };
    }

    if (input.hasToken && input.enabled) {
        return { status: "DEGRADED", healthy: false };
    }

    return { status: "UNAVAILABLE", healthy: false };
}

/**
 * Build the singleton official Datafy channel descriptor.
 * Always the same id — never duplicates per user/login.
 */
export async function getOfficialDatafyChannel(): Promise<ChannelDescriptor> {
    const cfg = await loadDatafyConfig();

    let operationalAccessMode = "ROLE_OWNER";
    try {
        const row = await prisma.datafyIntegration.findUnique({
            where: { id: "default" },
            select: { operationalAccessMode: true },
        });
        operationalAccessMode = normalizeOperationalAccessMode(
            row?.operationalAccessMode
        );
    } catch {
        operationalAccessMode = "ROLE_OWNER";
    }

    const { status, healthy } = deriveDatafyHealth({
        enabled: cfg.enabled,
        hasToken: Boolean(cfg.channelToken),
        displayPhoneNumber: cfg.displayPhoneNumber,
        phoneNumberId: cfg.phoneNumberId,
        lastVerifiedAt: cfg.lastVerifiedAt,
        lastError: cfg.lastError,
    });

    return {
        id: DATAFY_OFFICIAL_CHANNEL_ID,
        provider: "datafy",
        name: DATAFY_OFFICIAL_CHANNEL_NAME,
        status,
        displayPhoneNumber: cfg.displayPhoneNumber,
        shared: true,
        official: true,
        lastVerifiedAt: cfg.lastVerifiedAt?.toISOString() ?? null,
        healthy,
        providerLabel: "Datafy API",
        meta: {
            lastError: cfg.lastError ? redactSecrets(cfg.lastError) : null,
            phoneNumberId: cfg.phoneNumberId,
            enabled: cfg.enabled,
            configured: Boolean(cfg.channelToken && cfg.webhookSecret),
            operationalAccessMode: normalizeOperationalAccessMode(
                operationalAccessMode
            ),
        },
    };
}

/**
 * Return the official channel only when the user is authorized to see/select it.
 * Unauthorized users get null (no IDOR leak of phone number via this path when
 * access is denied — callers must not expose meta elsewhere).
 */
export async function getAccessibleDatafyChannel(
    userId: string,
    userRole: string
): Promise<ChannelDescriptor | null> {
    const allowed = await canAccessDatafyChannel(userId, userRole);
    if (!allowed) return null;
    return getOfficialDatafyChannel();
}
