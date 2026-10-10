import type { CrmContact, CrmTag, User } from "@prisma/client";

type TagJoin = { tag: CrmTag };
type ContactWithTags = CrmContact & {
    tags?: TagJoin[];
    createdBy?: Pick<User, "id" | "name" | "email"> | null;
    updatedBy?: Pick<User, "id" | "name" | "email"> | null;
    _count?: { conversations?: number };
};

export function serializeCrmContact(c: ContactWithTags) {
    return {
        id: c.id,
        organizationKey: c.organizationKey,
        waId: c.waId,
        fullName: c.fullName,
        company: c.company,
        city: c.city,
        state: c.state,
        category: c.category,
        origin: c.origin,
        notes: c.notes,
        active: c.active,
        consentStatus: c.consentStatus,
        consentSource: c.consentSource,
        consentAt: c.consentAt?.toISOString() ?? null,
        optedOutAt: c.optedOutAt?.toISOString() ?? null,
        lastInteractionAt: c.lastInteractionAt?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        tags: (c.tags || []).map((t) => ({
            id: t.tag.id,
            name: t.tag.name,
            colorHex: t.tag.colorHex,
        })),
        conversationsCount: c._count?.conversations ?? undefined,
        createdBy: c.createdBy
            ? { id: c.createdBy.id, name: c.createdBy.name, email: c.createdBy.email }
            : null,
        updatedBy: c.updatedBy
            ? { id: c.updatedBy.id, name: c.updatedBy.name, email: c.updatedBy.email }
            : null,
    };
}

export function serializeCrmTag(t: CrmTag) {
    return {
        id: t.id,
        name: t.name,
        colorHex: t.colorHex,
        createdAt: t.createdAt.toISOString(),
    };
}
