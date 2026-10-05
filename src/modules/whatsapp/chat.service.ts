import { prisma } from "@/lib/prisma";
import { normalizeJid } from "@/lib/jid-utils";
import { toWhatsAppJid, formatPhoneDisplay } from "@/lib/phone-br";
import { waManager } from "@/modules/whatsapp/manager";
import { onMessageSent } from "@/lib/webhook";
import Sticker from "wa-sticker-formatter";

type ChatListItem = {
    jid: string;
    name: string | null;
    notify: string | null;
    profilePic: string | null;
    /** Real phone JID when known (never @lid) */
    phoneJid?: string | null;
    lastMessage: {
        content: string | null;
        timestamp: string;
        type: string;
    } | null;
};

/** Avoid hammering WhatsApp with repeated history pulls for the same chat */
const historyFetchCooldown = new Map<string, number>();
const HISTORY_COOLDOWN_MS = 60_000;
/** Throttle bulk PN↔LID USYNC during chat list loads */
const lidEnrichCooldown = new Map<string, number>();
const LID_ENRICH_COOLDOWN_MS = 120_000;

export class ChatService {
    /**
     * Resolve display info for a batch of JIDs from Contact + Group tables.
     * Matches jid, lid and remoteJidAlt so LID chats get address-book names.
     */
    private static async resolveChatInfo(
        dbSessionId: string,
        jids: string[]
    ): Promise<Map<string, { name: string | null; notify: string | null; profilePic: string | null }>> {
        const infoMap = new Map<string, { name: string | null; notify: string | null; profilePic: string | null }>();
        if (jids.length === 0) return infoMap;

        const [contacts, groups] = await Promise.all([
            prisma.contact.findMany({
                where: {
                    sessionId: dbSessionId,
                    OR: [
                        { jid: { in: jids } },
                        { lid: { in: jids } },
                        { remoteJidAlt: { in: jids } },
                    ],
                },
                select: {
                    jid: true,
                    lid: true,
                    remoteJidAlt: true,
                    name: true,
                    notify: true,
                    verifiedName: true,
                    profilePic: true,
                },
            }),
            prisma.group.findMany({
                where: { sessionId: dbSessionId, jid: { in: jids } },
                select: { jid: true, subject: true },
            }),
        ]);

        const apply = (
            key: string | null | undefined,
            data: { name: string | null; notify: string | null; profilePic: string | null }
        ) => {
            if (!key) return;
            const existing = infoMap.get(key);
            if (!existing) {
                infoMap.set(key, data);
                return;
            }
            // Prefer real name over empty / notify-only
            if (!existing.name && data.name) existing.name = data.name;
            if (!existing.notify && data.notify) existing.notify = data.notify;
            if (!existing.profilePic && data.profilePic) existing.profilePic = data.profilePic;
        };

        for (const c of contacts) {
            const data = {
                name: c.name || c.verifiedName || null,
                notify: c.notify || null,
                profilePic: c.profilePic || null,
            };
            apply(c.jid, data);
            apply(c.lid, data);
            apply(c.remoteJidAlt, data);
        }

        for (const g of groups) {
            apply(g.jid, {
                name: g.subject || null,
                notify: g.subject || null,
                profilePic: null,
            });
        }

        return infoMap;
    }

    /**
     * Collect all JID variants (phone / lid / alt) for message queries.
     */
    private static async expandJids(dbSessionId: string, jid: string): Promise<string[]> {
        const normalizedJid = normalizeJid(jid) || jid;
        const queryJids = new Set<string>([jid, normalizedJid].filter(Boolean));

        const contact = await prisma.contact.findFirst({
            where: {
                sessionId: dbSessionId,
                OR: [
                    { jid },
                    { lid: jid },
                    { remoteJidAlt: jid },
                    { jid: normalizedJid },
                    { remoteJidAlt: normalizedJid },
                    { lid: normalizedJid },
                ],
            },
            select: { jid: true, lid: true, remoteJidAlt: true },
        });

        if (contact) {
            if (contact.jid) queryJids.add(contact.jid);
            if (contact.lid) queryJids.add(contact.lid);
            if (contact.remoteJidAlt) queryJids.add(contact.remoteJidAlt);
            const altNorm = contact.remoteJidAlt ? normalizeJid(contact.remoteJidAlt) : "";
            if (altNorm) queryJids.add(altNorm);
        }

        // Also pull sibling Chat rows that share the same contact mapping
        const chat = await prisma.chat.findFirst({
            where: { sessionId: dbSessionId, jid: { in: Array.from(queryJids) } },
            select: { jid: true },
        });
        if (chat?.jid) queryJids.add(chat.jid);

        return Array.from(queryJids);
    }

    private static parseAuthMappingValue(value: unknown): string {
        if (typeof value === "string") return value.replace(/^"|"$/g, "").trim();
        if (value == null) return "";
        return String(value).replace(/^"|"$/g, "").trim();
    }

