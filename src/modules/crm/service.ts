import { prisma } from "@/lib/prisma";
import { normalizeBrazilianPhone } from "@/lib/phone-br";
import { CRM_ORG_DEFAULT, CRM_CATEGORIES, CRM_CONSENT_STATUSES } from "./constants";
import { serializeCrmContact, serializeCrmTag } from "./serialize";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";

export class CrmError extends Error {
    statusCode: number;
    constructor(message: string, statusCode = 400) {
        super(message);
        this.name = "CrmError";
        this.statusCode = statusCode;
    }
}

function normalizeWa(input: string): string {
    const phone = normalizeBrazilianPhone(input);
    if (!phone || phone.length < 10) {
        throw new CrmError("Telefone WhatsApp inválido", 400);
    }
    return phone;
}

const contactInclude = {
    tags: { include: { tag: true } },
    createdBy: { select: { id: true, name: true, email: true } },
    updatedBy: { select: { id: true, name: true, email: true } },
    _count: { select: { conversations: true } },
} as const;

export async function listCrmContacts(opts: {
    search?: string;
    company?: string;
    city?: string;
    state?: string;
    category?: string;
    origin?: string;
    active?: boolean | "all";
    consentStatus?: string;
    tagIds?: string[];
    page?: number;
    limit?: number;
}) {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(100, Math.max(1, opts.limit || 20));
    const search = opts.search?.trim();

    const where: Record<string, unknown> = {
        organizationKey: CRM_ORG_DEFAULT,
    };

    if (opts.active !== "all" && opts.active !== undefined) {
        where.active = Boolean(opts.active);
    } else if (opts.active === undefined) {
        where.active = true;
    }

    if (opts.company?.trim()) {
        where.company = { contains: opts.company.trim(), mode: "insensitive" };
    }
    if (opts.city?.trim()) {
        where.city = { contains: opts.city.trim(), mode: "insensitive" };
    }
    if (opts.state?.trim()) {
        where.state = opts.state.trim().toUpperCase().slice(0, 2);
    }
    if (opts.category?.trim()) where.category = opts.category.trim();
    if (opts.origin?.trim()) where.origin = opts.origin.trim();
    if (opts.consentStatus?.trim()) where.consentStatus = opts.consentStatus.trim();

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

    const [total, rows] = await Promise.all([
        prisma.crmContact.count({ where: where as never }),
        prisma.crmContact.findMany({
            where: where as never,
            include: contactInclude,
            orderBy: [{ updatedAt: "desc" }],
            skip: (page - 1) * limit,
            take: limit,
        }),
    ]);

    return {
        contacts: rows.map(serializeCrmContact),
        meta: {
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
        },
    };
}

export async function getCrmContact(id: string) {
    const c = await prisma.crmContact.findFirst({
        where: { id, organizationKey: CRM_ORG_DEFAULT },
        include: {
            ...contactInclude,
            conversations: {
                where: { channelId: DATAFY_OFFICIAL_CHANNEL_ID },
                orderBy: { lastMessageAt: "desc" },
                take: 20,
                include: {
                    assignedTo: {
                        select: { id: true, name: true, email: true },
                    },
                },
            },
        },
    });
    if (!c) throw new CrmError("Contato não encontrado", 404);

    return {
        contact: serializeCrmContact(c),
        conversations: c.conversations.map((conv) => ({
            id: conv.id,
            waId: conv.waId,
            status: conv.status,
            lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
            lastMessagePreview: conv.lastMessagePreview,
            unreadCount: conv.unreadCount,
            assignedTo: conv.assignedTo
                ? {
                      id: conv.assignedTo.id,
                      name: conv.assignedTo.name,
                      email: conv.assignedTo.email,
                  }
                : null,
        })),
    };
}

