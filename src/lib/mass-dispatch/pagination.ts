export type PageMeta = {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
};

export function clampPage(page: number, totalPages: number): number {
    const tp = Math.max(1, totalPages || 1);
    return Math.min(Math.max(1, page || 1), tp);
}

export function buildPageMeta(
    total: number,
    page: number,
    limit: number
): PageMeta {
    const safeLimit = Math.max(1, limit || 10);
    const totalPages = Math.max(1, Math.ceil(Math.max(0, total) / safeLimit));
    const safePage = clampPage(page, totalPages);
    return {
        total: Math.max(0, total),
        page: safePage,
        limit: safeLimit,
        totalPages,
    };
}

export function rangeLabel(meta: PageMeta): string {
    if (meta.total === 0) return "Exibindo 0 de 0 campanhas";
    const start = (meta.page - 1) * meta.limit + 1;
    const end = Math.min(meta.page * meta.limit, meta.total);
    return `Exibindo ${start} a ${end} de ${meta.total} campanhas`;
}

/** Page numbers around current (e.g. 1 2 3 …). */
export function visiblePageNumbers(
    page: number,
    totalPages: number,
    window = 3
): number[] {
    const tp = Math.max(1, totalPages);
    const cur = clampPage(page, tp);
    if (tp <= window) {
        return Array.from({ length: tp }, (_, i) => i + 1);
    }
    let start = Math.max(1, cur - Math.floor(window / 2));
    let end = start + window - 1;
    if (end > tp) {
        end = tp;
        start = Math.max(1, end - window + 1);
    }
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