    /**
     * Resolve LID → phone JID via AuthState (all mappings), Contact.remoteJidAlt,
     * and live Baileys lidMapping. Persists links for next time.
     */
    private static async resolveLidPhoneMap(
        dbSessionId: string,
        sessionKey: string | null,
        lidJids: string[]
    ): Promise<Map<string, string>> {
        const map = new Map<string, string>();
        if (lidJids.length === 0) return map;

        const want = new Set(lidJids);

        // 1) Contact.remoteJidAlt already known
        const lidContacts = await prisma.contact.findMany({
            where: {
                sessionId: dbSessionId,
                OR: [{ jid: { in: lidJids } }, { lid: { in: lidJids } }],
            },
            select: { jid: true, lid: true, remoteJidAlt: true },
        });
        for (const c of lidContacts) {
            const alt = c.remoteJidAlt ? normalizeJid(c.remoteJidAlt) : "";
            if (!alt || alt.endsWith("@lid")) continue;
            if (c.jid.endsWith("@lid") && want.has(c.jid)) map.set(c.jid, alt);
            if (c.lid && want.has(c.lid)) map.set(c.lid, alt);
            if (c.jid.endsWith("@s.whatsapp.net") && c.lid && want.has(c.lid)) {
                map.set(c.lid, normalizeJid(c.jid) || c.jid);
            }
        }

        // 2) Load ALL AuthState lid-mapping keys (forward + reverse) and invert
        if (sessionKey) {
            const rows = await prisma.authState.findMany({
                where: {
                    sessionId: sessionKey,
                    key: { startsWith: "lid-mapping-" },
                },
                select: { key: true, value: true },
            });
            for (const row of rows) {
                const raw = this.parseAuthMappingValue(row.value);
                if (!raw) continue;
                if (row.key.endsWith("_reverse")) {
                    const lidUser = row.key
                        .replace(/^lid-mapping-/, "")
                        .replace(/_reverse$/, "");
                    const lidJid = `${lidUser}@lid`;
                    if (want.has(lidJid)) {
                        map.set(lidJid, normalizeJid(`${raw}@s.whatsapp.net`) || `${raw}@s.whatsapp.net`);
                    }
                } else {
                    const pnUser = row.key.replace(/^lid-mapping-/, "");
                    const lidUser = raw.replace(/@lid$/i, "").split(":")[0];
                    const lidJid = `${lidUser}@lid`;
                    if (want.has(lidJid)) {
                        map.set(
                            lidJid,
                            normalizeJid(`${pnUser}@s.whatsapp.net`) || `${pnUser}@s.whatsapp.net`
                        );
                    }
                }
            }
        }

        // 3) Fast cache-only getPNForLID (no USYNC) for unresolved
        if (sessionKey) {
            const instance = waManager.getInstance(sessionKey);
            const lidMapping = (instance?.socket as any)?.signalRepository?.lidMapping;
            if (lidMapping?.getPNForLID) {
                for (const lid of lidJids) {
                    if (map.has(lid)) continue;
                    try {
                        const pn = await lidMapping.getPNForLID(lid);
                        if (pn && typeof pn === "string") {
                            const rawUser = pn.split("@")[0].split(":")[0];
                            const phone = normalizeJid(`${rawUser}@s.whatsapp.net`);
                            if (phone && !phone.endsWith("@lid")) map.set(lid, phone);
                        }
                    } catch {
                        // ignore
                    }
                }
            }
        }

        // Persist links for next list load (fast DB writes)
        for (const [lid, phone] of map) {
            if (!want.has(lid)) continue;
            try {
                const phoneContact = await prisma.contact.findFirst({
                    where: { sessionId: dbSessionId, jid: phone },
                    select: { name: true, notify: true, verifiedName: true },
                });
                await prisma.contact.updateMany({
                    where: { sessionId: dbSessionId, jid: phone },
                    data: { lid },
                });
                await prisma.contact.updateMany({
                    where: { sessionId: dbSessionId, jid: lid },
                    data: {
                        remoteJidAlt: phone,
                        ...(phoneContact?.name ? { name: phoneContact.name } : {}),
                        ...(phoneContact?.notify ? { notify: phoneContact.notify } : {}),
                        ...(phoneContact?.verifiedName
                            ? { verifiedName: phoneContact.verifiedName }
                            : {}),
                    },
                });
                if (phoneContact?.name || phoneContact?.verifiedName) {
                    await prisma.chat.updateMany({
                        where: { sessionId: dbSessionId, jid: lid },
                        data: {
                            name: phoneContact.name || phoneContact.verifiedName || undefined,
                        },
                    });
                }
            } catch {
                // non-fatal
            }
        }

        return map;
    }

