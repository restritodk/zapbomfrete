import { prisma } from "@/lib/prisma";
import { normalizeBrazilianPhone } from "@/lib/phone-br";
import { CRM_ORG_DEFAULT } from "@/modules/crm/constants";
import {
    evaluateEligibility,
    summarizeConsentAudience,
    type EligibilityContact,
    type EligibilityOpts,
} from "./eligibility";

export type SegmentFilter = {
    /** When true (default CRM UX), load all active org contacts; geo filters remain optional. */
    selectAllEligible?: boolean;
    /** import | crm | groups — informational for audit */
    source?: "import" | "crm" | "groups";
    /** Normalized phone digits from TXT/CSV or Baileys group extract */
    phones?: string[];
    /**
     * When true (default for import/groups), upsert missing phones into CRM
     * as unknown consent — never grants marketing consent.
     */
    ensureCrmContacts?: boolean;
    contactIds?: string[];
    tagIds?: string[];
    category?: string | null;
    city?: string | null;
    state?: string | null;
    company?: string | null;
    origin?: string | null;
    search?: string | null;
};

export async function resolveSegmentContacts(filter: SegmentFilter) {
    // Phone-list path (import / groups) — match CRM by waId, never invent consent.
    // Empty phones array must not fall through to CRM "select all".
    if (
        filter.source === "import" ||
        filter.source === "groups" ||
        (Array.isArray(filter.phones) && filter.phones.length > 0)
    ) {
        return resolveContactsFromPhones(filter.phones || [], {
            // Explicit opt-in — never invent consent; only creates unknown CRM rows.
            ensureCrmContacts: filter.ensureCrmContacts === true,
        });
    }

    const where: Record<string, unknown> = {
        organizationKey: CRM_ORG_DEFAULT,
        active: true,
    };

    if (filter.contactIds?.length) {
        where.id = { in: filter.contactIds };
    }
    if (filter.category) where.category = filter.category;
    if (filter.city) {
        where.city = { contains: filter.city, mode: "insensitive" };
    }
    if (filter.state) {
        where.state = filter.state.trim().toUpperCase().slice(0, 2);
    }
    if (filter.company) {
        where.company = { contains: filter.company, mode: "insensitive" };
    }
    if (filter.origin) where.origin = filter.origin;
    if (filter.tagIds?.length) {
        where.tags = { some: { tagId: { in: filter.tagIds } } };
    }
    if (filter.search?.trim()) {
        const s = filter.search.trim();
        const digits = s.replace(/\D/g, "");
        where.OR = [
            { fullName: { contains: s, mode: "insensitive" } },
            { company: { contains: s, mode: "insensitive" } },
            ...(digits ? [{ waId: { contains: digits } }] : []),
        ];
    }

    return prisma.crmContact.findMany({
        where: where as never,
        take: 20_000,
        orderBy: { fullName: "asc" },
    });
}

/**
 * Resolve imported/group phones against CRM.
 * When ensureCrmContacts is true, missing numbers are upserted as CRM contacts
 * with consentStatus=unknown (never granted). Otherwise they stay synthetic.
 */
export async function resolveContactsFromPhones(
    rawPhones: string[],
    opts?: { ensureCrmContacts?: boolean }
): Promise<EligibilityContact[]> {
    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const raw of rawPhones) {
        const wa = normalizeBrazilianPhone(raw);
        if (!wa || wa.length < 10 || seen.has(wa)) continue;
        seen.add(wa);
        normalized.push(wa);
    }
    if (!normalized.length) return [];

    let existing = await prisma.crmContact.findMany({
        where: {
            organizationKey: CRM_ORG_DEFAULT,
            waId: { in: normalized },
        },
    });
    const byWa = new Map(existing.map((c) => [c.waId, c]));

    if (opts?.ensureCrmContacts) {
        const missing = normalized.filter((wa) => !byWa.has(wa));
        for (const waId of missing) {
            try {
                const created = await prisma.crmContact.create({
                    data: {
                        organizationKey: CRM_ORG_DEFAULT,
                        waId,
                        origin: "import",
                        consentStatus: "unknown",
                        consentPurpose: "marketing_offers",
                    } as never,
                });
                byWa.set(waId, created);
            } catch {
                const again = await prisma.crmContact.findUnique({
                    where: {
                        organizationKey_waId: {
                            organizationKey: CRM_ORG_DEFAULT,
                            waId,
                        },
                    },
                });
                if (again) byWa.set(waId, again);
            }
        }
        existing = Array.from(byWa.values());
    }

    return normalized.map((waId) => {
        const c = byWa.get(waId);
        if (c) {
            return {
                id: c.id,
                waId: c.waId,
                fullName: c.fullName,
                company: c.company,
                city: c.city,
                state: c.state,
                category: c.category,
                origin: c.origin,
                active: c.active,
                consentStatus: c.consentStatus,
            };
        }
        return {
            id: `synth:${waId}`,
            waId,
            fullName: null,
            company: null,
            city: null,
            state: null,
            category: null,
            origin: "import",
            active: true,
            consentStatus: "unknown",
        };
    });
}

export function isSyntheticContactId(id: string | null | undefined): boolean {
    return !id || id.startsWith("synth:");
}

function runPreviewPass(
    contacts: EligibilityContact[],
    opts: EligibilityOpts
) {
    const seen = new Set<string>();
    const eligible: Array<EligibilityContact & { waId: string }> = [];
    const excluded: Array<{
        contactId: string;
        waId: string;
        fullName: string | null;
        reason: string;
    }> = [];

    for (const c of contacts) {
        const result = evaluateEligibility(c, opts);
        if (!result.ok) {
            excluded.push({
                contactId: c.id,
                waId: c.waId,
                fullName: c.fullName,
                reason: result.reason,
            });
            continue;
        }
        if (seen.has(result.waId)) {
            excluded.push({
                contactId: c.id,
                waId: result.waId,
                fullName: c.fullName,
                reason: "duplicate",
            });
            continue;
        }
        seen.add(result.waId);
        eligible.push({ ...c, waId: result.waId });
    }

    const exclusionBreakdown: Record<string, number> = {};
    for (const e of excluded) {
        exclusionBreakdown[e.reason] =
            (exclusionBreakdown[e.reason] || 0) + 1;
    }

    return { eligible, excluded, exclusionBreakdown };
}

export function previewRecipients(
    contacts: EligibilityContact[],
    opts: EligibilityOpts
) {
    const pass = runPreviewPass(contacts, opts);

    let simulationEligibleCount = pass.eligible.length;
    if (opts.requireConsent && !opts.simulationRelaxConsent) {
        simulationEligibleCount = runPreviewPass(contacts, {
            ...opts,
            simulationRelaxConsent: true,
        }).eligible.length;
    }

    const consentSummary = summarizeConsentAudience(contacts);

    return {
        selected: contacts.length,
        eligibleCount: pass.eligible.length,
        excludedCount: pass.excluded.length,
        exclusionBreakdown: pass.exclusionBreakdown,
        consentSummary,
        simulationEligibleCount,
        eligible: pass.eligible.slice(0, 50),
        excluded: pass.excluded.slice(0, 100),
        eligibleAll: pass.eligible,
        excludedAll: pass.excluded,
    };
}
