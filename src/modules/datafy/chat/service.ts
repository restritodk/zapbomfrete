import { prisma } from "@/lib/prisma";
import { DatafyApiError } from "../client";
import { datafyProvider } from "../provider";
import { emitDatafyEvent } from "./realtime";
import {
    serializeConversation,
    serializeMessage,
} from "./persist";
import { conversationWindowInfo } from "./send";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";

export async function listDatafyConversations(opts: {
    search?: string;
    cursor?: string | null;
    limit?: number;
}) {
    const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
    const search = opts.search?.trim();

    const rows = await prisma.datafyConversation.findMany({
        where: {
            channelId: DATAFY_OFFICIAL_CHANNEL_ID,
            ...(search
                ? {
                      OR: [
                          { contactName: { contains: search, mode: "insensitive" } },
                          { waId: { contains: search.replace(/\D/g, "") } },
                      ],
                  }
                : {}),
            ...(opts.cursor
                ? { lastMessageAt: { lt: new Date(opts.cursor) } }
                : {}),
        },
        orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
        take: limit + 1,
        include: {
            assignedTo: { select: { id: true, name: true, email: true } },
        },
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
        hasMore && slice[slice.length - 1]?.lastMessageAt
            ? slice[slice.length - 1].lastMessageAt!.toISOString()
            : null;

    return {
        conversations: slice.map(serializeConversation),
        nextCursor,
        hasMore,
    };
}

export async function getDatafyConversation(id: string) {
    const c = await prisma.datafyConversation.findUnique({
        where: { id },
        include: {
            assignedTo: { select: { id: true, name: true, email: true } },
        },
    });
    if (!c || c.channelId !== DATAFY_OFFICIAL_CHANNEL_ID) {
        throw new DatafyApiError("Conversa não encontrada", 404);
    }
    return {
        conversation: serializeConversation(c),
        window: conversationWindowInfo(c.lastCustomerMessageAt),
    };
}

export async function listDatafyMessages(opts: {
    conversationId: string;
    cursor?: string | null;
    limit?: number;
}) {
    await getDatafyConversation(opts.conversationId);
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);

    const rows = await prisma.datafyMessage.findMany({
        where: {
            conversationId: opts.conversationId,
            ...(opts.cursor ? { createdAt: { lt: new Date(opts.cursor) } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    // Return chronological for UI
    const chronological = [...slice].reverse();
    const nextCursor =
        hasMore && slice[slice.length - 1]
            ? slice[slice.length - 1].createdAt.toISOString()
            : null;

    return {
        messages: chronological.map(serializeMessage),
        nextCursor,
        hasMore,
    };
}

export async function markConversationRead(opts: {
    conversationId: string;
    markProviderRead?: boolean;
}) {
    const c = await prisma.datafyConversation.findUnique({
        where: { id: opts.conversationId },
    });
    if (!c) throw new DatafyApiError("Conversa não encontrada", 404);

    const updated = await prisma.datafyConversation.update({
        where: { id: c.id },
        data: { unreadCount: 0 },
        include: {
            assignedTo: { select: { id: true, name: true, email: true } },
        },
    });

    if (opts.markProviderRead) {
        const lastInbound = await prisma.datafyMessage.findFirst({
            where: {
                conversationId: c.id,
                direction: "inbound",
                wamid: { not: null },
            },
            orderBy: { createdAt: "desc" },
        });
        if (lastInbound?.wamid && (c.phoneNumberId || true)) {
            try {
                const client = await datafyProvider.createClient();
                const cfgPhone = c.phoneNumberId;
                const { phoneNumberId } = await import("../config").then((m) =>
                    m.loadDatafyConfig()
                );
                const pnid = cfgPhone || phoneNumberId;
                if (pnid) {
                    await client.markAsRead(pnid, lastInbound.wamid);
                }
            } catch {
                /* non-fatal — local unread cleared */
            }
        }
    }

    emitDatafyEvent("datafy.conversation", {
        conversation: serializeConversation(updated),
    });
    return serializeConversation(updated);
}

export async function claimConversation(opts: {
    conversationId: string;
    userId: string;
    force?: boolean;
}) {
    const c = await prisma.datafyConversation.findUnique({
        where: { id: opts.conversationId },
    });
    if (!c) throw new DatafyApiError("Conversa não encontrada", 404);

    if (
        c.assignedToId &&
        c.assignedToId !== opts.userId &&
        !opts.force
    ) {
        throw new DatafyApiError(
            "Conversa já atribuída a outro atendente. Use transferência.",
            409
        );
    }

    const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.datafyConversation.update({
            where: { id: c.id },
            data: {
                assignedToId: opts.userId,
                assignedAt: new Date(),
                status: "open",
            },
            include: {
                assignedTo: { select: { id: true, name: true, email: true } },
            },
        });
        await tx.datafyAssignmentHistory.create({
            data: {
                conversationId: c.id,
                fromUserId: c.assignedToId,
                toUserId: opts.userId,
                action: "claim",
                createdById: opts.userId,
            },
        });
        return row;
    });

    emitDatafyEvent("datafy.conversation", {
        conversation: serializeConversation(updated),
    });
    return serializeConversation(updated);
}

export async function transferConversation(opts: {
    conversationId: string;
    fromUserId: string;
    toUserId: string;
    note?: string;
}) {
    const c = await prisma.datafyConversation.findUnique({
        where: { id: opts.conversationId },
    });
    if (!c) throw new DatafyApiError("Conversa não encontrada", 404);

    const target = await prisma.user.findUnique({
        where: { id: opts.toUserId },
        select: { id: true, role: true },
    });
    if (!target) throw new DatafyApiError("Usuário destino inválido", 400);

    const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.datafyConversation.update({
            where: { id: c.id },
            data: {
                assignedToId: opts.toUserId,
                assignedAt: new Date(),
            },
            include: {
                assignedTo: { select: { id: true, name: true, email: true } },
            },
        });
        await tx.datafyAssignmentHistory.create({
            data: {
                conversationId: c.id,
                fromUserId: c.assignedToId || opts.fromUserId,
                toUserId: opts.toUserId,
                action: "transfer",
                createdById: opts.fromUserId,
                note: opts.note?.slice(0, 240) || null,
            },
        });
        return row;
    });

    emitDatafyEvent("datafy.conversation", {
        conversation: serializeConversation(updated),
    });
    return serializeConversation(updated);
}

export async function getDatafyDashboardStats() {
    const channelId = DATAFY_OFFICIAL_CHANNEL_ID;
    const [
        conversations,
        unread,
        inbound,
        outbound,
        openAssigned,
        lastInbound,
    ] = await Promise.all([
        prisma.datafyConversation.count({ where: { channelId } }),
        prisma.datafyConversation.aggregate({
            where: { channelId },
            _sum: { unreadCount: true },
        }),
        prisma.datafyMessage.count({
            where: { direction: "inbound", conversation: { channelId } },
        }),
        prisma.datafyMessage.count({
            where: { direction: "outbound", conversation: { channelId } },
        }),
        prisma.datafyConversation.count({
            where: {
                channelId,
                status: "open",
                assignedToId: { not: null },
            },
        }),
        prisma.datafyMessage.findFirst({
            where: { direction: "inbound", conversation: { channelId } },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
        }),
    ]);

    return {
        provider: "datafy" as const,
        channelId,
        conversations,
        unreadConversations: unread._sum.unreadCount || 0,
        messagesInbound: inbound,
        messagesOutbound: outbound,
        assignedOpen: openAssigned,
        lastInboundAt: lastInbound?.createdAt.toISOString() ?? null,
    };
}

export async function resolveInboundMediaUrl(mediaId: string) {
    const client = await datafyProvider.createClient();
    return client.getInboundMedia(mediaId);
}
