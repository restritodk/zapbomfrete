import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { DatafyApiError } from "../client";
import { datafyProvider } from "../provider";
import { redactSecrets } from "../crypto-secrets";
import { loadDatafyConfig } from "../config";
import { isWithinServiceWindow, normalizeWaId, serviceWindowExpiresAt } from "./window";
import { emitDatafyEvent } from "./realtime";
import { serializeMessage, serializeConversation } from "./persist";
import { randomUUID } from "crypto";

export type SendTextInput = {
    conversationId: string;
    text: string;
    userId: string;
    clientMessageId?: string | null;
    contextMessageId?: string | null;
};

export type SendTemplateInput = {
    conversationId: string;
    userId: string;
    templateName: string;
    languageCode: string;
    components?: unknown[];
    clientMessageId?: string | null;
};

function previewTemplate(name: string, components?: unknown[]): string {
    const texts: string[] = [];
    for (const c of components || []) {
        const comp = c as { parameters?: Array<{ text?: string }> };
        for (const p of comp.parameters || []) {
            if (p.text) texts.push(p.text);
        }
    }
    return texts.length
        ? `[template:${name}] ${texts.join(" · ")}`
        : `[template:${name}]`;
}

export async function sendDatafyText(input: SendTextInput) {
    const text = input.text.trim();
    if (!text) {
        throw new DatafyApiError("Mensagem vazia", 400);
    }
    if (text.length > 4096) {
        throw new DatafyApiError("Mensagem excede 4096 caracteres", 400);
    }

    const clientMessageId =
        input.clientMessageId?.trim() || `cli_${randomUUID()}`;

    const existing = await prisma.datafyMessage.findUnique({
        where: { clientMessageId },
    });
    if (existing) {
        return { duplicate: true as const, message: serializeMessage(existing) };
    }

    const conversation = await prisma.datafyConversation.findUnique({
        where: { id: input.conversationId },
    });
    if (!conversation) {
        throw new DatafyApiError("Conversa não encontrada", 404);
    }

    if (!isWithinServiceWindow(conversation.lastCustomerMessageAt)) {
        throw new DatafyApiError(
            "Janela de 24 horas fechada. Envie um template aprovado pela Meta para retomar o contato.",
            403
        );
    }

    const cfg = await loadDatafyConfig();
    if (!cfg.enabled || !cfg.channelToken) {
        throw new DatafyApiError("Integração Datafy indisponível", 503);
    }
    const phoneNumberId = cfg.phoneNumberId || conversation.phoneNumberId;
    if (!phoneNumberId) {
        throw new DatafyApiError(
            "phone_number_id indisponível — verifique a conexão Datafy",
            400
        );
    }

    const to = normalizeWaId(conversation.waId);
    const pending = await prisma.datafyMessage.create({
        data: {
            conversationId: conversation.id,
            clientMessageId,
            direction: "outbound",
            type: "text",
            body: text,
            status: "pending",
            sentByUserId: input.userId,
        },
    });

    try {
        const client = await datafyProvider.createClient();
        const res = await client.sendText(phoneNumberId, {
            to,
            text,
            contextMessageId: input.contextMessageId || undefined,
        });
        const wamid = res.messages?.[0]?.id || null;
        const updated = await prisma.datafyMessage.update({
            where: { id: pending.id },
            data: {
                wamid,
                status: "accepted",
                providerTimestamp: new Date(),
            },
        });
        const conv = await prisma.datafyConversation.update({
            where: { id: conversation.id },
            data: {
                lastMessagePreview: text.slice(0, 280),
                lastMessageAt: new Date(),
            },
            include: {
                assignedTo: {
                    select: { id: true, name: true, email: true },
                },
            },
        });

        const serialized = serializeMessage(updated);
        emitDatafyEvent("datafy.message", {
            conversationId: conversation.id,
            message: serialized,
        });
        emitDatafyEvent("datafy.conversation", {
            conversation: serializeConversation(conv),
        });

        return { duplicate: false as const, message: serialized };
    } catch (e) {
        const message =
            e instanceof DatafyApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "Falha ao enviar";
        const safe = redactSecrets(message).slice(0, 240);
        const failed = await prisma.datafyMessage.update({
            where: { id: pending.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                errorCode: e instanceof DatafyApiError ? e.statusCode : null,
                errorMessage: safe,
            },
        });
        emitDatafyEvent("datafy.status", {
            conversationId: conversation.id,
            message: serializeMessage(failed),
        });
        throw new DatafyApiError(safe, e instanceof DatafyApiError ? e.statusCode : 502);
    }
}

