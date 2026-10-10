import { NextResponse } from "next/server";
import { isDatafyChannelId, isReservedChannelId } from "./ids";

/**
 * Block Baileys-only API routes when the client passes the Datafy channel id.
 * Prevents accidental QR / send / contacts calls against a non-Baileys id.
 */
export function baileysRouteRejectedForChannel(channelId: string | null | undefined): {
    rejected: boolean;
    response?: NextResponse;
} {
    if (!channelId) {
        return { rejected: false };
    }

    if (isDatafyChannelId(channelId) || isReservedChannelId(channelId)) {
        return {
            rejected: true,
            response: NextResponse.json(
                {
                    status: false,
                    message:
                        "Este canal é Datafy (oficial). Operações Baileys (QR, chat nativo, grupos) não se aplicam a este identificador.",
                    error: "DATAFY_CHANNEL_NOT_BAILEYS",
                    provider: "datafy",
                },
                { status: 400 }
            ),
        };
    }

    return { rejected: false };
}

/** Phase 2: outbound Datafy campaigns remain disabled. */
export function datafyOutboundNotImplementedResponse(): NextResponse {
    return NextResponse.json(
        {
            status: false,
            message:
                "Disparos via canal oficial Datafy estarão disponíveis em uma fase futura. Use uma sessão Baileys para envios atuais.",
            error: "DATAFY_OUTBOUND_NOT_ENABLED",
            provider: "datafy",
            outboundCampaignsEnabled: false,
        },
        { status: 403 }
    );
}
