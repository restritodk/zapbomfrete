import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { loadDatafyConfig } from "@/modules/datafy/config";
import { datafyProvider } from "@/modules/datafy/provider";
import { DatafyApiError } from "@/modules/datafy/client";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";
import { normalizeWaId } from "@/modules/datafy/chat/window";
import { emitDatafyEvent } from "@/modules/datafy/chat/realtime";
import {
    CAMPAIGN_LOCK_TTL_MS,
    CAMPAIGN_ORG_DEFAULT,
    canTransition,
} from "./constants";
import { appendEvent, setStatus } from "./service";
import { buildTemplateComponents } from "./variables";
import { evaluateEligibility } from "./eligibility";

const WORKER_ID = `worker_${process.pid}_${randomUUID().slice(0, 8)}`;

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

async function refreshCounters(campaignId: string) {
    const groups = await prisma.datafyCampaignRecipient.groupBy({
        by: ["status"],
        where: { campaignId },
        _count: { _all: true },
    });
    const count = (s: string) =>
        groups.find((g) => g.status === s)?._count._all || 0;

    const accepted =
        count("accepted") +
        count("sent") +
        count("delivered") +
        count("read");
    const data = {
        totalAccepted: accepted,
        totalSent: count("sent") + count("delivered") + count("read"),
        totalDelivered: count("delivered") + count("read"),
        totalRead: count("read"),
        totalFailed: count("failed") + count("unknown_after_send"),
        totalSkipped: count("skipped"),
        totalCancelled: count("cancelled"),
        totalQueued: count("pending") + count("queued") + count("sending"),
    };
    await prisma.datafyCampaign.update({
        where: { id: campaignId },
        data,
    });
    return data;
}

async function tryLock(campaignId: string): Promise<boolean> {
    const now = new Date();
    const staleBefore = new Date(now.getTime() - CAMPAIGN_LOCK_TTL_MS);
    const result = await prisma.datafyCampaign.updateMany({
        where: {
            id: campaignId,
            OR: [
                { lockedAt: null },
                { lockedAt: { lt: staleBefore } },
                { lockedBy: WORKER_ID },
            ],
        },
        data: { lockedAt: now, lockedBy: WORKER_ID },
    });
    return result.count > 0;
}

async function unlock(campaignId: string) {
    await prisma.datafyCampaign.updateMany({
        where: { id: campaignId, lockedBy: WORKER_ID },
        data: { lockedAt: null, lockedBy: null },
    });
}

async function ensureConversation(waId: string, contactName: string | null) {
    return prisma.datafyConversation.upsert({
        where: {
            channelId_waId: {
                channelId: DATAFY_OFFICIAL_CHANNEL_ID,
                waId,
            },
        },
        create: {
            channelId: DATAFY_OFFICIAL_CHANNEL_ID,
            waId,
            contactName,
            status: "open",
        },
        update: {
            contactName: contactName || undefined,
        },
    });
}

