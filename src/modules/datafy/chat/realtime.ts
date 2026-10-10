import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { logger } from "@/lib/logger";

export const DATAFY_SOCKET_ROOM = DATAFY_OFFICIAL_CHANNEL_ID;

function getIo(): { to: (room: string) => { emit: (event: string, payload: unknown) => void } } | null {
    try {
        return ((global as unknown as { io?: typeof getIo extends never ? never : any }).io as any) || null;
    } catch {
        return null;
    }
}

/** Emit to the shared official channel room (authorized clients join this room). */
export function emitDatafyEvent(event: string, payload: unknown): void {
    const io = getIo();
    if (!io) {
        logger.debug("Datafy", `Socket skip (no io): ${event}`);
        return;
    }
    try {
        io.to(DATAFY_SOCKET_ROOM).emit(event, payload);
    } catch (e) {
        logger.warn(
            "Datafy",
            `Socket emit failed: ${e instanceof Error ? e.message : "unknown"}`
        );
    }
}
