import type {
    DatafyCampaign,
    DatafyCampaignEvent,
    DatafyCampaignRecipient,
    User,
} from "@prisma/client";

type CampaignWithMeta = DatafyCampaign & {
    createdBy?: Pick<User, "id" | "name" | "email"> | null;
    _count?: { recipients?: number };
};

export function serializeCampaign(c: CampaignWithMeta) {
    return {
        id: c.id,
        organizationKey: c.organizationKey,
        channelId: c.channelId,
        name: c.name,
        description: c.description,
        purpose: c.purpose,
        status: c.status,
        templateName: c.templateName,
        templateLanguage: c.templateLanguage,
        templateCategory: c.templateCategory,
        templateComponents: c.templateComponents,
        templateApprovalStatus: c.templateApprovalStatus,
        contentSource: c.contentSource,
        contentKind: c.contentKind || "message",
        messageBody: c.messageBody,
        messageParts: c.messageParts ?? null,
        bulletinMeta: c.bulletinMeta ?? null,
        headerImageUrl: c.headerImageUrl,
        headerImageHandle: c.headerImageHandle,
        variableMapping: c.variableMapping,
        segmentFilter: c.segmentFilter,
        timezone: c.timezone,
        scheduledAt: c.scheduledAt?.toISOString() ?? null,
        startedAt: c.startedAt?.toISOString() ?? null,
        completedAt: c.completedAt?.toISOString() ?? null,
        pausedAt: c.pausedAt?.toISOString() ?? null,
        cancelledAt: c.cancelledAt?.toISOString() ?? null,
        delayMs: c.delayMs,
        batchSize: c.batchSize,
        dryRun: c.dryRun,
        requireConsent: c.requireConsent,
        totals: {
            selected: c.totalSelected,
            eligible: c.totalEligible,
            excluded: c.totalExcluded,
            queued: c.totalQueued,
            sent: c.totalSent,
            accepted: c.totalAccepted,
            delivered: c.totalDelivered,
            read: c.totalRead,
            failed: c.totalFailed,
            skipped: c.totalSkipped,
            cancelled: c.totalCancelled,
        },
        lastError: c.lastError,
        createdBy: c.createdBy
            ? {
                  id: c.createdBy.id,
                  name: c.createdBy.name,
                  email: c.createdBy.email,
              }
            : null,
        recipientsCount: c._count?.recipients,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
    };
}

export function serializeRecipient(r: DatafyCampaignRecipient) {
    return {
        id: r.id,
        campaignId: r.campaignId,
        crmContactId: r.crmContactId,
        waId: r.waId,
        fullName: r.fullName,
        company: r.company,
        status: r.status,
        skipReason: r.skipReason,
        attemptCount: r.attemptCount,
        clientMessageId: r.clientMessageId,
        wamid: r.wamid,
        datafyMessageId: r.datafyMessageId,
        conversationId: r.conversationId,
        partStatuses: r.partStatuses ?? null,
        lastError: r.lastError,
        errorCode: r.errorCode,
        sentAt: r.sentAt?.toISOString() ?? null,
        acceptedAt: r.acceptedAt?.toISOString() ?? null,
        deliveredAt: r.deliveredAt?.toISOString() ?? null,
        readAt: r.readAt?.toISOString() ?? null,
        failedAt: r.failedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
    };
}

export function serializeEvent(e: DatafyCampaignEvent) {
    return {
        id: e.id,
        campaignId: e.campaignId,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        message: e.message,
        meta: e.meta,
        actorId: e.actorId,
        createdAt: e.createdAt.toISOString(),
    };
}
