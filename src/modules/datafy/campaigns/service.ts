import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import {
    CAMPAIGN_ORG_DEFAULT,
    CAMPAIGN_PURPOSES,
    DEFAULT_CAMPAIGN_BATCH_SIZE,
    canTransition,
    type CampaignPurpose,
    type CampaignStatus,
} from "./constants";
import { normalizeCampaignDelayMs } from "./pacing";
import {
    isSyntheticContactId,
    previewRecipients,
    resolveSegmentContacts,
    type SegmentFilter,
} from "./recipients";
import {
    serializeCampaign,
    serializeEvent,
    serializeRecipient,
} from "./serialize";
import {
    assessRealSendReadiness,
    countOpenServiceWindows,
    hasApprovedTemplateContent,
} from "./send-readiness";

export class CampaignError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 400) {
        super(message);
        this.name = "CampaignError";
        this.statusCode = statusCode;
    }
}

async function appendEvent(opts: {
    campaignId: string;
    type: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    message?: string | null;
    meta?: Prisma.InputJsonValue;
    actorId?: string | null;
}) {
    await prisma.datafyCampaignEvent.create({
        data: {
            campaignId: opts.campaignId,
            type: opts.type,
            fromStatus: opts.fromStatus || null,
            toStatus: opts.toStatus || null,
            message: opts.message || null,
            meta: opts.meta,
            actorId: opts.actorId || null,
        },
    });
}

async function setStatus(
    id: string,
    to: CampaignStatus,
    actorId?: string | null,
    message?: string
) {
    const current = await prisma.datafyCampaign.findUnique({ where: { id } });
    if (!current) throw new CampaignError("Campanha não encontrada", 404);
    if (current.status === to) return current;
    if (!canTransition(current.status, to)) {
        throw new CampaignError(
            `Transição inválida: ${current.status} → ${to}`,
            409
        );
    }
    const data: Prisma.DatafyCampaignUpdateInput = { status: to };
    if (to === "running" || to === "preparing") {
        data.startedAt = current.startedAt || new Date();
        data.pausedAt = null;
    }
    if (to === "paused") data.pausedAt = new Date();
    if (to === "cancelled") data.cancelledAt = new Date();
    if (to === "completed" || to === "completed_with_errors" || to === "failed") {
        data.completedAt = new Date();
        data.lockedAt = null;
        data.lockedBy = null;
    }
    const updated = await prisma.datafyCampaign.update({
        where: { id },
        data,
        include: {
            createdBy: { select: { id: true, name: true, email: true } },
        },
    });
    await appendEvent({
        campaignId: id,
        type: "status_change",
        fromStatus: current.status,
        toStatus: to,
        message,
        actorId,
    });
    return updated;
}

