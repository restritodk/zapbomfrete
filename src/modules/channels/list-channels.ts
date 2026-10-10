import { getAccessibleSessions } from "@/lib/api-auth";
import { getAccessibleDatafyChannel } from "./datafy-channel";
import type { ChannelDescriptor } from "./types";

/**
 * Unified channel list for the global selector.
 * Datafy (when authorized) first, then Baileys sessions.
 */
export async function listAccessibleChannels(
    userId: string,
    userRole: string
): Promise<ChannelDescriptor[]> {
    const [datafy, sessions] = await Promise.all([
        getAccessibleDatafyChannel(userId, userRole),
        getAccessibleSessions(userId, userRole),
    ]);

    const channels: ChannelDescriptor[] = [];

    if (datafy) {
        channels.push(datafy);
    }

    for (const s of sessions) {
        channels.push({
            id: s.sessionId,
            provider: "baileys",
            name: s.name,
            status: s.status || "DISCONNECTED",
            displayPhoneNumber: null,
            shared: false,
            official: false,
            lastVerifiedAt: null,
            healthy: (s.status || "").toUpperCase() === "CONNECTED",
            providerLabel: "Baileys",
            dbId: s.id,
        });
    }

    return channels;
}
