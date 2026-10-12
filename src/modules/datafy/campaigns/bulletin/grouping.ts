/**
 * Bulletin grouping / versioning / card order helpers (pure).
 * IDs like COTTON-20261012-001 are immutable public keys for a bulletin family.
 */

import type { CampaignMessagePart } from "./types";

export type BulletinApprovalAggregate =
    | "draft"
    | "pending_approval"
    | "partially_approved"
    | "fully_approved"
    | "archived";

export type BulletinCardSeed = {
    position: number;
    loadIndexes: number[];
    loadSummary: string;
    bodyPreview: string;
    libraryTemplateId?: string | null;
    technicalName?: string | null;
    displayName?: string | null;
    language?: string;
    category?: string;
    approvalStatus?: string;
    managedTemplateId?: string | null;
    remoteTemplateId?: string | null;
    lastSubmittedAt?: Date | string | null;
    lastSyncedAt?: Date | string | null;
    variableMapping?: unknown;
    templateComponents?: unknown;
    associationSource?: string;
};

const STOP_WORDS = new Set([
    "de",
    "da",
    "do",
    "das",
    "dos",
    "e",
    "a",
    "o",
    "as",
    "os",
    "um",
    "uma",
    "para",
    "com",
    "em",
    "no",
    "na",
    "atualizacao",
    "atualização",
    "embarque",
    "boletim",
    "cargas",
    "carga",
]);

/** Normalize title → short slug token for public keys (COTTON, SOJA, …). */
export function slugifyBulletinTitle(title: string): string {
    const cleaned = String(title || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s-]/g, " ")
        .toUpperCase()
        .trim();
    const parts = cleaned
        .split(/[\s_-]+/)
        .map((p) => p.replace(/[^A-Z0-9]/g, ""))
        .filter((p) => p.length >= 2 && !STOP_WORDS.has(p.toLowerCase()));
    const picked = (parts[0] || "BOLETIM").slice(0, 24);
    return picked || "BOLETIM";
}