export async function sendDatafyTemplate(input: SendTemplateInput) {
    const clientMessageId =
        input.clientMessageId?.trim() || `cli_${randomUUID()}`;

    const existing = await prisma.datafyMessage.findUnique({
        where: { clientMessageId },
    });
    if (existing) {
        return { duplicate: true as const, message: serializeMessage(existing) };
    }

    const conversation = await prisma.datafyConversation.findUnique({
        where: { id: input.conversationId },
    });
    if (!conversation) {
        throw new DatafyApiError("Conversa não encontrada", 404);
    }

    const cfg = await loadDatafyConfig();
    if (!cfg.enabled || !cfg.channelToken) {
        throw new DatafyApiError("Integração Datafy indisponível", 503);
    }
    const phoneNumberId = cfg.phoneNumberId || conversation.phoneNumberId;
    if (!phoneNumberId) {
        throw new DatafyApiError("phone_number_id indisponível", 400);
    }

    const preview = previewTemplate(input.templateName, input.components);
    const pending = await prisma.datafyMessage.create({
        data: {
            conversationId: conversation.id,
            clientMessageId,
            direction: "outbound",
            type: "template",
            body: preview,
            status: "pending",
            sentByUserId: input.userId,
            metadata: {
                templateName: input.templateName,
                languageCode: input.languageCode,
                components: (input.components || []) as Prisma.InputJsonValue,
            } as Prisma.InputJsonValue,
        },
    });

    try {
        const client = await datafyProvider.createClient();
        const res = await client.sendTemplate(phoneNumberId, {
            to: normalizeWaId(conversation.waId),
            name: input.templateName,
            languageCode: input.languageCode || "pt_BR",
            components: input.components,
        });
        const wamid = res.messages?.[0]?.id || null;
        const updated = await prisma.datafyMessage.update({
            where: { id: pending.id },
            data: {
                wamid,
                status: "accepted",
                providerTimestamp: new Date(),
            },
        });
        const conv = await prisma.datafyConversation.update({
            where: { id: conversation.id },
            data: {
                lastMessagePreview: preview.slice(0, 280),
                lastMessageAt: new Date(),
            },
            include: {
                assignedTo: {
                    select: { id: true, name: true, email: true },
                },
            },
        });

        const serialized = serializeMessage(updated);
        emitDatafyEvent("datafy.message", {
            conversationId: conversation.id,
            message: serialized,
        });
        emitDatafyEvent("datafy.conversation", {
            conversation: serializeConversation(conv),
        });
        return { duplicate: false as const, message: serialized };
    } catch (e) {
        const message =
            e instanceof DatafyApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "Falha ao enviar template";
        const safe = redactSecrets(message).slice(0, 240);
        const failed = await prisma.datafyMessage.update({
            where: { id: pending.id },
            data: {
                status: "failed",
                failedAt: new Date(),
                errorCode: e instanceof DatafyApiError ? e.statusCode : null,
                errorMessage: safe,
            },
        });
        emitDatafyEvent("datafy.status", {
            conversationId: conversation.id,
            message: serializeMessage(failed),
        });
        throw new DatafyApiError(safe, e instanceof DatafyApiError ? e.statusCode : 502);
    }
}

export function conversationWindowInfo(lastCustomerMessageAt: Date | null) {
    const open = isWithinServiceWindow(lastCustomerMessageAt);
    return {
        open,
        expiresAt: serviceWindowExpiresAt(lastCustomerMessageAt)?.toISOString() ?? null,
        lastCustomerMessageAt: lastCustomerMessageAt?.toISOString() ?? null,
    };
}
