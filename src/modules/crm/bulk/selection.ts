import { CRM_ORG_DEFAULT } from "../constants";

export type CrmListFilters = {
    search?: string;
    company?: string;
    city?: string;
    state?: string;
    category?: string;
    origin?: string;
    active?: boolean | "all";
    consentStatus?: string;
    tagIds?: string[];
    /** When set, only blocked / not blocked. */
    blocked?: boolean | "all";
};

export type BulkSelectionInput =
    | { mode: "ids"; ids: string[] }
    | {
          mode: "filters";
          filters: CrmListFilters;
          /** IDs to exclude from the filter match (deselect after select-all). */
          excludeIds?: string[];
      };

const MAX_BULK_IDS = 10_000;

export function buildCrmListWhere(
    opts: CrmListFilters,
    organizationKey = CRM_ORG_DEFAULT
): Record<string, unknown> {
    const where: Record<string, unknown> = {
        organizationKey,
    };

    if (opts.active !== "all" && opts.active !== undefined) {
        where.active = Boolean(opts.active);
    } else if (opts.active === undefined) {
        where.active = true;
    }

    if (opts.blocked !== "all" && opts.blocked !== undefined) {
        where.blocked = Boolean(opts.blocked);
    }

    if (opts.company?.trim()) {
        where.company = {
            contains: opts.company.trim(),
            mode: "insensitive",
        };
    }
    if (opts.city?.trim()) {
        where.city = { contains: opts.city.trim(), mode: "insensitive" };
    }
    if (opts.state?.trim()) {
        where.state = opts.state.trim().toUpperCase().slice(0, 2);
    }
    if (opts.category?.trim()) where.category = opts.category.trim();
    if (opts.origin?.trim()) where.origin = opts.origin.trim();
    if (opts.consentStatus?.trim()) {
        where.consentStatus = opts.consentStatus.trim();
    }

    const search = opts.search?.trim();
    if (search) {
        const digits = search.replace(/\D/g, "");
        where.OR = [
            { fullName: { contains: search, mode: "insensitive" } },
            { company: { contains: search, mode: "insensitive" } },
            { city: { contains: search, mode: "insensitive" } },
            { notes: { contains: search, mode: "insensitive" } },
            ...(digits ? [{ waId: { contains: digits } }] : []),
        ];
    }

    if (opts.tagIds?.length) {
        where.tags = {
            some: { tagId: { in: opts.tagIds } },
        };
    }

    return where;
}

export function normalizeIdList(ids: unknown): string[] {
    if (!Array.isArray(ids)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of ids) {
        const id = String(raw || "").trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(id);
        if (out.length >= MAX_BULK_IDS) break;
    }
    return out;
}

export { MAX_BULK_IDS };