    /**
     * Background: resolve remaining LID→phone via Baileys USYNC and notify UI.
     */
    static enrichLidMappingsInBackground(
        dbSessionId: string,
        sessionKey: string,
        lidJids: string[]
    ) {
        const unresolved = lidJids.filter(Boolean);
        if (unresolved.length === 0) return;

        const enrichKey = `${dbSessionId}:lid-enrich`;
        const lastEnrich = lidEnrichCooldown.get(enrichKey) || 0;
        if (Date.now() - lastEnrich < LID_ENRICH_COOLDOWN_MS) return;
        lidEnrichCooldown.set(enrichKey, Date.now());

        setImmediate(async () => {
            try {
                const instance = waManager.getInstance(sessionKey);
                const lidMapping = (instance?.socket as any)?.signalRepository?.lidMapping;
                if (!lidMapping?.getLIDForPN) return;

                const pending = new Set(unresolved);
                // Drop ones already linked in Contact
                const linked = await prisma.contact.findMany({
                    where: {
                        sessionId: dbSessionId,
                        OR: [{ jid: { in: unresolved } }, { lid: { in: unresolved } }],
                        remoteJidAlt: { not: null },
                    },
                    select: { jid: true, lid: true },
                });
                for (const c of linked) {
                    if (c.jid.endsWith("@lid")) pending.delete(c.jid);
                    if (c.lid) pending.delete(c.lid);
                }
                if (pending.size === 0) return;

                const phoneContacts = await prisma.contact.findMany({
                    where: {
                        sessionId: dbSessionId,
                        jid: { endsWith: "@s.whatsapp.net" },
                    },
                    select: { jid: true, name: true },
                    orderBy: { updatedAt: "desc" },
                    take: 150,
                });
                phoneContacts.sort((a, b) => Number(!!b.name) - Number(!!a.name));

                let linkedCount = 0;
                for (const pc of phoneContacts) {
                    if (pending.size === 0) break;
                    try {
                        const lid = await lidMapping.getLIDForPN(pc.jid);
                        if (!lid || typeof lid !== "string") continue;
                        const lidJid = `${lid.split("@")[0].split(":")[0]}@lid`;
                        if (!pending.has(lidJid)) continue;

                        const phone = normalizeJid(pc.jid) || pc.jid;
                        await prisma.contact.updateMany({
                            where: { sessionId: dbSessionId, jid: phone },
                            data: { lid: lidJid },
                        });
                        await prisma.contact.updateMany({
                            where: { sessionId: dbSessionId, jid: lidJid },
                            data: {
                                remoteJidAlt: phone,
                                ...(pc.name ? { name: pc.name } : {}),
                            },
                        });
                        if (pc.name) {
                            await prisma.chat.updateMany({
                                where: { sessionId: dbSessionId, jid: lidJid },
                                data: { name: pc.name },
                            });
                        }
                        pending.delete(lidJid);
                        linkedCount++;
                    } catch {
                        // ignore
                    }
                }

                if (linkedCount > 0) {
                    instance?.io?.to(sessionKey).emit("chats.synced", {
                        count: linkedCount,
                        source: "lid-enrich",
                        isLatest: false,
                    });
                }
            } catch {
                // non-fatal background job
            }
        });
    }

    /**
     * Fetch missing profile pictures from WhatsApp and persist on Contact.
     */
    private static async ensureProfilePics(
        dbSessionId: string,
        sessionKey: string | null,
        targets: { jid: string; phoneJid?: string | null }[]
    ): Promise<Map<string, string>> {
        const pics = new Map<string, string>();
        if (!sessionKey || targets.length === 0) return pics;

        const instance = waManager.getInstance(sessionKey);
        const sock = instance?.socket;
        if (!sock?.profilePictureUrl) return pics;

        const slice = targets.slice(0, 15);
        await Promise.all(
            slice.map(async (t) => {
                const fetchJid = t.phoneJid || t.jid;
                if (!fetchJid || fetchJid.includes("@broadcast")) return;
                try {
                    const url = await sock.profilePictureUrl(fetchJid, "image");
                    if (!url) return;
                    pics.set(t.jid, url);
                    if (t.phoneJid) pics.set(t.phoneJid, url);

                    const jidsToUpdate = [t.jid, t.phoneJid].filter(Boolean) as string[];
                    await prisma.contact.updateMany({
                        where: { sessionId: dbSessionId, jid: { in: jidsToUpdate } },
                        data: { profilePic: url },
                    });
                } catch {
                    // no pic / privacy
                }
            })
        );
        return pics;
    }

