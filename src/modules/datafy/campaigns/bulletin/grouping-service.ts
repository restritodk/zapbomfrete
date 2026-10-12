/**
 * Persist / query bulletin bundles, versions and cards.
 * Reuses CampaignMessagePart composition — does not invent a parallel send pipeline.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { CampaignMessagePart } from "./types";
import {
    aggregateCardApprovalStatus,
    cardSeedsFromMessageParts,
    formatBulletinDateKey,
    formatBulletinPublicKey,
    partsFromBulletinCards,
    slugifyBulletinTitle,
    splitCurrentAndHistory,
    type BulletinCardSeed,
    type GroupedBulletinListItem,
    canAssociateTemplateToCard,
} from "./grouping";

const ORG = "default";

type BundleDb = {
    datafyBulletinBundle: {
        findFirst: (args: unknown) => Promise<{
            id: string;
            publicKey: string;
            name: string;
            slug: string;
            latestVersion: number;
        } | null>;
        findMany: (args: unknown) => Promise<
            Array<{
                id: string;
                publicKey: string;
                name: string;
                slug: string;
                latestVersion: number;
            }>
        >;
        create: (args: unknown) => Promise<{
            id: string;
            publicKey: string;
            name: string;
            slug: string;
            latestVersion: number;
        }>;
        update: (args: unknown) => Promise<unknown>;
    };
    datafyBulletinVersion: {
        findUnique: (args: unknown) => Promise<VersionRow | null>;
        findFirst: (args: unknown) => Promise<VersionRow | null>;
        findMany: (args: unknown) => Promise<VersionRow[]>;
        create: (args: unknown) => Promise<VersionRow>;
        update: (args: unknown) => Promise<VersionRow>;
        updateMany: (args: unknown) => Promise<unknown>;
    };
    datafyBulletinCard: {
        findMany: (args: unknown) => Promise<CardRow[]>;
        findUnique: (args: unknown) => Promise<CardRow | null>;
        createMany: (args: unknown) => Promise<unknown>;
        update: (args: unknown) => Promise<CardRow>;
        deleteMany: (args: unknown) => Promise<unknown>;
    };
    datafyManagedTemplate: {
        findMany: (args: unknown) => Promise<
            Array<{
                id: string;
                technicalName: string;
                displayName: string;
                language: string;
                category: string;
                remoteStatus: string | null;
                remoteTemplateId: string | null;
                loadsPerMessage: number;
                inLibrary: boolean;
                lastSyncedAt: Date | null;
                lastSubmittedAt: Date | null;
                componentsJson: unknown;
                bodyText: string;
                suggestedBundleKey: string | null;
            }>
        >;
        findUnique: (args: unknown) => Promise<{
            id: string;
            technicalName: string;
            language: string;
            loadsPerMessage: number;
            remoteStatus: string | null;
            remoteTemplateId: string | null;
            lastSyncedAt: Date | null;
            lastSubmittedAt: Date | null;
            componentsJson: unknown;
            displayName: string;
            category: string;
            bodyText: string;
        } | null>;
        update: (args: unknown) => Promise<unknown>;
    };
    datafyBulletinDraft: {
        update: (args: unknown) => Promise<unknown>;
    };
};

function db(): BundleDb {
    return prisma as unknown as BundleDb;
}

type CardRow = {
    id: string;
    versionId: string;
    position: number;
    loadIndexes: unknown;
    loadSummary: string | null;
    bodyPreview: string | null;
    libraryTemplateId: string | null;
    technicalName: string | null;
    displayName: string | null;
    language: string;
    category: string;
    approvalStatus: string;
    managedTemplateId: string | null;
    remoteTemplateId: string | null;
    lastSubmittedAt: Date | null;
    lastSyncedAt: Date | null;
    variableMapping: unknown;
    templateComponents: unknown;
    associationSource: string;
};

type VersionRow = {
    id: string;
    organizationKey: string;
    bundleId: string;
    version: number;
    title: string;
    rawText: string;
    loads: unknown;
    loadCount: number;
    cardCount: number;
    language: string;
    category: string;
    approvalStatus: string;
    isCurrent: boolean;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
    cards?: CardRow[];
    bundle?: {
        id: string;
        publicKey: string;
        name: string;
        slug: string;
        latestVersion: number;
    };
};

async function nextSequenceForSlugDate(
    slug: string,
    dateKey: string
): Promise<number> {
    const prefix = `${slug}-${dateKey}-`;
    const existing = await db().datafyBulletinBundle.findMany({
        where: {
            organizationKey: ORG,
            publicKey: { startsWith: prefix },
        },
        select: { publicKey: true },
    });
    let max = 0;
    for (const row of existing) {
        const m = String(row.publicKey).match(/-(\d+)$/);
        if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
}

async function resolveManagedByName(
    technicalName: string | null | undefined,
    language: string
) {
    if (!technicalName) return null;
    const rows = await db().datafyManagedTemplate.findMany({
        where: {
            organizationKey: ORG,
            technicalName,
            language,
            deletedAt: null,
            hidden: false,
        },
        take: 1,
    });
    return rows[0] || null;
}

async function hydrateCardSeeds(
    seeds: BulletinCardSeed[]
): Promise<BulletinCardSeed[]> {
    const out: BulletinCardSeed[] = [];
    for (const seed of seeds) {
        const managed = await resolveManagedByName(
            seed.technicalName,
            seed.language || "pt_BR"
        );
        if (managed) {
            out.push({
                ...seed,
                managedTemplateId: managed.id,
                remoteTemplateId: managed.remoteTemplateId,
                approvalStatus: String(
                    managed.remoteStatus || seed.approvalStatus || "DRAFT"
                ).toUpperCase(),
                lastSyncedAt: managed.lastSyncedAt,
                lastSubmittedAt: managed.lastSubmittedAt,
                templateComponents:
                    seed.templateComponents ?? managed.componentsJson,
                associationSource: "compose",
            });
        } else {
            out.push(seed);
        }
    }
    return out;
}

export async function createBulletinVersionFromParts(opts: {
    title: string;
    rawText: string;
    loads?: unknown;
    loadCount: number;
    parts: CampaignMessagePart[];
    userId?: string | null;
    /** When set, create a new version under this existing bundle. */
    bundleId?: string | null;
    draftId?: string | null;
    language?: string;
    category?: string;
}): Promise<{
    bundle: { id: string; publicKey: string; name: string };
    version: VersionRow;
    cards: CardRow[];
}> {
    const title = opts.title.trim() || "Boletim";
    const seeds = await hydrateCardSeeds(cardSeedsFromMessageParts(opts.parts));
    const approvalStatus = aggregateCardApprovalStatus(
        seeds.map((s) => s.approvalStatus)
    );

    let bundle = opts.bundleId
        ? await db().datafyBulletinBundle.findFirst({
              where: { id: opts.bundleId, organizationKey: ORG },
          })
        : null;

    if (!bundle) {
        const slug = slugifyBulletinTitle(title);
        const dateKey = formatBulletinDateKey(new Date());
        const seq = await nextSequenceForSlugDate(slug, dateKey);
        const publicKey = formatBulletinPublicKey(slug, dateKey, seq);
        bundle = await db().datafyBulletinBundle.create({
            data: {
                organizationKey: ORG,
                publicKey,
                name: title,
                slug,
                latestVersion: 1,
                createdById: opts.userId || null,
            },
        });
    } else {
        await db().datafyBulletinVersion.updateMany({
            where: { bundleId: bundle.id, isCurrent: true },
            data: { isCurrent: false },
        });
        const nextVer = Math.max(1, bundle.latestVersion) + 1;
        await db().datafyBulletinBundle.update({
            where: { id: bundle.id },
            data: {
                latestVersion: nextVer,
                name: title,
            },
        });
        bundle = {
            ...bundle,
            latestVersion: nextVer,
            name: title,
        };
    }

    const versionNumber = bundle.latestVersion;
    const version = await db().datafyBulletinVersion.create({
        data: {
            organizationKey: ORG,
            bundleId: bundle.id,
            version: versionNumber,
            title,
            rawText: opts.rawText,
            loads: (opts.loads ?? null) as Prisma.InputJsonValue,
            loadCount: opts.loadCount,
            cardCount: seeds.length,
            language: opts.language || "pt_BR",
            category: opts.category || "MARKETING",
            approvalStatus,
            isCurrent: true,
            createdById: opts.userId || null,
        },
    });

    if (seeds.length) {
        await db().datafyBulletinCard.createMany({
            data: seeds.map((s) => ({
                versionId: version.id,
                position: s.position,
                loadIndexes: s.loadIndexes as Prisma.InputJsonValue,
                loadSummary: s.loadSummary,
                bodyPreview: s.bodyPreview,
                libraryTemplateId: s.libraryTemplateId || null,
                technicalName: s.technicalName || null,
                displayName: s.displayName || null,
                language: s.language || "pt_BR",
                category: s.category || "MARKETING",
                approvalStatus: String(s.approvalStatus || "DRAFT").toUpperCase(),
                managedTemplateId: s.managedTemplateId || null,
                remoteTemplateId: s.remoteTemplateId || null,
                lastSubmittedAt: s.lastSubmittedAt
                    ? new Date(s.lastSubmittedAt)
                    : null,
                lastSyncedAt: s.lastSyncedAt
                    ? new Date(s.lastSyncedAt)
                    : null,
                variableMapping: (s.variableMapping ??
                    null) as Prisma.InputJsonValue,
                templateComponents: (s.templateComponents ??
                    null) as Prisma.InputJsonValue,
                associationSource: s.associationSource || "compose",
            })),
        });
    }

    if (opts.draftId) {
        await db().datafyBulletinDraft.update({
            where: { id: opts.draftId },
            data: { bulletinVersionId: version.id },
        });
    }

    const cards = await db().datafyBulletinCard.findMany({
        where: { versionId: version.id },
        orderBy: { position: "asc" },
    });

    return {
        bundle: {
            id: bundle.id,
            publicKey: bundle.publicKey,
            name: bundle.name,
        },
        version,
        cards,
    };
}

