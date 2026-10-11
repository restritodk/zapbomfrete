import type { Prisma } from "@prisma/client";
import { normalizeBrazilianPhone } from "@/lib/phone-br";
import { logger } from "@/lib/logger";
import {
    CONSENT_PURPOSE,
    CONSENT_SOURCE,
    CRM_ORG_DEFAULT,
    decisionToCrmStatus,
    type ConsentDecisionCode,
} from "./constants";
import { classifyConsentReply } from "./classify";
import { notifyConsentDecision } from "./notify";
import { consentDb } from "./db";

export type ApplyConsentInput = {
    organizationKey?: string;
    wabaId?: string | null;
    waId: string;
    purpose?: string;
    decision: ConsentDecisionCode;
    source: string;
    evidenceText?: string | null;
    evidencePayload?: Record<string, unknown> | null;
    buttonId?: string | null;
    buttonTitle?: string | null;
    relatedMessageId?: string | null;
    templateName?: string | null;
    requestVersion?: string | null;
    datafyEventId?: string | null;
    decidedAt?: Date;
    actorUserId?: string | null;
    idempotencyKey?: string | null;
    /** When true, create CRM contact (unknown→decision) if missing. */
    createContactIfMissing?: boolean;
};

export type ApplyConsentResult = {
    ok: boolean;
    duplicate?: boolean;
    stale?: boolean;
    applied: boolean;
    decisionId: string | null;
    crmContactId: string | null;
    resultingStatus: string | null;
    message?: string;
};

/**
 * Append immutable history and update current status only if decidedAt
 * is >= contact.consentAt (out-of-order safe).
 */
export async function applyConsentDecision(
    input: ApplyConsentInput
): Promise<ApplyConsentResult> {
    const organizationKey = input.organizationKey || CRM_ORG_DEFAULT;
    const waId = normalizeBrazilianPhone(input.waId);
    if (!waId || waId.length < 10) {
        return {
            ok: false,
            applied: false,
            decisionId: null,
            crmContactId: null,
            resultingStatus: null,
            message: "Telefone inválido",
        };
    }

    const db = consentDb();

    if (input.idempotencyKey) {
        const existing = await db.crmConsentDecision.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            select: { id: true, crmContactId: true, resultingStatus: true },
        });
        if (existing) {
            return {
                ok: true,
                duplicate: true,
                applied: false,
                decisionId: existing.id,
                crmContactId: existing.crmContactId,
                resultingStatus: existing.resultingStatus,
                message: "Evento já processado",
            };
        }
    }

    const decidedAt = input.decidedAt || new Date();
    const purpose = input.purpose || CONSENT_PURPOSE.MARKETING_OFFERS;
    const resultingStatus = decisionToCrmStatus(input.decision);
    const wabaId = String(input.wabaId || "").trim();

    let contact = await db.crmContact.findUnique({
        where: {
            organizationKey_waId: { organizationKey, waId },
        },
    });

    if (!contact && input.createContactIfMissing !== false) {
        contact = await db.crmContact.create({
            data: {
                organizationKey,
                waId,
                origin: "datafy_webhook",
                consentStatus: "unknown",
                consentPurpose: purpose,
            } as never,
        });
    }

    const previousAt = contact?.consentAt?.getTime() ?? 0;
    const isStale = Boolean(contact?.consentAt && decidedAt.getTime() < previousAt);

    let applied = false;
    if (contact && !isStale) {
        await db.crmContact.update({
            where: { id: contact.id },
            data: {
                consentStatus: resultingStatus,
                consentSource: input.source,
                consentAt: decidedAt,
                consentPurpose: purpose,
                consentWabaId: wabaId || (contact as { consentWabaId?: string | null }).consentWabaId,
                consentEvidence: input.evidenceText || null,
                optedOutAt:
                    resultingStatus === "opted_out" ? decidedAt : null,
                lastInteractionAt: new Date(),
                updatedById: input.actorUserId || undefined,
            } as never,
        });
        applied = true;
    }

    let decisionRow;
    try {
        decisionRow = await db.crmConsentDecision.create({
            data: {
                organizationKey,
                wabaId,
                crmContactId: contact?.id || null,
                waId,
                purpose,
                decision: input.decision,
                resultingStatus,
                source: input.source,
                evidenceText: input.evidenceText || null,
                evidencePayload: (input.evidencePayload ||
                    undefined) as Prisma.InputJsonValue | undefined,
                buttonId: input.buttonId || null,
                buttonTitle: input.buttonTitle || null,
                relatedMessageId: input.relatedMessageId || null,
                templateName: input.templateName || null,
                requestVersion: input.requestVersion || null,
                datafyEventId: input.datafyEventId || null,
                decidedAt,
                actorUserId: input.actorUserId || null,
                idempotencyKey: input.idempotencyKey || null,
                appliedToContact: applied,
            },
        });
    } catch (e: unknown) {
        const code = (e as { code?: string })?.code;
        if (code === "P2002" && input.idempotencyKey) {
            const dup = await db.crmConsentDecision.findUnique({
                where: { idempotencyKey: input.idempotencyKey },
            });
            return {
                ok: true,
                duplicate: true,
                applied: false,
                decisionId: dup?.id || null,
                crmContactId: dup?.crmContactId || null,
                resultingStatus: dup?.resultingStatus || null,
            };
        }
        throw e;
    }

    if (contact && applied) {
        await db.crmContact.update({
            where: { id: contact.id },
            data: { lastConsentDecisionId: decisionRow.id } as never,
        });
        try {
            await notifyConsentDecision({
                decision: input.decision,
                waId,
                fullName: contact.fullName,
                source: input.source,
            });
        } catch (err) {
            logger.warn(
                "Consent",
                `Notify failed: ${err instanceof Error ? err.message : "unknown"}`
            );
        }
    }

    return {
        ok: true,
        stale: isStale,
        applied,
        decisionId: decisionRow.id,
        crmContactId: contact?.id || null,
        resultingStatus: applied
            ? resultingStatus
            : contact?.consentStatus || resultingStatus,
        message: isStale
            ? "Evento antigo registrado no histórico sem alterar status atual"
            : undefined,
    };
}