export type UpsertCrmInput = {
    waId: string;
    fullName?: string | null;
    company?: string | null;
    city?: string | null;
    state?: string | null;
    category?: string | null;
    notes?: string | null;
    origin?: string;
    active?: boolean;
    consentStatus?: string;
    consentSource?: string | null;
    tagIds?: string[];
    tagNames?: string[];
};

async function resolveTagIds(
    tagIds?: string[],
    tagNames?: string[]
): Promise<string[]> {
    const ids = new Set<string>(tagIds || []);
    for (const raw of tagNames || []) {
        const name = raw.trim();
        if (!name) continue;
        const tag = await prisma.crmTag.upsert({
            where: {
                organizationKey_name: {
                    organizationKey: CRM_ORG_DEFAULT,
                    name,
                },
            },
            create: {
                organizationKey: CRM_ORG_DEFAULT,
                name,
            },
            update: {},
        });
        ids.add(tag.id);
    }
    return Array.from(ids);
}

export async function createCrmContact(
    input: UpsertCrmInput,
    userId: string
) {
    const waId = normalizeWa(input.waId);
    const existing = await prisma.crmContact.findUnique({
        where: {
            organizationKey_waId: {
                organizationKey: CRM_ORG_DEFAULT,
                waId,
            },
        },
    });
    if (existing) {
        throw new CrmError("Já existe um contato com este WhatsApp", 409);
    }

    if (
        input.category &&
        !CRM_CATEGORIES.includes(input.category as (typeof CRM_CATEGORIES)[number])
    ) {
        throw new CrmError("Categoria inválida", 400);
    }
    if (
        input.consentStatus &&
        !CRM_CONSENT_STATUSES.includes(
            input.consentStatus as (typeof CRM_CONSENT_STATUSES)[number]
        )
    ) {
        throw new CrmError("Status de consentimento inválido", 400);
    }

    // Import/manual never auto-grants marketing consent
    let consentStatus = input.consentStatus || "unknown";
    if (input.origin === "import" && consentStatus === "granted") {
        consentStatus = "unknown";
    }

    const tagIds = await resolveTagIds(input.tagIds, input.tagNames);

    const created = await prisma.crmContact.create({
        data: {
            organizationKey: CRM_ORG_DEFAULT,
            waId,
            fullName: input.fullName?.trim() || null,
            company: input.company?.trim() || null,
            city: input.city?.trim() || null,
            state: input.state?.trim().toUpperCase().slice(0, 2) || null,
            category: input.category || null,
            notes: input.notes?.trim() || null,
            origin: input.origin || "manual",
            active: input.active !== false,
            consentStatus,
            consentSource: input.consentSource || null,
            consentAt:
                consentStatus === "granted" || consentStatus === "denied"
                    ? new Date()
                    : null,
            createdById: userId,
            updatedById: userId,
            tags: tagIds.length
                ? { create: tagIds.map((tagId) => ({ tagId })) }
                : undefined,
        },
        include: contactInclude,
    });

    await linkCrmToDatafyConversation(created.id, waId);
    return serializeCrmContact(created);
}