    /**
     * Get active chats list — only conversations that have real messages
     * (text content or media). Empty / junk stubs are hidden.
     */
    static async getChatsList(
        dbSessionId: string,
        limit = 50,
        before?: string,
        search?: string
    ) {
        const beforeDate = before ? new Date(before) : null;
        const take = Math.min(Math.max(limit, 1), 200);

        // Seed once if Chat table empty
        const chatCount = await prisma.chat.count({ where: { sessionId: dbSessionId } });
        if (chatCount === 0) {
            await this.backfillChatsFromMessages(dbSessionId);
        }

        // Only chats with at least one real message (text OR media)
        type ChatRow = {
            jid: string;
            name: string | null;
            lastPreview: string | null;
            lastMsgType: string | null;
            ts: Date | null;
        };

        const chatRows = beforeDate
            ? await prisma.$queryRaw<ChatRow[]>`
                SELECT c.jid, c.name, c."lastPreview", c."lastMsgType",
                       COALESCE(c."lastMessageAt", c."conversationTs") AS ts
                FROM "Chat" c
                WHERE c."sessionId" = ${dbSessionId}
                  AND c.jid NOT LIKE '%@broadcast'
                  AND c.jid <> '0@s.whatsapp.net'
                  AND COALESCE(c."lastMessageAt", c."conversationTs") < ${beforeDate}
                  AND EXISTS (
                    SELECT 1 FROM "Message" m
                    WHERE m."sessionId" = c."sessionId"
                      AND m."remoteJid" = c.jid
                      AND (COALESCE(m.content, '') <> '' OR m.type::text <> 'TEXT')
                  )
                ORDER BY ts DESC NULLS LAST
                LIMIT ${take}
            `
            : await prisma.$queryRaw<ChatRow[]>`
                SELECT c.jid, c.name, c."lastPreview", c."lastMsgType",
                       COALESCE(c."lastMessageAt", c."conversationTs") AS ts
                FROM "Chat" c
                WHERE c."sessionId" = ${dbSessionId}
                  AND c.jid NOT LIKE '%@broadcast'
                  AND c.jid <> '0@s.whatsapp.net'
                  AND EXISTS (
                    SELECT 1 FROM "Message" m
                    WHERE m."sessionId" = c."sessionId"
                      AND m."remoteJid" = c.jid
                      AND (COALESCE(m.content, '') <> '' OR m.type::text <> 'TEXT')
                  )
                ORDER BY ts DESC NULLS LAST
                LIMIT ${take}
            `;

        if (chatRows.length === 0) {
            return this.getChatsListFromMessages(dbSessionId, take, before, search);
        }

        const jids = chatRows.map((c) => c.jid);
        const session = await prisma.session.findUnique({
            where: { id: dbSessionId },
            select: { sessionId: true },
        });

        const lidJids = jids.filter((j) => j.endsWith("@lid"));
        const lidPhoneMap = await this.resolveLidPhoneMap(
            dbSessionId,
            session?.sessionId || null,
            lidJids
        );

        // Expand contact lookup with resolved phone JIDs
        const lookupJids = [...jids, ...Array.from(lidPhoneMap.values())];
        const infoMap = await this.resolveChatInfo(dbSessionId, lookupJids);

        // Apply phone contact info onto LID keys (agenda name + pic win)
        for (const [lid, phone] of lidPhoneMap) {
            const phoneInfo = infoMap.get(phone);
            const lidInfo = infoMap.get(lid);
            if (phoneInfo) {
                infoMap.set(lid, {
                    name: phoneInfo.name || lidInfo?.name || null,
                    notify: phoneInfo.notify || lidInfo?.notify || null,
                    profilePic: phoneInfo.profilePic || lidInfo?.profilePic || null,
                });
            }
        }

        // Kick background LID→phone enrich for unresolved chats (does not block response)
        const unresolvedLids = lidJids.filter((j) => !lidPhoneMap.has(j));
        if (session?.sessionId && unresolvedLids.length > 0) {
            this.enrichLidMappingsInBackground(dbSessionId, session.sessionId, unresolvedLids);
        }

        const mapped: Array<ChatListItem & { _canon: string; _ts: number }> = chatRows.map((c) => {
            const info = infoMap.get(c.jid);
            const isGroup = c.jid.endsWith("@g.us");
            const phone =
                lidPhoneMap.get(c.jid) ||
                (c.jid.endsWith("@s.whatsapp.net") ? c.jid : null);
            const phoneLabel = phone ? formatPhoneDisplay(phone) : null;

            // Saved contact = agenda / business / WhatsApp chat name (NOT pushname, NOT LID digits)
            const chatName =
                c.name && !/^\d{10,}$/.test(c.name.replace(/\D/g, "")) ? c.name : null;
            const savedName =
                info?.name || (isGroup ? info?.notify || chatName : null) || chatName || null;

            // Display: saved name → real phone → never raw LID id
            const displayName = savedName || phoneLabel || (isGroup ? "Grupo" : "Contato");
            const displayNotify = phoneLabel || null;

            const ts = c.ts;
            const previewType = c.lastMsgType || "TEXT";
            let previewContent = c.lastPreview;
            if ((!previewContent || !previewContent.trim()) && previewType !== "TEXT") {
                previewContent = null;
            }
            const canon = phone || c.jid;
            return {
                // Prefer phone JID for DMs so UI/send use the real number
                jid: phone && !isGroup ? phone : c.jid,
                name: displayName,
                notify: displayNotify,
                profilePic: info?.profilePic || null,
                phoneJid: phone,
                lastMessage: ts
                    ? {
                          content: previewContent,
                          timestamp: ts instanceof Date ? ts.toISOString() : String(ts),
                          type: previewType,
                      }
                    : null,
                _canon: canon,
                _ts: ts ? new Date(ts).getTime() : 0,
            };
        });

        // Collapse phone + LID duplicates of the same person (keep newest)
        const byCanon = new Map<string, (typeof mapped)[0]>();
        for (const item of mapped) {
            const existing = byCanon.get(item._canon);
            if (!existing || item._ts > existing._ts) {
                byCanon.set(item._canon, item);
            }
        }
        // Also collapse when a phone chat and a LID chat both exist and LID maps to that phone
        for (const [lid, phone] of lidPhoneMap) {
            const lidItem = [...byCanon.values()].find((i) => i.jid === lid);
            const phoneItem = byCanon.get(phone);
            if (lidItem && phoneItem && lidItem.jid !== phoneItem.jid) {
                const winner = lidItem._ts >= phoneItem._ts ? lidItem : phoneItem;
                // Prefer phone JID for sending, keep best name/preview
                winner.jid = phoneItem.jid.endsWith("@s.whatsapp.net") ? phoneItem.jid : winner.jid;
                winner.name = winner.name || phoneItem.name || lidItem.name;
                winner.notify = winner.notify || phoneItem.notify || lidItem.notify;
                winner.profilePic = winner.profilePic || phoneItem.profilePic || lidItem.profilePic;
                byCanon.delete(lid);
                byCanon.delete(phone);
                byCanon.set(phone, winner);
            }
        }

        let result: ChatListItem[] = Array.from(byCanon.values())
            .sort((a, b) => b._ts - a._ts)
            .map(({ _canon, _ts, ...rest }) => rest);

        if (search && search.trim()) {
            const q = search.toLowerCase();
            result = result.filter(
                (c) =>
                    (c.name || "").toLowerCase().includes(q) ||
                    (c.notify || "").toLowerCase().includes(q) ||
                    c.jid.toLowerCase().includes(q)
            );
        }

        return result;
    }

