import { logger } from "@/lib/logger";
import { WORKER_TICK_MS } from "./constants";
import { tickDatafyCampaigns, WORKER_ID } from "./queue";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * In-process campaign worker (PM2-compatible).
 * Safe to call once at server boot. Does not send during unit tests
 * unless DATAFY_CAMPAIGN_WORKER=1.
 */
export function startDatafyCampaignWorker() {
    if (timer) return;
    if (process.env.NODE_ENV === "test") return;
    if (process.env.DATAFY_CAMPAIGN_WORKER === "0") return;

    const tick = async () => {
        if (running) return;
        running = true;
        try {
            await tickDatafyCampaigns();
        } catch (e) {
            logger.error(
                "DatafyCampaignWorker",
                e instanceof Error ? e.message : e
            );
        } finally {
            running = false;
        }
    };

    timer = setInterval(() => {
        void tick();
    }, WORKER_TICK_MS);

    // First tick shortly after boot (recover scheduled / interrupted)
    setTimeout(() => void tick(), 2_500);
    logger.info(
        "DatafyCampaignWorker",
        `Started (${WORKER_ID}) tick=${WORKER_TICK_MS}ms`
    );
}

export function stopDatafyCampaignWorker() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