export async function updateCrmContact(
    id: string,
    input: Partial<UpsertCrmInput> & {
        optOut?: boolean;
        clearOptOut?: boolean;
    },
    userId: string
) {
    const current = await prisma.crmContact.findFirst({
        where: { id, organizationKey: CRM_ORG_DEFAULT },
    });
    if (!current) throw new CrmError("Contato não encontrado", 404);

    const data: Record<string, unknown> = { updatedById: userId };

    if (input.waId !== undefined) {
        const waId = normalizeWa(input.waId);
        if (waId !== current.waId) {
            const clash = await prisma.crmContact.findUnique({
                where: {
                    organizationKey_waId: {
                        organizationKey: CRM_ORG_DEFAULT,
                        waId,
                    },
                },
            });
            if (clash) throw new CrmError("WhatsApp já cadastrado", 409);
            data.waId = waId;
        }
    }

    if (input.fullName !== undefined) data.fullName = input.fullName?.trim() || null;
    if (input.company !== undefined) data.company = input.company?.trim() || null;
    if (input.city !== undefined) data.city = input.city?.trim() || null;
    if (input.state !== undefined)
        data.state = input.state?.trim().toUpperCase().slice(0, 2) || null;
    if (input.category !== undefined) data.category = input.category || null;
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    if (input.active !== undefined) data.active = Boolean(input.active);

    // Never overwrite opted_out with import/granted unless clearOptOut
    if (input.optOut) {
        data.consentStatus = "opted_out";
        data.optedOutAt = new Date();
        data.consentAt = new Date();
        data.consentSource = input.consentSource || "manual_opt_out";
    } else if (input.clearOptOut && current.consentStatus === "opted_out") {
        data.consentStatus = "unknown";
        data.optedOutAt = null;
    } else if (input.consentStatus !== undefined) {
        if (current.consentStatus === "opted_out" && input.consentStatus !== "opted_out") {
            // Protect opt-out
            /* skip consent overwrite */
        } else {
            data.consentStatus = input.consentStatus;
            if (
                input.consentStatus === "granted" ||
                input.consentStatus === "denied"
            ) {
                data.consentAt = new Date();
                data.consentSource = input.consentSource || "manual";
            }
            if (input.consentStatus === "opted_out") {
                data.optedOutAt = new Date();
            }
        }
    }

    await prisma.crmContact.update({ where: { id }, data });

    if (input.tagIds !== undefined || input.tagNames !== undefined) {
        const tagIds = await resolveTagIds(input.tagIds, input.tagNames);
        await prisma.crmContactTag.deleteMany({ where: { contactId: id } });
        if (tagIds.length) {
            await prisma.crmContactTag.createMany({
                data: tagIds.map((tagId) => ({ contactId: id, tagId })),
                skipDuplicates: true,
            });
        }
    }

    const waId = (data.waId as string) || current.waId;
    await linkCrmToDatafyConversation(id, waId);

    const updated = await prisma.crmContact.findUniqueOrThrow({
        where: { id },
        include: contactInclude,
    });
    return serializeCrmContact(updated);
}

export async function deactivateCrmContact(id: string, userId: string) {
    return updateCrmContact(id, { active: false }, userId);
}

export async function reactivateCrmContact(id: string, userId: string) {
    return updateCrmContact(id, { active: true }, userId);
}

export async function deleteCrmContact(id: string) {
    const current = await prisma.crmContact.findFirst({
        where: { id, organizationKey: CRM_ORG_DEFAULT },
        include: { _count: { select: { conversations: true } } },
    });
    if (!current) throw new CrmError("Contato não encontrado", 404);

    // Soft-prefer: if has conversations, only deactivate
    if ((current._count.conversations || 0) > 0) {
        await prisma.crmContact.update({
            where: { id },
            data: { active: false },
        });
        return { deleted: false, deactivated: true };
    }

    await prisma.crmContact.delete({ where: { id } });
    return { deleted: true, deactivated: false };
}

/**
 * Bulk create from phone list (same parsePhoneList contract as Disparo).
 * Never sets consent to granted. Never overwrites opted_out.
 */
export async function importCrmPhones(opts: {
    phones: string[];
    userId: string;
    category?: string | null;
    tagNames?: string[];
}) {
    let created = 0;
    let skipped = 0;
    let updated = 0;

    for (const raw of opts.phones) {
        let waId: string;
        try {
            waId = normalizeWa(raw);
        } catch {
            skipped++;
            continue;
        }

        const existing = await prisma.crmContact.findUnique({
            where: {
                organizationKey_waId: {
                    organizationKey: CRM_ORG_DEFAULT,
                    waId,
                },
            },
        });

        if (existing) {
            // Do not overwrite opt-out or manual CRM fields; only touch interaction link
            await linkCrmToDatafyConversation(existing.id, waId);
            skipped++;
            continue;
        }

        await createCrmContact(
            {
                waId,
                origin: "import",
                consentStatus: "unknown",
                category: opts.category || null,
                tagNames: opts.tagNames,
            },
            opts.userId
        );
        created++;
        void updated;
    }

    return { created, skipped, updated, total: opts.phones.length };
}

