import { CRM_ORG_DEFAULT } from "../constants";
import {
    consentSourceLabel,
    consentStatusLabel,
    crmStatusToDecision,
} from "./constants";
import { consentDb } from "./db";

export type ConsentListFilters = {
    tab: "granted" | "not_granted";
    status?: string | null;
    source?: string | null;
    search?: string | null;
    from?: Date | null;
    to?: Date | null;
    page?: number;
    pageSize?: number;
};

export async function getConsentStats(organizationKey = CRM_ORG_DEFAULT) {
    const db = consentDb();
    const [total, granted, denied, optedOut, unknown] = await Promise.all([
        db.crmContact.count({
            where: { organizationKey, active: true },
        }),
        db.crmContact.count({
            where: { organizationKey, active: true, consentStatus: "granted" },
        }),
        db.crmContact.count({
            where: { organizationKey, active: true, consentStatus: "denied" },
        }),
        db.crmContact.count({
            where: {
                organizationKey,
                active: true,
                consentStatus: "opted_out",
            },
        }),
        db.crmContact.count({
            where: { organizationKey, active: true, consentStatus: "unknown" },
        }),
    ]);

    return {
        total,
        granted,
        denied,
        optedOut,
        revoked: optedOut,
        unknown,
        awaiting: unknown,
        notGranted: denied + optedOut + unknown,
    };
}

function buildWhere(
    organizationKey: string,
    filters: ConsentListFilters
): Record<string, unknown> {
    const where: Record<string, unknown> = {
        organizationKey,
        active: true,
    };

    if (filters.tab === "granted") {
        where.consentStatus = "granted";
    } else if (filters.status) {
        where.consentStatus = filters.status;
    } else {
        where.consentStatus = { in: ["denied", "opted_out", "unknown"] };
    }

    if (filters.source?.trim()) {
        where.consentSource = filters.source.trim();
    }

    if (filters.from || filters.to) {
        where.consentAt = {
            ...(filters.from ? { gte: filters.from } : {}),
            ...(filters.to ? { lte: filters.to } : {}),
        };
    }

    if (filters.search?.trim()) {
        const s = filters.search.trim();
        const digits = s.replace(/\D/g, "");
        where.OR = [
            { fullName: { contains: s, mode: "insensitive" } },
            { company: { contains: s, mode: "insensitive" } },
            ...(digits.length >= 4 ? [{ waId: { contains: digits } }] : []),
        ];
    }

    return where;
}

export async function listConsentContacts(filters: ConsentListFilters) {
    const page = Math.max(1, filters.page || 1);
    const pageSize = Math.min(50, Math.max(1, filters.pageSize || 10));
    const organizationKey = CRM_ORG_DEFAULT;
    const where = buildWhere(organizationKey, filters);

    const db = consentDb();
    const [total, rows] = await Promise.all([
        db.crmContact.count({ where: where as never }),
        db.crmContact.findMany({
            where: where as never,
            orderBy: [{ consentAt: "desc" }, { updatedAt: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
                id: true,
                waId: true,
                fullName: true,
                company: true,
                consentStatus: true,
                consentSource: true,
                consentAt: true,
                optedOutAt: true,
                consentPurpose: true,
                consentWabaId: true,
                consentEvidence: true,
                updatedAt: true,
            },
        }) as Promise<
            Array<{
                id: string;
                waId: string;
                fullName: string | null;
                company: string | null;
                consentStatus: string;
                consentSource: string | null;
                consentAt: Date | null;
                optedOutAt: Date | null;
                consentPurpose: string;
                consentWabaId: string | null;
                consentEvidence: string | null;
                updatedAt: Date;
            }>
        >,
    ]);

    return {
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        items: rows.map((r) => ({
            id: r.id,
            waId: r.waId,
            fullName: r.fullName,
            company: r.company,
            consentStatus: r.consentStatus,
            consentStatusLabel: consentStatusLabel(r.consentStatus),
            decisionCode: crmStatusToDecision(r.consentStatus),
            consentSource: r.consentSource,
            consentSourceLabel: consentSourceLabel(r.consentSource),
            consentAt: r.consentAt?.toISOString() ?? null,
            optedOutAt: r.optedOutAt?.toISOString() ?? null,
            consentPurpose: r.consentPurpose,
            consentWabaId: r.consentWabaId,
            consentEvidence: r.consentEvidence,
            channelLabel: r.consentWabaId
                ? `WABA ${r.consentWabaId}`
                : "WhatsApp Oficial",
            updatedAt: r.updatedAt.toISOString(),
        })),
    };
}

export async function getConsentHistory(crmContactId: string, take = 50) {
    const rows = await consentDb().crmConsentDecision.findMany({
        where: { crmContactId },
        orderBy: { decidedAt: "desc" },
        take,
    });
    return rows.map((r) => ({
        id: r.id,
        decision: r.decision,
        resultingStatus: r.resultingStatus,
        resultingStatusLabel: consentStatusLabel(r.resultingStatus),
        source: r.source,
        sourceLabel: consentSourceLabel(r.source),
        evidenceText: r.evidenceText,
        buttonTitle: r.buttonTitle,
        relatedMessageId: r.relatedMessageId,
        templateName: r.templateName,
        wabaId: r.wabaId,
        decidedAt: r.decidedAt.toISOString(),
        appliedToContact: r.appliedToContact,
        stale: !r.appliedToContact,
    }));
}

export async function getConsentDetail(crmContactId: string) {
    const contact = (await consentDb().crmContact.findUnique({
        where: { id: crmContactId },
        select: {
            id: true,
            waId: true,
            fullName: true,
            company: true,
            consentStatus: true,
            consentSource: true,
            consentAt: true,
            optedOutAt: true,
            consentPurpose: true,
            consentWabaId: true,
            consentEvidence: true,
        },
    })) as {
        id: string;
        waId: string;
        fullName: string | null;
        company: string | null;
        consentStatus: string;
        consentSource: string | null;
        consentAt: Date | null;
        optedOutAt: Date | null;
        consentPurpose: string;
        consentWabaId: string | null;
        consentEvidence: string | null;
    } | null;
    if (!contact) return null;
    const history = await getConsentHistory(crmContactId);
    return {
        contact: {
            ...contact,
            consentStatusLabel: consentStatusLabel(contact.consentStatus),
            consentSourceLabel: consentSourceLabel(contact.consentSource),
            consentAt: contact.consentAt?.toISOString() ?? null,
            optedOutAt: contact.optedOutAt?.toISOString() ?? null,
        },
        history,
    };
}
