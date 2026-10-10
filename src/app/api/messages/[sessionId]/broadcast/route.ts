import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import {
    baileysRouteRejectedForChannel,
    datafyOutboundNotImplementedResponse,
    isDatafyChannelId,
} from "@/modules/channels";
import { toWhatsAppJid } from "@/lib/phone-br";
import {
    computeInterRecipientDelayMs,
    normalizeBroadcastDelayMs,
    sleepMs,
} from "@/lib/broadcast-delay";
import {
    CANCELLED_RECIPIENT_DETAIL,
    clearBroadcastCancel,
    registerBroadcastCancel,
} from "@/lib/broadcast-cancel";
import { runBroadcastSendLoop } from "@/lib/broadcast-runner";
import type { AnyMessageContent } from "@whiskeysockets/baileys";
import { z } from "zod";

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 16 * 1024 * 1024; // 16MB

type AttachmentPayload = {
    buffer: Buffer;
    mimetype: string;
    fileName: string;
    kind: "image" | "document";
};

function classifyFile(mimetype: string, fileName: string): "image" | "document" | null {
    const mt = (mimetype || "").toLowerCase();
    const name = (fileName || "").toLowerCase();
    if (mt.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(name)) {
        return "image";
    }
    if (
        mt === "application/pdf" ||
        mt === "application/x-pdf" ||
        name.endsWith(".pdf")
    ) {
        return "document";
    }
    return null;
}

function buildMediaContent(
    att: AttachmentPayload,
    caption?: string
): AnyMessageContent {
    if (att.kind === "image") {
        return {
            image: att.buffer,
            mimetype: att.mimetype || "image/jpeg",
            caption: caption || undefined,
        } as AnyMessageContent;
    }
    return {
        document: att.buffer,
        mimetype: att.mimetype || "application/pdf",
        fileName: att.fileName || "documento.pdf",
        caption: caption || undefined,
    } as AnyMessageContent;
}

