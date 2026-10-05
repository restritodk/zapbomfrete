import { prisma } from "../src/lib/prisma";
import { ChatService } from "../src/modules/whatsapp/chat.service";

async function main() {
    const s = await prisma.session.findFirst({ where: { sessionId: "sdsa" } });
    if (!s) throw new Error("no session");
    const list = await ChatService.getChatsList(s.id, 20);
    console.log("count", list.length);
    for (const c of list.slice(0, 12)) {
        console.log({
            name: c.name || c.notify || c.jid,
            type: c.lastMessage?.type,
            preview: (c.lastMessage?.content || "").slice(0, 40),
            jid: c.jid,
        });
    }
    const empty = list.filter(
        (c) =>
            !c.lastMessage?.content &&
            (!c.lastMessage?.type || c.lastMessage.type === "TEXT")
    );
    console.log("empty text previews:", empty.length);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
