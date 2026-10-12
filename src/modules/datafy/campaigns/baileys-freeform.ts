import { prisma } from "@/lib/prisma";
import { formatPhoneDisplay, normalizeBrazilianPhone } from "@/lib/phone-br";
import { brazilianWaIdVariants } from "@/modules/datafy/chat/window";
import { loadDatafyConfig } from "@/modules/datafy/config";

/** Digits of a Baileys user id (`5566…:device@s.whatsapp.net`). */
export function phoneDigitsFromJid(raw: string | null | undefined): string {
    const head = String(raw || "").split("@")[0]?.split(":")[0] || "";
    return normalizeBrazilianPhone(head);
}

/** Same line, including the Brazilian 9th-digit variant. */
export function phonesReferToSameLine(a: string, b: string): boolean {
    const left = brazilianWaIdVariants(normalizeBrazilianPhone(a) || a);
    const right = new Set(
        brazilianWaIdVariants(normalizeBrazilianPhone(b) || b)
    );
    return left.some((v) => right.has(v));
}

export type DatafyBaileysSession = {
    sessionId: string;
    phone: string;
    displayPhone: string;
};

/**
 * Sessão Baileys CONNECTED cujo número é o mesmo cadastrado no canal Datafy.
 * Texto livre não passa pela Cloud API.
 */
export async function resolveBaileysSessionForDatafyNumber(): Promise<DatafyBaileysSession> {
    const cfg = await loadDatafyConfig();
    const target = normalizeBrazilianPhone(cfg.displayPhoneNumber || "");
    if (!target || target.length < 10) {
        throw new Error(
            "O canal Datafy não tem um número de telefone salvo. Verifique a conexão oficial antes de usar Texto livre."
        );
    }
    const display = formatPhoneDisplay(target) || `+${target}`;

    const sessions = await prisma.session.findMany({
        where: { status: { not: "LOGGED_OUT" } },
        select: { sessionId: true },
    });

    const { waManager } = await import("@/modules/whatsapp/manager");

    let sawMatchingOffline = false;
    for (const s of sessions) {
        const inst = waManager.getInstance(s.sessionId);
        const livePhone = phoneDigitsFromJid(inst?.socket?.user?.id);
        if (!livePhone || !phonesReferToSameLine(target, livePhone)) continue;
        const connected =
            String(inst?.status || "").toUpperCase() === "CONNECTED" &&
            Boolean(inst?.socket);
        if (!connected) {
            sawMatchingOffline = true;
            continue;
        }
        return {
            sessionId: s.sessionId,
            phone: livePhone,
            displayPhone: display,
        };
    }

    if (sawMatchingOffline) {
        throw new Error(
            `O número ${display} está no WhatsApp conectado, mas a sessão não está online. Abra Sessões e reconecte esse número para o Texto livre.`
        );
    }
    throw new Error(
        `Texto livre envia pelo WhatsApp conectado (Baileys) com o número da Datafy ${display}. Conecte esse número em Sessões (QR ou código) e dispare de novo. Esse modo não passa pela API da Meta.`
    );
}

export async function sendBaileysCampaignText(
    sessionId: string,
    waId: string,
    text: string
): Promise<{ keyId: string }> {
    const { ChatService } = await import("@/modules/whatsapp/chat.service");
    const result = await ChatService.sendTextMessage(sessionId, waId, {
        text,
    });
    const keyId = result?.key?.id ? String(result.key.id) : "";
    if (!keyId) {
        throw new Error(
            "O WhatsApp conectado não confirmou o envio da mensagem."
        );
    }
    return { keyId };
}