export function formatBulletinDateKey(d: Date = new Date()): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}${m}${day}`;
}

export function formatBulletinPublicKey(
    slug: string,
    dateKey: string,
    sequence: number
): string {
    const seq = String(Math.max(1, Math.floor(sequence))).padStart(3, "0");
    return `${slug}-${dateKey}-${seq}`;
}

export function parseBulletinPublicKey(publicKey: string): {
    slug: string;
    dateKey: string;
    sequence: number;
} | null {
    const m = String(publicKey || "")
        .trim()
        .toUpperCase()
        .match(/^([A-Z0-9]+)-(\d{8})-(\d{3,})$/);
    if (!m) return null;
    return {
        slug: m[1],
        dateKey: m[2],
        sequence: Number(m[3]),
    };
}

export function summarizeLoadIndexes(loadIndexes: number[]): string {
    if (!loadIndexes.length) return "Sem cargas";
    const sorted = [...loadIndexes].sort((a, b) => a - b);
    if (sorted.length === 1) return `Carga ${sorted[0] + 1}`;
    return `Cargas ${sorted.map((i) => i + 1).join(", ")}`;
}

export function cardSeedsFromMessageParts(
    parts: CampaignMessagePart[]
): BulletinCardSeed[] {
    return parts.map((p, i) => {
        const position = i + 1;
        const loadIndexes = Array.isArray(p.loadIndexes) ? p.loadIndexes : [];
        return {
            position,
            loadIndexes,
            loadSummary: summarizeLoadIndexes(loadIndexes),
            bodyPreview: String(p.bodyText || "").slice(0, 4000),
            libraryTemplateId: p.libraryTemplateId || null,
            technicalName: p.templateName || null,
            displayName: p.templateName || p.label || `Card ${position}`,
            language: p.templateLanguage || "pt_BR",
            category: p.templateCategory || "MARKETING",
            approvalStatus: String(p.templateApprovalStatus || "DRAFT").toUpperCase(),
            variableMapping: p.variableMapping ?? null,
            templateComponents: p.templateComponents ?? null,
            associationSource: p.templateName ? "compose" : "orphan_unlinked",
        };
    });
}

export function aggregateCardApprovalStatus(
    statuses: Array<string | null | undefined>
): BulletinApprovalAggregate {
    if (!statuses.length) return "draft";
    const normalized = statuses.map((s) => String(s || "DRAFT").toUpperCase());
    const approved = normalized.filter((s) => s === "APPROVED").length;
    const pending = normalized.filter((s) =>
        ["PENDING", "IN_APPEAL", "SUBMITTED"].includes(s)
    ).length;
    const rejected = normalized.filter((s) =>
        ["REJECTED", "PAUSED", "DISABLED"].includes(s)
    ).length;
    if (approved === normalized.length) return "fully_approved";
    if (approved > 0) return "partially_approved";
    if (pending > 0) return "pending_approval";
    if (rejected === normalized.length) return "archived";
    return "draft";
}

export function expectedMessagesForCampaign(opts: {
    eligibleRecipients: number;
    cardCount: number;
}): number {
    const recipients = Math.max(0, Math.floor(opts.eligibleRecipients));
    const cards = Math.max(1, Math.floor(opts.cardCount));
    return recipients * cards;
}

export type GroupedBulletinListItem = {
    bundleId: string;
    publicKey: string;
    name: string;
    versionId: string;
    version: number;
    isCurrent: boolean;
    title: string;
    loadCount: number;
    cardCount: number;
    approvalStatus: BulletinApprovalAggregate | string;
    approvedCardCount: number;
    createdAt: string;
    updatedAt: string;
    cards: Array<{
        id: string;
        position: number;
        loadIndexes: number[];
        loadSummary: string;
        technicalName: string | null;
        displayName: string | null;
        approvalStatus: string;
        lastSyncedAt: string | null;
        bodyPreview: string | null;
        libraryTemplateId: string | null;
        language?: string | null;
        category?: string | null;
        templateComponents?: unknown;
    }>;
};

export function splitCurrentAndHistory(
    items: GroupedBulletinListItem[]
): {
    current: GroupedBulletinListItem[];
    history: GroupedBulletinListItem[];
} {
    const byKey = new Map<string, GroupedBulletinListItem[]>();
    for (const item of items) {
        const list = byKey.get(item.publicKey) || [];
        list.push(item);
        byKey.set(item.publicKey, list);
    }
    const current: GroupedBulletinListItem[] = [];
    const history: GroupedBulletinListItem[] = [];
    for (const list of byKey.values()) {
        const sorted = [...list].sort((a, b) => b.version - a.version);
        const head = sorted.find((x) => x.isCurrent) || sorted[0];
        if (head) current.push(head);
        for (const item of sorted) {
            if (item.versionId !== head?.versionId) history.push(item);
        }
    }
    current.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    history.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return { current, history };
}

/**
 * Pure filter for Step 1 section B: APPROVED managed templates not linked
 * to any card. Intentionally ignores inLibrary (Meta remotes start false).
 */
export function filterUnassociatedApprovedTemplates<
    T extends { id: string; remoteStatus?: string | null },
>(templates: T[], linkedManagedIds: Iterable<string>): T[] {
    const linked = new Set(
        [...linkedManagedIds].filter((id): id is string => Boolean(id))
    );
    return templates.filter(
        (t) =>
            String(t.remoteStatus || "").toUpperCase() === "APPROVED" &&
            !linked.has(t.id)
    );
}

export function canAssociateTemplateToCard(opts: {
    cardLoadsPerMessage: number;
    templateLoadsPerMessage: number | null | undefined;
    cardApprovalStatus: string;
    templateRemoteStatus: string | null | undefined;
}): { ok: boolean; reason?: string } {
    if (
        opts.templateLoadsPerMessage != null &&
        opts.templateLoadsPerMessage > 0 &&
        opts.cardLoadsPerMessage > 0 &&
        opts.templateLoadsPerMessage !== opts.cardLoadsPerMessage
    ) {
        return {
            ok: false,
            reason: `Template é de ${opts.templateLoadsPerMessage} carga(s); o card espera ${opts.cardLoadsPerMessage}.`,
        };
    }
    return { ok: true };
}

export function partsFromBulletinCards(
    cards: Array<{
        position: number;
        loadIndexes: unknown;
        bodyPreview?: string | null;
        technicalName?: string | null;
        language?: string | null;
        category?: string | null;
        approvalStatus?: string | null;
        libraryTemplateId?: string | null;
        variableMapping?: unknown;
        templateComponents?: unknown;
        loadSummary?: string | null;
    }>,
    opts?: { onlyApproved?: boolean; onlyPosition?: number | null }
): CampaignMessagePart[] {
    const sorted = [...cards].sort((a, b) => a.position - b.position);
    const filtered = sorted.filter((c) => {
        if (opts?.onlyPosition != null) return c.position === opts.onlyPosition;
        if (opts?.onlyApproved)
            return String(c.approvalStatus || "").toUpperCase() === "APPROVED";
        return true;
    });
    return filtered.map((c, i) => {
        const loadIndexes = Array.isArray(c.loadIndexes)
            ? (c.loadIndexes as number[])
            : [];
        const approval = String(c.approvalStatus || "DRAFT").toUpperCase();
        const ready = approval === "APPROVED" && Boolean(c.technicalName);
        return {
            index: i,
            label: `Card ${c.position}/${sorted.length}`,
            bodyText: c.bodyPreview || "",
            loadIndexes,
            charCount: (c.bodyPreview || "").length,
            templateName: c.technicalName || null,
            templateLanguage: c.language || "pt_BR",
            templateCategory: c.category || "MARKETING",
            templateApprovalStatus: approval,
            templateComponents: c.templateComponents ?? null,
            variableMapping: (c.variableMapping as CampaignMessagePart["variableMapping"]) || null,
            libraryTemplateId: c.libraryTemplateId || null,
            readyForRealSend: ready,
            compatibility: ready ? "ready" : "missing_template",
            blockReason: ready
                ? null
                : "Card sem template APPROVED associado a esta versão do boletim.",
        };
    });
}
