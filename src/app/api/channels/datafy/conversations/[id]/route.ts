import { NextRequest, NextResponse } from "next/server";
import { requireDatafyChatAccess } from "@/modules/datafy/chat/auth-gate";
import { getDatafyConversation, DatafyApiError } from "@/modules/datafy";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireDatafyChatAccess(request);
    if (gate.error) return gate.error;

    try {
        const { id } = await params;
        const data = await getDatafyConversation(id);
        return NextResponse.json({ status: true, data });
    } catch (e) {
        if (e instanceof DatafyApiError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Erro ao carregar conversa" },
            { status: 500 }
        );
    }
}
