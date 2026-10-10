import { Suspense } from "react";
import { auth } from "@/lib/auth";
import { ChatLayoutClient } from "@/components/chat/chat-layout-client";
import { ChatInterface } from "@/components/chat/chat-interface";
import { cookies } from "next/headers";
import { canAccessSession, canAccessChannel } from "@/lib/api-auth";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { isDatafyChannelId } from "@/modules/channels/ids";
import { getAccessibleDatafyChannel } from "@/modules/channels/datafy-channel";
import { DatafyChatLayout } from "@/components/dashboard/datafy-chat/datafy-chat-layout";

export default async function ChatPage() {
    const session = await auth();

    if (!session?.user?.id) return <div>Não autorizado</div>;

    const cookieStore = await cookies();
    const channelId = cookieStore.get("sessionId")?.value;

    if (channelId && isDatafyChannelId(channelId)) {
        const allowed = await canAccessChannel(
            session.user.id,
            session.user.role,
            channelId
        );
        if (!allowed) {
            return (
                <SessionGuard>
                    <ChatInterface sessionId={null} />
                </SessionGuard>
            );
        }
        const channel = await getAccessibleDatafyChannel(
            session.user.id,
            session.user.role
        );
        return (
            <Suspense
                fallback={
                    <div className="flex h-[calc(100vh-6.5rem)] items-center justify-center text-sm text-muted-foreground">
                        Carregando chat oficial…
                    </div>
                }
            >
                <DatafyChatLayout
                    displayPhoneNumber={channel?.displayPhoneNumber}
                />
            </Suspense>
        );
    }

    let validSessionId: string | null = null;

    if (channelId) {
        const hasAccess = await canAccessSession(
            session.user.id,
            session.user.role,
            channelId
        );
        if (hasAccess) {
            validSessionId = channelId;
        }
    }

    if (!validSessionId) {
        return (
            <SessionGuard>
                <ChatInterface sessionId={null} />
            </SessionGuard>
        );
    }

    return (
        <div className="h-[calc(100vh-6.5rem)] sm:h-[calc(100vh-6rem)]">
            <ChatLayoutClient key={validSessionId} sessionId={validSessionId} />
        </div>
    );
}