    /** Legacy aggregation used when Chat table has no rows yet. */
    private static async getChatsListFromMessages(
        dbSessionId: string,
        limit: number,
        before?: string,
        search?: string
    ) {
        type Row = {
            remoteJid: string;
            content: string | null;
            timestamp: Date;
            type: string;
        };

        const beforeDate = before ? new Date(before) : null;

        // Only remoteJids that have real content or media
        const rawLastMessages = beforeDate
            ? await prisma.$queryRaw<Row[]>`
                SELECT m1."remoteJid", m1.content, m1.timestamp, m1.type::text AS type
                FROM "Message" m1
                INNER JOIN (
                    SELECT "remoteJid", MAX(timestamp) AS max_ts
                    FROM "Message"
                    WHERE "sessionId" = ${dbSessionId}
                      AND "remoteJid" <> 'status@broadcast'
                      AND "remoteJid" <> '0@s.whatsapp.net'
                      AND (COALESCE(content, '') <> '' OR type::text <> 'TEXT')
                    GROUP BY "remoteJid"
                ) m2 ON m1."remoteJid" = m2."remoteJid" AND m1.timestamp = m2.max_ts
                WHERE m1."sessionId" = ${dbSessionId}
                  AND m1.timestamp < ${beforeDate}
                ORDER BY m1.timestamp DESC
                LIMIT ${limit}
            `
            : await prisma.$queryRaw<Row[]>`
                SELECT m1."remoteJid", m1.content, m1.timestamp, m1.type::text AS type
                FROM "Message" m1
                INNER JOIN (
                    SELECT "remoteJid", MAX(timestamp) AS max_ts
                    FROM "Message"
                    WHERE "sessionId" = ${dbSessionId}
                      AND "remoteJid" <> 'status@broadcast'
                      AND "remoteJid" <> '0@s.whatsapp.net'
                      AND (COALESCE(content, '') <> '' OR type::text <> 'TEXT')
                    GROUP BY "remoteJid"
                ) m2 ON m1."remoteJid" = m2."remoteJid" AND m1.timestamp = m2.max_ts
                WHERE m1."sessionId" = ${dbSessionId}
                ORDER BY m1.timestamp DESC
                LIMIT ${limit}
            `;

        if (rawLastMessages.length === 0) return [];

        const jids = rawLastMessages.map((m) => m.remoteJid);
        const infoMap = await this.resolveChatInfo(dbSessionId, jids);

        const result: ChatListItem[] = [];
        const seen = new Set<string>();
        for (const msg of rawLastMessages) {
            if (seen.has(msg.remoteJid)) continue;
            seen.add(msg.remoteJid);
            const info = infoMap.get(msg.remoteJid);
            result.push({
                jid: msg.remoteJid,
                name: info?.name || null,
                notify: info?.notify || null,
                profilePic: info?.profilePic || null,
                lastMessage: {
                    content: msg.content,
                    timestamp:
                        msg.timestamp instanceof Date
                            ? msg.timestamp.toISOString()
                            : String(msg.timestamp),
                    type: msg.type,
                },
            });
        }

        if (search && search.trim()) {
            const q = search.toLowerCase();
            return result.filter(
                (c) =>
                    (c.name || "").toLowerCase().includes(q) ||
                    (c.notify || "").toLowerCase().includes(q) ||
                    c.jid.toLowerCase().includes(q)
            );
        }

        return result;
    }

