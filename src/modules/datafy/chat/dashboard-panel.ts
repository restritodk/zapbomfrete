import { prisma } from "@/lib/prisma";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { CRM_ORG_DEFAULT } from "@/modules/crm/constants";
import { datafyProvider } from "../provider";
import { listCampaigns } from "../campaigns/service";
import { getDatafyDashboardStats } from "./service";

export type DashboardPeriod = "today" | "7d" | "30d" | "custom";

export type DashboardPeriodInput = {
    period?: DashboardPeriod | string;
    from?: string | null;
    to?: string | null;
};

export function resolveDashboardRange(input: DashboardPeriodInput): {
    period: DashboardPeriod;
    from: Date;
    to: Date;
} {
    const to = new Date();
    const periodRaw = String(input.period || "7d").toLowerCase();
    let period: DashboardPeriod = "7d";
    if (
        periodRaw === "today" ||
        periodRaw === "7d" ||
        periodRaw === "30d" ||
        periodRaw === "custom"
    ) {
        period = periodRaw;
    }

    if (period === "custom" && input.from && input.to) {
        const from = new Date(input.from);
        const toCustom = new Date(input.to);
        if (
            !Number.isNaN(from.getTime()) &&
            !Number.isNaN(toCustom.getTime()) &&
            from.getTime() <= toCustom.getTime()
        ) {
            // Inclusive end-of-day when time is midnight
            if (
                toCustom.getHours() === 0 &&
                toCustom.getMinutes() === 0 &&
                toCustom.getSeconds() === 0
            ) {
                toCustom.setHours(23, 59, 59, 999);
            }
            return { period, from, to: toCustom };
        }
    }

    const from = new Date(to);
    if (period === "today") {
        from.setHours(0, 0, 0, 0);
    } else if (period === "30d") {
        from.setDate(from.getDate() - 29);
        from.setHours(0, 0, 0, 0);
    } else {
        // 7d default
        period = period === "custom" ? "7d" : period;
        from.setDate(from.getDate() - 6);
        from.setHours(0, 0, 0, 0);
    }
    return { period, from, to };
}

/** Map real conversation rows to UI buckets without inventing DB statuses. */
export function mapConversationStatusBuckets(rows: Array<{
    status: string;
    assignedToId: string | null;
}>): {
    awaiting: number;
    inService: number;
    awaitingClient: number;
    resolved: number;
    total: number;
} {
    let awaiting = 0;
    let inService = 0;
    let awaitingClient = 0;
    let resolved = 0;
    for (const r of rows) {
        const s = String(r.status || "open").toLowerCase();
        if (s === "closed") {
            resolved++;
        } else if (s === "pending") {
            awaitingClient++;
        } else if (r.assignedToId) {
            inService++;
        } else {
            awaiting++;
        }
    }
    return {
        awaiting,
        inService,
        awaitingClient,
        resolved,
        total: rows.length,
    };
}

function dayKeySaoPaulo(d: Date): string {
    return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function buildDaySeries(
    from: Date,
    to: Date,
    counts: Map<string, { inbound: number; outbound: number }>
): Array<{ date: string; label: string; inbound: number; outbound: number }> {
    const out: Array<{
        date: string;
        label: string;
        inbound: number;
        outbound: number;
    }> = [];
    const cursor = new Date(from);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    while (cursor.getTime() <= end.getTime()) {
        const key = dayKeySaoPaulo(cursor);
        const c = counts.get(key) || { inbound: 0, outbound: 0 };
        out.push({
            date: key,
            label: cursor.toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "short",
                timeZone: "America/Sao_Paulo",
            }),
            inbound: c.inbound,
            outbound: c.outbound,
        });
        cursor.setDate(cursor.getDate() + 1);
    }
    return out;
}

