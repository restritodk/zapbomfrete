import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireDatafyChatAccess } from "@/modules/datafy/chat/auth-gate";
import {
    DatafyApiError,
    listDatafyMessages,
    sendDatafyText,
    sendDatafyTemplate,
} from "@/modules/datafy";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireDatafyChatAccess(request);
    if (gate.error) return gate.error;

    try {
        const { id } = await params;
        const { searchParams } = new URL(request.url);
        const data = await listDatafyMessages({
            conversationId: id,
            cursor: searchParams.get("cursor"),
            limit: Number(searchParams.get("limit") || 50) || 50,
        });
        return NextResponse.json({ status: true, data });
    } catch (e) {
        if (e instanceof DatafyApiError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Erro ao listar mensagens" },
            { status: 500 }
        );
    }
}

const postSchema = z.discriminatedUnion("kind", [
    z.object({
        kind: z.literal("text"),
        text: z.string().min(1).max(4096),
        clientMessageId: z.string().min(8).max(80).optional(),
        contextMessageId: z.string().optional(),
    }),
    z.object({
        kind: z.literal("template"),
        templateName: z.string().min(1).max(120),
        languageCode: z.string().min(2).max(16).default("pt_BR"),
        components: z.array(z.unknown()).optional(),
        clientMessageId: z.string().min(8).max(80).optional(),
    }),
]);

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireDatafyChatAccess(request);
    if (gate.error) return gate.error;

    try {
        const { id } = await params;
        const body = await request.json().catch(() => null);
        const parsed = postSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Payload inválido" },
                { status: 400 }
            );
        }

        if (parsed.data.kind === "text") {
            const result = await sendDatafyText({
                conversationId: id,
                text: parsed.data.text,
                userId: gate.user.id,
                clientMessageId: parsed.data.clientMessageId,
                contextMessageId: parsed.data.contextMessageId,
            });
            return NextResponse.json({
                status: true,
                data: result,
            });
        }

        const result = await sendDatafyTemplate({
            conversationId: id,
            userId: gate.user.id,
            templateName: parsed.data.templateName,
            languageCode: parsed.data.languageCode,
            components: parsed.data.components,
            clientMessageId: parsed.data.clientMessageId,
        });
        return NextResponse.json({ status: true, data: result });
    } catch (e) {
        if (e instanceof DatafyApiError) {
            return NextResponse.json(
                { status: false, message: redactSecrets(e.message) },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao enviar mensagem" },
            { status: 500 }
        );
    }
}
