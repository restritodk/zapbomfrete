import { NextRequest, NextResponse } from "next/server";
import { verifyGroupInviteToken } from "@/modules/crm/group-invite/tracking";
import {
    recordGroupInviteClick,
    sendGroupExclusiveNotice,
} from "@/modules/crm/group-invite/events";
import { validateWhatsappGroupInviteUrl } from "@/modules/crm/consent/group-invite-url";
import { loadDatafyConfig } from "@/modules/datafy/config";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Public tracked redirect for WhatsApp group invites.
 * Logs click → sends "*Usuário no grupo exclusivo*" (best-effort) → redirects.
 * Never claims the user joined the group.
 */
export async function GET(
    _request: NextRequest,
    ctx: { params: Promise<{ token: string }> }
) {
    const { token: rawToken } = await ctx.params;
    const token = decodeURIComponent(rawToken || "");
    const verified = verifyGroupInviteToken(token);
    if (!verified.ok) {
        return new NextResponse(
            `<!doctype html><html lang="pt-BR"><meta charset="utf-8"/><title>Link inválido</title>
<body style="font-family:system-ui;padding:2rem;max-width:28rem;margin:auto">
<h1>Link inválido ou expirado</h1>
<p>Não foi possível abrir o convite do grupo. Solicite um novo link à Bom Frete.</p>
</body></html>`,
            {
                status: 400,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            }
        );
    }

    const { payload } = verified;
    const urlCheck = validateWhatsappGroupInviteUrl(payload.inviteUrl);
    if (!urlCheck.ok) {
        return new NextResponse(
            `<!doctype html><html lang="pt-BR"><meta charset="utf-8"/><title>Convite indisponível</title>
<body style="font-family:system-ui;padding:2rem;max-width:28rem;margin:auto">
<h1>Convite indisponível</h1>
<p>O link do grupo está revogado, expirado ou inválido. Não confirmamos ingresso.</p>
</body></html>`,
            {
                status: 410,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            }
        );
    }

    try {
        await recordGroupInviteClick({
            organizationKey: payload.organizationKey,
            waId: payload.waId,
            inviteUrl: urlCheck.normalized,
            campaignId: payload.campaignId,
            recipientId: payload.recipientId,
            trackingToken: token,
        });
    } catch (e) {
        logger.warn(
            "GroupInviteRedirect",
            e instanceof Error ? e.message : "click record failed"
        );
    }

    // Best-effort: open 24h window with notice (does not confirm group join).
    try {
        const cfg = await loadDatafyConfig();
        if (cfg.phoneNumberId) {
            void sendGroupExclusiveNotice({
                waId: payload.waId,
                phoneNumberId: cfg.phoneNumberId,
            });
        }
    } catch {
        /* non-blocking */
    }

    return NextResponse.redirect(urlCheck.normalized, 302);
}