export async function getPremiumDatafyDashboard(
    input: DashboardPeriodInput = {}
) {
    const channelId = DATAFY_OFFICIAL_CHANNEL_ID;
    const range = resolveDashboardRange(input);
    const checkedAt = new Date();

    const [
        liveStats,
        publicStatus,
        statusRows,
        periodInbound,
        periodOutbound,
        messageRows,
        recentConversations,
        campaignsPage,
    ] = await Promise.all([
        getDatafyDashboardStats(),
        datafyProvider.getPublicStatus(),
        prisma.datafyConversation.findMany({
            where: { channelId },
            select: { status: true, assignedToId: true },
        }),
        prisma.datafyMessage.count({
            where: {
                direction: "inbound",
                createdAt: { gte: range.from, lte: range.to },
                conversation: { channelId },
            },
        }),
        prisma.datafyMessage.count({
            where: {
                direction: "outbound",
                createdAt: { gte: range.from, lte: range.to },
                conversation: { channelId },
            },
        }),
        prisma.datafyMessage.findMany({
            where: {
                createdAt: { gte: range.from, lte: range.to },
                conversation: { channelId },
            },
            select: { direction: true, createdAt: true },
            take: 50_000,
        }),
        prisma.datafyConversation.findMany({
            where: { channelId },
            orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
            take: 8,
            select: {
                id: true,
                waId: true,
                contactName: true,
                lastMessagePreview: true,
                lastMessageAt: true,
                unreadCount: true,
                status: true,
                crmContact: {
                    select: { fullName: true, waId: true },
                },
                messages: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    select: { direction: true, createdAt: true },
                },
            },
        }),
        listCampaigns({ page: 1, limit: 6 }),
    ]);

    const byDay = new Map<string, { inbound: number; outbound: number }>();
    for (const m of messageRows) {
        const key = dayKeySaoPaulo(m.createdAt);
        const cur = byDay.get(key) || { inbound: 0, outbound: 0 };
        if (m.direction === "inbound") cur.inbound++;
        else if (m.direction === "outbound") cur.outbound++;
        byDay.set(key, cur);
    }

    const activity = buildDaySeries(range.from, range.to, byDay);
    const conversationStatus = mapConversationStatusBuckets(statusRows);

    const healthy = Boolean(
        publicStatus.enabled &&
            publicStatus.hasChannelToken &&
            publicStatus.displayPhoneNumber &&
            publicStatus.lastVerifiedAt &&
            !publicStatus.lastError
    );

    let channelState: "active" | "attention" | "disconnected" | "disabled" =
        "disconnected";
    if (!publicStatus.enabled) channelState = "disabled";
    else if (healthy) channelState = "active";
    else if (publicStatus.lastError || publicStatus.configured)
        channelState = "attention";
    else channelState = "disconnected";

    const operationalOk = channelState === "active";

    return {
        period: range.period,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        checkedAt: checkedAt.toISOString(),
        organizationKey: CRM_ORG_DEFAULT,
        // Live KPIs (not historical)
        live: {
            ...liveStats,
            channelState,
            channelStateLabel:
                channelState === "active"
                    ? "Ativo"
                    : channelState === "attention"
                      ? "Atenção"
                      : channelState === "disabled"
                        ? "Desligado"
                        : "Desconectado",
        },
        // Period-scoped message totals
        periodMessages: {
            inbound: periodInbound,
            outbound: periodOutbound,
        },
        activity,
        conversationStatus: {
            ...conversationStatus,
            labels: [
                {
                    key: "awaiting",
                    label: "Aguardando atendimento",
                    count: conversationStatus.awaiting,
                    color: "#f59e0b",
                },
                {
                    key: "inService",
                    label: "Em atendimento",
                    count: conversationStatus.inService,
                    color: "#2563eb",
                },
                {
                    key: "awaitingClient",
                    label: "Aguardando cliente",
                    count: conversationStatus.awaitingClient,
                    color: "#8b5cf6",
                },
                {
                    key: "resolved",
                    label: "Resolvidas",
                    count: conversationStatus.resolved,
                    color: "#10b981",
                },
            ],
        },
        recentContacts: recentConversations.map((c) => {
            const lastDir = c.messages[0]?.direction || null;
            const name =
                c.crmContact?.fullName?.trim() ||
                c.contactName?.trim() ||
                null;
            return {
                id: c.id,
                waId: c.waId,
                displayName: name || "Contato sem nome",
                hasName: Boolean(name),
                preview: c.lastMessagePreview || null,
                lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
                unreadCount: c.unreadCount,
                direction: lastDir,
                status: c.status,
            };
        }),
        recentCampaigns: campaignsPage.campaigns.map((c) => {
            const totals = c.totals || {};
            const sent = Number(totals.sent || totals.accepted || 0);
            const delivered = Number(totals.delivered || 0);
            const selected = Number(totals.selected || c.recipientsCount || 0);
            const deliveryPct =
                sent > 0 ? Math.round((delivered / sent) * 1000) / 10 : null;
            return {
                id: c.id,
                name: c.name,
                status: c.status,
                recipients: selected,
                sent,
                delivered,
                deliveryPct,
                date:
                    c.startedAt ||
                    c.scheduledAt ||
                    c.createdAt ||
                    null,
            };
        }),
        channel: {
            name: "Bom Frete — WhatsApp Oficial",
            provider: "Datafy",
            providerLabel: "WhatsApp Oficial (Datafy)",
            enabled: publicStatus.enabled,
            configured: publicStatus.configured,
            healthy,
            channelState,
            displayPhoneNumber: publicStatus.displayPhoneNumber,
            lastVerifiedAt: publicStatus.lastVerifiedAt,
            lastError: publicStatus.lastError,
            organizationKey: CRM_ORG_DEFAULT,
            connectionQuality: healthy
                ? "Estável"
                : publicStatus.lastError
                  ? "Instável"
                  : publicStatus.enabled
                    ? "Parcial"
                    : "Indisponível",
        },
        statusBar: {
            level: operationalOk
                ? ("ok" as const)
                : channelState === "attention"
                  ? ("warn" as const)
                  : ("error" as const),
            title: operationalOk
                ? "Tudo funcionando normalmente"
                : channelState === "attention"
                  ? "Atenção no canal oficial"
                  : "Canal oficial indisponível",
            description: operationalOk
                ? "O canal WhatsApp Oficial está conectado e operando sem intercorrências."
                : publicStatus.lastError
                  ? String(publicStatus.lastError)
                  : !publicStatus.enabled
                    ? "O canal oficial está desligado na integração Datafy."
                    : "Verifique token, número e última sincronização da integração.",
            checkedAt: checkedAt.toISOString(),
        },
    };
}
