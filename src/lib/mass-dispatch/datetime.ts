/** Display helpers for Disparo em massa (America/Sao_Paulo by default). */

const TZ = "America/Sao_Paulo";

export function formatCampaignDateParts(
    iso: string | null | undefined,
    timeZone = TZ
): { date: string; time: string } | null {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const date = new Intl.DateTimeFormat("pt-BR", {
        timeZone,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    }).format(d);
    const time = new Intl.DateTimeFormat("pt-BR", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(d);
    return { date, time };
}

/** Start of send — never invent from createdAt. */
export function resolveCampaignStartedAt(c: {
    startedAt?: string | null;
}): string | null {
    return c.startedAt || null;
}

/**
 * End of processing:
 * - completed* / failed → completedAt
 * - cancelled → cancelledAt (cancellation event, not success)
 * - otherwise → null (show —)
 */
export function resolveCampaignFinishedAt(c: {
    status: string;
    completedAt?: string | null;
    cancelledAt?: string | null;
}): string | null {
    if (c.status === "cancelled") return c.cancelledAt || null;
    if (
        ["completed", "completed_with_errors", "failed"].includes(c.status)
    ) {
        return c.completedAt || null;
    }
    return null;
}

export type PeriodKey = "all" | "today" | "7d" | "30d";

export function periodToDateRange(
    period: PeriodKey,
    now = new Date(),
    timeZone = TZ
): { from: string | null; to: string | null } {
    if (period === "all") return { from: null, to: null };

    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    const todayStr = `${y}-${m}-${day}`;

    if (period === "today") {
        const from = new Date(`${todayStr}T00:00:00-03:00`);
        return { from: from.toISOString(), to: now.toISOString() };
    }

    const days = period === "7d" ? 7 : 30;
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: now.toISOString() };
}
