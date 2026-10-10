import { NextRequest, NextResponse } from "next/server";
import { requireDatafyChatAccess } from "@/modules/datafy/chat/auth-gate";
import { DatafyApiError, resolveInboundMediaUrl } from "@/modules/datafy";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";

export const dynamic = "force-dynamic";

/** Authorized proxy metadata for inbound Datafy media (no token to client). */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ mediaId: string }> }
) {
    const gate = await requireDatafyChatAccess(request);
    if (gate.error) return gate.error;

    try {
        const { mediaId } = await params;
        if (!/^[A-Za-z0-9_-]{6,80}$/.test(mediaId)) {
            return NextResponse.json(
                { status: false, message: "mediaId inválido" },
                { status: 400 }
            );
        }
        const media = await resolveInboundMediaUrl(mediaId);
        // Only return Datafy-hosted HTTPS URLs
        if (media.url && !/^https:\/\/midia\.datafyapi\.com\.br\//i.test(media.url)) {
            return NextResponse.json(
                {
                    status: true,
                    data: {
                        url: null,
                        mime_type: media.mime_type || null,
                        size: media.size ?? null,
                        note: "URL não reconhecida — baixe via painel Datafy se necessário",
                    },
                }
            );
        }
        return NextResponse.json({
            status: true,
            data: {
                url: media.url || null,
                mime_type: media.mime_type || null,
                size: media.size ?? null,
            },
        });
    } catch (e) {
        if (e instanceof DatafyApiError) {
            return NextResponse.json(
                { status: false, message: redactSecrets(e.message) },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao obter mídia" },
            { status: 500 }
        );
    }
}