import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDatafyChatAccess } from "@/modules/datafy/chat/auth-gate";
import { transferConversation, DatafyApiError } from "@/modules/datafy";
import { canAccessDatafyChannel } from "@/modules/channels/access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const schema = z.object({
    toUserId: z.string().min(1),
    note: z.string().max(240).optional(),
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireDatafyChatAccess(request);
    if (gate.error) return gate.error;

    try {
        const { id } = await params;
        const body = await request.json().catch(() => null);
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Payload inválido" },
                { status: 400 }
            );
        }

        const target = await prisma.user.findUnique({
            where: { id: parsed.data.toUserId },
            select: { id: true, role: true },
        });
        if (!target) {
            return NextResponse.json(
                { status: false, message: "Usuário destino não encontrado" },
                { status: 400 }
            );
        }
        const targetAllowed = await canAccessDatafyChannel(
            target.id,
            target.role
        );
        if (!targetAllowed) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Destino sem acesso operacional ao canal Datafy",
                },
                { status: 403 }
            );
        }

        const conversation = await transferConversation({
            conversationId: id,
            fromUserId: gate.user.id,
            toUserId: parsed.data.toUserId,
            note: parsed.data.note,
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
            { status: false, message: "Falha ao transferir" },
            { status: 500 }
        );
    }
}
