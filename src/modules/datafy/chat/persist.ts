import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { redactSecrets } from "../crypto-secrets";
import { normalizeWaId } from "./window";
import { emitDatafyEvent } from "./realtime";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import type { DatafyWebhookValue } from "../types";

function parseTs(raw?: string): Date {
    if (!raw) return new Date();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 1_000_000_000) {
        return new Date(n * 1000);
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date() : d;
}

function previewFromInbound(msg: Record<string, unknown>): {
    type: string;
    body: string | null;
    caption: string | null;
    mediaId: string | null;
    mediaMimeType: string | null;
    mediaFilename: string | null;
    metadata: Record<string, unknown> | null;
} {
    const type = String(msg.type || "unknown");
    if (type === "text") {
        const text = (msg.text as { body?: string } | undefined)?.body || null;
        return {
            type,
            body: text,
            caption: null,
            mediaId: null,
            mediaMimeType: null,
            mediaFilename: null,
            metadata: null,
        };
    }

    const mediaTypes = ["image", "audio", "video", "document", "sticker"] as const;
    if ((mediaTypes as readonly string[]).includes(type)) {
        const media = msg[type] as
            | {
                  id?: string;
                  mime_type?: string;
                  caption?: string;
                  filename?: string;
                  voice?: boolean;
              }
            | undefined;
        const caption = media?.caption || null;
        return {
            type,
            body: caption || `[${type}]`,
            caption,
            mediaId: media?.id || null,
            mediaMimeType: media?.mime_type || null,
            mediaFilename: media?.filename || null,
            metadata: media ? { voice: media.voice } : null,
        };
    }

    if (type === "location") {
        const loc = msg.location as
            | { latitude?: number; longitude?: number; name?: string; address?: string }
            | undefined;
        const label =
            loc?.name ||
            loc?.address ||
            (loc?.latitude != null && loc?.longitude != null
                ? `${loc.latitude}, ${loc.longitude}`
                : "[localização]");
        return {
            type,
            body: label,
            caption: null,
            mediaId: null,
            mediaMimeType: null,
            mediaFilename: null,
            metadata: loc || null,
        };
    }

    if (type === "interactive") {
        const interactive = msg.interactive as Record<string, unknown> | undefined;
        const button = interactive?.button_reply as { title?: string; id?: string } | undefined;
        const list = interactive?.list_reply as { title?: string; id?: string } | undefined;
        const title = button?.title || list?.title || "[interativo]";
        return {
            type,
            body: title,
            caption: null,
            mediaId: null,
            mediaMimeType: null,
            mediaFilename: null,
            metadata: interactive || null,
        };
    }

    if (type === "reaction") {
        const reaction = msg.reaction as { emoji?: string; message_id?: string } | undefined;
        return {
            type,
            body: reaction?.emoji || "[reação]",
            caption: null,
            mediaId: null,
            mediaMimeType: null,
            mediaFilename: null,
            metadata: reaction || null,
        };
    }

    return {
        type: type || "unknown",
        body: `[${type || "mensagem"}]`,
        caption: null,
        mediaId: null,
        mediaMimeType: null,
        mediaFilename: null,
        metadata: null,
    };
}

/**
 * Persist inbound webhook messages into DatafyConversation / DatafyMessage.
 * Idempotent on wamid. Safe when operators are offline.
 */
