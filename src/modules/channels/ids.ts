/**
 * Stable multiprovider channel identifiers.
 * Datafy official channel never uses a Baileys sessionId / QR flow.
 */

export const DATAFY_OFFICIAL_CHANNEL_ID = "datafy-official" as const;

export type ChannelProvider = "baileys" | "datafy";

export function isDatafyChannelId(id: string | null | undefined): boolean {
    return typeof id === "string" && id === DATAFY_OFFICIAL_CHANNEL_ID;
}

export function resolveChannelProvider(
    id: string | null | undefined
): ChannelProvider | null {
    if (!id) return null;
    if (isDatafyChannelId(id)) return "datafy";
    return "baileys";
}

/** Reserved IDs that must never be used as Baileys sessionIds. */
export function isReservedChannelId(id: string | null | undefined): boolean {
    if (!id) return false;
    const normalized = id.trim().toLowerCase();
    return (
        normalized === DATAFY_OFFICIAL_CHANNEL_ID ||
        normalized.startsWith("datafy:") ||
        normalized.startsWith("datafy-")
    );
}
