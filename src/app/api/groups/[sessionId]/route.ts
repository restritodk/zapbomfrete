import { prisma } from "@/lib/prisma";
import { NextResponse, NextRequest } from "next/server";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { baileysRouteRejectedForChannel } from "@/modules/channels";
import { resolveBaileysLiveStatus } from "@/modules/channels/baileys-status";
import { waManager } from "@/modules/whatsapp/manager";
import { syncGroups } from "@/modules/whatsapp/store/groups";

// GET: List groups for a session (auth + session access required)
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId } = await params;
        const datafyBlock = baileysRouteRejectedForChannel(sessionId);
        if (datafyBlock.rejected) return datafyBlock.response!;

        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const session = await prisma.session.findUnique({
            where: { sessionId: sessionId },
            select: { id: true, status: true },
        });

        if (!session) {
            return NextResponse.json({ status: false, message: "Session not found", error: "Session not found" }, { status: 404 });
        }

        const liveStatus = resolveBaileysLiveStatus(sessionId, session.status);
        const wantSync =
            request.nextUrl.searchParams.get("sync") === "1" ||
            request.nextUrl.searchParams.get("refresh") === "1";

        // Optional live sync when CONNECTED — never reconnects the socket
        if (wantSync && liveStatus === "CONNECTED") {
            const instance = waManager.getInstance(sessionId);
            if (instance?.socket) {
                await syncGroups(instance.socket, sessionId);
            }
        }

        const groups = await prisma.group.findMany({
            where: { sessionId: session.id },
            orderBy: { subject: "asc" },
        });

        return NextResponse.json({
            status: true,
            message: "Groups retrieved successfully",
            data: groups,
            meta: {
                sessionId,
                connectionStatus: liveStatus,
                groupCount: groups.length,
            },
        });
    } catch (error) {
        console.error("Get groups error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch groups", error: "Failed to fetch groups" }, { status: 500 });
    }
}
