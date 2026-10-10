import { NextRequest, NextResponse } from "next/server";
import { requireDatafyChatAccess } from "@/modules/datafy/chat/auth-gate";
import { claimConversation, DatafyApiError } from "@/modules/datafy";
import { isAdmin } from "@/lib/api-auth";

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
        const force = Boolean(body?.force) && isAdmin(gate.user.role);
        const conversation = await claimConversation({
            conversationId: id,
            userId: gate.user.id,
            force,
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
            { status: false, message: "Falha ao assumir conversa" },
            { status: 500 }
        );
    }
}
