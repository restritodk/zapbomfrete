import { NextRequest, NextResponse } from "next/server";
import { requireDatafyChatAccess } from "@/modules/datafy/chat/auth-gate";
import { DatafyApiError, markConversationRead } from "@/modules/datafy";

export const dynamic = "force-dynamic";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireDatafyChatAccess(request);
    if (gate.error) return gate.error;

    try {
        const { id } = await params;
        const body = await request.json().catch(() => ({}));
        const conversation = await markConversationRead({
            conversationId: id,
            markProviderRead: Boolean(body?.markProviderRead),
        });
        return NextResponse.json({ status: true, data: { conversation } });
    } catch (e) {
        if (e instanceof DatafyApiError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao marcar como lida" },
            { status: 500 }
        );
    }
}
