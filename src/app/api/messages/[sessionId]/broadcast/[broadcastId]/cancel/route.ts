import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { requestBroadcastCancel } from "@/lib/broadcast-cancel";

/**
 * POST /api/messages/[sessionId]/broadcast/[broadcastId]/cancel
 * Authenticated cancel for a running broadcast owned by the given WA session.
 */
export async function POST(
    _request: Request,
    { params }: { params: Promise<{ sessionId: string; broadcastId: string }> }
) {
    try {
        const user = await getAuthenticatedUser();
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Unauthorized", error: "Unauthorized" },
                { status: 401 }
            );
        }

        const { sessionId, broadcastId } = await params;

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json(
                { status: false, message: "Forbidden", error: "Forbidden" },
                { status: 403 }
            );
        }

        const log = await prisma.broadcastLog.findFirst({
            where: { id: broadcastId, sessionId },
            select: {
                id: true,
                sessionId: true,
                status: true,
                sent: true,
                failed: true,
                total: true,
            },
        });

        if (!log) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Disparo não encontrado nesta sessão",
                    error: "Broadcast not found",
                },
                { status: 404 }
            );
        }

        if (log.status === "completed") {
            return NextResponse.json(
                {
                    status: false,
                    message: "Disparo já concluído",
                    error: "Broadcast already completed",
                    data: { broadcastId: log.id, status: log.status },
                },
                { status: 409 }
            );
        }

        if (log.status === "cancelled") {
            return NextResponse.json({
                status: true,
                message: "Disparo já cancelado",
                data: {
                    broadcastId: log.id,
                    status: "cancelled",
                    alreadyCancelled: true,
                    sent: log.sent,
                    failed: log.failed,
                    total: log.total,
                },
            });
        }

        // status === "running"
        const abortResult = requestBroadcastCancel(broadcastId, sessionId);

        if (abortResult === "forbidden") {
            // In-memory entry belongs to another session — should not happen if DB matched
            return NextResponse.json(
                { status: false, message: "Forbidden", error: "Forbidden" },
                { status: 403 }
            );
        }

        // missing: loop may have finished between DB read and abort, or process restarted.
        // Still return accepted — client waits for socket / history refresh.
        return NextResponse.json({
            status: true,
            message:
                abortResult === "already"
                    ? "Cancelamento já solicitado"
                    : abortResult === "missing"
                      ? "Cancelamento registrado (loop pode ter finalizado)"
                      : "Cancelamento solicitado",
            data: {
                broadcastId: log.id,
                status: "cancelling",
                abortResult,
                sent: log.sent,
                failed: log.failed,
                total: log.total,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("Broadcast cancel error:", error);
        return NextResponse.json(
            { status: false, message: "Internal error", error: message },
            { status: 500 }
        );
    }
}