async function parseBroadcastRequest(request: NextRequest): Promise<{
    recipients: string[];
    message: string;
    delay?: number;
    attachments: AttachmentPayload[];
}> {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
        const form = await request.formData();
        const message = String(form.get("message") || "");
        const delayRaw = form.get("delay");
        const delay =
            delayRaw != null && String(delayRaw).trim() !== ""
                ? normalizeBroadcastDelayMs(delayRaw)
                : undefined;

        let recipients: string[] = [];
        const recipientsRaw = form.get("recipients");
        if (typeof recipientsRaw === "string") {
            try {
                const parsed = JSON.parse(recipientsRaw);
                if (Array.isArray(parsed)) recipients = parsed.map(String);
            } catch {
                recipients = [];
            }
        }

        const attachments: AttachmentPayload[] = [];
        const files = form.getAll("files").filter((f): f is File => f instanceof File);

        if (files.length > MAX_ATTACHMENTS) {
            throw Object.assign(new Error(`Máximo de ${MAX_ATTACHMENTS} anexos`), { status: 400 });
        }

        for (const file of files) {
            if (file.size > MAX_FILE_BYTES) {
                throw Object.assign(
                    new Error(`Arquivo muito grande: ${file.name} (máx. 16MB)`),
                    { status: 400 }
                );
            }
            const kind = classifyFile(file.type, file.name);
            if (!kind) {
                throw Object.assign(
                    new Error(`Tipo não suportado: ${file.name}. Use imagens ou PDF.`),
                    { status: 400 }
                );
            }
            const buffer = Buffer.from(await file.arrayBuffer());
            attachments.push({
                buffer,
                mimetype: file.type || (kind === "image" ? "image/jpeg" : "application/pdf"),
                fileName: file.name || (kind === "image" ? "imagem.jpg" : "documento.pdf"),
                kind,
            });
        }

        return { recipients, message, delay, attachments };
    }

    const body = await request.json();
    const schema = z.object({
        recipients: z.array(z.string()),
        message: z.string().optional().default(""),
        delay: z.number().optional(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        throw Object.assign(new Error("Invalid body"), {
            status: 400,
            details: parsed.error.flatten(),
        });
    }
    return {
        recipients: parsed.data.recipients,
        message: parsed.data.message || "",
        delay:
            parsed.data.delay !== undefined
                ? normalizeBroadcastDelayMs(parsed.data.delay)
                : undefined,
        attachments: [],
    };
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Unauthorized", error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { sessionId } = await params;

        if (isDatafyChannelId(sessionId) || baileysRouteRejectedForChannel(sessionId).rejected) {
            return datafyOutboundNotImplementedResponse();
        }

        let payload: Awaited<ReturnType<typeof parseBroadcastRequest>>;
        try {
            payload = await parseBroadcastRequest(request);
        } catch (e: any) {
            return NextResponse.json(
                {
                    status: false,
                    message: e.message || "Invalid request",
                    error: e.message || "Invalid request",
                    details: e.details,
                },
                { status: e.status || 400 }
            );
        }

        const { message, attachments } = payload;
        const delay = normalizeBroadcastDelayMs(payload.delay);
        const text = (message || "").trim();

        if (!text && attachments.length === 0) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Informe uma mensagem ou anexe ao menos um arquivo",
                    error: "Empty broadcast content",
                },
                { status: 400 }
            );
        }

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json(
                { status: false, message: "Forbidden", error: "Forbidden" },
                { status: 403 }
            );
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json(
                { status: false, message: "Session not ready", error: "Session not ready" },
                { status: 503 }
            );
        }

        // Resolve each recipient via onWhatsApp so Brazil (+9th digit) maps to real JIDs
        const resolved: string[] = [];
        const unresolved: string[] = [];
        for (const raw of payload.recipients) {
            const normalized = toWhatsAppJid(raw);
            if (!normalized) {
                unresolved.push(raw);
                continue;
            }
            if (
                normalized.endsWith("@g.us") ||
                normalized.endsWith("@lid") ||
                normalized.includes("@broadcast")
            ) {
                resolved.push(normalized);
                continue;
            }
            try {
                const phone = normalized.replace(/@s\.whatsapp\.net$/i, "");
                const checkResult = await instance.socket.onWhatsApp(phone);
                const hit = Array.isArray(checkResult) ? checkResult[0] : null;
                if (hit?.exists && hit.jid) {
                    resolved.push(String(hit.jid));
                } else {
                    unresolved.push(raw);
                }
            } catch {
                unresolved.push(raw);
            }
        }

        const recipients = Array.from(new Set(resolved));
        const NOT_ON_WHATSAPP = "Número não disponível no WhatsApp";

        // Numbers rejected by onWhatsApp — keep visible in report (do not silently drop)
        const skipped = Array.from(
            new Map(
                unresolved.map((raw) => {
                    const jid = toWhatsAppJid(raw) || String(raw);
                    return [jid, { jid, error: NOT_ON_WHATSAPP }] as const;
                })
            ).values()
        );

        if (recipients.length === 0) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Nenhum destinatário disponível no WhatsApp",
                    error: "No valid WhatsApp recipients",
                    data: { unresolved: skipped },
                },
                { status: 400 }
            );
        }

        const totalAll = recipients.length + skipped.length;
        const logMessage =
            text ||
            (attachments.length
                ? `[${attachments.length} anexo(s): ${attachments.map((a) => a.fileName).join(", ")}]`
                : "");

        const log = await prisma.broadcastLog.create({
            data: {
                sessionId,
                message: logMessage,
                total: totalAll,
                sent: 0,
                failed: skipped.length,
                delay,
                status: "running",
                recipients: {
                    create: [
                        ...recipients.map((jid) => ({
                            jid,
                            status: "pending",
                        })),
                        ...skipped.map((s) => ({
                            jid: s.jid,
                            status: "failed",
                            error: s.error,
                            sentAt: new Date(),
                        })),
                    ],
                },
            },
            include: { recipients: true },
        });

        const io = (global as any).io;
        const broadcastId = log.id;
        const startedAtIso = log.startedAt.toISOString();

        if (io) {
            io.to(sessionId).emit("broadcast.progress", {
                broadcastId,
                status: "running",
                total: totalAll,
                sent: 0,
                failed: skipped.length,
                current: null,
                phase: "queued",
                progress: Math.round((skipped.length / totalAll) * 100),
                startedAt: startedAtIso,
                skipped,
            });
        }

        // Process in background — sequential send; delay AFTER each recipient; cancel via AbortSignal
        (async () => {
            const signal = registerBroadcastCancel(broadcastId, sessionId);
            let sent = 0;
            let failed = skipped.length;
            const errors: { jid: string; error: string }[] = skipped.map((s) => ({
                jid: s.jid,
                error: s.error,
            }));

            try {
                const loopResult = await runBroadcastSendLoop({
                    recipients,
                    delayMs: delay,
                    signal,
                    computeDelay: (base) => {
                        const waitMs = computeInterRecipientDelayMs(base);
                        if (process.env.NODE_ENV !== "production") {
                            console.debug(
                                `[broadcast-delay] base=${base}ms wait=${waitMs}ms`
                            );
                        }
                        return waitMs;
                    },
                    onBeforeSend: async (jid, i) => {
                        if (io) {
                            io.to(sessionId).emit("broadcast.progress", {
                                broadcastId,
                                status: "running",
                                total: totalAll,
                                sent,
                                failed,
                                current: jid,
                                currentIndex: i,
                                phase: "sending",
                                progress: Math.round(((sent + failed) / totalAll) * 100),
                                startedAt: startedAtIso,
                            });
                        }
                    },
                    sendOne: async (jid) => {
                        try {
                            if (attachments.length > 0) {
                                for (let a = 0; a < attachments.length; a++) {
                                    const caption = a === 0 && text ? text : undefined;
                                    await instance.socket!.sendMessage(
                                        jid,
                                        buildMediaContent(attachments[a], caption)
                                    );
                                    if (a < attachments.length - 1) {
                                        // Short gap between attachments of the SAME recipient — not cancelable
                                        await sleepMs(350);
                                    }
                                }
                            } else {
                                await instance.socket!.sendMessage(jid, {
                                    text,
                                } as AnyMessageContent);
                            }

                            await prisma.broadcastRecipient.updateMany({
                                where: { broadcastLogId: broadcastId, jid },
                                data: { status: "sent", sentAt: new Date() },
                            });
                            return "sent";
                        } catch (e: unknown) {
                            const errMsg =
                                e instanceof Error ? e.message : "Unknown error";
                            errors.push({ jid, error: errMsg });
                            console.error(`Failed to send broadcast to ${jid}`, e);

                            await prisma.broadcastRecipient.updateMany({
                                where: { broadcastLogId: broadcastId, jid },
                                data: { status: "failed", error: errMsg },
                            });
                            return "failed";
                        }
                    },
                    onAfterSend: async (jid, i, result) => {
                        if (result === "sent") sent++;
                        else failed++;

                        const progress = Math.round(((sent + failed) / totalAll) * 100);

                        await prisma.broadcastLog.update({
                            where: { id: broadcastId },
                            data: { sent, failed },
                        });

                        if (io) {
                            io.to(sessionId).emit("broadcast.progress", {
                                broadcastId,
                                status: "running",
                                total: totalAll,
                                sent,
                                failed,
                                current: jid,
                                currentIndex: i,
                                phase: "processed",
                                progress,
                                startedAt: startedAtIso,
                            });
                        }
                    },
                });

                // Align counters with loop (skipped failures already in `failed`)
                sent = loopResult.sent;
                failed = skipped.length + loopResult.failed;

                const finishedAt = new Date();

                if (loopResult.status === "cancelled") {
                    if (loopResult.cancelledJids.length > 0) {
                        await prisma.broadcastRecipient.updateMany({
                            where: {
                                broadcastLogId: broadcastId,
                                status: "pending",
                                jid: { in: loopResult.cancelledJids },
                            },
                            data: {
                                status: "cancelled",
                                error: CANCELLED_RECIPIENT_DETAIL,
                                sentAt: finishedAt,
                            },
                        });
                    }
                    // Any leftover pending (safety net)
                    await prisma.broadcastRecipient.updateMany({
                        where: { broadcastLogId: broadcastId, status: "pending" },
                        data: {
                            status: "cancelled",
                            error: CANCELLED_RECIPIENT_DETAIL,
                            sentAt: finishedAt,
                        },
                    });

                    await prisma.broadcastLog.update({
                        where: { id: broadcastId },
                        data: {
                            status: "cancelled",
                            sent,
                            failed,
                            completedAt: finishedAt,
                        },
                    });

                    const cancelledCount = loopResult.cancelled;
                    const payload = {
                        broadcastId,
                        status: "cancelled" as const,
                        total: totalAll,
                        sent,
                        failed,
                        cancelled: cancelledCount,
                        errors,
                        progress: Math.round(((sent + failed) / totalAll) * 100),
                        phase: "done" as const,
                        startedAt: startedAtIso,
                        completedAt: finishedAt.toISOString(),
                    };

                    if (io) {
                        io.to(sessionId).emit("broadcast.progress", payload);
                        io.to(sessionId).emit("broadcast.cancelled", payload);
                    }
                    console.log(
                        `Broadcast ${broadcastId} cancelled: ${sent} sent, ${failed} failed, ${cancelledCount} cancelled out of ${totalAll}`
                    );
                } else {
                    await prisma.broadcastLog.update({
                        where: { id: broadcastId },
                        data: {
                            status: "completed",
                            sent,
                            failed,
                            completedAt: finishedAt,
                        },
                    });

                    if (io) {
                        io.to(sessionId).emit("broadcast.progress", {
                            broadcastId,
                            status: "completed",
                            total: totalAll,
                            sent,
                            failed,
                            cancelled: 0,
                            errors,
                            progress: 100,
                            phase: "done",
                            startedAt: startedAtIso,
                            completedAt: finishedAt.toISOString(),
                        });
                    }
                    console.log(
                        `Broadcast ${broadcastId} completed: ${sent} sent, ${failed} failed out of ${totalAll}`
                    );
                }
            } finally {
                clearBroadcastCancel(broadcastId);
            }
        })();

        return NextResponse.json({
            status: true,
            message: "Broadcast started",
            data: {
                broadcastId: log.id,
                total: totalAll,
                processable: recipients.length,
                // Resolved WhatsApp JIDs used by the send loop — frontend must track these for live progress
                recipients,
                skipped,
                attachments: attachments.length,
                startedAt: startedAtIso,
                delay,
            },
        });
    } catch (e) {
        console.error("Broadcast error", e);
        return NextResponse.json(
            {
                status: false,
                message: "Failed to start broadcast",
                error: "Failed to start broadcast",
            },
            { status: 500 }
        );
    }
}