    /**
     * Seed Chat rows from existing Message data (one-time / empty table).
     */
    static async backfillChatsFromMessages(dbSessionId: string) {
        type Row = {
            remoteJid: string;
            content: string | null;
            timestamp: Date;
            type: string;
            pushName: string | null;
        };

        const rows = await prisma.$queryRaw<Row[]>`
            SELECT m1."remoteJid", m1.content, m1.timestamp, m1.type::text AS type, m1."pushName"
            FROM "Message" m1
            INNER JOIN (
                SELECT "remoteJid", MAX(timestamp) AS max_ts
                FROM "Message"
                WHERE "sessionId" = ${dbSessionId}
                  AND "remoteJid" <> 'status@broadcast'
                  AND "remoteJid" NOT LIKE '%@broadcast'
                GROUP BY "remoteJid"
            ) m2 ON m1."remoteJid" = m2."remoteJid" AND m1.timestamp = m2.max_ts
            WHERE m1."sessionId" = ${dbSessionId}
        `;

        for (const row of rows) {
            const jid = normalizeJid(row.remoteJid) || row.remoteJid;
            try {
                await prisma.chat.upsert({
                    where: { sessionId_jid: { sessionId: dbSessionId, jid } },
                    create: {
                        sessionId: dbSessionId,
                        jid,
                        name: row.pushName || null,
                        lastMessageAt: row.timestamp,
                        conversationTs: row.timestamp,
                        lastPreview: row.content,
                        lastMsgType: row.type,
                    },
                    update: {
                        lastMessageAt: row.timestamp,
                        conversationTs: row.timestamp,
                        lastPreview: row.content,
                        lastMsgType: row.type,
                    },
                });
            } catch {
                // ignore individual failures
            }
        }
    }

    /**
     * Get messages for a specific chat with cursor pagination.
     * Also asks the live WhatsApp socket for older history when the DB is thin.
     */
    static async getMessages(
        dbSessionId: string,
        jid: string,
        limit = 50,
        before?: string
    ) {
        const queryJids = await this.expandJids(dbSessionId, jid);

        const where: any = {
            sessionId: dbSessionId,
            remoteJid: { in: queryJids },
        };

        if (before) {
            where.timestamp = { lt: new Date(before) };
        }

        let messages = await prisma.message.findMany({
            where,
            orderBy: { timestamp: "desc" },
            take: limit + 1,
        });

        // If opening a chat with few local messages, request more history from WhatsApp (throttled)
        if (!before && messages.length < 15) {
            await this.requestHistoryFromWhatsApp(
                dbSessionId,
                jid,
                messages[messages.length - 1] || null
            );
        }

        const hasMore = messages.length > limit;
        if (hasMore) messages.pop();

        const quoteIds = messages.map((m) => m.quoteId).filter((id): id is string => !!id);
        const quotedMessagesMap = new Map<
            string,
            { content: string | null; fromMe: boolean; senderJid: string | null; pushName: string | null }
        >();
        if (quoteIds.length > 0) {
            try {
                const quotedMsgs = await prisma.message.findMany({
                    where: { sessionId: dbSessionId, keyId: { in: quoteIds } },
                    select: {
                        keyId: true,
                        content: true,
                        fromMe: true,
                        senderJid: true,
                        pushName: true,
                    },
                });
                quotedMsgs.forEach((qm) => {
                    quotedMessagesMap.set(qm.keyId, {
                        content: qm.content,
                        fromMe: qm.fromMe,
                        senderJid: qm.senderJid,
                        pushName: qm.pushName,
                    });
                });
            } catch (e) {
                console.error("Failed to batch load quoted messages:", e);
            }
        }

        const messagesWithQuote = messages.map((m: any) => {
            const quoted = m.quoteId ? quotedMessagesMap.get(m.quoteId) : undefined;
            return {
                ...m,
                quoted: quoted
                    ? {
                          keyId: m.quoteId,
                          content: quoted.content,
                          fromMe: quoted.fromMe,
                          senderJid: quoted.senderJid,
                          pushName: quoted.pushName,
                      }
                    : null,
            };
        });

        return {
            messages: messagesWithQuote.reverse(),
            hasMore,
        };
    }

