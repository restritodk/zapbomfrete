import { prisma } from "@/lib/prisma";
import type { WASocket, Chat as BaileysChat } from "@whiskeysockets/baileys";
import { normalizeJid } from "@/lib/jid-utils";
import { logger } from "@/lib/logger";
import type { Server } from "socket.io";

function chatTimestamp(chat: BaileysChat): Date | null {
    const ts = (chat as any).conversationTimestamp;
    if (!ts) return null;
    const n = typeof ts === "object" && "low" in ts ? Number(ts.low) : Number(ts);
    if (!Number.isFinite(n) || n <= 0) return null;
    // Baileys may send seconds or ms
    return new Date(n > 1e12 ? n : n * 1000);
}

function chatName(chat: BaileysChat): string | undefined {
    const name = chat.name || (chat as any).displayName || (chat as any).notify;
    return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

async function ensureDbSessionId(
    sessionId: string,
    current: string | null
): Promise<string | null> {
    if (current) return current;
    const session = await prisma.session.findUnique({
        where: { sessionId },
        select: { id: true },
    });
    return session?.id ?? null;
}

export async function upsertChatsFromBaileys(
    dbSessionId: string,
    chats: BaileysChat[]
): Promise<number> {
    let saved = 0;
    for (const chat of chats) {
        try {
            if (!chat.id) continue;
            if (chat.id.includes("@broadcast") || chat.id === "status@broadcast") continue;

            const jid = normalizeJid(chat.id) || chat.id;
            const name = chatName(chat);
            const conversationTs = chatTimestamp(chat);
            const unreadCount = typeof chat.unreadCount === "number" ? chat.unreadCount : 0;

            await prisma.chat.upsert({
                where: { sessionId_jid: { sessionId: dbSessionId, jid } },
                create: {
                    sessionId: dbSessionId,
                    jid,
                    name: name || null,
                    unreadCount,
                    archived: !!(chat as any).archived,
                    pinned: !!(chat as any).pinned,
                    muted: (chat as any).mute != null && Number((chat as any).mute) > 0,
                    conversationTs,
                    lastMessageAt: conversationTs,
                },
                update: {
                    ...(name ? { name } : {}),
                    unreadCount,
                    archived: !!(chat as any).archived,
                    pinned: !!(chat as any).pinned,
                    muted: (chat as any).mute != null && Number((chat as any).mute) > 0,
                    ...(conversationTs
                        ? {
                              conversationTs,
                              lastMessageAt: conversationTs,
                          }
                        : {}),
                },
            });

            // Keep Contact/Group name in sync
            if (jid.endsWith("@g.us")) {
                if (name) {
                    await prisma.group.upsert({
                        where: { sessionId_jid: { sessionId: dbSessionId, jid } },
                        create: {
                            sessionId: dbSessionId,
                            jid,
                            subject: name,
                        },
                        update: { subject: name },
                    }).catch(() => {});
                }
            } else if (name) {
                await prisma.contact.upsert({
                    where: { sessionId_jid: { sessionId: dbSessionId, jid } },
                    create: {
                        sessionId: dbSessionId,
                        jid,
                        name,
                        notify: (chat as any).notify || undefined,
                    },
                    update: {
                        name,
                        notify: (chat as any).notify || undefined,
                    },
                }).catch(() => {});
            }

            saved++;
        } catch (e) {
            logger.error("Store", `Failed to upsert chat ${chat.id}`, e);
        }
    }
    return saved;
}

export async function touchChatFromMessage(
    dbSessionId: string,
    remoteJid: string,
    preview: string | null,
    type: string,
    timestamp: Date,
    nameHint?: string | null
) {
    if (!remoteJid || remoteJid.includes("@broadcast")) return;
    const jid = normalizeJid(remoteJid) || remoteJid;
    try {
        await prisma.chat.upsert({
            where: { sessionId_jid: { sessionId: dbSessionId, jid } },
            create: {
                sessionId: dbSessionId,
                jid,
                name: nameHint || null,
                lastMessageAt: timestamp,
                conversationTs: timestamp,
                lastPreview: preview,
                lastMsgType: type,
            },
            update: {
                lastMessageAt: timestamp,
                conversationTs: timestamp,
                lastPreview: preview,
                lastMsgType: type,
                ...(nameHint ? { name: nameHint } : {}),
            },
        });
    } catch (e) {
        logger.debug("Store", `touchChatFromMessage failed for ${jid}`, e);
    }
}

/**
 * Sync WhatsApp chats into the Chat table and notify the frontend.
 */
export function bindChatSync(sock: WASocket, sessionId: string, io: Server | null) {
    let dbSessionId: string | null = null;

    (async () => {
        dbSessionId = await ensureDbSessionId(sessionId, null);
        if (dbSessionId) {
            logger.info("Store", `Chat sync initialized for session ${sessionId} (db: ${dbSessionId})`);
        }
    })();

    const flush = async (chats: BaileysChat[], source: string, isLatest?: boolean) => {
        dbSessionId = await ensureDbSessionId(sessionId, dbSessionId);
        if (!dbSessionId || !chats?.length) return;

        const saved = await upsertChatsFromBaileys(dbSessionId, chats);
        logger.info("Store", `Chat sync (${source}): ${saved}/${chats.length} chats saved`);
        io?.to(sessionId).emit("chats.synced", {
            count: saved,
            source,
            isLatest: !!isLatest,
        });
    };

    sock.ev.on("chats.upsert", async (chats) => {
        await flush(chats, "chats.upsert");
    });

    sock.ev.on("chats.update", async (updates) => {
        // chats.update is Partial<Chat>[] — still upsertable when id is present
        await flush(updates as BaileysChat[], "chats.update");
    });

    sock.ev.on("messaging-history.set", async ({ chats, isLatest }) => {
        if (chats?.length) {
            await flush(chats, "messaging-history.set", isLatest);
        } else if (isLatest) {
            io?.to(sessionId).emit("chats.synced", {
                count: 0,
                source: "messaging-history.set",
                isLatest: true,
            });
        }
    });
}
