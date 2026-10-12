import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { loadDatafyConfig } from "@/modules/datafy/config";
import { datafyProvider } from "@/modules/datafy/provider";
import { DatafyApiError } from "@/modules/datafy/client";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";
import {
    brazilianWaIdVariants,
    normalizeWaId,
} from "@/modules/datafy/chat/window";
import { normalizeBrazilianPhone } from "@/lib/phone-br";
import { emitDatafyEvent } from "@/modules/datafy/chat/realtime";
import {
    serializeConversation,
    serializeMessage,
} from "@/modules/datafy/chat/persist";
import {
    CAMPAIGN_LOCK_TTL_MS,
    CAMPAIGN_ORG_DEFAULT,
    canTransition,
} from "./constants";
import {
    appendEvent,
    assertCampaignRealSendAllowed,
    CampaignError,
    setStatus,
} from "./service";
import {
    buildTemplateComponents,
    renderCampaignFreeform,
    type CampaignVariableContext,
} from "./variables";
import { resolveSenderVariableFields } from "@/modules/crm/org-profile";
import {
    extractMetaErrorCode,
    formatMeta132000Message,
    isMeta132000Error,
    validateTemplateBodyParamCount,
} from "./template-params";
import {
    resolveBaileysSessionForDatafyNumber,
    sendBaileysCampaignText,
} from "./baileys-freeform";
import { evaluateEligibility } from "./eligibility";
import { partClientMessageId, resolveCampaignParts } from "./parts";
import {
    hasApprovedTemplateContent,
    META_INTERACTIVE_BODY_MAX,
    purposeAllowsServiceWindowFreeform,
    purposeUsesBaileysFreeform,
    recipientHasOpenServiceWindow,
    resolveRecipientSendMode,
} from "./send-readiness";
import {
    META_FREEFORM_TEXT_MAX,
    type CampaignMessagePart,
} from "./bulletin/types";
import {
    normalizeCampaignDelayMs,
} from "./pacing";
import {
    claimCampaignSendSlot,
    deferCampaignSendSlot,
    refreshCampaignLock,
} from "./pacing-store";

const WORKER_ID = `worker_${process.pid}_${randomUUID().slice(0, 8)}`;

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

/** Wait until campaign pacing slot is open, refreshing lock so TTL does not expire. */
async function waitForSendSlot(
    campaignId: string,
    delayMs: number
): Promise<boolean> {
    for (;;) {
        const camp = await prisma.datafyCampaign.findUnique({
            where: { id: campaignId },
            select: {
                status: true,
                nextSendEligibleAt: true,
            },
        });
        if (!camp || camp.status !== "running") return false;
        const now = Date.now();
        const eligibleAt = camp.nextSendEligibleAt?.getTime() ?? 0;
        const waitMs = Math.max(0, eligibleAt - now);
        if (waitMs <= 0) return true;
        await refreshCampaignLock(campaignId, WORKER_ID);
        await sleep(Math.min(waitMs, 5_000));
    }
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
    const keys = brazilianWaIdVariants(waId);
    const canonical = normalizeWaId(waId);
    if (keys.length) {
        const existing = await prisma.datafyConversation.findFirst({
            where: {
                channelId: DATAFY_OFFICIAL_CHANNEL_ID,
                waId: { in: keys },
            },
            orderBy: [{ lastCustomerMessageAt: "desc" }, { updatedAt: "desc" }],
        });
        if (existing) {
            return prisma.datafyConversation.update({
                where: { id: existing.id },
                data: {
                    contactName: contactName || undefined,
                },
            });
        }
    }
    return prisma.datafyConversation.upsert({
        where: {
            channelId_waId: {
                channelId: DATAFY_OFFICIAL_CHANNEL_ID,
                waId: canonical,
            },
        },
        create: {
            channelId: DATAFY_OFFICIAL_CHANNEL_ID,
            waId: canonical,
            contactName,
            status: "open",
        },
        update: {
            contactName: contactName || undefined,
        },
    });
}