export async function persistInboundFromWebhookValue(
    value: DatafyWebhookValue
): Promise<{ messagesCreated: number; conversationsTouched: number }> {
    const messages = value.messages || [];
    if (!messages.length) {
        return { messagesCreated: 0, conversationsTouched: 0 };
    }

    const phoneNumberId = value.metadata?.phone_number_id || null;
    const displayFromMeta = value.metadata?.display_phone_number || null;
    if (displayFromMeta) {
        try {
            await prisma.datafyIntegration.update({
                where: { id: "default" },
                data: { displayPhoneNumber: displayFromMeta },
            });
        } catch {
            /* integration row may not exist yet */
        }
    }

    const contactByWa = new Map<
        string,
        { name?: string; userId?: string }
    >();
    for (const c of value.contacts || []) {
        const wa = normalizeWaId(c.wa_id);
        if (!wa) continue;
        contactByWa.set(wa, {
            name: c.profile?.name,
            userId: (c as { user_id?: string }).user_id,
        });
    }

    let messagesCreated = 0;
    const touched = new Set<string>();

    for (const raw of messages) {
        const msg = raw as Record<string, unknown>;
        const wamid = String(msg.id || "");
        if (!wamid) continue;

        const from = normalizeWaId(String(msg.from || ""));
        if (!from) continue;

        const existing = await prisma.datafyMessage.findUnique({
            where: { wamid },
            select: { id: true },
        });
        if (existing) continue;

        const contact = contactByWa.get(from);
        const parsed = previewFromInbound(msg);
        const providerTimestamp = parseTs(
            typeof msg.timestamp === "string" ? msg.timestamp : undefined
        );

        let crmContactId: string | null = null;
        try {
            const { upsertCrmFromDatafyWebhook } = await import(
                "@/modules/crm/service"
            );
            crmContactId = await upsertCrmFromDatafyWebhook({
                waId: from,
                contactName: contact?.name || null,
            });
        } catch {
            crmContactId = null;
        }

        const conversation = await prisma.datafyConversation.upsert({
            where: {
                channelId_waId: {
                    channelId: DATAFY_OFFICIAL_CHANNEL_ID,
                    waId: from,
                },
            },
            create: {
                channelId: DATAFY_OFFICIAL_CHANNEL_ID,
                waId: from,
                contactName: contact?.name || null,
                contactUserId: contact?.userId || null,
                phoneNumberId,
                crmContactId: crmContactId || undefined,
                lastMessagePreview: parsed.body,
                lastMessageAt: providerTimestamp,
                lastCustomerMessageAt: providerTimestamp,
                unreadCount: 1,
                status: "open",
            },
            update: {
                contactName: contact?.name || undefined,
                contactUserId: contact?.userId || undefined,
                phoneNumberId: phoneNumberId || undefined,
                ...(crmContactId ? { crmContactId } : {}),
                lastMessagePreview: parsed.body,
                lastMessageAt: providerTimestamp,
                lastCustomerMessageAt: providerTimestamp,
                unreadCount: { increment: 1 },
                status: "open",
            },
        });

        try {
            const created = await prisma.datafyMessage.create({
                data: {
                    conversationId: conversation.id,
                    wamid,
                    direction: "inbound",
                    type: parsed.type,
                    body: parsed.body,
                    caption: parsed.caption,
                    mediaId: parsed.mediaId,
                    mediaMimeType: parsed.mediaMimeType,
                    mediaFilename: parsed.mediaFilename,
                    status: "delivered",
                    providerTimestamp,
                    metadata: parsed.metadata
                        ? (parsed.metadata as Prisma.InputJsonValue)
                        : undefined,
                },
            });
            messagesCreated++;
            touched.add(conversation.id);

            emitDatafyEvent("datafy.message", {
                conversationId: conversation.id,
                message: serializeMessage(created),
            });
            emitDatafyEvent("datafy.conversation", {
                conversation: serializeConversation(conversation),
            });
        } catch (e: unknown) {
            const code = (e as { code?: string })?.code;
            if (code === "P2002") continue; // race on wamid
            throw e;
        }
    }

    return { messagesCreated, conversationsTouched: touched.size };
}

const STATUS_RANK: Record<string, number> = {
    pending: 0,
    accepted: 1,
    sent: 2,
    delivered: 3,
    read: 4,
    failed: 5,
};

