import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { loadDatafyConfig } from "@/modules/datafy/config";
import { datafyProvider } from "@/modules/datafy/provider";
import { DatafyApiError } from "@/modules/datafy/client";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";
import {
    isWithinServiceWindow,
    normalizeWaId,
} from "@/modules/datafy/chat/window";
import { emitDatafyEvent } from "@/modules/datafy/chat/realtime";
import {
    CAMPAIGN_LOCK_TTL_MS,
    CAMPAIGN_ORG_DEFAULT,
    canTransition,
} from "./constants";
import { appendEvent, setStatus } from "./service";
import { buildTemplateComponents } from "./variables";
import { evaluateEligibility } from "./eligibility";
import { partClientMessageId, resolveCampaignParts } from "./parts";
import {
    hasApprovedTemplateContent,
    purposeAllowsServiceWindowFreeform,
} from "./send-readiness";
import type { CampaignMessagePart } from "./bulletin/types";

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
        headerImageUrl?: string | null;
        messageBody?: string | null;
    },
    recipientId: string
) {
    const recipient = await prisma.datafyCampaignRecipient.findUnique({
        where: { id: recipientId },
    });
    if (!recipient) return;
    if (!["pending", "queued", "failed", "sending"].includes(recipient.status))
        return;
    if (
        recipient.status === "failed" &&
        recipient.attemptCount >= recipient.maxAttempts
    ) {
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
                simulationRelaxConsent: campaign.dryRun,
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
            status: { in: ["pending", "queued", "failed", "sending"] },
        },
        data: {
            status: "sending",
            attemptCount: { increment: 1 },
        },
    });
    if (claim.count === 0) return;

    const fullCampaign = await prisma.datafyCampaign.findUnique({
        where: { id: campaign.id },
    });
    if (!fullCampaign) return;

    const parts = resolveCampaignParts(fullCampaign);
    const legacyClientMessageId =
        recipient.clientMessageId ||
        `camp_${campaign.id}_${recipient.waId}`;

    if (campaign.dryRun) {
        const partState = {
            nextPartIndex: parts.length,
            parts: parts.map((p) => ({
                index: p.index,
                status: "accepted",
                clientMessageId: partClientMessageId(
                    campaign.id,
                    recipient.waId,
                    p.index
                ),
            })),
        };
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "accepted",
                clientMessageId:
                    partState.parts[0]?.clientMessageId ||
                    legacyClientMessageId,
                partStatuses: partState as Prisma.InputJsonValue,
                acceptedAt: new Date(),
                sentAt: new Date(),
                lastError: "SIMULAÇÃO — nenhum envio real foi realizado",
            },
        });
        return;
    }

    const hasTemplate = hasApprovedTemplateContent({
        contentKind: fullCampaign.contentKind,
        templateName: fullCampaign.templateName,
        templateApprovalStatus: fullCampaign.templateApprovalStatus,
        messageParts: parts,
    });
    const allowWindow =
        purposeAllowsServiceWindowFreeform(fullCampaign.purpose) &&
        Boolean((fullCampaign.messageBody || "").trim());

    if (!hasTemplate && !allowWindow) {
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                lastError:
                    "Sem template APPROVED e finalidade não permite resposta livre na janela 24h",
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

    if (!hasTemplate && allowWindow) {
        if (!isWithinServiceWindow(conversation.lastCustomerMessageAt)) {
            await prisma.datafyCampaignRecipient.update({
                where: { id: recipient.id },
                data: {
                    status: "skipped",
                    skipReason: "no_service_window",
                    lastError:
                        "Janela de atendimento fechada — destinatário precisa de template APPROVED",
                },
            });
            return;
        }
    }

    try {
        await sendPartsSequentially({
            campaign: fullCampaign,
            parts,
            recipient,
            conversationId: conversation.id,
            phoneNumberId,
            delayMs: campaign.delayMs,
            sendMode: hasTemplate ? "template" : "freeform",
            purpose: fullCampaign.purpose,
        });
    } catch (e) {
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

        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status:
                    !statusCode || statusCode >= 500
                        ? "unknown_after_send"
                        : "failed",
                failedAt: new Date(),
                lastError: msg,
                errorCode: statusCode || null,
                conversationId: conversation.id,
            },
        });
    }
}

type PartStatusEntry = {
    index: number;
    status: string;
    clientMessageId: string;
    wamid?: string | null;
    datafyMessageId?: string | null;
    lastError?: string | null;
};

