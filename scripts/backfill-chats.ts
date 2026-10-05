import { prisma } from "../src/lib/prisma";
import { ChatService } from "../src/modules/whatsapp/chat.service";

async function main() {
    const s = await prisma.session.findFirst({
        where: { OR: [{ sessionId: "sdsa" }, { name: "Casa" }] },
        orderBy: { updatedAt: "desc" },
    });
    if (!s) {
        console.error("Session not found");
        process.exit(1);
    }

    await ChatService.backfillChatsFromMessages(s.id);
    const n = await prisma.chat.count({ where: { sessionId: s.id } });
    const sample = await prisma.chat.findMany({
        where: { sessionId: s.id },
        orderBy: { lastMessageAt: "desc" },
        take: 10,
        select: { jid: true, name: true, lastPreview: true, lastMessageAt: true },
    });

    console.log(`Backfilled chats for ${s.name} (${s.sessionId}): ${n}`);
    console.log(JSON.stringify(sample, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