export async function linkCrmToDatafyConversation(
    crmContactId: string,
    waId: string
) {
    try {
        await prisma.datafyConversation.updateMany({
            where: {
                channelId: DATAFY_OFFICIAL_CHANNEL_ID,
                waId,
                OR: [{ crmContactId: null }, { crmContactId: { not: crmContactId } }],
            },
            data: { crmContactId },
        });
    } catch {
        /* tables may not be ready during partial migrate */
    }
}

/**
 * Upsert CRM contact from Datafy webhook. Does not overwrite manual fullName/company/notes.
 * Never grants consent.
 */
export async function upsertCrmFromDatafyWebhook(opts: {
    waId: string;
    contactName?: string | null;
}): Promise<string | null> {
    const waId = normalizeBrazilianPhone(opts.waId);
    if (!waId || waId.length < 10) return null;

    try {
        const existing = await prisma.crmContact.findUnique({
            where: {
                organizationKey_waId: {
                    organizationKey: CRM_ORG_DEFAULT,
                    waId,
                },
            },
        });

        if (existing) {
            await prisma.crmContact.update({
                where: { id: existing.id },
                data: {
                    lastInteractionAt: new Date(),
                    // Only fill empty name from WhatsApp push name
                    fullName:
                        existing.fullName ||
                        opts.contactName?.trim() ||
                        existing.fullName,
                },
            });
            await linkCrmToDatafyConversation(existing.id, waId);
            return existing.id;
        }

        const created = await prisma.crmContact.create({
            data: {
                organizationKey: CRM_ORG_DEFAULT,
                waId,
                fullName: opts.contactName?.trim() || null,
                origin: "datafy_webhook",
                consentStatus: "unknown",
                lastInteractionAt: new Date(),
            },
        });
        await linkCrmToDatafyConversation(created.id, waId);
        return created.id;
    } catch {
        return null;
    }
}

export async function listCrmTags() {
    const tags = await prisma.crmTag.findMany({
        where: { organizationKey: CRM_ORG_DEFAULT },
        orderBy: { name: "asc" },
    });
    return tags.map(serializeCrmTag);
}

export async function createCrmTag(name: string, colorHex?: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new CrmError("Nome da etiqueta é obrigatório");
    const tag = await prisma.crmTag.upsert({
        where: {
            organizationKey_name: {
                organizationKey: CRM_ORG_DEFAULT,
                name: trimmed,
            },
        },
        create: {
            organizationKey: CRM_ORG_DEFAULT,
            name: trimmed,
            colorHex: colorHex || "#64748b",
        },
        update: {
            colorHex: colorHex || undefined,
        },
    });
    return serializeCrmTag(tag);
}

export async function exportCrmContactsCsv(): Promise<string> {
    const rows = await prisma.crmContact.findMany({
        where: { organizationKey: CRM_ORG_DEFAULT },
        include: { tags: { include: { tag: true } } },
        orderBy: { fullName: "asc" },
    });

    const header = [
        "waId",
        "fullName",
        "company",
        "city",
        "state",
        "category",
        "origin",
        "active",
        "consentStatus",
        "tags",
        "notes",
    ].join(",");

    const escape = (v: string | null | undefined) => {
        const s = String(v ?? "");
        if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
        return s;
    };

    const lines = rows.map((r) =>
        [
            r.waId,
            r.fullName,
            r.company,
            r.city,
            r.state,
            r.category,
            r.origin,
            r.active ? "1" : "0",
            r.consentStatus,
            r.tags.map((t) => t.tag.name).join("|"),
            r.notes,
        ]
            .map(escape)
            .join(",")
    );

    return [header, ...lines].join("\n");
}
