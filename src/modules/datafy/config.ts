import { prisma } from "@/lib/prisma";
import {
    decryptSecret,
    encryptSecret,
    maskSecret,
    redactSecrets,
    resolveEncryptionKeys,
} from "./crypto-secrets";
import type { DatafyPublicStatus } from "./types";

export const DATAFY_DEFAULT_BASE_URL = "https://cloud.datafyapi.com.br";

export type DatafyResolvedConfig = {
    enabled: boolean;
    baseUrl: string;
    channelToken: string | null;
    webhookSecret: string | null;
    phoneNumberId: string | null;
    wabaId: string | null;
    businessId: string | null;
    displayPhoneNumber: string | null;
    clienteId: string | null;
    webhookConfigured: boolean;
    lastVerifiedAt: Date | null;
    lastError: string | null;
    tokenSource: "db" | "env" | "none";
    secretSource: "db" | "env" | "none";
};

function envFlag(name: string, fallback = false): boolean {
    const v = process.env[name];
    if (v === undefined || v === "") return fallback;
    return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export function getDatafyWebhookPublicUrl(): string {
    const base = (process.env.BASE_URL || process.env.NEXTAUTH_URL || "").replace(
        /\/$/,
        ""
    );
    return `${base}/api/webhooks/datafy`;
}

export function isWebhookUrlHttps(url: string): boolean {
    return /^https:\/\//i.test(url);
}

/** Production requires HTTPS webhook URL. Dev/test may use http://localhost. */
export function assertWebhookUrlSafeForEnvironment(url: string): {
    ok: boolean;
    reason?: string;
} {
    if (!url || url.startsWith("/api/")) {
        return { ok: false, reason: "BASE_URL_missing" };
    }
    if (process.env.NODE_ENV === "production" && !isWebhookUrlHttps(url)) {
        return { ok: false, reason: "https_required_in_production" };
    }
    return { ok: true };
}

export function encryptionKeySource(): DatafyPublicStatus["encryptionKeySource"] {
    const slots = resolveEncryptionKeys();
    if (slots.some((s) => s.label === "dek")) return "datafy";
    if (slots.some((s) => s.label === "auth")) return "auth_secret";
    return "none";
}

export async function loadDatafyConfig(): Promise<DatafyResolvedConfig> {
    const baseUrl =
        process.env.DATAFY_API_BASE_URL?.replace(/\/$/, "") ||
        DATAFY_DEFAULT_BASE_URL;

    let row: Awaited<ReturnType<typeof prisma.datafyIntegration.findUnique>> =
        null;
    try {
        row = await prisma.datafyIntegration.findUnique({
            where: { id: "default" },
        });
    } catch {
        row = null;
    }

    let channelToken: string | null = null;
    let tokenSource: DatafyResolvedConfig["tokenSource"] = "none";
    if (row?.channelTokenEnc) {
        try {
            channelToken = decryptSecret(row.channelTokenEnc);
            tokenSource = "db";
        } catch {
            channelToken = null;
        }
    }
    if (!channelToken && process.env.DATAFY_CHANNEL_TOKEN) {
        channelToken = process.env.DATAFY_CHANNEL_TOKEN.trim();
        tokenSource = "env";
    }

    let webhookSecret: string | null = null;
    let secretSource: DatafyResolvedConfig["secretSource"] = "none";
    if (row?.webhookSecretEnc) {
        try {
            webhookSecret = decryptSecret(row.webhookSecretEnc);
            secretSource = "db";
        } catch {
            webhookSecret = null;
        }
    }
    if (!webhookSecret && process.env.DATAFY_WEBHOOK_SECRET) {
        webhookSecret = process.env.DATAFY_WEBHOOK_SECRET.trim();
        secretSource = "env";
    }

    const enabled =
        row?.enabled ??
        envFlag("DATAFY_ENABLED", Boolean(channelToken && webhookSecret));

    return {
        enabled,
        baseUrl,
        channelToken,
        webhookSecret,
        phoneNumberId:
            row?.phoneNumberId ?? process.env.DATAFY_PHONE_NUMBER_ID ?? null,
        wabaId: row?.wabaId ?? process.env.DATAFY_WABA_ID ?? null,
        businessId: row?.businessId ?? null,
        displayPhoneNumber: row?.displayPhoneNumber ?? null,
        clienteId: row?.clienteId ?? null,
        webhookConfigured: row?.webhookConfigured ?? false,
        lastVerifiedAt: row?.lastVerifiedAt ?? null,
        lastError: row?.lastError ? redactSecrets(row.lastError) : null,
        tokenSource,
        secretSource,
    };
}

export function toPublicStatus(cfg: DatafyResolvedConfig): DatafyPublicStatus {
    const hasChannelToken = Boolean(cfg.channelToken);
    const hasWebhookSecret = Boolean(cfg.webhookSecret);
    const webhookUrl = getDatafyWebhookPublicUrl();
    return {
        provider: "datafy",
        enabled: cfg.enabled,
        configured: hasChannelToken && hasWebhookSecret,
        hasChannelToken,
        hasWebhookSecret,
        channelTokenMasked: maskSecret(cfg.channelToken),
        webhookSecretMasked: maskSecret(cfg.webhookSecret),
        phoneNumberId: cfg.phoneNumberId,
        wabaId: cfg.wabaId,
        businessId: cfg.businessId,
        displayPhoneNumber: cfg.displayPhoneNumber,
        clienteId: cfg.clienteId,
        webhookUrl,
        webhookUrlIsHttps: isWebhookUrlHttps(webhookUrl),
        webhookConfigured: cfg.webhookConfigured,
        lastVerifiedAt: cfg.lastVerifiedAt?.toISOString() ?? null,
        lastError: cfg.lastError ? redactSecrets(cfg.lastError) : null,
        outboundCampaignsEnabled: true,
        encryptionKeySource: encryptionKeySource(),
    };
}

export type SaveDatafyInput = {
    enabled?: boolean;
    channelToken?: string | null;
    webhookSecret?: string | null;
    webhookConfigured?: boolean;
    clearChannelToken?: boolean;
    clearWebhookSecret?: boolean;
    phoneNumberId?: string | null;
    wabaId?: string | null;
    businessId?: string | null;
    displayPhoneNumber?: string | null;
    clienteId?: string | null;
    lastVerifiedAt?: Date | null;
    lastError?: string | null;
};

export async function saveDatafyConfig(input: SaveDatafyInput) {
    const data: Record<string, unknown> = {};

    if (input.enabled !== undefined) data.enabled = input.enabled;
    if (input.webhookConfigured !== undefined)
        data.webhookConfigured = input.webhookConfigured;
    if (input.phoneNumberId !== undefined) data.phoneNumberId = input.phoneNumberId;
    if (input.wabaId !== undefined) data.wabaId = input.wabaId;
    if (input.businessId !== undefined) data.businessId = input.businessId;
    if (input.displayPhoneNumber !== undefined)
        data.displayPhoneNumber = input.displayPhoneNumber;
    if (input.clienteId !== undefined) data.clienteId = input.clienteId;
    if (input.lastVerifiedAt !== undefined)
        data.lastVerifiedAt = input.lastVerifiedAt;
    if (input.lastError !== undefined) {
        data.lastError =
            input.lastError === null
                ? null
                : redactSecrets(String(input.lastError)).slice(0, 240);
    }

    if (input.clearChannelToken) {
        data.channelTokenEnc = null;
    } else if (
        typeof input.channelToken === "string" &&
        input.channelToken.trim() &&
        !input.channelToken.includes("••••")
    ) {
        data.channelTokenEnc = encryptSecret(input.channelToken.trim());
    }

    if (input.clearWebhookSecret) {
        data.webhookSecretEnc = null;
    } else if (
        typeof input.webhookSecret === "string" &&
        input.webhookSecret.trim() &&
        !input.webhookSecret.includes("••••")
    ) {
        data.webhookSecretEnc = encryptSecret(input.webhookSecret.trim());
    }

    return prisma.datafyIntegration.upsert({
        where: { id: "default" },
        create: {
            id: "default",
            enabled: Boolean(input.enabled),
            ...(data as object),
        },
        update: data,
    });
}
