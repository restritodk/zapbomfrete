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

/**
 * Baileys broadcast routes must not accept the Datafy channel id.
 * Official campaigns use /api/channels/datafy/campaigns instead.
 */
export function datafyOutboundNotImplementedResponse(): NextResponse {
    return NextResponse.json(
        {
            status: false,
            message:
                "Este endpoint é exclusivo Baileys. Para campanhas oficiais Datafy use Disparo → WhatsApp Oficial.",
            error: "DATAFY_USE_CAMPAIGNS_MODULE",
            provider: "datafy",
            outboundCampaignsEnabled: true,
        },
        { status: 403 }
    );
}