/** Apply outbound status webhook without going backwards (except failed). */
export async function applyOutboundStatus(opts: {
    wamid: string;
    status: string;
    timestamp: Date;
    errorCode?: number | null;
    errorTitle?: string | null;
    errorDetails?: string | null;
}): Promise<boolean> {
    const msg = await prisma.datafyMessage.findUnique({
        where: { wamid: opts.wamid },
    });
    if (!msg) return false;

    const next = opts.status.toLowerCase();
    if (!["sent", "delivered", "read", "failed"].includes(next)) return false;

    const currentRank = STATUS_RANK[msg.status] ?? 0;
    const nextRank = STATUS_RANK[next] ?? 0;
    if (next !== "failed" && nextRank < currentRank) {
        return false;
    }

    const data: Record<string, unknown> = { status: next };
    if (next === "delivered") data.deliveredAt = opts.timestamp;
    if (next === "read") {
        data.readAt = opts.timestamp;
        if (!msg.deliveredAt) data.deliveredAt = opts.timestamp;
    }
    if (next === "failed") {
        data.failedAt = opts.timestamp;
        data.errorCode = opts.errorCode ?? null;
        data.errorMessage = redactSecrets(
            opts.errorTitle || opts.errorDetails || "Falha no envio"
        ).slice(0, 240);
    }

    const updated = await prisma.datafyMessage.update({
        where: { id: msg.id },
        data,
    });

    emitDatafyEvent("datafy.status", {
        conversationId: msg.conversationId,
        message: serializeMessage(updated),
    });

    try {
        const { syncCampaignRecipientFromWamid } = await import(
            "@/modules/datafy/campaigns/status-sync"
        );
        await syncCampaignRecipientFromWamid({
            wamid: opts.wamid,
            status: next,
            timestamp: opts.timestamp,
            errorCode: opts.errorCode,
            errorTitle: opts.errorTitle,
        });
    } catch {
        /* campaign tables may be absent during partial migrate */
    }

    return true;
}

export function serializeMessage(m: {
    id: string;
    conversationId: string;
    wamid: string | null;
    clientMessageId: string | null;
    direction: string;
    type: string;
    body: string | null;
    caption: string | null;
    mediaId: string | null;
    mediaUrl: string | null;
    mediaMimeType: string | null;
    mediaFilename: string | null;
    mediaSize: number | null;
    status: string;
    errorCode: number | null;
    errorMessage: string | null;
    sentByUserId: string | null;
    providerTimestamp: Date | null;
    deliveredAt: Date | null;
    readAt: Date | null;
    failedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}) {
    return {
        id: m.id,
        conversationId: m.conversationId,
        wamid: m.wamid,
        clientMessageId: m.clientMessageId,
        direction: m.direction,
        type: m.type,
        body: m.body,
        caption: m.caption,
        mediaId: m.mediaId,
        mediaUrl: m.mediaUrl,
        mediaMimeType: m.mediaMimeType,
        mediaFilename: m.mediaFilename,
        mediaSize: m.mediaSize,
        status: m.status,
        errorCode: m.errorCode,
        errorMessage: m.errorMessage ? redactSecrets(m.errorMessage) : null,
        sentByUserId: m.sentByUserId,
        providerTimestamp: m.providerTimestamp?.toISOString() ?? null,
        deliveredAt: m.deliveredAt?.toISOString() ?? null,
        readAt: m.readAt?.toISOString() ?? null,
        failedAt: m.failedAt?.toISOString() ?? null,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
    };
}

export function serializeConversation(c: {
    id: string;
    channelId: string;
    waId: string;
    contactName: string | null;
    contactUserId: string | null;
    phoneNumberId: string | null;
    lastMessagePreview: string | null;
    lastMessageAt: Date | null;
    lastCustomerMessageAt: Date | null;
    unreadCount: number;
    status: string;
    assignedToId: string | null;
    assignedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    assignedTo?: { id: string; name: string | null; email: string } | null;
}) {
    return {
        id: c.id,
        channelId: c.channelId,
        waId: c.waId,
        contactName: c.contactName,
        contactUserId: c.contactUserId,
        phoneNumberId: c.phoneNumberId,
        lastMessagePreview: c.lastMessagePreview,
        lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        lastCustomerMessageAt: c.lastCustomerMessageAt?.toISOString() ?? null,
        unreadCount: c.unreadCount,
        status: c.status,
        assignedToId: c.assignedToId,
        assignedAt: c.assignedAt?.toISOString() ?? null,
        assignedTo: c.assignedTo
            ? {
                  id: c.assignedTo.id,
                  name: c.assignedTo.name,
                  email: c.assignedTo.email,
              }
            : null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
    };
}
