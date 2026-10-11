import { CONSENT_DECISION } from "./constants";
import type { ConsentDecisionCode } from "./constants";
import { consentDb } from "./db";

function maskWa(waId: string): string {
    const d = waId.replace(/\D/g, "");
    if (d.length < 4) return "****";
    return `${d.slice(0, 4)}…${d.slice(-4)}`;
}

export async function notifyConsentDecision(opts: {
    decision: ConsentDecisionCode;
    waId: string;
    fullName?: string | null;
    source: string;
}) {
    const db = consentDb();
    const users = await db.user.findMany({
        where: { role: { in: ["OWNER", "SUPERADMIN"] } },
        select: { id: true },
        take: 50,
    });
    if (!users.length) return;

    const who = opts.fullName?.trim() || maskWa(opts.waId);
    let title = "Consentimento atualizado";
    let message = `Contato ${who}: status atualizado.`;
    let type: "INFO" | "SUCCESS" | "WARNING" = "INFO";

    if (opts.decision === CONSENT_DECISION.GRANTED) {
        title = "Novo consentimento registrado";
        message = `${who} autorizou receber ofertas pelo WhatsApp.`;
        type = "SUCCESS";
    } else if (
        opts.decision === CONSENT_DECISION.DENIED ||
        opts.decision === CONSENT_DECISION.REVOKED
    ) {
        title = "Contato pediu para não receber";
        message = `${who} recusou ou revogou o recebimento de ofertas.`;
        type = "WARNING";
    }

    await db.notification.createMany({
        data: users.map((u) => ({
            userId: u.id,
            title,
            message,
            type,
            href: "/dashboard/contatos/consentimentos",
        })),
    });

    try {
        const io = (
            global as {
                io?: {
                    to: (r: string) => {
                        emit: (e: string, p: unknown) => void;
                    };
                };
            }
        ).io;
        if (io) {
            for (const u of users) {
                io.to(`user:${u.id}`).emit("notification:new", {
                    userId: u.id,
                    title,
                    message,
                    type,
                    href: "/dashboard/contatos/consentimentos",
                    createdAt: new Date().toISOString(),
                    read: false,
                });
            }
        }
    } catch {
        /* socket may be unavailable in tests */
    }
}