    /**
     * Ask Baileys to pull older messages for this chat into messaging-history.set.
     */
    private static async requestHistoryFromWhatsApp(
        dbSessionId: string,
        jid: string,
        oldestLocal: { keyId: string; timestamp: Date; fromMe: boolean; remoteJid: string } | null
    ) {
        const cooldownKey = `${dbSessionId}:${jid}`;
        const last = historyFetchCooldown.get(cooldownKey) || 0;
        if (Date.now() - last < HISTORY_COOLDOWN_MS) return;
        historyFetchCooldown.set(cooldownKey, Date.now());

        try {
            const session = await prisma.session.findFirst({
                where: { id: dbSessionId },
                select: { sessionId: true },
            });
            if (!session) return;

            const instance = waManager.getInstance(session.sessionId);
            const sock = instance?.socket;
            if (!sock || typeof sock.fetchMessageHistory !== "function") return;

            // Need a real local message as anchor — synthetic keys are ignored by WA
            if (!oldestLocal?.keyId) return;

            const targetJid = normalizeJid(jid) || jid;
            await sock.fetchMessageHistory(
                50,
                {
                    remoteJid: oldestLocal.remoteJid || targetJid,
                    id: oldestLocal.keyId,
                    fromMe: oldestLocal.fromMe,
                },
                Math.floor(new Date(oldestLocal.timestamp).getTime() / 1000)
            );
        } catch (e) {
            console.error("fetchMessageHistory failed:", e);
        }
    }