export async function syncVersionCardStatuses(versionId: string) {
    const version = await db().datafyBulletinVersion.findUnique({
        where: { id: versionId },
        include: { cards: { orderBy: { position: "asc" } } },
    });
    if (!version?.cards?.length) return null;

    for (const card of version.cards) {
        if (!card.managedTemplateId && !card.technicalName) continue;
        const managed = card.managedTemplateId
            ? await db().datafyManagedTemplate.findUnique({
                  where: { id: card.managedTemplateId },
              })
            : await resolveManagedByName(card.technicalName, card.language);
        if (!managed) continue;
        await db().datafyBulletinCard.update({
            where: { id: card.id },
            data: {
                managedTemplateId: managed.id,
                approvalStatus: String(
                    managed.remoteStatus || card.approvalStatus || "DRAFT"
                ).toUpperCase(),
                remoteTemplateId: managed.remoteTemplateId,
                lastSyncedAt: managed.lastSyncedAt || new Date(),
                lastSubmittedAt: managed.lastSubmittedAt,
            },
        });
    }

    const refreshed = await db().datafyBulletinCard.findMany({
        where: { versionId },
        orderBy: { position: "asc" },
    });
    const approvalStatus = aggregateCardApprovalStatus(
        refreshed.map((c) => c.approvalStatus)
    );
    return db().datafyBulletinVersion.update({
        where: { id: versionId },
        data: { approvalStatus, cardCount: refreshed.length },
        include: { cards: { orderBy: { position: "asc" } }, bundle: true },
    });
}

