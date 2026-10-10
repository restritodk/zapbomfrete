import { NextRequest, NextResponse } from "next/server";
import { requireDatafyChatAccess } from "@/modules/datafy/chat/auth-gate";
import { prisma } from "@/lib/prisma";
import { serializeCrmContact } from "@/modules/crm/serialize";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";

export const dynamic = "force-dynamic";

/** GET CRM contact linked to a Datafy conversation (authorized chat users). */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireDatafyChatAccess(request);
    if (gate.error) return gate.error;

    const { id } = await params;
    const conv = await prisma.datafyConversation.findFirst({
        where: { id, channelId: DATAFY_OFFICIAL_CHANNEL_ID },
        include: {
            crmContact: {
                include: {
                    tags: { include: { tag: true } },
                },
            },
        },
    });

    if (!conv) {
        return NextResponse.json(
            { status: false, message: "Conversa não encontrada" },
            { status: 404 }
        );
    }

    return NextResponse.json({
        status: true,
        data: {
            conversationId: conv.id,
            waId: conv.waId,
            contact: conv.crmContact
                ? serializeCrmContact(conv.crmContact)
                : null,
        },
    });
}
