/**
 * Pure helpers for Biblioteca de templates UI (counters, filters, dates).
 * Does not mutate Meta/Datafy status or template content.
 */

export type LibraryStatusBucket =
    | "approved"
    | "pending"
    | "rejected"
    | "not_sent"
    | "paused"
    | "disabled"
    | "other";

export type LibraryTab =
    | "all"
    | "local"
    | "approved"
    | "pending"
    | "rejected"
    | "not_sent"
    | "unassociated";

export type LibraryRowLike = {
    id: string;
    technicalName: string;
    displayName?: string | null;
    category?: string | null;
    language?: string | null;
    remoteStatus?: string | null;
    remoteTemplateId?: string | null;
    remoteRejectedReason?: string | null;
    kind?: string | null;
    associated?: boolean;
    createdAt?: string | null;
    updatedAt?: string | null;
    lastSubmittedAt?: string | null;
    lastSyncedAt?: string | null;
};

export type LibraryCounters = {
    total: number;
    approved: number;
    pending: number;
    rejected: number;
    notSent: number;
    unassociatedApproved: number;
    local: number;
};

export function normalizeMetaStatus(
    status: string | null | undefined
): string {
    const s = String(status || "")
        .trim()
        .toUpperCase()
        .normalize("NFD")
        .replace(/\p{M}/gu, "");
    if (!s || s === "NAO ENVIADO" || s === "NOT_SENT" || s === "DRAFT") {
        return "NOT_SENT";
    }
    return s;
}

export function statusBucket(
    status: string | null | undefined
): LibraryStatusBucket {
    const s = normalizeMetaStatus(status);
    if (s === "APPROVED") return "approved";
    if (s === "PENDING") return "pending";
    if (s === "REJECTED") return "rejected";
    if (s === "PAUSED") return "paused";
    if (s === "DISABLED") return "disabled";
    if (s === "NOT_SENT") return "not_sent";
    return "other";
}

export function statusLabelPt(status: string | null | undefined): string {
    const b = statusBucket(status);
    if (b === "approved") return "Aprovado";
    if (b === "pending") return "Em análise";
    if (b === "rejected") return "Rejeitado";
    if (b === "paused") return "Pausado";
    if (b === "disabled") return "Desabilitado";
    if (b === "not_sent") return "Não enviado";
    return String(status || "—");
}

/** Format ISO timestamps in America/Sao_Paulo as `dd/mm/yyyy, hh:mm:ss`. */
export function formatSaoPaulo(iso: string | null | undefined): string | null {
    if (!iso) return null;
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return null;
        return d.toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    } catch {
        return null;
    }
}

export type DateLine = { label: string; value: string };

/**
 * Relevant date lines for the table column (real events only).
 * Never treats lastSyncedAt as Meta approval time.
 */
export function libraryDateLines(row: LibraryRowLike): DateLine[] {
    const bucket = statusBucket(row.remoteStatus);
    const lines: DateLine[] = [];
    const sent = formatSaoPaulo(row.lastSubmittedAt);
    const created = formatSaoPaulo(row.createdAt);
    const updated = formatSaoPaulo(row.updatedAt);

    if (sent) lines.push({ label: "Enviado", value: sent });

    if (bucket === "approved") {
        lines.push({
            label: "Aprovado",
            value: "Data de aprovação indisponível",
        });
    } else if (bucket === "rejected") {
        lines.push({
            label: "Rejeitado",
            value: updated || "Data de rejeição indisponível",
        });
    } else if (bucket === "not_sent" && created) {
        lines.push({ label: "Criado", value: created });
    } else if (bucket === "pending" && !sent && created) {
        lines.push({ label: "Criado", value: created });
    }

    if (!lines.length && created) {
        lines.push({ label: "Criado", value: created });
    }
    return lines;
}

export function computeLibraryCounters(
    rows: LibraryRowLike[]
): LibraryCounters {
    const counters: LibraryCounters = {
        total: rows.length,
        approved: 0,
        pending: 0,
        rejected: 0,
        notSent: 0,
        unassociatedApproved: 0,
        local: 0,
    };
    for (const row of rows) {
        const b = statusBucket(row.remoteStatus);
        if (b === "approved") counters.approved++;
        else if (b === "pending") counters.pending++;
        else if (b === "rejected") counters.rejected++;
        else if (b === "not_sent" || b === "other") counters.notSent++;

        if (b === "approved" && !row.associated) {
            counters.unassociatedApproved++;
        }
        if (row.kind === "builtin" || row.kind === "custom") {
            counters.local++;
        }
    }
    return counters;
}

export function matchesLibraryQuery(
    row: LibraryRowLike,
    q: string
): boolean {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    const hay = [
        row.technicalName,
        row.displayName,
        row.category,
        row.language,
        row.remoteTemplateId,
        row.id,
    ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return hay.includes(needle);
}

export function filterLibraryRows(
    rows: LibraryRowLike[],
    opts: {
        q?: string;
        tab?: LibraryTab;
        status?: string;
        category?: string;
        language?: string;
    }
): LibraryRowLike[] {
    const tab = opts.tab || "all";
    const status = opts.status || "all";
    const category = opts.category || "all";
    const language = opts.language || "all";
    return rows.filter((row) => {
        if (!matchesLibraryQuery(row, opts.q || "")) return false;
        if (category !== "all" && String(row.category || "").toUpperCase() !== category.toUpperCase()) {
            return false;
        }
        if (
            language !== "all" &&
            String(row.language || "").toLowerCase() !== language.toLowerCase()
        ) {
            return false;
        }
        if (status !== "all") {
            const b = statusBucket(row.remoteStatus);
            if (status === "APPROVED" && b !== "approved") return false;
            if (status === "PENDING" && b !== "pending") return false;
            if (status === "REJECTED" && b !== "rejected") return false;
            if (status === "NOT_SENT" && b !== "not_sent" && b !== "other")
                return false;
            if (
                status === "PAUSED_OR_DISABLED" &&
                b !== "paused" &&
                b !== "disabled"
            )
                return false;
        }
        if (tab === "local") {
            return row.kind === "builtin" || row.kind === "custom";
        }
        if (tab === "approved") return statusBucket(row.remoteStatus) === "approved";
        if (tab === "pending") return statusBucket(row.remoteStatus) === "pending";
        if (tab === "rejected") return statusBucket(row.remoteStatus) === "rejected";
        if (tab === "not_sent") {
            const b = statusBucket(row.remoteStatus);
            return b === "not_sent" || b === "other";
        }
        if (tab === "unassociated") {
            return (
                statusBucket(row.remoteStatus) === "approved" &&
                !row.associated
            );
        }
        return true;
    });
}

export function countComponents(item: {
    headerText?: string | null;
    bodyText?: string | null;
    footerText?: string | null;
    buttons?: { enabled?: boolean; buttons?: unknown[] } | null;
}): number {
    let n = 0;
    if (item.headerText?.trim()) n++;
    if (item.bodyText?.trim()) n++;
    if (item.footerText?.trim()) n++;
    if (item.buttons?.enabled && (item.buttons.buttons?.length || 0) > 0) n++;
    return Math.max(n, item.bodyText?.trim() ? 1 : 0);
}
