import { prisma } from "../src/lib/prisma";

/**
 * Copy Contact/Group names onto Chat rows so the inbox shows real WhatsApp names.
 */
async function main() {
    const sessions = await prisma.session.findMany({ select: { id: true, name: true } });
    for (const s of sessions) {
        const chats = await prisma.chat.findMany({
            where: { sessionId: s.id },
            select: { id: true, jid: true, name: true },
        });
        let updated = 0;
        for (const chat of chats) {
            if (chat.jid.endsWith("@g.us")) {
                const g = await prisma.group.findUnique({
                    where: { sessionId_jid: { sessionId: s.id, jid: chat.jid } },
                    select: { subject: true },
                });
                if (g?.subject && g.subject !== chat.name) {
                    await prisma.chat.update({
                        where: { id: chat.id },
                        data: { name: g.subject },
                    });
                    updated++;
                }
                continue;
            }

            const contact = await prisma.contact.findFirst({
                where: {
                    sessionId: s.id,
                    OR: [
                        { jid: chat.jid },
                        { lid: chat.jid },
                        { remoteJidAlt: chat.jid },
                    ],
                },
                select: { name: true, notify: true, verifiedName: true },
            });
            const name = contact?.name || contact?.verifiedName || contact?.notify || null;
            if (name && name !== chat.name) {
                await prisma.chat.update({
                    where: { id: chat.id },
                    data: { name },
                });
                updated++;
            }
        }
        console.log(`Session ${s.name}: enriched ${updated}/${chats.length} chat names`);
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
