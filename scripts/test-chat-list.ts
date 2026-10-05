import { prisma } from "../src/lib/prisma";
import { ChatService } from "../src/modules/whatsapp/chat.service";

async function main() {
    const s = await prisma.session.findFirst({ where: { sessionId: "sdsa" } });
    if (!s) throw new Error("no session");
    const list = await ChatService.getChatsList(s.id, 30);
    const named = list.filter((c) => c.name || c.notify);
    console.log(`Total: ${list.length}, with name/notify: ${named.length}`);
    console.log(
        JSON.stringify(
            list.slice(0, 15).map((c) => ({
                jid: c.jid,
                name: c.name,
                notify: c.notify,
                preview: c.lastMessage?.content?.slice(0, 40),
            })),
            null,
            2
        )
    );

    // Test messages for a LID chat that has content
    const lid = list.find((c) => c.jid.includes("@lid") && c.lastMessage?.content);
    if (lid) {
        const msgs = await ChatService.getMessages(s.id, lid.jid, 20);
        console.log(`\nMessages for ${lid.name || lid.notify || lid.jid}: ${msgs.messages.length}`);
        console.log(
            msgs.messages.slice(-5).map((m: any) => ({
                fromMe: m.fromMe,
                content: (m.content || "").slice(0, 50),
                ts: m.timestamp,
            }))
        );
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