export async function listCampaigns(opts: {
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
}) {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(100, Math.max(1, opts.limit || 20));
    const where: Prisma.DatafyCampaignWhereInput = {
        organizationKey: CAMPAIGN_ORG_DEFAULT,
        channelId: DATAFY_OFFICIAL_CHANNEL_ID,
    };
    if (opts.status) where.status = opts.status;
    if (opts.search?.trim()) {
        where.name = { contains: opts.search.trim(), mode: "insensitive" };
    }
    const [total, rows] = await Promise.all([
        prisma.datafyCampaign.count({ where }),
        prisma.datafyCampaign.findMany({
            where,
            include: {
                createdBy: { select: { id: true, name: true, email: true } },
                _count: { select: { recipients: true } },
            },
            orderBy: { createdAt: "desc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);
    return {
        campaigns: rows.map(serializeCampaign),
        meta: {
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

export async function getCampaignStats() {
    const org = {
        organizationKey: CAMPAIGN_ORG_DEFAULT,
        channelId: DATAFY_OFFICIAL_CHANNEL_ID,
    };
    const rows = await prisma.datafyCampaign.groupBy({
        by: ["status"],
        where: org,
        _count: { _all: true },
        _sum: {
            totalEligible: true,
            totalAccepted: true,
            totalDelivered: true,
            totalRead: true,
            totalFailed: true,
            totalExcluded: true,
        },
    });

    const byStatus: Record<string, number> = {};
    let totalEligible = 0;
    let totalAccepted = 0;
    let totalDelivered = 0;
    let totalRead = 0;
    let totalFailed = 0;
    let totalExcluded = 0;
    let created = 0;

    for (const r of rows) {
        byStatus[r.status] = r._count._all;
        created += r._count._all;
        totalEligible += r._sum.totalEligible || 0;
        totalAccepted += r._sum.totalAccepted || 0;
        totalDelivered += r._sum.totalDelivered || 0;
        totalRead += r._sum.totalRead || 0;
        totalFailed += r._sum.totalFailed || 0;
        totalExcluded += r._sum.totalExcluded || 0;
    }

    return {
        created,
        scheduled: byStatus.scheduled || 0,
        running: (byStatus.running || 0) + (byStatus.preparing || 0),
        paused: byStatus.paused || 0,
        completed:
            (byStatus.completed || 0) + (byStatus.completed_with_errors || 0),
        cancelled: byStatus.cancelled || 0,
        failed: byStatus.failed || 0,
        totalEligible,
        totalAccepted,
        totalDelivered,
        totalRead,
        totalFailed,
        totalExcluded,
        byStatus,
    };
}

export async function getCampaign(id: string) {
    const c = await prisma.datafyCampaign.findFirst({
        where: {
            id,
            organizationKey: CAMPAIGN_ORG_DEFAULT,
            channelId: DATAFY_OFFICIAL_CHANNEL_ID,
        },
        include: {
            createdBy: { select: { id: true, name: true, email: true } },
            events: { orderBy: { createdAt: "desc" }, take: 50 },
            _count: { select: { recipients: true } },
        },
    });
    if (!c) throw new CampaignError("Campanha não encontrada", 404);
    return {
        campaign: serializeCampaign(c),
        events: c.events.map(serializeEvent),
    };
}

export async function listCampaignRecipients(
    id: string,
    opts: { status?: string; page?: number; limit?: number }
) {
    await getCampaign(id);
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(200, Math.max(1, opts.limit || 50));
    const where: Prisma.DatafyCampaignRecipientWhereInput = {
        campaignId: id,
    };
    if (opts.status) where.status = opts.status;
    const [total, rows] = await Promise.all([
        prisma.datafyCampaignRecipient.count({ where }),
        prisma.datafyCampaignRecipient.findMany({
            where,
            orderBy: { createdAt: "asc" },
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);
    return {
        recipients: rows.map(serializeRecipient),
        meta: {
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

export type CreateCampaignInput = {
    name: string;
    description?: string | null;
    purpose?: string;
    templateName?: string | null;
    templateLanguage?: string | null;
    templateCategory?: string | null;
    templateComponents?: unknown;
    templateApprovalStatus?: string | null;
    contentSource?: string;
    contentKind?: string;
    messageBody?: string | null;
    messageParts?: unknown;
    bulletinMeta?: unknown;
    headerImageUrl?: string | null;
    headerImageHandle?: string | null;
    variableMapping?: unknown;
    segmentFilter?: SegmentFilter | null;
    timezone?: string;
    scheduledAt?: string | null;
    delayMs?: number;
    batchSize?: number;
    dryRun?: boolean;
    requireConsent?: boolean;
};

export async function createCampaign(
    input: CreateCampaignInput,
    userId: string
) {
    const name = input.name?.trim();
    if (!name) throw new CampaignError("Nome da campanha é obrigatório");
    const purpose = (input.purpose || "marketing") as CampaignPurpose;
    if (!CAMPAIGN_PURPOSES.includes(purpose)) {
        throw new CampaignError("Finalidade inválida");
    }

    const scheduledAt = input.scheduledAt
        ? new Date(input.scheduledAt)
        : null;
    if (scheduledAt && Number.isNaN(scheduledAt.getTime())) {
        throw new CampaignError("Data de agendamento inválida");
    }
    if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) {
        throw new CampaignError("Agendamento deve ser no futuro");
    }

    const status: CampaignStatus = scheduledAt ? "scheduled" : "draft";

    const created = await prisma.datafyCampaign.create({
        data: {
            organizationKey: CAMPAIGN_ORG_DEFAULT,
            channelId: DATAFY_OFFICIAL_CHANNEL_ID,
            name,
            description: input.description?.trim() || null,
            purpose,
            status,
            templateName: input.templateName || null,
            templateLanguage: input.templateLanguage || "pt_BR",
            templateCategory: input.templateCategory || null,
            templateComponents:
                input.templateComponents === undefined
                    ? undefined
                    : (input.templateComponents as Prisma.InputJsonValue),
            templateApprovalStatus: input.templateApprovalStatus || null,
            contentSource: input.contentSource || "existing_template",
            contentKind:
                input.contentKind === "bulletin" ? "bulletin" : "message",
            messageBody: input.messageBody?.trim() || null,
            messageParts:
                input.messageParts === undefined
                    ? undefined
                    : (input.messageParts as Prisma.InputJsonValue),
            bulletinMeta:
                input.bulletinMeta === undefined
                    ? undefined
                    : (input.bulletinMeta as Prisma.InputJsonValue),
            headerImageUrl: input.headerImageUrl || null,
            headerImageHandle: input.headerImageHandle || null,
            variableMapping:
                input.variableMapping === undefined
                    ? undefined
                    : (input.variableMapping as Prisma.InputJsonValue),
            segmentFilter:
                input.segmentFilter === undefined || input.segmentFilter === null
                    ? undefined
                    : (input.segmentFilter as Prisma.InputJsonValue),
            timezone: input.timezone || "America/Sao_Paulo",
            scheduledAt,
            delayMs: normalizeCampaignDelayMs(
                input.delayMs,
                { allowLegacyBelowMin: true }
            ),
            batchSize: Math.max(
                1,
                Math.min(50, input.batchSize ?? DEFAULT_CAMPAIGN_BATCH_SIZE)
            ),
            dryRun: Boolean(input.dryRun),
            requireConsent: input.requireConsent !== false,
            createdById: userId,
        },
        include: {
            createdBy: { select: { id: true, name: true, email: true } },
        },
    });

    await appendEvent({
        campaignId: created.id,
        type: "status_change",
        toStatus: status,
        message: "Campanha criada",
        actorId: userId,
    });

    if (input.segmentFilter) {
        const dryRun = Boolean(input.dryRun);
        await materializeRecipients(created.id, input.segmentFilter, {
            purpose,
            requireConsent: input.requireConsent !== false,
            // Dry-run may include valid phones without marketing consent; never authorizes real send
            simulationRelaxConsent: dryRun,
        });
    }

    // Real send (immediate or scheduled): enforce modalities A/B/C on the server
    if (!input.dryRun) {
        try {
            await assertCampaignRealSendAllowed(created.id);
        } catch (e) {
            await prisma.datafyCampaignRecipient.deleteMany({
                where: { campaignId: created.id },
            });
            await prisma.datafyCampaignEvent.deleteMany({
                where: { campaignId: created.id },
            });
            await prisma.datafyCampaign.delete({ where: { id: created.id } });
            throw e;
        }
    }

    return serializeCampaign(
        await prisma.datafyCampaign.findUniqueOrThrow({
            where: { id: created.id },
            include: {
                createdBy: { select: { id: true, name: true, email: true } },
                _count: { select: { recipients: true } },
            },
        })
    );
}

export async function updateCampaign(
    id: string,
    input: Partial<CreateCampaignInput>,
    userId: string
) {
    const current = await prisma.datafyCampaign.findFirst({
        where: {
            id,
            organizationKey: CAMPAIGN_ORG_DEFAULT,
        },
    });
    if (!current) throw new CampaignError("Campanha não encontrada", 404);
    if (!["draft", "scheduled"].includes(current.status)) {
        throw new CampaignError(
            "Somente rascunhos ou campanhas agendadas podem ser editadas",
            409
        );
    }

    const data: Prisma.DatafyCampaignUpdateInput = {};
    if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name) throw new CampaignError("Nome inválido");
        data.name = name;
    }
    if (input.description !== undefined) {
        data.description = input.description?.trim() || null;
    }
    if (input.purpose !== undefined) {
        if (!CAMPAIGN_PURPOSES.includes(input.purpose as CampaignPurpose)) {
            throw new CampaignError("Finalidade inválida");
        }
        data.purpose = input.purpose;
    }
    if (input.templateName !== undefined) data.templateName = input.templateName;
    if (input.templateLanguage !== undefined) {
        data.templateLanguage = input.templateLanguage;
    }
    if (input.templateCategory !== undefined) {
        data.templateCategory = input.templateCategory;
    }
    if (input.templateComponents !== undefined) {
        data.templateComponents =
            input.templateComponents as Prisma.InputJsonValue;
    }
    if (input.templateApprovalStatus !== undefined) {
        data.templateApprovalStatus = input.templateApprovalStatus;
    }
    if (input.contentSource !== undefined) data.contentSource = input.contentSource;
    if (input.messageBody !== undefined) {
        data.messageBody = input.messageBody?.trim() || null;
    }
    if (input.headerImageUrl !== undefined) {
        data.headerImageUrl = input.headerImageUrl || null;
    }
    if (input.headerImageHandle !== undefined) {
        data.headerImageHandle = input.headerImageHandle || null;
    }
    if (input.variableMapping !== undefined) {
        data.variableMapping = input.variableMapping as Prisma.InputJsonValue;
    }
    if (input.timezone !== undefined) data.timezone = input.timezone;
    if (input.delayMs !== undefined) {
        data.delayMs = normalizeCampaignDelayMs(input.delayMs, {
            allowLegacyBelowMin: true,
        });
    }
    if (input.batchSize !== undefined) {
        data.batchSize = Math.max(1, Math.min(50, input.batchSize));
    }
    if (input.dryRun !== undefined) data.dryRun = Boolean(input.dryRun);
    if (input.requireConsent !== undefined) {
        data.requireConsent = Boolean(input.requireConsent);
    }
    if (input.scheduledAt !== undefined) {
        if (input.scheduledAt === null || input.scheduledAt === "") {
            data.scheduledAt = null;
            if (current.status === "scheduled") data.status = "draft";
        } else {
            const d = new Date(input.scheduledAt);
            if (Number.isNaN(d.getTime())) {
                throw new CampaignError("Data de agendamento inválida");
            }
            data.scheduledAt = d;
            data.status = "scheduled";
        }
    }
    if (input.segmentFilter !== undefined) {
        data.segmentFilter =
            (input.segmentFilter as Prisma.InputJsonValue) || Prisma.JsonNull;
    }

    await prisma.datafyCampaign.update({ where: { id }, data });

    if (input.segmentFilter) {
        const nextDryRun =
            input.dryRun !== undefined ? Boolean(input.dryRun) : current.dryRun;
        await materializeRecipients(id, input.segmentFilter, {
            purpose: (input.purpose || current.purpose) as string,
            requireConsent:
                input.requireConsent !== undefined
                    ? Boolean(input.requireConsent)
                    : current.requireConsent,
            simulationRelaxConsent: nextDryRun,
        });
    }

    await appendEvent({
        campaignId: id,
        type: "note",
        message: "Campanha atualizada",
        actorId: userId,
    });

    return (await getCampaign(id)).campaign;
}

export async function previewCampaignAudience(
    filter: SegmentFilter,
    opts: {
        purpose: string;
        requireConsent: boolean;
        simulationRelaxConsent?: boolean;
    }
) {
    const contacts = await resolveSegmentContacts(filter);
    const preview = previewRecipients(contacts, opts);
    const windows = await countOpenServiceWindows(
        preview.eligibleAll.map((c) => c.waId)
    );
    return {
        selected: preview.selected,
        eligibleCount: preview.eligibleCount,
        excludedCount: preview.excludedCount,
        exclusionBreakdown: preview.exclusionBreakdown,
        simulationEligibleCount: preview.simulationEligibleCount,
        openWindowCount: windows.openWindowCount,
        needsTemplateCount: windows.needsTemplateCount,
        eligiblePreview: preview.eligible.map((c) => ({
            id: c.id,
            waId: c.waId,
            fullName: c.fullName,
            company: c.company,
            city: c.city,
            state: c.state,
            consentStatus: c.consentStatus,
        })),
        excludedPreview: preview.excluded.map((e) => ({
            contactId: e.contactId,
            waId: e.waId,
            fullName: e.fullName,
            reason: e.reason,
        })),
    };
}

export async function materializeRecipients(
    campaignId: string,
    filter: SegmentFilter,
    opts: {
        purpose: string;
        requireConsent: boolean;
        simulationRelaxConsent?: boolean;
    }
) {
    const contacts = await resolveSegmentContacts(filter);
    const preview = previewRecipients(contacts, opts);

    await prisma.datafyCampaignRecipient.deleteMany({
        where: { campaignId },
    });

    if (preview.eligibleAll.length) {
        await prisma.datafyCampaignRecipient.createMany({
            data: preview.eligibleAll.map((c) => ({
                campaignId,
                crmContactId: isSyntheticContactId(c.id) ? null : c.id,
                waId: c.waId,
                fullName: c.fullName,
                company: c.company,
                status: "pending",
                clientMessageId: `camp_${campaignId}_${c.waId}`,
            })),
            skipDuplicates: true,
        });
    }

    if (preview.excludedAll.length) {
        const eligibleSet = new Set(preview.eligibleAll.map((e) => e.waId));
        const skipped = preview.excludedAll.filter(
            (e) => e.waId && !eligibleSet.has(e.waId.replace(/\D/g, ""))
        );
        const byWa = new Map<string, (typeof skipped)[0]>();
        for (const s of skipped) {
            const wa = s.waId.replace(/\D/g, "");
            if (!wa || eligibleSet.has(wa) || byWa.has(wa)) continue;
            byWa.set(wa, s);
        }
        if (byWa.size) {
            await prisma.datafyCampaignRecipient.createMany({
                data: Array.from(byWa.values()).map((s) => ({
                    campaignId,
                    crmContactId: isSyntheticContactId(s.contactId)
                        ? null
                        : s.contactId,
                    waId: s.waId.replace(/\D/g, "") || s.waId,
                    fullName: s.fullName,
                    status: "skipped",
                    skipReason: s.reason,
                })),
                skipDuplicates: true,
            });
        }
    }

    const camp = await prisma.datafyCampaign.findUnique({
        where: { id: campaignId },
        select: { messageParts: true, contentKind: true },
    });
    const partCount = Array.isArray(camp?.messageParts)
        ? Math.max(1, (camp?.messageParts as unknown[]).length)
        : 1;

    await prisma.datafyCampaign.update({
        where: { id: campaignId },
        data: {
            segmentFilter: filter as Prisma.InputJsonValue,
            totalSelected: preview.selected,
            totalEligible: preview.eligibleCount,
            totalExcluded: preview.excludedCount,
            totalSkipped: preview.excludedCount,
            totalQueued: preview.eligibleCount * partCount,
        },
    });

    return preview;
}

/**
 * Server-side gate for real sends (modalities A/B/C).
 * Used by start, schedule, create(scheduled) and worker promotion.
 */
export async function assertCampaignRealSendAllowed(campaignId: string) {
    const c = await prisma.datafyCampaign.findFirst({
        where: { id: campaignId, organizationKey: CAMPAIGN_ORG_DEFAULT },
    });
    if (!c) throw new CampaignError("Campanha não encontrada", 404);
    if (c.dryRun) return;

    const parts = Array.isArray(c.messageParts)
        ? (c.messageParts as Array<{
              templateName?: string | null;
              templateApprovalStatus?: string | null;
              readyForRealSend?: boolean;
          }>)
        : [];
    const hasTemplate = hasApprovedTemplateContent({
        contentKind: c.contentKind,
        templateName: c.templateName,
        templateApprovalStatus: c.templateApprovalStatus,
        messageParts: parts,
    });
    const recipients = await prisma.datafyCampaignRecipient.findMany({
        where: {
            campaignId,
            status: { in: ["pending", "queued"] },
        },
        select: { waId: true },
        take: 20_000,
    });
    const windows = await countOpenServiceWindows(
        recipients.map((r) => r.waId)
    );
    const assessment = assessRealSendReadiness({
        purpose: c.purpose,
        consentEligibleCount: Math.max(c.totalEligible, recipients.length),
        openWindowCount: windows.openWindowCount,
        hasApprovedTemplate: hasTemplate,
        hasFreeformBody: Boolean(c.messageBody?.trim()),
    });
    if (!assessment.realSendReady) {
        throw new CampaignError(
            assessment.blockReason ||
                "Envio real bloqueado: sem template APPROVED nem janela de atendimento válida.",
            400
        );
    }
    if (c.totalEligible <= 0 && recipients.length <= 0) {
        throw new CampaignError("Nenhum destinatário elegível", 400);
    }
}

export async function startCampaign(
    id: string,
    userId: string,
    opts?: { confirm?: boolean; dryRun?: boolean }
) {
    if (!opts?.confirm) {
        throw new CampaignError(
            "Confirmação explícita obrigatória para iniciar a campanha",
            400
        );
    }
    const c = await prisma.datafyCampaign.findFirst({
        where: { id, organizationKey: CAMPAIGN_ORG_DEFAULT },
    });
    if (!c) throw new CampaignError("Campanha não encontrada", 404);
    const isDry = Boolean(opts?.dryRun || c.dryRun);

    if (!isDry) {
        await assertCampaignRealSendAllowed(id);
    } else if (
        c.contentKind !== "bulletin" &&
        !c.templateName &&
        !c.messageBody?.trim()
    ) {
        throw new CampaignError(
            "Informe um template ou texto da mensagem para simular",
            400
        );
    }
    if (c.totalEligible <= 0 && !isDry) {
        throw new CampaignError("Nenhum destinatário elegível", 400);
    }
    if (c.totalEligible <= 0 && isDry) {
        throw new CampaignError(
            "Nenhum destinatário para simulação",
            400
        );
    }
    if (opts.dryRun !== undefined) {
        await prisma.datafyCampaign.update({
            where: { id },
            data: { dryRun: Boolean(opts.dryRun) },
        });
    }

    const next =
        c.status === "paused"
            ? "running"
            : c.status === "draft" || c.status === "scheduled"
              ? "preparing"
              : null;
    if (!next) {
        throw new CampaignError(
            `Não é possível iniciar campanha em estado ${c.status}`,
            409
        );
    }

    const updated = await setStatus(
        id,
        next,
        userId,
        opts?.dryRun || c.dryRun
            ? "Início em modo simulação (sem envio real)"
            : "Campanha iniciada"
    );
    return serializeCampaign(updated);
}

export async function scheduleCampaign(
    id: string,
    scheduledAt: string,
    userId: string
) {
    const d = new Date(scheduledAt);
    if (Number.isNaN(d.getTime()) || d.getTime() <= Date.now()) {
        throw new CampaignError("Agendamento deve ser no futuro");
    }
    const c = await prisma.datafyCampaign.findFirst({
        where: { id, organizationKey: CAMPAIGN_ORG_DEFAULT },
    });
    if (!c) throw new CampaignError("Campanha não encontrada", 404);
    if (!["draft", "scheduled"].includes(c.status)) {
        throw new CampaignError("Campanha não pode ser agendada neste estado", 409);
    }
    if (c.totalEligible <= 0) {
        throw new CampaignError("Nenhum destinatário elegível", 400);
    }
    if (!c.dryRun) {
        await assertCampaignRealSendAllowed(id);
    }
    await prisma.datafyCampaign.update({
        where: { id },
        data: { scheduledAt: d, status: "scheduled" },
    });
    await appendEvent({
        campaignId: id,
        type: "status_change",
        fromStatus: c.status,
        toStatus: "scheduled",
        message: `Agendada para ${d.toISOString()}`,
        actorId: userId,
    });
    return (await getCampaign(id)).campaign;
}

export async function pauseCampaign(id: string, userId: string) {
    const updated = await setStatus(id, "paused", userId, "Campanha pausada");
    return serializeCampaign(updated);
}

export async function resumeCampaign(id: string, userId: string) {
    const updated = await setStatus(id, "running", userId, "Campanha retomada");
    return serializeCampaign(updated);
}

export async function cancelCampaign(id: string, userId: string) {
    const c = await prisma.datafyCampaign.findFirst({
        where: { id, organizationKey: CAMPAIGN_ORG_DEFAULT },
    });
    if (!c) throw new CampaignError("Campanha não encontrada", 404);
    if (
        ["completed", "completed_with_errors", "cancelled"].includes(c.status)
    ) {
        throw new CampaignError("Campanha já finalizada", 409);
    }
    await prisma.datafyCampaignRecipient.updateMany({
        where: {
            campaignId: id,
            status: { in: ["pending", "queued"] },
        },
        data: { status: "cancelled" },
    });
    const cancelled = await prisma.datafyCampaignRecipient.count({
        where: { campaignId: id, status: "cancelled" },
    });
    await prisma.datafyCampaign.update({
        where: { id },
        data: { totalCancelled: cancelled },
    });
    const updated = await setStatus(id, "cancelled", userId, "Campanha cancelada");
    return serializeCampaign(updated);
}

export async function duplicateCampaign(id: string, userId: string) {
    const src = await prisma.datafyCampaign.findFirst({
        where: { id, organizationKey: CAMPAIGN_ORG_DEFAULT },
    });
    if (!src) throw new CampaignError("Campanha não encontrada", 404);

    const created = await createCampaign(
        {
            name: `${src.name} (cópia)`,
            description: src.description,
            purpose: src.purpose,
            templateName: src.templateName,
            templateLanguage: src.templateLanguage,
            templateCategory: src.templateCategory,
            templateComponents: src.templateComponents ?? undefined,
            templateApprovalStatus: src.templateApprovalStatus,
            contentSource: src.contentSource,
            messageBody: src.messageBody,
            headerImageUrl: src.headerImageUrl,
            headerImageHandle: src.headerImageHandle,
            variableMapping: src.variableMapping ?? undefined,
            segmentFilter: (src.segmentFilter as SegmentFilter) || null,
            timezone: src.timezone,
            delayMs: src.delayMs,
            batchSize: src.batchSize,
            dryRun: src.dryRun,
            requireConsent: src.requireConsent,
        },
        userId
    );
    return created;
}

export async function exportCampaignCsv(id: string): Promise<string> {
    await getCampaign(id);
    const rows = await prisma.datafyCampaignRecipient.findMany({
        where: { campaignId: id },
        orderBy: { waId: "asc" },
    });
    const header = [
        "waId",
        "fullName",
        "company",
        "status",
        "skipReason",
        "wamid",
        "attemptCount",
        "lastError",
        "sentAt",
        "deliveredAt",
        "readAt",
    ].join(",");
    const esc = (v: string | null | undefined) => {
        const s = String(v ?? "");
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };
    const lines = rows.map((r) =>
        [
            r.waId,
            r.fullName,
            r.company,
            r.status,
            r.skipReason,
            r.wamid,
            String(r.attemptCount),
            r.lastError,
            r.sentAt?.toISOString() ?? "",
            r.deliveredAt?.toISOString() ?? "",
            r.readAt?.toISOString() ?? "",
        ]
            .map(esc)
            .join(",")
    );
    return [header, ...lines].join("\n");
}

export { setStatus, appendEvent };
