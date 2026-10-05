import { prisma } from "../src/lib/prisma";
import { ChatService } from "../src/modules/whatsapp/chat.service";

async function main() {
    const s = await prisma.session.findFirst({ where: { sessionId: "sdsa" } });
    if (!s) throw new Error("no session");
    const list = await ChatService.getChatsList(s.id, 25);
    console.log("count", list.length);
    for (const c of list) {
        const looksLikeLid = /^\d{14,}$/.test((c.name || "").replace(/\D/g, ""));
        console.log({
            name: c.name,
            jid: c.jid,
            phoneJid: c.phoneJid,
            pic: c.profilePic ? "yes" : "no",
            badLidName: looksLikeLid,
        });
    }
    const bad = list.filter((c) => /^\d{14,}$/.test((c.name || "").replace(/\D/g, "")) || c.jid.endsWith("@lid") && c.name === c.jid.split("@")[0]);
    console.log("bad lid displays:", bad.length);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
