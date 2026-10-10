/**
 * Persistent send-slot claims against DatafyCampaign.nextSendEligibleAt.
 * Pure math lives in pacing.ts — this module talks to Postgres via Prisma.
 */

import { prisma } from "@/lib/prisma";
import {
    effectiveRetryDelayMs,
    isSendSlotEligible,
    nextEligibleAfterClaim,
    normalizeCampaignDelayMs,
} from "./pacing";

export type ClaimSendSlotResult =
    | { ok: true; claimedAt: Date; nextEligibleAt: Date; delayMs: number }
    | {
          ok: false;
          reason: "not_running" | "not_eligible" | "not_found";
          nextEligibleAt: Date | null;
          waitMs: number;
          delayMs: number;
      };

/**
 * Atomically claim the next send slot for a running campaign.
 * Succeeds only when status=running and nextSendEligibleAt is null or ≤ now.
 * On success, advances nextSendEligibleAt to now + delayMs.
 */
export async function claimCampaignSendSlot(
    campaignId: string,
    opts?: { now?: Date; delayMs?: number }
): Promise<ClaimSendSlotResult> {
    const now = opts?.now ?? new Date();
    const campaign = await prisma.datafyCampaign.findUnique({
        where: { id: campaignId },
        select: {
            id: true,
            status: true,
            delayMs: true,
            nextSendEligibleAt: true,
        },
    });
    if (!campaign) {
        return {
            ok: false,
            reason: "not_found",
            nextEligibleAt: null,
            waitMs: 0,
            delayMs: normalizeCampaignDelayMs(opts?.delayMs),
        };
    }
    const delayMs = normalizeCampaignDelayMs(
        opts?.delayMs ?? campaign.delayMs,
        { allowLegacyBelowMin: true }
    );
    if (campaign.status !== "running") {
        return {
            ok: false,
            reason: "not_running",
            nextEligibleAt: campaign.nextSendEligibleAt,
            waitMs: 0,
            delayMs,
        };
    }
    if (!isSendSlotEligible(campaign.nextSendEligibleAt, now)) {
        const next = campaign.nextSendEligibleAt!;
        return {
            ok: false,
            reason: "not_eligible",
            nextEligibleAt: next,
            waitMs: Math.max(0, next.getTime() - now.getTime()),
            delayMs,
        };
    }

    const nextEligibleAt = nextEligibleAfterClaim(now, delayMs);
    const updated = await prisma.datafyCampaign.updateMany({
        where: {
            id: campaignId,
            status: "running",
            OR: [
                { nextSendEligibleAt: null },
                { nextSendEligibleAt: { lte: now } },
            ],
        },
        data: { nextSendEligibleAt: nextEligibleAt },
    });

    if (updated.count === 0) {
        const fresh = await prisma.datafyCampaign.findUnique({
            where: { id: campaignId },
            select: { nextSendEligibleAt: true },
        });
        const next = fresh?.nextSendEligibleAt ?? nextEligibleAt;
        return {
            ok: false,
            reason: "not_eligible",
            nextEligibleAt: next,
            waitMs: Math.max(0, next.getTime() - now.getTime()),
            delayMs,
        };
    }

    return { ok: true, claimedAt: now, nextEligibleAt, delayMs };
}

/** Push next eligible further out (e.g. Datafy 429 retry). Never shortens. */
export async function deferCampaignSendSlot(
    campaignId: string,
    opts: {
        campaignDelayMs: number;
        providerRetrySec?: number | null;
        now?: Date;
    }
): Promise<Date> {
    const now = opts.now ?? new Date();
    const waitMs = effectiveRetryDelayMs(
        opts.campaignDelayMs,
        opts.providerRetrySec
    );
    const candidate = new Date(now.getTime() + waitMs);
    const current = await prisma.datafyCampaign.findUnique({
        where: { id: campaignId },
        select: { nextSendEligibleAt: true },
    });
    const next =
        current?.nextSendEligibleAt &&
        current.nextSendEligibleAt.getTime() > candidate.getTime()
            ? current.nextSendEligibleAt
            : candidate;
    await prisma.datafyCampaign.update({
        where: { id: campaignId },
        data: { nextSendEligibleAt: next },
    });
    return next;
}

export async function refreshCampaignLock(
    campaignId: string,
    workerId: string
): Promise<void> {
    await prisma.datafyCampaign.updateMany({
        where: { id: campaignId, lockedBy: workerId },
        data: { lockedAt: new Date() },
    });
}
