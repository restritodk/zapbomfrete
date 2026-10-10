/**
 * Campaign send pacing — interval between message attempt starts.
 * User-facing unit: seconds (3–60). Storage: milliseconds on delayMs.
 */

export const CAMPAIGN_DELAY_SEC_MIN = 3;
export const CAMPAIGN_DELAY_SEC_MAX = 60;
export const DEFAULT_CAMPAIGN_DELAY_SEC = 10;

export const CAMPAIGN_DELAY_MS_MIN = CAMPAIGN_DELAY_SEC_MIN * 1000;
export const CAMPAIGN_DELAY_MS_MAX = CAMPAIGN_DELAY_SEC_MAX * 1000;
export const DEFAULT_CAMPAIGN_DELAY_MS = DEFAULT_CAMPAIGN_DELAY_SEC * 1000;

export const DELAY_PRESETS_SEC = [3, 5, 10, 15, 30, 60] as const;

/** Clamp / normalize a delay expressed in milliseconds (API / DB). */
export function normalizeCampaignDelayMs(
    input: unknown,
    opts?: { allowLegacyBelowMin?: boolean }
): number {
    const n = typeof input === "number" ? input : Number(input);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
        return DEFAULT_CAMPAIGN_DELAY_MS;
    }
    // Guard against accidental double conversion (e.g. 10s → 10_000_000)
    if (n > CAMPAIGN_DELAY_MS_MAX * 20) {
        return DEFAULT_CAMPAIGN_DELAY_MS;
    }
    if (opts?.allowLegacyBelowMin && n > 0 && n < CAMPAIGN_DELAY_MS_MIN) {
        return CAMPAIGN_DELAY_MS_MIN;
    }
    if (n < CAMPAIGN_DELAY_MS_MIN) return CAMPAIGN_DELAY_MS_MIN;
    if (n > CAMPAIGN_DELAY_MS_MAX) return CAMPAIGN_DELAY_MS_MAX;
    return n;
}

/** Parse user-facing seconds → ms. Rejects non-integers and out-of-range. */
export function parseDelaySeconds(input: unknown): {
    ok: true;
    seconds: number;
    delayMs: number;
} | {
    ok: false;
    reason: string;
} {
    const n = typeof input === "number" ? input : Number(input);
    if (!Number.isFinite(n)) {
        return { ok: false, reason: "Intervalo inválido" };
    }
    if (!Number.isInteger(n)) {
        return {
            ok: false,
            reason: "O intervalo deve ser um número inteiro de segundos",
        };
    }
    if (n < CAMPAIGN_DELAY_SEC_MIN || n > CAMPAIGN_DELAY_SEC_MAX) {
        return {
            ok: false,
            reason: `O intervalo deve estar entre ${CAMPAIGN_DELAY_SEC_MIN} e ${CAMPAIGN_DELAY_SEC_MAX} segundos`,
        };
    }
    return { ok: true, seconds: n, delayMs: n * 1000 };
}

export function delaySecondsFromMs(delayMs: number): number {
    const ms = normalizeCampaignDelayMs(delayMs, { allowLegacyBelowMin: true });
    return Math.round(ms / 1000);
}

/** Wait time between consecutive send starts: (totalSends - 1) × interval. */
export function estimateWaitMs(
    totalSends: number,
    delayMs: number
): number {
    const n = Math.max(0, Math.floor(totalSends));
    if (n <= 1) return 0;
    return (n - 1) * normalizeCampaignDelayMs(delayMs, {
        allowLegacyBelowMin: true,
    });
}

export function formatDurationPt(ms: number): string {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    if (totalSec < 60) {
        return totalSec === 1 ? "1 segundo" : `${totalSec} segundos`;
    }
    const minutes = Math.floor(totalSec / 60);
    const seconds = totalSec % 60;
    const minLabel = minutes === 1 ? "1 minuto" : `${minutes} minutos`;
    if (seconds === 0) return minLabel;
    const secLabel = seconds === 1 ? "1 segundo" : `${seconds} segundos`;
    return `${minLabel} e ${secLabel}`;
}

export function buildEstimateCopy(opts: {
    recipientCount: number;
    partsPerRecipient: number;
    delaySeconds: number;
}): string {
    const parts = Math.max(1, opts.partsPerRecipient | 0);
    const recipients = Math.max(0, opts.recipientCount | 0);
    const total = recipients * parts;
    const delayMs = opts.delaySeconds * 1000;
    const waitMs = estimateWaitMs(total, delayMs);
    if (total <= 0) {
        return "Selecione destinatários para estimar a duração do envio.";
    }
    if (total === 1) {
        return `1 mensagem com intervalo de ${opts.delaySeconds} segundos — sem espera entre envios (apenas o tempo de processamento da API).`;
    }
    return `${total} mensagens com intervalo de ${opts.delaySeconds} segundos representam aproximadamente ${formatDurationPt(waitMs)} de espera entre envios, além do tempo de processamento da API. A estimativa não garante o tempo final — podem ocorrer filas, limites de velocidade e tentativas posteriores.`;
}

/**
 * Pure eligibility check used by claim logic and tests.
 * Returns whether a send may start at `now`, given the persisted next eligible instant.
 */
export function isSendSlotEligible(
    nextSendEligibleAt: Date | null | undefined,
    now: Date
): boolean {
    if (!nextSendEligibleAt) return true;
    return nextSendEligibleAt.getTime() <= now.getTime();
}

/** Next eligible timestamp after claiming a slot at `now`. */
export function nextEligibleAfterClaim(now: Date, delayMs: number): Date {
    const ms = normalizeCampaignDelayMs(delayMs, { allowLegacyBelowMin: true });
    return new Date(now.getTime() + ms);
}

/**
 * Decide the effective wait when Datafy asks for a longer retry (429).
 * Always take the maximum of campaign interval and provider retry.
 */
export function effectiveRetryDelayMs(
    campaignDelayMs: number,
    providerRetrySec: number | null | undefined
): number {
    const base = normalizeCampaignDelayMs(campaignDelayMs, {
        allowLegacyBelowMin: true,
    });
    const fromProvider =
        typeof providerRetrySec === "number" && providerRetrySec > 0
            ? Math.ceil(providerRetrySec) * 1000
            : 0;
    return Math.max(base, fromProvider);
}