/**
 * Process one inbound Datafy message for consent (button or keyword).
 */
export async function processInboundConsentMessage(opts: {
    waId: string;
    wabaId?: string | null;
    wamid?: string | null;
    messageType: string;
    body?: string | null;
    interactive?: Record<string, unknown> | null;
    timestamp?: Date;
    datafyEventId?: string | null;
}): Promise<ApplyConsentResult | null> {
    const waId = normalizeBrazilianPhone(opts.waId);
    if (!waId) return null;

    const contact = await consentDb().crmContact.findUnique({
        where: {
            organizationKey_waId: {
                organizationKey: CRM_ORG_DEFAULT,
                waId,
            },
        },
        select: { consentStatus: true },
    });

    let buttonId: string | null = null;
    let buttonTitle: string | null = null;
    const interactive = opts.interactive;
    if (opts.messageType === "interactive" && interactive) {
        const reply = (interactive.button_reply ||
            interactive.list_reply) as
            | { id?: string; title?: string }
            | undefined;
        buttonId = reply?.id || null;
        buttonTitle = reply?.title || null;
    }

    const classified = classifyConsentReply({
        buttonId,
        buttonTitle,
        textBody:
            opts.messageType === "text" || opts.messageType === "interactive"
                ? opts.body
                : null,
        previousStatus: contact?.consentStatus,
    });

    if (classified.kind === "none") return null;

    const source =
        classified.matchedBy === "keyword"
            ? CONSENT_SOURCE.KEYWORD_OPT_OUT
            : CONSENT_SOURCE.INTERACTIVE_BUTTON;

    const idem =
        opts.wamid
            ? `consent:${opts.wamid}:${buttonId || classified.decision}`
            : null;

    return applyConsentDecision({
        waId,
        wabaId: opts.wabaId,
        decision: classified.decision,
        source,
        evidenceText: buttonTitle || opts.body || classified.decision,
        evidencePayload: {
            buttonId,
            buttonTitle,
            messageType: opts.messageType,
            matchedBy: classified.matchedBy,
        },
        buttonId,
        buttonTitle,
        relatedMessageId: opts.wamid,
        datafyEventId: opts.datafyEventId,
        decidedAt: opts.timestamp || new Date(),
        idempotencyKey: idem,
        createContactIfMissing: true,
    });
}

export async function recordManualConsent(opts: {
    crmContactId: string;
    decision: "GRANTED" | "DENIED" | "REVOKED";
    evidenceText: string;
    actorUserId: string;
    wabaId?: string | null;
    purpose?: string;
}): Promise<ApplyConsentResult> {
    const evidence = opts.evidenceText.trim();
    if (evidence.length < 10) {
        return {
            ok: false,
            applied: false,
            decisionId: null,
            crmContactId: opts.crmContactId,
            resultingStatus: null,
            message:
                "Informe evidência válida (mín. 10 caracteres) para registro manual.",
        };
    }

    const contact = await consentDb().crmContact.findUnique({
        where: { id: opts.crmContactId },
    });
    if (!contact) {
        return {
            ok: false,
            applied: false,
            decisionId: null,
            crmContactId: null,
            resultingStatus: null,
            message: "Contato não encontrado",
        };
    }

    return applyConsentDecision({
        organizationKey: contact.organizationKey,
        waId: contact.waId,
        wabaId: opts.wabaId,
        purpose: opts.purpose || CONSENT_PURPOSE.MARKETING_OFFERS,
        decision: opts.decision,
        source: CONSENT_SOURCE.MANUAL_EVIDENCE,
        evidenceText: evidence,
        actorUserId: opts.actorUserId,
        decidedAt: new Date(),
        idempotencyKey: `manual:${contact.id}:${opts.decision}:${Date.now()}`,
        createContactIfMissing: false,
    });
}