async function sendPartsSequentially(opts: {
    campaign: {
        id: string;
        headerImageUrl: string | null;
        delayMs?: number;
        messageBody?: string | null;
    };
    parts: CampaignMessagePart[];
    recipient: {
        id: string;
        waId: string;
        fullName: string | null;
        company: string | null;
        partStatuses: unknown;
    };
    conversationId: string;
    phoneNumberId: string;
    delayMs: number;
    sendMode: "template" | "freeform";
    purpose: string;
}) {
    const { campaign, parts, recipient, conversationId, phoneNumberId } = opts;
    const prev = (recipient.partStatuses || {}) as {
        nextPartIndex?: number;
        parts?: PartStatusEntry[];
    };
    let nextIndex = prev.nextPartIndex || 0;
    const partEntries: PartStatusEntry[] = [...(prev.parts || [])];

    const client = await datafyProvider.createClient();

    for (let i = nextIndex; i < parts.length; i++) {
        const part = parts[i];
        const useTemplate =
            opts.sendMode === "template" && Boolean(part.templateName);

        if (!useTemplate && opts.sendMode === "template") {
            throw new DatafyApiError(
                `Parte ${i + 1} sem templateName`,
                400
            );
        }
        if (
            !useTemplate &&
            !purposeAllowsServiceWindowFreeform(opts.purpose)
        ) {
            throw new DatafyApiError(
                "Resposta livre na janela 24h não permitida para esta finalidade",
                400
            );
        }

        const cmid = partClientMessageId(
            campaign.id,
            recipient.waId,
            part.index
        );

        const existingMsg = await prisma.datafyMessage.findUnique({
            where: { clientMessageId: cmid },
        });
        if (existingMsg?.wamid) {
            partEntries[i] = {
                index: part.index,
                status: "accepted",
                clientMessageId: cmid,
                wamid: existingMsg.wamid,
                datafyMessageId: existingMsg.id,
            };
            nextIndex = i + 1;
            continue;
        }

        const freeformText = (
            part.bodyText ||
            campaign.messageBody ||
            ""
        ).trim();
        const preview = (useTemplate ? part.bodyText : freeformText).slice(
            0,
            280
        );

        let messageId = existingMsg?.id;
        let wamid: string | null = null;

        if (useTemplate && part.templateName) {
            const mapping =
                part.variableMapping &&
                Array.isArray(part.variableMapping.body) &&
                part.variableMapping.body.length
                    ? part.variableMapping
                    : { body: [] as string[] };

            const headerUrl =
                i === 0
                    ? part.headerImageUrl || campaign.headerImageUrl
                    : part.headerImageUrl || null;

            const components = buildTemplateComponents(
                mapping,
                {
                    fullName: recipient.fullName,
                    company: recipient.company,
                    waId: recipient.waId,
                },
                { headerImageUrl: headerUrl }
            );

            if (!messageId) {
                const pending = await prisma.datafyMessage.create({
                    data: {
                        conversationId,
                        clientMessageId: cmid,
                        direction: "outbound",
                        type: "template",
                        body: preview,
                        status: "pending",
                        metadata: {
                            campaignId: campaign.id,
                            campaignRecipientId: recipient.id,
                            templateName: part.templateName,
                            languageCode: part.templateLanguage || "pt_BR",
                            partIndex: part.index,
                            components: components as Prisma.InputJsonValue,
                        } as Prisma.InputJsonValue,
                    },
                });
                messageId = pending.id;
            }

            const res = await client.sendTemplate(phoneNumberId, {
                to: normalizeWaId(recipient.waId),
                name: part.templateName,
                languageCode: part.templateLanguage || "pt_BR",
                components,
            });
            wamid = res.messages?.[0]?.id || null;
        } else {
            if (!freeformText) {
                throw new DatafyApiError(
                    `Parte ${i + 1} sem texto para resposta livre`,
                    400
                );
            }
            if (!messageId) {
                const pending = await prisma.datafyMessage.create({
                    data: {
                        conversationId,
                        clientMessageId: cmid,
                        direction: "outbound",
                        type: "text",
                        body: preview,
                        status: "pending",
                        metadata: {
                            campaignId: campaign.id,
                            campaignRecipientId: recipient.id,
                            partIndex: part.index,
                            sendMode: "service_window_freeform",
                        } as Prisma.InputJsonValue,
                    },
                });
                messageId = pending.id;
            }

            const res = await client.sendText(phoneNumberId, {
                to: normalizeWaId(recipient.waId),
                text: freeformText.slice(0, 4096),
            });
            wamid = res.messages?.[0]?.id || null;
        }

        await prisma.datafyMessage.update({
            where: { id: messageId },
            data: {
                wamid,
                status: "accepted",
                providerTimestamp: new Date(),
            },
        });

        partEntries[i] = {
            index: part.index,
            status: "accepted",
            clientMessageId: cmid,
            wamid,
            datafyMessageId: messageId,
        };
        nextIndex = i + 1;

        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: nextIndex >= parts.length ? "accepted" : "sending",
                clientMessageId: partEntries[0]?.clientMessageId || cmid,
                wamid: wamid,
                datafyMessageId: messageId,
                conversationId,
                partStatuses: {
                    nextPartIndex: nextIndex,
                    parts: partEntries,
                } as Prisma.InputJsonValue,
                acceptedAt:
                    nextIndex >= parts.length ? new Date() : undefined,
                sentAt: new Date(),
                lastError: null,
            },
        });

        await prisma.datafyConversation.update({
            where: { id: conversationId },
            data: {
                lastMessagePreview: preview,
                lastMessageAt: new Date(),
            },
        });

        if (i < parts.length - 1 && opts.delayMs > 0) {
            await sleep(opts.delayMs);
        }
    }

    if (nextIndex >= parts.length) {
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "accepted",
                partStatuses: {
                    nextPartIndex: nextIndex,
                    parts: partEntries,
                } as Prisma.InputJsonValue,
                acceptedAt: new Date(),
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
                status: { in: ["pending", "queued", "sending"] },
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
                    headerImageUrl: true,
                    messageBody: true,
                    contentKind: true,
                    messageParts: true,
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
