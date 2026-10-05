import { NextResponse, NextRequest } from "next/server";
import { waManager } from "@/modules/whatsapp/manager";
import { getAuthenticatedUser, canAccessSession } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { normalizeJid } from "@/lib/jid-utils";

// POST: Fetch profile picture URL for a JID
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string; jid: string }> }
) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const { sessionId, jid } = await params;

        // Check if user can access this session
        const canAccess = await canAccessSession(user.id, user.role, sessionId);
        if (!canAccess) {
            return NextResponse.json({ status: false, message: "Forbidden - Cannot access this session", error: "Forbidden - Cannot access this session" }, { status: 403 });
        }

        const instance = waManager.getInstance(sessionId);
        if (!instance?.socket) {
            return NextResponse.json({ status: false, message: "Session not ready", error: "Session not ready" }, { status: 503 });
        }

        const decodedJid = normalizeJid(decodeURIComponent(jid)) || decodeURIComponent(jid);

        // Fetch profile picture
        try {
            const profilePicUrl = await instance.socket.profilePictureUrl(decodedJid, 'image');

            if (profilePicUrl) {
                const session = await prisma.session.findUnique({
                    where: { sessionId },
                    select: { id: true },
                });
                if (session) {
                    const contact = await prisma.contact.findFirst({
                        where: {
                            sessionId: session.id,
                            OR: [
                                { jid: decodedJid },
                                { lid: decodedJid },
                                { remoteJidAlt: decodedJid },
                            ],
                        },
                        select: { jid: true, lid: true, remoteJidAlt: true },
                    });
                    const jids = new Set<string>([decodedJid]);
                    if (contact?.jid) jids.add(contact.jid);
                    if (contact?.lid) jids.add(contact.lid);
                    if (contact?.remoteJidAlt) jids.add(contact.remoteJidAlt);

                    await prisma.contact.updateMany({
                        where: { sessionId: session.id, jid: { in: Array.from(jids) } },
                        data: { profilePic: profilePicUrl },
                    });
                }
            }
            
            return NextResponse.json({ 
                success: true,
                jid: decodedJid,
                profilePicUrl
            });
        } catch (error: any) {
            // If no profile picture exists
            if (error.message?.includes('404') || error.message?.includes('not-found')) {
                return NextResponse.json({ 
                    success: true,
                    jid: decodedJid,
                    profilePicUrl: null,
                    message: "No profile picture found"
                });
            }
            throw error;
        }

    } catch (error) {
        console.error("Fetch profile picture error:", error);
        return NextResponse.json({ status: false, message: "Failed to fetch profile picture", error: "Failed to fetch profile picture" }, { status: 500 });
    }
}