function toListItem(v: VersionRow): GroupedBulletinListItem {
    const cards = v.cards || [];
    const approvedCardCount = cards.filter(
        (c) => String(c.approvalStatus).toUpperCase() === "APPROVED"
    ).length;
    return {
        bundleId: v.bundleId,
        publicKey: v.bundle?.publicKey || "",
        name: v.bundle?.name || v.title,
        versionId: v.id,
        version: v.version,
        isCurrent: v.isCurrent,
        title: v.title,
        loadCount: v.loadCount,
        cardCount: v.cardCount,
        approvalStatus: v.approvalStatus,
        approvedCardCount,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
        cards: cards.map((c) => ({
            id: c.id,
            position: c.position,
            loadSummary: c.loadSummary || "",
            technicalName: c.technicalName,
            displayName: c.displayName,
            approvalStatus: c.approvalStatus,
            lastSyncedAt: c.lastSyncedAt?.toISOString() || null,
            bodyPreview: c.bodyPreview,
            libraryTemplateId: c.libraryTemplateId,
        })),
    };
}

export async function listGroupedBulletins(opts?: {
    onlyFullyApproved?: boolean;
    includeHistory?: boolean;
}): Promise<{
    current: GroupedBulletinListItem[];
    history: GroupedBulletinListItem[];
    all: GroupedBulletinListItem[];
}> {
    const versions = await db().datafyBulletinVersion.findMany({
        where: {
            organizationKey: ORG,
            ...(opts?.onlyFullyApproved
                ? { approvalStatus: "fully_approved" }
                : {}),
            ...(opts?.includeHistory === false ? { isCurrent: true } : {}),
        },
        include: {
            cards: { orderBy: { position: "asc" } },
            bundle: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 200,
    });

    // Refresh stale statuses lightly (APPROVED templates may have synced)
    for (const v of versions.slice(0, 40)) {
        if (v.approvalStatus !== "fully_approved") {
            await syncVersionCardStatuses(v.id).catch(() => null);
        }
    }

    const refreshed = await db().datafyBulletinVersion.findMany({
        where: {
            organizationKey: ORG,
            id: { in: versions.map((v) => v.id) },
            ...(opts?.onlyFullyApproved
                ? { approvalStatus: "fully_approved" }
                : {}),
        },
        include: {
            cards: { orderBy: { position: "asc" } },
            bundle: true,
        },
        orderBy: { updatedAt: "desc" },
    });

    const all = refreshed.map(toListItem);
    const { current, history } = splitCurrentAndHistory(all);
    return { current, history, all };
}

export async function getBulletinVersionDetail(versionId: string) {
    const version = await db().datafyBulletinVersion.findUnique({
        where: { id: versionId },
        include: {
            cards: { orderBy: { position: "asc" } },
            bundle: true,
        },
    });
    if (!version) return null;
    await syncVersionCardStatuses(versionId).catch(() => null);
    const fresh = await db().datafyBulletinVersion.findUnique({
        where: { id: versionId },
        include: {
            cards: { orderBy: { position: "asc" } },
            bundle: true,
        },
    });
    return fresh ? toListItem(fresh) : null;
}

export async function buildCampaignPartsForVersion(opts: {
    versionId: string;
    mode: "complete_bulletin" | "single_card";
    cardPosition?: number | null;
}): Promise<{
    parts: CampaignMessagePart[];
    meta: {
        publicKey: string;
        version: number;
        title: string;
        loadCount: number;
        cardCount: number;
        approvedCardCount: number;
        bulletinSendMode: string;
        bulletinVersionId: string;
        bulletinCardPosition: number | null;
    };
}> {
    const detail = await getBulletinVersionDetail(opts.versionId);
    if (!detail) throw new Error("Versão de boletim não encontrada");

    const version = await db().datafyBulletinVersion.findUnique({
        where: { id: opts.versionId },
        include: { cards: { orderBy: { position: "asc" } }, bundle: true },
    });
    if (!version) throw new Error("Versão de boletim não encontrada");

    if (opts.mode === "complete_bulletin") {
        const approved = (version.cards || []).filter(
            (c) => String(c.approvalStatus).toUpperCase() === "APPROVED"
        );
        if (!approved.length) {
            throw new Error(
                "Nenhum card APPROVED nesta versão — aguarde aprovação ou associe templates."
            );
        }
        if (approved.length !== (version.cards || []).length) {
            throw new Error(
                `Boletim incompleto: ${approved.length} de ${(version.cards || []).length} cards aprovados.`
            );
        }
        const parts = partsFromBulletinCards(version.cards || [], {
            onlyApproved: true,
        });
        return {
            parts,
            meta: {
                publicKey: version.bundle?.publicKey || detail.publicKey,
                version: version.version,
                title: version.title,
                loadCount: version.loadCount,
                cardCount: version.cardCount,
                approvedCardCount: approved.length,
                bulletinSendMode: "complete_bulletin",
                bulletinVersionId: version.id,
                bulletinCardPosition: null,
            },
        };
    }

    const pos = opts.cardPosition;
    if (pos == null || pos < 1) {
        throw new Error("Informe a posição do card para envio individual");
    }
    const card = (version.cards || []).find((c) => c.position === pos);
    if (!card) throw new Error("Card não encontrado nesta versão");
    if (String(card.approvalStatus).toUpperCase() !== "APPROVED") {
        throw new Error("Card selecionado ainda não está APPROVED");
    }
    const parts = partsFromBulletinCards([card], {
        onlyApproved: true,
        onlyPosition: pos,
    });
    return {
        parts,
        meta: {
            publicKey: version.bundle?.publicKey || detail.publicKey,
            version: version.version,
            title: version.title,
            loadCount: version.loadCount,
            cardCount: 1,
            approvedCardCount: 1,
            bulletinSendMode: "single_card",
            bulletinVersionId: version.id,
            bulletinCardPosition: pos,
        },
    };
}

export async function listOrphanManagedTemplates() {
    const linked = await db().datafyBulletinCard.findMany({
        where: { managedTemplateId: { not: null } },
        select: { managedTemplateId: true },
    });
    const linkedIds = new Set(
        linked.map((l) => l.managedTemplateId).filter(Boolean) as string[]
    );
    const templates = await db().datafyManagedTemplate.findMany({
        where: {
            organizationKey: ORG,
            deletedAt: null,
            hidden: false,
            remoteStatus: "APPROVED",
            inLibrary: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 200,
    });
    return templates
        .filter((t) => !linkedIds.has(t.id))
        .map((t) => ({
            id: t.id,
            technicalName: t.technicalName,
            displayName: t.displayName,
            language: t.language,
            category: t.category,
            loadsPerMessage: t.loadsPerMessage,
            remoteStatus: t.remoteStatus,
            lastSyncedAt: t.lastSyncedAt?.toISOString() || null,
            bodyPreview: t.bodyText.slice(0, 800),
            suggestedBundleKey: t.suggestedBundleKey,
            associationStatus: "unassociated" as const,
        }));
}

export async function associateTemplateToCard(opts: {
    cardId: string;
    managedTemplateId: string;
    actorRole?: string;
}) {
    const card = await db().datafyBulletinCard.findUnique({
        where: { id: opts.cardId },
    });
    if (!card) throw new Error("Card não encontrado");

    const managed = await db().datafyManagedTemplate.findUnique({
        where: { id: opts.managedTemplateId },
    });
    if (!managed) throw new Error("Template não encontrado");

    const loadIndexes = Array.isArray(card.loadIndexes)
        ? (card.loadIndexes as number[])
        : [];
    const check = canAssociateTemplateToCard({
        cardLoadsPerMessage: loadIndexes.length || 1,
        templateLoadsPerMessage: managed.loadsPerMessage,
        cardApprovalStatus: card.approvalStatus,
        templateRemoteStatus: managed.remoteStatus,
    });
    if (!check.ok) throw new Error(check.reason || "Associação incompatível");

    // Prevent reusing the same managed template on another card of a different version
    // with conflicting positions — allow same reusable library template across versions.
    const updated = await db().datafyBulletinCard.update({
        where: { id: card.id },
        data: {
            managedTemplateId: managed.id,
            technicalName: managed.technicalName,
            displayName: managed.displayName,
            language: managed.language,
            category: managed.category,
            approvalStatus: String(managed.remoteStatus || "DRAFT").toUpperCase(),
            remoteTemplateId: managed.remoteTemplateId,
            lastSyncedAt: managed.lastSyncedAt || new Date(),
            lastSubmittedAt: managed.lastSubmittedAt,
            templateComponents: managed.componentsJson as Prisma.InputJsonValue,
            associationSource: "manual",
        },
    });

    await syncVersionCardStatuses(card.versionId);
    return updated;
}

export async function tryAutoLinkOrphansByExactComposeMatch(opts: {
    versionId: string;
}): Promise<number> {
    const version = await db().datafyBulletinVersion.findUnique({
        where: { id: opts.versionId },
        include: { cards: true },
    });
    if (!version) return 0;
    let linked = 0;
    for (const card of version.cards || []) {
        if (card.managedTemplateId || !card.technicalName) continue;
        const managed = await resolveManagedByName(
            card.technicalName,
            card.language
        );
        if (!managed) continue;
        if (String(managed.remoteStatus || "").toUpperCase() !== "APPROVED")
            continue;
        await db().datafyBulletinCard.update({
            where: { id: card.id },
            data: {
                managedTemplateId: managed.id,
                approvalStatus: "APPROVED",
                remoteTemplateId: managed.remoteTemplateId,
                lastSyncedAt: managed.lastSyncedAt || new Date(),
                associationSource: "auto_link",
            },
        });
        linked++;
    }
    if (linked) await syncVersionCardStatuses(opts.versionId);
    return linked;
}