    static async sendTextMessage(
        sessionId: string,
        jid: string,
        messagePayload: any,
        mentions?: string[],
        quotedMessageId?: string
    ) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw new Error("WhatsApp session is disconnected or not found");
        }

        jid = toWhatsAppJid(jid);
        if (!jid) {
            throw new Error("Invalid recipient JID");
        }

        if (jid.endsWith("@s.whatsapp.net") && instance.socket.onWhatsApp) {
            try {
                const phone = jid.replace(/@s\.whatsapp\.net$/i, "");
                const checkResult = await instance.socket.onWhatsApp(phone);
                const hit = Array.isArray(checkResult) ? checkResult[0] : null;
                if (hit?.exists && hit.jid) {
                    jid = String(hit.jid);
                } else if (hit && hit.exists === false) {
                    throw new Error(`Number is not on WhatsApp: ${phone}`);
                }
            } catch (e: any) {
                if (e?.message?.startsWith("Number is not on WhatsApp")) throw e;
            }
        }

        let quotedOption: any = undefined;
        if (quotedMessageId) {
            try {
                const dbSession = await prisma.session.findUnique({
                    where: { sessionId },
                    select: { id: true },
                });
                if (dbSession) {
                    const quotedMsg = await prisma.message.findFirst({
                        where: { sessionId: dbSession.id, keyId: quotedMessageId },
                        select: {
                            keyId: true,
                            remoteJid: true,
                            fromMe: true,
                            content: true,
                            senderJid: true,
                        },
                    });
                    if (quotedMsg) {
                        const rawParticipant = quotedMsg.fromMe
                            ? instance.socket.user?.id
                            : quotedMsg.senderJid || quotedMsg.remoteJid;

                        let cleanParticipant: string | undefined = undefined;
                        if (rawParticipant) {
                            const [userPart, domain] = rawParticipant.split("@");
                            const cleanUser = userPart.split(":")[0];
                            cleanParticipant = domain ? `${cleanUser}@${domain}` : cleanUser;
                        }

                        quotedOption = {
                            key: {
                                remoteJid: quotedMsg.remoteJid,
                                fromMe: quotedMsg.fromMe,
                                id: quotedMsg.keyId,
                                participant: cleanParticipant,
                            },
                            message: {
                                conversation: quotedMsg.content || "",
                            },
                        };
                    }
                }
            } catch (e) {
                console.error("Error fetching quoted message (non-fatal):", e);
            }
        }

        let msgPayload = { ...messagePayload };

        if (
            msgPayload.text &&
            (msgPayload.image || msgPayload.video || msgPayload.document || msgPayload.audio)
        ) {
            if (!msgPayload.caption) {
                msgPayload.caption = msgPayload.text;
            }
            delete msgPayload.text;
        }

        if (msgPayload.sticker && (msgPayload.sticker.url || typeof msgPayload.sticker === "string")) {
            const url = msgPayload.sticker.url || msgPayload.sticker;
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Failed to fetch sticker media`);
                const buffer = await res.arrayBuffer();
                const sticker = new Sticker(Buffer.from(buffer), {
                    pack: msgPayload.sticker.pack || "WA-AKG Bot",
                    author: msgPayload.sticker.author || "WA-AKG",
                    type: "full",
                    quality: 50,
                });
                msgPayload = { sticker: await sticker.toBuffer() };
            } catch (e: any) {
                throw new Error(`Failed to generate sticker from URL: ${e.message}`);
            }
        }

        if (msgPayload.image && typeof msgPayload.image === "object" && msgPayload.image.url) {
            try {
                const res = await fetch(msgPayload.image.url);
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                const buffer = await res.arrayBuffer();
                msgPayload.image = Buffer.from(buffer);
            } catch (e: any) {
                throw new Error(`Failed to fetch image from URL: ${e.message}`);
            }
        }

        if (msgPayload.video && typeof msgPayload.video === "object" && msgPayload.video.url) {
            try {
                const res = await fetch(msgPayload.video.url);
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                const buffer = await res.arrayBuffer();
                msgPayload.video = Buffer.from(buffer);
            } catch (e: any) {
                throw new Error(`Failed to fetch video from URL: ${e.message}`);
            }
        }

        if (
            msgPayload.document &&
            typeof msgPayload.document === "object" &&
            msgPayload.document.url
        ) {
            try {
                const res = await fetch(msgPayload.document.url);
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                const buffer = await res.arrayBuffer();
                msgPayload.document = Buffer.from(buffer);
            } catch (e: any) {
                throw new Error(`Failed to fetch document from URL: ${e.message}`);
            }
        }

        if (msgPayload.audio && typeof msgPayload.audio === "object" && msgPayload.audio.url) {
            try {
                const res = await fetch(msgPayload.audio.url);
                if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                const buffer = await res.arrayBuffer();
                msgPayload.audio = Buffer.from(buffer);
            } catch (e: any) {
                throw new Error(`Failed to fetch audio from URL: ${e.message}`);
            }
        }

        if (msgPayload.text && mentions && Array.isArray(mentions)) {
            msgPayload.mentions = mentions;
        }

        const options: any = { mentions: mentions || [] };
        if (quotedOption) {
            options.quoted = quotedOption;
        }

        const sendResult = await instance.socket.sendMessage(jid, msgPayload, options);

        try {
            const webhookMsg: any = {
                key: sendResult?.key || sendResult || {},
                message: {
                    conversation:
                        typeof msgPayload.text === "string"
                            ? msgPayload.text
                            : msgPayload.caption || "",
                },
                messageTimestamp: Math.floor(Date.now() / 1000),
            };

            if (msgPayload.image) {
                webhookMsg.message = {
                    imageMessage: {
                        caption: msgPayload.caption || "",
                        mimetype: msgPayload.mimetype || "image/jpeg",
                    },
                };
            } else if (msgPayload.video) {
                webhookMsg.message = {
                    videoMessage: {
                        caption: msgPayload.caption || "",
                        mimetype: msgPayload.mimetype || "video/mp4",
                    },
                };
            } else if (msgPayload.audio) {
                webhookMsg.message = {
                    audioMessage: {
                        mimetype: msgPayload.ptt ? "audio/ogg; codecs=opus" : "audio/mp4",
                    },
                };
            } else if (msgPayload.document) {
                webhookMsg.message = {
                    documentMessage: {
                        caption: msgPayload.caption || "",
                        fileName: msgPayload.fileName || "document",
                        mimetype: msgPayload.mimetype || "application/octet-stream",
                    },
                };
            } else if (msgPayload.sticker) {
                webhookMsg.message = { stickerMessage: {} };
            }

            onMessageSent(sessionId, webhookMsg).catch((e) => console.error("Webhook error:", e));
        } catch {
            // non-blocking
        }

        return sendResult;
    }

    static async sendMediaMessage(
        sessionId: string,
        jid: string,
        buffer: Buffer,
        type: string,
        mimetype: string,
        fileName: string,
        caption: string
    ) {
        const instance = waManager.getInstance(sessionId);
        if (!instance || !instance.socket) {
            throw new Error("WhatsApp session is disconnected or not found");
        }

        const messageOptions: any = {};
        if (caption) messageOptions.caption = caption;
        messageOptions.mimetype = mimetype;

        let content: any = {};

        if (type === "image") {
            content = { image: buffer, ...messageOptions };
        } else if (type === "video") {
            content = { video: buffer, ...messageOptions };
        } else if (type === "audio") {
            content = { audio: buffer, mimetype: "audio/mp4", ptt: false };
        } else if (type === "voice") {
            content = { audio: buffer, mimetype: "audio/mp4", ptt: true };
        } else if (type === "document") {
            content = { document: buffer, mimetype, fileName, ...messageOptions };
        } else if (type === "sticker") {
            const sticker = new Sticker(buffer, {
                pack: "WA-AKG Bot",
                author: "WA-AKG",
                type: "full",
                quality: 50,
            });
            content = { sticker: await sticker.toBuffer() };
        } else {
            content = { document: buffer, mimetype, fileName, ...messageOptions };
        }

        const sendResult = await instance.socket.sendMessage(jid, content);

        try {
            const webhookMsg: any = {
                key: sendResult?.key || sendResult || {},
                message: { conversation: caption || "" },
                messageTimestamp: Math.floor(Date.now() / 1000),
            };

            if (type === "image") {
                webhookMsg.message = { imageMessage: { caption: caption || "", mimetype } };
            } else if (type === "video") {
                webhookMsg.message = { videoMessage: { caption: caption || "", mimetype } };
            } else if (type === "audio" || type === "voice") {
                webhookMsg.message = {
                    audioMessage: { mimetype: "audio/mp4", ptt: type === "voice" },
                };
            } else if (type === "document") {
                webhookMsg.message = {
                    documentMessage: { caption: caption || "", fileName, mimetype },
                };
            } else if (type === "sticker") {
                webhookMsg.message = { stickerMessage: {} };
            }

            onMessageSent(sessionId, webhookMsg).catch((e) => console.error("Webhook error:", e));
        } catch {
            // non-blocking
        }

        return sendResult;
    }
}