async function sendOneRecipient(
    campaign: {
        id: string;
        templateName: string | null;
        templateLanguage: string | null;
        variableMapping: unknown;
        dryRun: boolean;
        purpose: string;
        requireConsent: boolean;
        delayMs: number;
    },
    recipientId: string
) {
    const recipient = await prisma.datafyCampaignRecipient.findUnique({
        where: { id: recipientId },
    });
    if (!recipient) return;
    if (!["pending", "queued", "failed"].includes(recipient.status)) return;
    if (recipient.status === "failed" && recipient.attemptCount >= recipient.maxAttempts) {
        return;
    }

    // Re-check eligibility immediately before send
    if (recipient.crmContactId) {
        const contact = await prisma.crmContact.findUnique({
            where: { id: recipient.crmContactId },
        });
        if (contact) {
            const elig = evaluateEligibility(contact, {
                purpose: campaign.purpose,
                requireConsent: campaign.requireConsent,
            });
            if (!elig.ok) {
                await prisma.datafyCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: {
                        status: "skipped",
                        skipReason: elig.reason,
                    },
                });
                return;
            }
        }
    }

    const claim = await prisma.datafyCampaignRecipient.updateMany({
        where: {
            id: recipient.id,
            status: { in: ["pending", "queued", "failed"] },
        },
        data: {
            status: "sending",
            attemptCount: { increment: 1 },
        },
    });
    if (claim.count === 0) return;

    const clientMessageId =
        recipient.clientMessageId ||
        `camp_${campaign.id}_${recipient.waId}`;

    // Idempotency: if DatafyMessage already exists for this client key, reuse
    const existingMsg = await prisma.datafyMessage.findUnique({
        where: { clientMessageId },
    });
    if (existingMsg?.wamid) {
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status:
                    existingMsg.status === "failed"
                        ? "failed"
                        : existingMsg.status === "read"
                          ? "read"
                          : existingMsg.status === "delivered"
                            ? "delivered"
                            : existingMsg.status === "sent"
                              ? "sent"
                              : "accepted",
                wamid: existingMsg.wamid,
                datafyMessageId: existingMsg.id,
                conversationId: existingMsg.conversationId,
                acceptedAt: existingMsg.providerTimestamp || new Date(),
            },
        });
        return;
    }

    if (campaign.dryRun) {
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "accepted",
                clientMessageId,
                acceptedAt: new Date(),
                sentAt: new Date(),
                lastError: "SIMULAÇÃO — nenhum envio real foi realizado",
            },
        });
        return;
    }

    if (!campaign.templateName) {
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                lastError: "Template não configurado",
            },
        });
        return;
    }

    const cfg = await loadDatafyConfig();
    const phoneNumberId = cfg.phoneNumberId;
    if (!cfg.enabled || !cfg.channelToken || !phoneNumberId) {
        throw new DatafyApiError("Integração Datafy indisponível", 503);
    }

    const conversation = await ensureConversation(
        recipient.waId,
        recipient.fullName
    );

    const components = buildTemplateComponents(
        campaign.variableMapping as {
            body?: string[];
            header?: string[];
        } | null,
        {
            fullName: recipient.fullName,
            company: recipient.company,
            waId: recipient.waId,
        }
    );

    const preview = `Template: ${campaign.templateName}`;

    let messageId = existingMsg?.id;
    if (!messageId) {
        const pending = await prisma.datafyMessage.create({
            data: {
                conversationId: conversation.id,
                clientMessageId,
                direction: "outbound",
                type: "template",
                body: preview,
                status: "pending",
                metadata: {
                    campaignId: campaign.id,
                    campaignRecipientId: recipient.id,
                    templateName: campaign.templateName,
                    languageCode: campaign.templateLanguage || "pt_BR",
                    components: components as Prisma.InputJsonValue,
                } as Prisma.InputJsonValue,
            },
        });
        messageId = pending.id;
    }

    try {
        const client = await datafyProvider.createClient();
        const res = await client.sendTemplate(phoneNumberId, {
            to: normalizeWaId(recipient.waId),
            name: campaign.templateName,
            languageCode: campaign.templateLanguage || "pt_BR",
            components,
        });
        const wamid = res.messages?.[0]?.id || null;

        await prisma.datafyMessage.update({
            where: { id: messageId },
            data: {
                wamid,
                status: "accepted",
                providerTimestamp: new Date(),
            },
        });

        await prisma.datafyConversation.update({
            where: { id: conversation.id },
            data: {
                lastMessagePreview: preview.slice(0, 280),
                lastMessageAt: new Date(),
            },
        });

        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "accepted",
                clientMessageId,
                wamid,
                datafyMessageId: messageId,
                conversationId: conversation.id,
                acceptedAt: new Date(),
                sentAt: new Date(),
                lastError: null,
            },
        });
    } catch (e) {
        // Ambiguous failure after possible accept: do not auto-retry blindly
        const apiErr = e instanceof DatafyApiError ? e : null;
        const statusCode = apiErr?.statusCode || 0;
        const msg = redactSecrets(
            apiErr?.message ||
                (e instanceof Error ? e.message : "Falha no envio")
        ).slice(0, 240);

        if (statusCode === 429) {
            const retrySec = apiErr?.retryAfterSec || 30;
            await prisma.datafyCampaignRecipient.update({
                where: { id: recipient.id },
                data: {
                    status: "queued",
                    nextAttemptAt: new Date(Date.now() + retrySec * 1000),
                    lastError: msg,
                    errorCode: 429,
                },
            });
            await sleep(Math.min(retrySec * 1000, 60_000));
            return;
        }

        // Network / 5xx: mark unknown_after_send if we already created pending
        // and cannot confirm — avoid duplicate send on next tick
        if (!statusCode || statusCode >= 500) {
            await prisma.datafyMessage.update({
                where: { id: messageId },
                data: {
                    status: "failed",
                    failedAt: new Date(),
                    errorMessage: msg,
                    errorCode: statusCode || null,
                },
            });
            await prisma.datafyCampaignRecipient.update({
                where: { id: recipient.id },
                data: {
                    status: "unknown_after_send",
                    failedAt: new Date(),
                    lastError: msg,
                    errorCode: statusCode || null,
                    datafyMessageId: messageId,
                    conversationId: conversation.id,
                    clientMessageId,
                },
            });
            return;
        }

        await prisma.datafyMessage.update({
            where: { id: messageId },
            data: {
                status: "failed",
                failedAt: new Date(),
                errorMessage: msg,
                errorCode: statusCode,
            },
        });
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                lastError: msg,
                errorCode: statusCode,
                datafyMessageId: messageId,
                conversationId: conversation.id,
                clientMessageId,
            },
        });
    }
}

