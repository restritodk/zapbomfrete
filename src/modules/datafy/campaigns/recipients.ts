import { prisma } from "@/lib/prisma";
import { CRM_ORG_DEFAULT } from "@/modules/crm/constants";
import { evaluateEligibility, type EligibilityContact } from "./eligibility";
import type { CampaignPurpose } from "./constants";

export type SegmentFilter = {
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

export function previewRecipients(
    contacts: EligibilityContact[],
    opts: { purpose: CampaignPurpose | string; requireConsent: boolean }
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

    return {
        selected: contacts.length,
        eligibleCount: eligible.length,
        excludedCount: excluded.length,
        eligible: eligible.slice(0, 50),
        excluded: excluded.slice(0, 100),
        eligibleAll: eligible,
        excludedAll: excluded,
    };
}
