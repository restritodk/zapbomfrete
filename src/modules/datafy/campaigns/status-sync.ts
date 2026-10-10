import { prisma } from "@/lib/prisma";
import { RECIPIENT_STATUS_RANK } from "./constants";
import { refreshCounters } from "./queue";
import { emitDatafyEvent } from "@/modules/datafy/chat/realtime";

/**
 * Sync webhook delivery statuses onto campaign recipients by wamid.
 * Never regresses status (except failed).
 */
export async function syncCampaignRecipientFromWamid(opts: {
    wamid: string;
    status: string;
    timestamp: Date;
    errorCode?: number | null;
    errorTitle?: string | null;
}): Promise<boolean> {
    const next = opts.status.toLowerCase();
    if (!["sent", "delivered", "read", "failed"].includes(next)) return false;

    const recipient = await prisma.datafyCampaignRecipient.findFirst({
        where: { wamid: opts.wamid },
    });
    if (!recipient) return false;

    const currentRank = RECIPIENT_STATUS_RANK[recipient.status] ?? 0;
    const nextRank = RECIPIENT_STATUS_RANK[next] ?? 0;
    if (next !== "failed" && nextRank < currentRank) {
        return false;
    }

    const data: Record<string, unknown> = { status: next };
    if (next === "sent" && !recipient.sentAt) data.sentAt = opts.timestamp;
    if (next === "delivered") data.deliveredAt = opts.timestamp;
    if (next === "read") {
        data.readAt = opts.timestamp;
        if (!recipient.deliveredAt) data.deliveredAt = opts.timestamp;
    }
    if (next === "failed") {
        data.failedAt = opts.timestamp;
        data.errorCode = opts.errorCode ?? null;
        data.lastError = (opts.errorTitle || "Falha no envio").slice(0, 240);
    }

    await prisma.datafyCampaignRecipient.update({
        where: { id: recipient.id },
        data,
    });

    const totals = await refreshCounters(recipient.campaignId);
    const campaign = await prisma.datafyCampaign.findUnique({
        where: { id: recipient.campaignId },
        select: { id: true, status: true, dryRun: true },
    });
    if (campaign) {
        emitDatafyEvent("datafy.campaign.progress", {
            campaignId: campaign.id,
            status: campaign.status,
            totals,
            dryRun: campaign.dryRun,
        });
    }
    return true;
}
