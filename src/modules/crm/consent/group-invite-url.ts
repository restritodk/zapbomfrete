/**
 * WhatsApp group invite URL validation (official chat.whatsapp.com invites).
 */

export const WHATSAPP_GROUP_HOST = "chat.whatsapp.com";

export type GroupInviteUrlValidation =
    | { ok: true; normalized: string; inviteCode: string }
    | { ok: false; error: string };

/** Accept only https://chat.whatsapp.com/<code> (optional query/hash stripped). */
export function validateWhatsappGroupInviteUrl(
    raw: string | null | undefined
): GroupInviteUrlValidation {
    const trimmed = String(raw || "").trim();
    if (!trimmed) {
        return { ok: false, error: "Informe a URL do convite do grupo." };
    }
    if (/\s/.test(trimmed)) {
        return { ok: false, error: "A URL não pode conter espaços." };
    }
    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        return { ok: false, error: "URL malformada." };
    }
    if (url.protocol !== "https:") {
        return {
            ok: false,
            error: "Use apenas HTTPS (esquemas inseguros são bloqueados).",
        };
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== WHATSAPP_GROUP_HOST) {
        return {
            ok: false,
            error: `O convite deve ser do domínio oficial ${WHATSAPP_GROUP_HOST}.`,
        };
    }
    const code = url.pathname.replace(/^\/+|\/+$/g, "").split("/")[0] || "";
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(code)) {
        return {
            ok: false,
            error: "Código de convite inválido no caminho da URL.",
        };
    }
    return {
        ok: true,
        normalized: `https://${WHATSAPP_GROUP_HOST}/${code}`,
        inviteCode: code,
    };
}

export function isWhatsappGroupInviteUrl(raw: string | null | undefined): boolean {
    return validateWhatsappGroupInviteUrl(raw).ok;
}
