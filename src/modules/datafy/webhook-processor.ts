import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import type {
    DatafyMessageStatusValue,
    DatafyWebhookEnvelope,
    DatafyWebhookValue,
} from "./types";
import {
    applyOutboundStatus,
    persistInboundFromWebhookValue,
} from "./chat/persist";

export type ProcessWebhookResult = {
    duplicate: boolean;
    deliveryId: string;
    fields: string[];
    statusesSaved: number;
    messagesReceived: number;
    chatMessagesPersisted: number;
};

/**
 * Claim delivery id for idempotency.
 * Returns true if this is the first time we see this delivery (should process).
 */
export async function claimDeliveryId(
    deliveryId: string,
    field?: string | null
): Promise<boolean> {
    if (!deliveryId) return true;
    try {
        await prisma.datafyWebhookDelivery.create({
            data: { deliveryId, field: field || null },
        });
        return true;
    } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === "P2002") {
            return false; // unique violation — duplicate
        }
        throw e;
    }
}

function parseTs(raw?: string): Date {
    if (!raw) return new Date();
    const n = Number(raw);
    if (Number.isFinite(n) && n > 1_000_000_000) {
        return new Date(n * 1000);
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function upsertStatus(opts: {
    wamid: string;
    status: DatafyMessageStatusValue;
    recipientId?: string | null;
    phoneNumberId?: string | null;
    timestamp: Date;
    errorCode?: number | null;
    errorTitle?: string | null;
    errorDetails?: string | null;
    conversationId?: string | null;
    pricingCategory?: string | null;
}) {
    await prisma.datafyMessageStatus.upsert({
        where: {
            wamid_status_timestamp: {
                wamid: opts.wamid,
                status: opts.status,
                timestamp: opts.timestamp,
            },
        },
        create: {
            wamid: opts.wamid,
            status: opts.status,
            recipientId: opts.recipientId || null,
            phoneNumberId: opts.phoneNumberId || null,
            timestamp: opts.timestamp,
            errorCode: opts.errorCode ?? null,
            errorTitle: opts.errorTitle || null,
            errorDetails: opts.errorDetails || null,
            conversationId: opts.conversationId || null,
            pricingCategory: opts.pricingCategory || null,
        },
        update: {
            recipientId: opts.recipientId || null,
            phoneNumberId: opts.phoneNumberId || null,
            errorCode: opts.errorCode ?? null,
            errorTitle: opts.errorTitle || null,
            errorDetails: opts.errorDetails || null,
            conversationId: opts.conversationId || null,
            pricingCategory: opts.pricingCategory || null,
        },
    });
}

async function processValue(
    value: DatafyWebhookValue,
    counters: {
        statusesSaved: number;
        messagesReceived: number;
        chatMessagesPersisted: number;
    }
) {
    const phoneNumberId = value.metadata?.phone_number_id || null;

    if (Array.isArray(value.statuses)) {
        for (const st of value.statuses) {
            if (!st?.id || !st.status) continue;
            const status = String(st.status).toLowerCase() as DatafyMessageStatusValue;
            if (!["sent", "delivered", "read", "failed"].includes(status)) continue;

            const err = st.errors?.[0];
            const timestamp = parseTs(st.timestamp);
            await upsertStatus({
                wamid: st.id,
                status,
                recipientId: st.recipient_id || null,
                phoneNumberId,
                timestamp,
                errorCode: err?.code ?? null,
                errorTitle: err?.title || err?.message || null,
                errorDetails: err?.error_data?.details || null,
                conversationId: st.conversation?.id || null,
                pricingCategory: st.pricing?.category || st.conversation?.origin?.type || null,
            });
            counters.statusesSaved++;

            await applyOutboundStatus({
                wamid: st.id,
                status,
                timestamp,
                errorCode: err?.code ?? null,
                errorTitle: err?.title || err?.message || null,
                errorDetails: err?.error_data?.details || null,
            });
        }
    }

    if (Array.isArray(value.messages) && value.messages.length > 0) {
        for (const msg of value.messages) {
            if (!msg?.id) continue;
            await upsertStatus({
                wamid: msg.id,
                status: "received",
                recipientId: msg.from || null,
                phoneNumberId,
                timestamp: parseTs(msg.timestamp),
            });
            counters.messagesReceived++;
        }

        const persisted = await persistInboundFromWebhookValue(value);
        counters.chatMessagesPersisted += persisted.messagesCreated;
    }
}

/**
 * Process a verified Datafy webhook payload.
 * Safe to call after HTTP 200 was already sent to the client.
 * Does NOT touch Baileys.
 */
export async function processDatafyWebhook(opts: {
    deliveryId: string;
    envelope: DatafyWebhookEnvelope;
}): Promise<ProcessWebhookResult> {
    const fields: string[] = [];
    const counters = {
        statusesSaved: 0,
        messagesReceived: 0,
        chatMessagesPersisted: 0,
    };

    const firstField =
        opts.envelope.entry?.[0]?.changes?.[0]?.field || null;

    const isNew = await claimDeliveryId(opts.deliveryId, firstField);
    if (!isNew) {
        logger.info(
            "Datafy",
            `Duplicate webhook delivery ignored: ${opts.deliveryId.slice(0, 8)}…`
        );
        return {
            duplicate: true,
            deliveryId: opts.deliveryId,
            fields: [],
            statusesSaved: 0,
            messagesReceived: 0,
            chatMessagesPersisted: 0,
        };
    }

    for (const entry of opts.envelope.entry || []) {
        for (const change of entry.changes || []) {
            if (change.field) fields.push(change.field);
            if (change.value) {
                await processValue(change.value, counters);
            }
        }
    }

    logger.info(
        "Datafy",
        `Webhook processed delivery=${opts.deliveryId.slice(0, 8)}… fields=${fields.join(",") || "-"} statuses=${counters.statusesSaved} inbound=${counters.messagesReceived} chat=${counters.chatMessagesPersisted}`
    );

    return {
        duplicate: false,
        deliveryId: opts.deliveryId,
        fields,
        ...counters,
    };
}