async function finalizeIfDone(campaignId: string) {
    const pending = await prisma.datafyCampaignRecipient.count({
        where: {
            campaignId,
            status: { in: ["pending", "queued", "sending"] },
        },
    });
    if (pending > 0) return;

    const failed = await prisma.datafyCampaignRecipient.count({
        where: {
            campaignId,
            status: { in: ["failed", "unknown_after_send"] },
        },
    });
    const camp = await prisma.datafyCampaign.findUnique({
        where: { id: campaignId },
    });
    if (!camp || !["running", "preparing"].includes(camp.status)) return;

    const to = failed > 0 ? "completed_with_errors" : "completed";
    if (canTransition(camp.status, to)) {
        await setStatus(campaignId, to, null, "Processamento concluído");
    }
    await refreshCounters(campaignId);
}

async function processCampaign(campaignId: string) {
    const locked = await tryLock(campaignId);
    if (!locked) return;

    try {
        let campaign = await prisma.datafyCampaign.findUnique({
            where: { id: campaignId },
        });
        if (!campaign) return;

        if (campaign.status === "preparing") {
            if (canTransition("preparing", "running")) {
                await setStatus(campaignId, "running", null, "Fila em execução");
            }
            campaign = await prisma.datafyCampaign.findUnique({
                where: { id: campaignId },
            });
        }
        if (!campaign || campaign.status !== "running") return;

        const now = new Date();
        const retryable = await prisma.datafyCampaignRecipient.findMany({
            where: {
                campaignId,
                status: { in: ["pending", "queued"] },
                OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
            },
            orderBy: { createdAt: "asc" },
            take: campaign.batchSize,
        });

        for (const r of retryable) {
            // Re-read status — may have been paused/cancelled
            const fresh = await prisma.datafyCampaign.findUnique({
                where: { id: campaignId },
                select: {
                    id: true,
                    status: true,
                    templateName: true,
                    templateLanguage: true,
                    variableMapping: true,
                    dryRun: true,
                    purpose: true,
                    requireConsent: true,
                    delayMs: true,
                },
            });
            if (!fresh || fresh.status !== "running") break;

            await sendOneRecipient(fresh, r.id);
            await refreshCounters(campaignId);

            const updated = await prisma.datafyCampaign.findUnique({
                where: { id: campaignId },
            });
            if (updated) {
                emitDatafyEvent("datafy.campaign.progress", {
                    campaignId,
                    status: updated.status,
                    totals: {
                        eligible: updated.totalEligible,
                        accepted: updated.totalAccepted,
                        delivered: updated.totalDelivered,
                        read: updated.totalRead,
                        failed: updated.totalFailed,
                        skipped: updated.totalSkipped,
                        cancelled: updated.totalCancelled,
                        queued: updated.totalQueued,
                    },
                    dryRun: updated.dryRun,
                });
            }

            await sleep(Math.max(500, fresh.delayMs));
        }

        await finalizeIfDone(campaignId);
    } catch (e) {
        const msg = redactSecrets(
            e instanceof Error ? e.message : "Erro no worker"
        ).slice(0, 240);
        await prisma.datafyCampaign.update({
            where: { id: campaignId },
            data: { lastError: msg },
        });
        await appendEvent({
            campaignId,
            type: "error",
            message: msg,
        });
        // Auth errors: pause for human review
        if (e instanceof DatafyApiError && [401, 403].includes(e.statusCode)) {
            try {
                await setStatus(
                    campaignId,
                    "paused",
                    null,
                    "Pausada por erro de autorização da API"
                );
            } catch {
                /* ignore */
            }
        }
    } finally {
        await unlock(campaignId);
    }
}

/** Promote due scheduled campaigns and process running ones. */
export async function tickDatafyCampaigns() {
    const due = await prisma.datafyCampaign.findMany({
        where: {
            organizationKey: CAMPAIGN_ORG_DEFAULT,
            channelId: DATAFY_OFFICIAL_CHANNEL_ID,
            status: "scheduled",
            scheduledAt: { lte: new Date() },
        },
        select: { id: true },
        take: 10,
    });

    for (const c of due) {
        try {
            await setStatus(c.id, "preparing", null, "Agendamento disparado");
        } catch {
            /* race */
        }
    }

    const active = await prisma.datafyCampaign.findMany({
        where: {
            organizationKey: CAMPAIGN_ORG_DEFAULT,
            channelId: DATAFY_OFFICIAL_CHANNEL_ID,
            status: { in: ["preparing", "running"] },
        },
        select: { id: true },
        take: 5,
        orderBy: { updatedAt: "asc" },
    });

    for (const c of active) {
        await processCampaign(c.id);
    }
}

export { WORKER_ID, refreshCounters };