async function sendRecipientViaBaileys(opts: {
    campaign: {
        id: string;
        delayMs: number;
        messageBody?: string | null;
    };
    recipient: {
        id: string;
        waId: string;
        fullName: string | null;
        company: string | null;
    };
    parts: CampaignMessagePart[];
}) {
    const { campaign, recipient, parts } = opts;
    let session: Awaited<ReturnType<typeof resolveBaileysSessionForDatafyNumber>>;
    try {
        session = await resolveBaileysSessionForDatafyNumber();
    } catch (e) {
        const msg = (
            e instanceof Error
                ? e.message
                : "WhatsApp conectado indisponível para Texto livre"
        ).slice(0, 500);
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                lastError: msg,
            },
        });
        return;
    }

    const toWaId =
        normalizeBrazilianPhone(recipient.waId) || normalizeWaId(recipient.waId);
    if (!toWaId || toWaId.length < 10) {
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                lastError: "Destinatário com telefone inválido",
            },
        });
        return;
    }

    const bodies = parts
        .map((p) => (p.bodyText || campaign.messageBody || "").trim())
        .filter(Boolean);
    const texts = bodies.length
        ? bodies
        : [(campaign.messageBody || "").trim()].filter(Boolean);
    if (!texts.length) {
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                lastError: "Texto livre sem conteúdo para enviar",
            },
        });
        return;
    }

    const conversation = await ensureConversation(toWaId, recipient.fullName);
    const sender = await resolveSenderVariableFields(CAMPAIGN_ORG_DEFAULT);
    const variableCtx: CampaignVariableContext = {
        recipient: {
            fullName: recipient.fullName,
            waProfileName: conversation.contactName,
            waId: toWaId,
            category: null,
        },
        sender,
    };

    try {
        let lastKey = "";
        for (let i = 0; i < texts.length; i++) {
            if (i > 0) {
                const delayMs = normalizeCampaignDelayMs(campaign.delayMs, {
                    allowLegacyBelowMin: true,
                });
                const ready = await waitForSendSlot(campaign.id, delayMs);
                if (!ready) return;
                const claimed = await claimCampaignSendSlot(campaign.id, {
                    delayMs,
                });
                if (!claimed.ok) return;
            }

            const text = renderCampaignFreeform(texts[i], variableCtx).trim();
            if (!text) continue;

            const { keyId } = await sendBaileysCampaignText(
                session.sessionId,
                toWaId,
                text
            );
            lastKey = keyId;
            const cmid = `camp_${campaign.id}_${toWaId}_b${i}`;
            const preview = text.slice(0, 280);
            const existing = await prisma.datafyMessage.findUnique({
                where: { clientMessageId: cmid },
            });
            const saved = existing
                ? await prisma.datafyMessage.update({
                      where: { id: existing.id },
                      data: {
                          wamid: keyId,
                          body: text,
                          status: "sent",
                          providerTimestamp: new Date(),
                      },
                  })
                : await prisma.datafyMessage.create({
                      data: {
                          conversationId: conversation.id,
                          clientMessageId: cmid,
                          wamid: keyId,
                          direction: "outbound",
                          type: "text",
                          body: text,
                          status: "sent",
                          providerTimestamp: new Date(),
                          metadata: {
                              campaignId: campaign.id,
                              campaignRecipientId: recipient.id,
                              partIndex: i,
                              transport: "baileys",
                              sessionId: session.sessionId,
                              senderPhone: session.phone,
                          } as Prisma.InputJsonValue,
                      },
                  });
            emitDatafyEvent("datafy.message", {
                conversationId: conversation.id,
                message: serializeMessage(saved),
            });

            const done = i === texts.length - 1;
            await prisma.datafyCampaignRecipient.update({
                where: { id: recipient.id },
                data: {
                    status: done ? "sent" : "sending",
                    waId: toWaId,
                    clientMessageId: `camp_${campaign.id}_${toWaId}_b0`,
                    wamid: keyId,
                    datafyMessageId: saved.id,
                    conversationId: conversation.id,
                    sentAt: new Date(),
                    acceptedAt: done ? new Date() : undefined,
                    lastError: null,
                    errorCode: null,
                },
            });

            const conv = await prisma.datafyConversation.update({
                where: { id: conversation.id },
                data: {
                    lastMessagePreview: preview,
                    lastMessageAt: new Date(),
                },
                include: {
                    assignedTo: {
                        select: { id: true, name: true, email: true },
                    },
                },
            });
            emitDatafyEvent("datafy.conversation", {
                conversation: serializeConversation(conv),
            });
        }

        if (!lastKey) {
            throw new Error("Texto livre ficou vazio depois das variáveis");
        }
    } catch (e) {
        const msg = (
            e instanceof Error ? e.message : "Falha no envio pelo WhatsApp conectado"
        ).slice(0, 500);
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                lastError: msg,
                conversationId: conversation.id,
            },
        });
    }
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
        interactiveButtons?: unknown;
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

    // Re-check eligibility before send.
    // Utilidade/Transacional: não bloqueia por consentimento (botões coletam depois).
    const purposeAllowsDirect = purposeAllowsServiceWindowFreeform(
        campaign.purpose
    );
    if (!purposeAllowsDirect) {
        const contact = recipient.crmContactId
            ? await prisma.crmContact.findUnique({
                  where: { id: recipient.crmContactId },
              })
            : await prisma.crmContact.findUnique({
                  where: {
                      organizationKey_waId: {
                          organizationKey: "default",
                          waId: recipient.waId,
                      },
                  },
              });
        if (contact) {
            const elig = evaluateEligibility(contact, {
                purpose: campaign.purpose,
                requireConsent: campaign.requireConsent,
                simulationRelaxConsent: campaign.dryRun,
            });
            if (!elig.ok) {
                const reason =
                    elig.reason === "opted_out" || elig.reason === "denied"
                        ? "consent_revoked_runtime"
                        : elig.reason;
                await prisma.datafyCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: {
                        status: "skipped",
                        skipReason: reason,
                        crmContactId: contact.id,
                    },
                });
                return;
            }
            if (!recipient.crmContactId) {
                await prisma.datafyCampaignRecipient.update({
                    where: { id: recipient.id },
                    data: { crmContactId: contact.id },
                });
            }
        } else if (
            campaign.requireConsent &&
            (campaign.purpose === "marketing" ||
                campaign.purpose === "other") &&
            !campaign.dryRun
        ) {
            await prisma.datafyCampaignRecipient.update({
                where: { id: recipient.id },
                data: {
                    status: "skipped",
                    skipReason: "not_in_crm",
                },
            });
            return;
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

    if (purposeUsesBaileysFreeform(fullCampaign.purpose)) {
        await sendRecipientViaBaileys({
            campaign: fullCampaign,
            recipient,
            parts,
        });
        return;
    }

    const hasTemplate = hasApprovedTemplateContent({
        contentKind: fullCampaign.contentKind,
        templateName: fullCampaign.templateName,
        templateApprovalStatus: fullCampaign.templateApprovalStatus,
        messageParts: parts,
    });
    const purposeAllowsFreeform = purposeAllowsServiceWindowFreeform(
        fullCampaign.purpose
    );
    // Boletim completo guarda o texto em messageParts; mensagem comum em messageBody.
    const hasFreeformBody = Boolean(
        (fullCampaign.messageBody || "").trim() ||
            parts.some((p) => Boolean((p.bodyText || "").trim()))
    );

    if (!hasTemplate && !(purposeAllowsFreeform && hasFreeformBody)) {
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                lastError:
                    "Sem texto livre (Utilidade/Transacional) e sem template APPROVED",
            },
        });
        return;
    }

    // Official Datafy Cloud number only — never Baileys session JIDs.
    const cfg = await loadDatafyConfig();
    const phoneNumberId = cfg.phoneNumberId?.trim() || null;
    if (!cfg.enabled || !cfg.channelToken || !phoneNumberId) {
        throw new DatafyApiError(
            "Integração Datafy indisponível: configure o phone_number_id do canal oficial antes de disparar.",
            503
        );
    }

    const conversation = await ensureConversation(
        recipient.waId,
        recipient.fullName
    );
    const senderFields = await resolveSenderVariableFields(
        CAMPAIGN_ORG_DEFAULT
    );
    const variableCtx: CampaignVariableContext = {
        recipient: {
            fullName: recipient.fullName,
            waProfileName: conversation.contactName,
            waId: normalizeBrazilianPhone(recipient.waId) || recipient.waId,
            category: null,
        },
        sender: senderFields,
    };

    // Texto livre fora da janela: a Datafy devolve HTTP 200 + wamid e a Meta
    // não entrega (131047). Não marcar isso como enviado.
    const windowOpen = await recipientHasOpenServiceWindow(recipient.waId);
    const recipientMode = resolveRecipientSendMode({
        hasApprovedTemplate: hasTemplate,
        purposeAllowsFreeform,
        hasFreeformBody,
        windowOpen,
    });

    if (recipientMode === "skip_no_window") {
        const closedWindow =
            purposeAllowsFreeform && hasFreeformBody && !windowOpen;
        await prisma.datafyCampaignRecipient.update({
            where: { id: recipient.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                errorCode: closedWindow ? 131047 : null,
                lastError: closedWindow
                    ? "A Meta não entrega texto livre com a janela de 24h fechada (erro 131047). A API aceita o envio e devolve um protocolo, mas o celular não recebe. Este contato nunca escreveu para o WhatsApp oficial. Envio real exige template APPROVED ou resposta do cliente nas últimas 24 horas."
                    : "Sem conteúdo enviável (texto livre na janela de 24h ou template APPROVED)",
            },
        });
        return;
    }

    try {
        await sendPartsSequentially({
            campaign: fullCampaign,
            parts,
            recipient,
            conversationId: conversation.id,
            phoneNumberId,
            delayMs: campaign.delayMs,
            sendMode: recipientMode,
            purpose: fullCampaign.purpose,
            variableCtx,
        });
    } catch (e) {
        const apiErr = e instanceof DatafyApiError ? e : null;
        const statusCode = apiErr?.statusCode || 0;
        const metaCode = extractMetaErrorCode(apiErr?.body) || null;
        let msg = redactSecrets(
            apiErr?.message ||
                (e instanceof Error ? e.message : "Falha no envio")
        ).slice(0, 400);
        if (
            isMeta132000Error({
                message: msg,
                body: apiErr?.body,
                errorCode: metaCode,
            })
        ) {
            msg = formatMeta132000Message({
                templateName: fullCampaign.templateName,
                language: fullCampaign.templateLanguage,
                apiMessage: msg,
            }).slice(0, 400);
        }

        if (statusCode === 429) {
            const retrySec = apiErr?.retryAfterSec || 30;
            const deferUntil = await deferCampaignSendSlot(campaign.id, {
                campaignDelayMs: campaign.delayMs,
                providerRetrySec: retrySec,
            });
            await prisma.datafyCampaignRecipient.update({
                where: { id: recipient.id },
                data: {
                    status: "queued",
                    nextAttemptAt: deferUntil,
                    lastError: msg,
                    errorCode: 429,
                },
            });
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
                errorCode: metaCode || statusCode || null,
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
        interactiveButtons?: unknown;
        templateName?: string | null;
        templateLanguage?: string | null;
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
    variableCtx: CampaignVariableContext;
}) {
    // Recipient-major: finish ALL parts for this recipient before the worker
    // moves to the next contact (processCampaign uses take:1 for multi-part).
    const parts = [...opts.parts].sort((a, b) => a.index - b.index);
    const {
        campaign,
        recipient,
        conversationId,
        phoneNumberId,
        variableCtx,
    } = opts;
    const prev = (recipient.partStatuses || {}) as {
        nextPartIndex?: number;
        parts?: PartStatusEntry[];
    };
    let nextIndex = prev.nextPartIndex || 0;
    const partEntries: PartStatusEntry[] = [...(prev.parts || [])];

    const client = await datafyProvider.createClient();

    for (let i = nextIndex; i < parts.length; i++) {
        const part = parts[i];
        const isLastPart = i >= parts.length - 1;
        const resolvedTemplateName =
            part.templateName || campaign.templateName || null;
        const resolvedTemplateLanguage =
            part.templateLanguage || campaign.templateLanguage || "pt_BR";
        const useTemplate =
            opts.sendMode === "template" && Boolean(resolvedTemplateName);

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

        const rawFreeform = (
            part.bodyText ||
            campaign.messageBody ||
            ""
        ).trim();
        // Always resolve {{fullName}}/{{company}}/{{city}}/{{state}} before send.
        // Emojis and UTF-8 are preserved by renderCampaignFreeform.
        const freeformText = renderCampaignFreeform(
            rawFreeform,
            variableCtx
        ).trim();
        const chatBody = (
            useTemplate
                ? renderCampaignFreeform(part.bodyText || "", variableCtx)
                : freeformText
        ).trim();
        const preview = chatBody.slice(0, 280);
        const toWaId =
            normalizeBrazilianPhone(recipient.waId) ||
            normalizeWaId(recipient.waId);
        if (!toWaId || toWaId.length < 10) {
            throw new DatafyApiError(
                `Destinatário com telefone inválido: ${recipient.waId}`,
                400
            );
        }

        let messageId = existingMsg?.id;
        let wamid: string | null = null;

        if (useTemplate && resolvedTemplateName) {
            const mapping =
                part.variableMapping &&
                Array.isArray(part.variableMapping.body) &&
                part.variableMapping.body.length
                    ? part.variableMapping
                    : { body: [] as string[] };

            const paramCheck = validateTemplateBodyParamCount({
                templateName: resolvedTemplateName,
                language: resolvedTemplateLanguage,
                bodyText: part.bodyText,
                templateComponents: part.templateComponents,
                variableMapping: mapping,
            });
            if (!paramCheck.ok) {
                throw new DatafyApiError(
                    formatMeta132000Message({
                        templateName: resolvedTemplateName,
                        language: resolvedTemplateLanguage,
                        expected: paramCheck.expected,
                        provided: paramCheck.provided,
                        apiMessage: paramCheck.message,
                    }),
                    400,
                    {
                        error: {
                            message: paramCheck.message || undefined,
                            code: 132000,
                            error_data: {
                                details: `expected=${paramCheck.expected};provided=${paramCheck.provided};part=${part.index}`,
                            },
                        },
                    }
                );
            }

            const headerUrl =
                i === 0
                    ? part.headerImageUrl || campaign.headerImageUrl
                    : part.headerImageUrl || null;

            const components = buildTemplateComponents(
                mapping,
                {
                    ...variableCtx,
                    recipient: {
                        ...variableCtx.recipient,
                        waId: toWaId,
                    },
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
                        body: chatBody || preview,
                        status: "pending",
                        metadata: {
                            campaignId: campaign.id,
                            campaignRecipientId: recipient.id,
                            templateName: resolvedTemplateName,
                            languageCode: resolvedTemplateLanguage,
                            partIndex: part.index,
                            expectedBodyParams: paramCheck.expected,
                            providedBodyParams: paramCheck.provided,
                            components: components as Prisma.InputJsonValue,
                        } as Prisma.InputJsonValue,
                    },
                });
                messageId = pending.id;
            }

            try {
                const res = await client.sendTemplate(phoneNumberId, {
                    to: toWaId,
                    name: resolvedTemplateName,
                    languageCode: resolvedTemplateLanguage,
                    components,
                });
                wamid = res.messages?.[0]?.id || null;
            } catch (sendErr) {
                if (
                    sendErr instanceof DatafyApiError &&
                    isMeta132000Error({
                        message: sendErr.message,
                        body: sendErr.body,
                        errorCode: extractMetaErrorCode(sendErr.body),
                    })
                ) {
                    throw new DatafyApiError(
                        formatMeta132000Message({
                            templateName: resolvedTemplateName,
                            language: resolvedTemplateLanguage,
                            expected: paramCheck.expected,
                            provided: paramCheck.provided,
                            apiMessage: sendErr.message,
                        }),
                        sendErr.statusCode || 400,
                        sendErr.body,
                        sendErr.retryAfterSec
                    );
                }
                throw sendErr;
            }
        } else {
            if (!freeformText) {
                throw new DatafyApiError(
                    `Parte ${i + 1} sem texto para resposta livre`,
                    400
                );
            }
            // Meta Cloud API free-form text max — never silently truncate
            if (freeformText.length > META_FREEFORM_TEXT_MAX) {
                throw new DatafyApiError(
                    `Texto livre excede ${META_FREEFORM_TEXT_MAX} caracteres (${freeformText.length}). Use boletim dividido ou reduza o conteúdo.`,
                    400
                );
            }

            const { parseCampaignConsentButtons, toInteractiveSendButtons } =
                await import("@/modules/crm/consent/campaign-buttons");
            const consentBtns = parseCampaignConsentButtons(
                (campaign as { interactiveButtons?: unknown })
                    .interactiveButtons
            );
            const placement = consentBtns.placement || "last_only";
            // Freeform consent buttons: only on the last part of the sequence
            // when placement is last_only (default for multi-template campaigns).
            const allowFreeformButtons =
                consentBtns.enabled &&
                (placement !== "last_only" || isLastPart);
            const interactiveButtons = allowFreeformButtons
                ? toInteractiveSendButtons(consentBtns)
                : [];
            const useInteractive = interactiveButtons.length > 0;
            // Utilidade/Transacional com botões: sempre texto completo + botões
            // num segundo balão (consentimento pós-recebimento).
            const detachedInteractive =
                useInteractive &&
                (purposeAllowsServiceWindowFreeform(opts.purpose) ||
                    freeformText.length > META_INTERACTIVE_BODY_MAX);

            if (!messageId) {
                const pending = await prisma.datafyMessage.create({
                    data: {
                        conversationId,
                        clientMessageId: cmid,
                        direction: "outbound",
                        type: "text",
                        body: chatBody || preview,
                        status: "pending",
                        metadata: {
                            campaignId: campaign.id,
                            campaignRecipientId: recipient.id,
                            partIndex: part.index,
                            to: toWaId,
                            sendMode: detachedInteractive
                                ? "service_window_freeform_plus_interactive"
                                : useInteractive
                                  ? "service_window_interactive"
                                  : "service_window_freeform",
                            interactiveButtons: useInteractive
                                ? interactiveButtons
                                : undefined,
                        } as Prisma.InputJsonValue,
                    },
                });
                messageId = pending.id;
            }

            async function sendTextTo(to: string) {
                return client.sendText(phoneNumberId, {
                    to,
                    text: freeformText,
                    previewUrl: /https?:\/\//i.test(freeformText),
                });
            }

            const tryTos = brazilianWaIdVariants(toWaId);
            let resText: Awaited<ReturnType<typeof sendTextTo>> | null = null;
            let deliveredTo = toWaId;
            let textError: unknown = null;
            for (const candidate of tryTos) {
                try {
                    resText = await sendTextTo(candidate);
                    if (resText.messages?.[0]?.id) {
                        deliveredTo = candidate;
                        break;
                    }
                } catch (err) {
                    textError = err;
                    resText = null;
                }
            }
            if (!resText?.messages?.[0]?.id) {
                if (textError) throw textError;
                throw new DatafyApiError(
                    `API Datafy não retornou wamid para ${toWaId}`,
                    502
                );
            }
            wamid = resText.messages[0].id;

            if (useInteractive) {
                const buttonBody = detachedInteractive
                    ? "Toque em uma opção para responder:"
                    : freeformText;
                try {
                    const resButtons = await client.sendInteractiveButtons(
                        phoneNumberId,
                        {
                            to: deliveredTo,
                            bodyText: buttonBody,
                            buttons: interactiveButtons,
                        }
                    );
                    const buttonWamid = resButtons.messages?.[0]?.id || null;
                    if (buttonWamid) {
                        const buttonMsg = await prisma.datafyMessage.create({
                            data: {
                                conversationId,
                                wamid: buttonWamid,
                                clientMessageId: `${cmid}_btns`,
                                direction: "outbound",
                                type: "interactive",
                                body: buttonBody,
                                status: "accepted",
                                providerTimestamp: new Date(),
                                metadata: {
                                    campaignId: campaign.id,
                                    campaignRecipientId: recipient.id,
                                    partIndex: part.index,
                                    buttons: interactiveButtons,
                                } as Prisma.InputJsonValue,
                            },
                        });
                        emitDatafyEvent("datafy.message", {
                            conversationId,
                            message: serializeMessage(buttonMsg),
                        });
                    }
                } catch {
                    // Texto já foi aceito — botões são opcionais pós-envio.
                }
            }

            // CTA URL (group invite) — separate interactive message (Meta cannot
            // mix reply + URL in one balloon). Uses tracked redirect URL.
            const { getEnabledUrlButton } = await import(
                "@/modules/crm/consent/campaign-buttons"
            );
            const urlBtn =
                allowFreeformButtons && consentBtns.enabled
                    ? getEnabledUrlButton(consentBtns)
                    : null;
            if (urlBtn) {
                try {
                    const { getPublicOrigin } = await import(
                        "@/lib/public-origin"
                    );
                    const {
                        signGroupInviteToken,
                        buildTrackedGroupInvitePath,
                    } = await import("@/modules/crm/group-invite/tracking");
                    const origin = getPublicOrigin(undefined, process.env);
                    const trackToken = signGroupInviteToken({
                        organizationKey: "default",
                        waId: toWaId,
                        campaignId: campaign.id,
                        recipientId: recipient.id,
                        inviteUrl: urlBtn.url,
                    });
                    const trackedUrl = `${origin.replace(/\/$/, "")}${buildTrackedGroupInvitePath(trackToken)}`;
                    const resCta = await client.sendCtaUrl(phoneNumberId, {
                        to: deliveredTo,
                        bodyText: "Acesse o grupo exclusivo da Bom Frete:",
                        displayText: urlBtn.title,
                        url: trackedUrl,
                    });
                    const ctaWamid = resCta.messages?.[0]?.id || null;
                    if (ctaWamid) {
                        const ctaMsg = await prisma.datafyMessage.create({
                            data: {
                                conversationId,
                                wamid: ctaWamid,
                                clientMessageId: `${cmid}_cta`,
                                direction: "outbound",
                                type: "interactive",
                                body: urlBtn.title,
                                status: "accepted",
                                providerTimestamp: new Date(),
                                metadata: {
                                    campaignId: campaign.id,
                                    campaignRecipientId: recipient.id,
                                    partIndex: part.index,
                                    ctaUrl: trackedUrl,
                                    inviteUrl: urlBtn.url,
                                } as Prisma.InputJsonValue,
                            },
                        });
                        emitDatafyEvent("datafy.message", {
                            conversationId,
                            message: serializeMessage(ctaMsg),
                        });
                    }
                } catch {
                    // Texto/respostas já aceitos — CTA opcional.
                }
            }
        }

        if (!wamid) {
            throw new DatafyApiError(
                `API Datafy aceitou sem wamid para ${toWaId}`,
                502
            );
        }

        const acceptedMsg = await prisma.datafyMessage.update({
            where: { id: messageId },
            data: {
                wamid,
                status: "accepted",
                providerTimestamp: new Date(),
                body: chatBody || undefined,
            },
        });
        emitDatafyEvent("datafy.message", {
            conversationId,
            message: serializeMessage(acceptedMsg),
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
                waId: toWaId,
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

        const conv = await prisma.datafyConversation.update({
            where: { id: conversationId },
            data: {
                lastMessagePreview: preview || chatBody.slice(0, 280),
                lastMessageAt: new Date(),
            },
            include: {
                assignedTo: {
                    select: { id: true, name: true, email: true },
                },
            },
        });
        emitDatafyEvent("datafy.conversation", {
            conversation: serializeConversation(conv),
        });

        if (i < parts.length - 1) {
            const delayMs = normalizeCampaignDelayMs(opts.delayMs, {
                allowLegacyBelowMin: true,
            });
            // Wait for the slot claimed before this part, then claim the next
            const ready = await waitForSendSlot(campaign.id, delayMs);
            if (!ready) break;
            const claimed = await claimCampaignSendSlot(campaign.id, {
                delayMs,
            });
            if (!claimed.ok) break;
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

        // Um start envia para todos os aptos da Etapa 2, não só o primeiro lote.
        let keepSending = true;
        let rounds = 0;
        while (keepSending && rounds < 20_000) {
            rounds++;
            const now = new Date();
            // Multi-template campaigns: process ONE recipient at a time so
            // T1→T2→T3 complete before the next contact (recipient-major order).
            const partCount = Array.isArray(campaign.messageParts)
                ? Math.max(1, (campaign.messageParts as unknown[]).length)
                : 1;
            const takeN =
                partCount > 1 ? 1 : Math.max(1, campaign.batchSize || 1);

            const retryable = await prisma.datafyCampaignRecipient.findMany({
                where: {
                    campaignId,
                    status: { in: ["pending", "queued", "sending"] },
                    OR: [
                        { nextAttemptAt: null },
                        { nextAttemptAt: { lte: now } },
                    ],
                },
                orderBy: { createdAt: "asc" },
                take: takeN,
            });
            if (!retryable.length) break;

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
                        interactiveButtons: true,
                        contentKind: true,
                        messageParts: true,
                    },
                });
                if (!fresh || fresh.status !== "running") {
                    keepSending = false;
                    break;
                }

                const delayMs = normalizeCampaignDelayMs(fresh.delayMs, {
                    allowLegacyBelowMin: true,
                });

                // Persistent pacing: do not start until nextSendEligibleAt
                const ready = await waitForSendSlot(campaignId, delayMs);
                if (!ready) {
                    keepSending = false;
                    break;
                }

                const slot = await claimCampaignSendSlot(campaignId, {
                    delayMs,
                });
                if (!slot.ok) {
                    keepSending = false;
                    break;
                }

                await refreshCampaignLock(campaignId, WORKER_ID);
                await sendOneRecipient({ ...fresh, delayMs }, r.id);
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
            }
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
            const camp = await prisma.datafyCampaign.findUnique({
                where: { id: c.id },
                select: { dryRun: true },
            });
            if (camp && !camp.dryRun) {
                try {
                    await assertCampaignRealSendAllowed(c.id);
                } catch (e) {
                    const msg =
                        e instanceof CampaignError
                            ? e.message
                            : "Agendamento bloqueado: sem autorização técnica";
                    await setStatus(
                        c.id,
                        "paused",
                        null,
                        `Agendamento pausado — ${msg}`
                    );
                    continue;
                }
            }
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

/** Kick one campaign immediately after start (real-time, same Datafy number). */
export async function kickDatafyCampaignNow(campaignId: string): Promise<void> {
    try {
        await processCampaign(campaignId);
    } catch {
        /* worker tick will retry */
    }
}

export { WORKER_ID, refreshCounters };
