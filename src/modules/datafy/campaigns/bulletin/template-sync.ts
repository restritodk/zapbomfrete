/**
 * Bidirectional operational sync of Meta message templates via Datafy.
 *
 * - Local submits → Meta (existing createTemplate flow)
 * - Meta Manager / other authorized systems → imported into ZapBomFrete
 *
 * Identity: organizationKey + wabaId + technicalName + language
 * Never invents endpoints. Never overwrites Meta content without explicit submit.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { DatafyApiError, type DatafyClient } from "@/modules/datafy/client";
import { loadDatafyConfig } from "@/modules/datafy/config";
import { datafyProvider } from "@/modules/datafy/provider";
import type { DatafyTemplate } from "@/modules/datafy/types";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    countPositionalVars,
} from "./library";

export const ORG_KEY = "default";

export const TEMPLATE_STATUSES = [
    "APPROVED",
    "PENDING",
    "REJECTED",
    "PAUSED",
    "DISABLED",
] as const;

export type TemplateOrigin = "local" | "meta_import" | "unknown";

export type SyncStats = {
    fetched: number;
    imported: number;
    updated: number;
    unchanged: number;
    pages: number;
    wabaId: string;
    lastSyncAt: string;
    errors: string[];
};

export type ApprovalsCounters = {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    pausedOrDisabled: number;
};

type ManagedRow = {
    id: string;
    organizationKey: string;
    wabaId: string;
    kind: string;
    builtinId: string | null;
    hidden: boolean;
    deletedAt: Date | null;
    technicalName: string;
    displayName: string;
    category: string;
    language: string;
    headerText: string | null;
    bodyText: string;
    footerText: string | null;
    componentsJson: unknown;
    fieldMappings: unknown;
    exampleRow: unknown;
    loadsPerMessage: number;
    description: string | null;
    origin: string;
    inLibrary: boolean;
    remoteStatus: string | null;
    remoteTemplateId: string | null;
    remoteRejectedReason: string | null;
    lastSubmittedAt: Date | null;
    lastSyncedAt: Date | null;
    lastNotifiedStatus: string | null;
    syncError: string | null;
    createdAt: Date;
    updatedAt: Date;
};

const LOCK_TTL_MS = 90_000;
const PAGE_LIMIT = 50;
const MAX_PAGES_PER_STATUS = 40;

function syncDb() {
    return prisma as unknown as {
        datafyManagedTemplate: {
            findMany: (args: unknown) => Promise<ManagedRow[]>;
            findFirst: (args: unknown) => Promise<ManagedRow | null>;
            create: (args: unknown) => Promise<ManagedRow>;
            update: (args: unknown) => Promise<ManagedRow>;
            upsert: (args: unknown) => Promise<ManagedRow>;
        };
        datafyTemplateSyncState: {
            findUnique: (args: unknown) => Promise<{
                id: string;
                lockedAt: Date | null;
                lockOwner: string | null;
                lastSyncAt: Date | null;
            } | null>;
            upsert: (args: unknown) => Promise<unknown>;
            update: (args: unknown) => Promise<unknown>;
            updateMany: (args: unknown) => Promise<{ count: number }>;
        };
        user: {
            findMany: (args: unknown) => Promise<Array<{ id: string }>>;
        };
        notification: {
            createMany: (args: unknown) => Promise<unknown>;
            findFirst: (args: unknown) => Promise<{ id: string } | null>;
        };
    };
}

/** Extract BODY/HEADER/FOOTER text and example row from Meta components. */
export function parseTemplateComponents(components: unknown[] | undefined): {
    headerText: string | null;
    bodyText: string;
    footerText: string | null;
    exampleRow: string[];
    variableCount: number;
} {
    let headerText: string | null = null;
    let bodyText = "";
    let footerText: string | null = null;
    let exampleRow: string[] = [];

    if (!Array.isArray(components)) {
        return {
            headerText,
            bodyText: "(sem BODY)",
            footerText,
            exampleRow,
            variableCount: 0,
        };
    }

    for (const raw of components) {
        const c = raw as {
            type?: string;
            text?: string;
            example?: { body_text?: string[][]; header_text?: string[] };
        };
        const type = String(c.type || "").toUpperCase();
        if (type === "HEADER" && c.text) headerText = c.text;
        if (type === "BODY" && c.text) {
            bodyText = c.text;
            const bt = c.example?.body_text;
            if (Array.isArray(bt?.[0])) {
                exampleRow = bt[0].map((x) => String(x ?? ""));
            }
        }
        if (type === "FOOTER" && c.text) footerText = c.text;
    }

    if (!bodyText.trim()) bodyText = "(sem BODY)";
    const variableCount = countPositionalVars(bodyText);
    while (exampleRow.length < variableCount) exampleRow.push("N/D");
    if (exampleRow.length > variableCount) {
        exampleRow = exampleRow.slice(0, variableCount);
    }

    return { headerText, bodyText, footerText, exampleRow, variableCount };
}

export function normalizeLanguage(lang: string | null | undefined): string {
    const raw = String(lang || "").trim();
    return raw || "pt_BR";
}

export function statusBucket(
    status: string | null | undefined
): keyof ApprovalsCounters | "other" {
    const s = String(status || "").toUpperCase();
    if (s === "PENDING") return "pending";
    if (s === "APPROVED") return "approved";
    if (s === "REJECTED") return "rejected";
    if (s === "PAUSED" || s === "DISABLED") return "pausedOrDisabled";
    return "other";
}

/** Rank for status regression guard (higher = more advanced). */
export function statusRank(status: string | null | undefined): number {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED") return 50;
    if (s === "REJECTED") return 40;
    if (s === "PAUSED") return 30;
    if (s === "DISABLED") return 20;
    if (s === "PENDING") return 10;
    return 0;
}

/**
 * Whether an incoming status should replace the stored one.
 * Allows APPROVED/REJECTED over PENDING; blocks stale PENDING over APPROVED
 * unless remoteTemplateId differs (new submission).
 */
export function shouldApplyRemoteStatus(
    current: string | null | undefined,
    incoming: string | null | undefined,
    opts?: { force?: boolean; sameTemplateId?: boolean }
): boolean {
    if (opts?.force) return true;
    const cur = String(current || "").toUpperCase();
    const next = String(incoming || "").toUpperCase();
    if (!next) return false;
    if (!cur) return true;
    if (cur === next) return true;
    // Never regress APPROVED → PENDING from a late webhook unless forced
    if (cur === "APPROVED" && next === "PENDING" && opts?.sameTemplateId !== false) {
        return false;
    }
    return statusRank(next) >= statusRank(cur) || next === "REJECTED" || next === "DISABLED";
}

export async function resolveWabaId(): Promise<string> {
    const cfg = await loadDatafyConfig();
    if (cfg.wabaId) return cfg.wabaId;
    const verified = await datafyProvider.verifyConnection();
    if (!verified.ok || !verified.me?.waba_id) {
        throw new DatafyApiError(
            verified.error || "waba_id indisponível para sincronização",
            400
        );
    }
    return verified.me.waba_id;
}

async function acquireSyncLock(wabaId: string, owner: string): Promise<boolean> {
    const db = syncDb();
    const now = new Date();
    const staleBefore = new Date(now.getTime() - LOCK_TTL_MS);

    await db.datafyTemplateSyncState.upsert({
        where: {
            organizationKey_wabaId: { organizationKey: ORG_KEY, wabaId },
        },
        create: {
            organizationKey: ORG_KEY,
            wabaId,
            lockedAt: now,
            lockOwner: owner,
        },
        update: {},
    });

    const row = await db.datafyTemplateSyncState.findUnique({
        where: {
            organizationKey_wabaId: { organizationKey: ORG_KEY, wabaId },
        },
    });
    if (!row) return false;

    const lockedAt = row.lockedAt ? new Date(row.lockedAt) : null;
    const held =
        lockedAt &&
        lockedAt > staleBefore &&
        row.lockOwner &&
        row.lockOwner !== owner;
    if (held) return false;

    const updated = await db.datafyTemplateSyncState.updateMany({
        where: {
            organizationKey: ORG_KEY,
            wabaId,
            OR: [
                { lockedAt: null },
                { lockedAt: { lte: staleBefore } },
                { lockOwner: owner },
                { lockOwner: null },
            ],
        },
        data: {
            lockedAt: now,
            lockOwner: owner,
            updatedAt: now,
        },
    });
    return updated.count > 0;
}

async function releaseSyncLock(
    wabaId: string,
    owner: string,
    result: { error?: string | null; stats?: SyncStats }
) {
    const db = syncDb();
    await db.datafyTemplateSyncState.updateMany({
        where: { organizationKey: ORG_KEY, wabaId, lockOwner: owner },
        data: {
            lockedAt: null,
            lockOwner: null,
            lastSyncAt: new Date(),
            lastSyncError: result.error || null,
            lastSyncStats: (result.stats || null) as unknown as Prisma.InputJsonValue,
            updatedAt: new Date(),
        },
    });
}

/** Page through Datafy GET /v1/{waba_id}/message_templates for one status. */
export async function fetchAllTemplatesForStatus(
    client: DatafyClient,
    wabaId: string,
    status: string
): Promise<{ templates: DatafyTemplate[]; pages: number }> {
    const templates: DatafyTemplate[] = [];
    let after: string | undefined;
    let pages = 0;

    do {
        pages++;
        const res = await client.listTemplates(wabaId, {
            status,
            limit: PAGE_LIMIT,
            after,
            fields: "name,status,category,language,id,rejected_reason,components",
        });
        const rows = Array.isArray(res?.data) ? res.data : [];
        for (const t of rows) {
            if (t?.name) templates.push(t);
        }
        after = res?.paging?.cursors?.after || undefined;
        if (!after || rows.length === 0 || pages >= MAX_PAGES_PER_STATUS) break;
    } while (after);

    return { templates, pages };
}

export async function fetchAllRemoteTemplates(
    client: DatafyClient,
    wabaId: string
): Promise<{ templates: DatafyTemplate[]; pages: number; errors: string[] }> {
    const byKey = new Map<string, DatafyTemplate>();
    let pages = 0;
    const errors: string[] = [];

    for (const status of TEMPLATE_STATUSES) {
        try {
            const batch = await fetchAllTemplatesForStatus(client, wabaId, status);
            pages += batch.pages;
            for (const t of batch.templates) {
                const lang = normalizeLanguage(t.language);
                const key = `${t.name.toLowerCase()}::${lang}`;
                const prev = byKey.get(key);
                if (
                    !prev ||
                    statusRank(t.status) > statusRank(prev.status)
                ) {
                    byKey.set(key, { ...t, language: lang });
                }
            }
        } catch (e) {
            const msg =
                e instanceof DatafyApiError
                    ? e.message
                    : e instanceof Error
                      ? e.message
                      : `Falha ao listar status ${status}`;
            errors.push(`${status}: ${msg}`);
        }
    }

    return { templates: [...byKey.values()], pages, errors };
}

function matchBuiltin(name: string) {
    return (
        BULLETIN_TEMPLATE_LIBRARY.find((s) =>
            s.namePatterns.some((re) => re.test(name))
        ) || null
    );
}

export async function upsertRemoteTemplate(
    wabaId: string,
    remote: DatafyTemplate,
    opts?: { originHint?: TemplateOrigin }
): Promise<"imported" | "updated" | "unchanged"> {
    const db = syncDb();
    const technicalName = String(remote.name || "").trim();
    const language = normalizeLanguage(remote.language);
    if (!technicalName) return "unchanged";

    const parsed = parseTemplateComponents(
        Array.isArray(remote.components) ? remote.components : undefined
    );
    const status = String(remote.status || "UNKNOWN").toUpperCase();
    const category = String(remote.category || "MARKETING").toUpperCase();
    const builtin = matchBuiltin(technicalName);

    const existing =
        (await db.datafyManagedTemplate.findFirst({
            where: {
                organizationKey: ORG_KEY,
                wabaId,
                technicalName,
                language,
                deletedAt: null,
            },
        })) ||
        // Legacy rows without wabaId
        (await db.datafyManagedTemplate.findFirst({
            where: {
                organizationKey: ORG_KEY,
                technicalName,
                language,
                deletedAt: null,
                OR: [{ wabaId: "" }, { wabaId: wabaId }],
            },
        })) ||
        // Match by official id
        (remote.id
            ? await db.datafyManagedTemplate.findFirst({
                  where: {
                      organizationKey: ORG_KEY,
                      remoteTemplateId: String(remote.id),
                      deletedAt: null,
                  },
              })
            : null);

    const now = new Date();

    if (!existing) {
        await db.datafyManagedTemplate.create({
            data: {
                organizationKey: ORG_KEY,
                wabaId,
                kind: builtin ? "builtin" : "remote",
                builtinId: builtin?.id || null,
                hidden: false,
                technicalName,
                displayName: technicalName,
                category,
                language,
                headerText: parsed.headerText,
                bodyText: parsed.bodyText,
                footerText: parsed.footerText,
                componentsJson: (remote.components ||
                    null) as unknown as Prisma.InputJsonValue,
                fieldMappings: (builtin?.slotFields ||
                    []) as unknown as Prisma.InputJsonValue,
                exampleRow: (parsed.exampleRow.length
                    ? parsed.exampleRow
                    : builtin?.exampleRow ||
                      []) as unknown as Prisma.InputJsonValue,
                loadsPerMessage: builtin?.loadsPerMessage || 1,
                description: builtin?.description || null,
                origin: opts?.originHint || "meta_import",
                inLibrary: Boolean(builtin),
                remoteStatus: status,
                remoteTemplateId: remote.id ? String(remote.id) : null,
                remoteRejectedReason: remote.rejected_reason || null,
                lastSyncedAt: now,
                syncError: null,
            },
        });
        return "imported";
    }

    const nextStatus = shouldApplyRemoteStatus(
        existing.remoteStatus,
        status,
        {
            sameTemplateId:
                !remote.id ||
                !existing.remoteTemplateId ||
                String(remote.id) === String(existing.remoteTemplateId),
        }
    )
        ? status
        : existing.remoteStatus;

    const same =
        existing.remoteStatus === nextStatus &&
        existing.remoteTemplateId === (remote.id ? String(remote.id) : existing.remoteTemplateId) &&
        existing.category === category &&
        existing.language === language &&
        existing.bodyText === parsed.bodyText &&
        existing.wabaId === wabaId;

    if (same && existing.lastSyncedAt) {
        await db.datafyManagedTemplate.update({
            where: { id: existing.id },
            data: { lastSyncedAt: now, syncError: null, updatedAt: now },
        });
        return "unchanged";
    }

    const origin =
        existing.origin === "local"
            ? "local"
            : existing.origin === "meta_import"
              ? "meta_import"
              : opts?.originHint || "meta_import";

    await db.datafyManagedTemplate.update({
        where: { id: existing.id },
        data: {
            wabaId: existing.wabaId || wabaId,
            kind: existing.kind === "builtin" ? "builtin" : existing.kind === "custom" ? "custom" : builtin ? "builtin" : "remote",
            builtinId: existing.builtinId || builtin?.id || null,
            category,
            language,
            headerText: parsed.headerText ?? existing.headerText,
            bodyText: parsed.bodyText || existing.bodyText,
            footerText: parsed.footerText ?? existing.footerText,
            componentsJson: (remote.components ||
                existing.componentsJson) as unknown as Prisma.InputJsonValue,
            remoteStatus: nextStatus,
            remoteTemplateId: remote.id
                ? String(remote.id)
                : existing.remoteTemplateId,
            remoteRejectedReason: remote.rejected_reason ?? existing.remoteRejectedReason,
            origin,
            lastSyncedAt: now,
            syncError: null,
            updatedAt: now,
        },
    });
    return "updated";
}

export async function syncTemplatesFromDatafy(opts?: {
    owner?: string;
    force?: boolean;
}): Promise<SyncStats> {
    const owner = opts?.owner || `sync_${Date.now()}`;
    const wabaId = await resolveWabaId();
    const locked = await acquireSyncLock(wabaId, owner);
    if (!locked) {
        throw new DatafyApiError(
            "Sincronização já em andamento. Aguarde a conclusão.",
            429
        );
    }

    const stats: SyncStats = {
        fetched: 0,
        imported: 0,
        updated: 0,
        unchanged: 0,
        pages: 0,
        wabaId,
        lastSyncAt: new Date().toISOString(),
        errors: [],
    };

    try {
        const client = await datafyProvider.createClient();
        const { templates, pages, errors } = await fetchAllRemoteTemplates(
            client,
            wabaId
        );
        stats.pages = pages;
        stats.errors.push(...errors);
        stats.fetched = templates.length;

        for (const t of templates) {
            try {
                const result = await upsertRemoteTemplate(wabaId, t);
                if (result === "imported") stats.imported++;
                else if (result === "updated") stats.updated++;
                else stats.unchanged++;
            } catch (e) {
                stats.errors.push(
                    `${t.name}: ${e instanceof Error ? e.message : "erro"}`
                );
            }
        }

        await releaseSyncLock(wabaId, owner, { stats });
        return stats;
    } catch (e) {
        const message =
            e instanceof DatafyApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "Falha na sincronização";
        await releaseSyncLock(wabaId, owner, { error: message, stats });
        throw e;
    }
}

export async function listSyncedApprovals(opts?: {
    q?: string;
    status?: string;
    category?: string;
    language?: string;
    page?: number;
    pageSize?: number;
}): Promise<{
    items: ManagedRow[];
    total: number;
    page: number;
    pageSize: number;
    counters: ApprovalsCounters;
    lastSyncAt: string | null;
    wabaId: string | null;
}> {
    const db = syncDb();
    const page = Math.max(1, opts?.page || 1);
    const pageSize = Math.min(50, Math.max(1, opts?.pageSize || 10));
    let wabaId: string | null = null;
    try {
        wabaId = await resolveWabaId();
    } catch {
        wabaId = null;
    }

    const where: Record<string, unknown> = {
        organizationKey: ORG_KEY,
        deletedAt: null,
        hidden: false,
    };
    if (wabaId) {
        where.OR = [{ wabaId }, { wabaId: "" }];
    }
    if (opts?.q?.trim()) {
        where.technicalName = {
            contains: opts.q.trim(),
            mode: "insensitive",
        };
    }
    if (opts?.status?.trim()) {
        const st = opts.status.trim().toUpperCase();
        if (st === "PAUSED_OR_DISABLED") {
            where.remoteStatus = { in: ["PAUSED", "DISABLED"] };
        } else {
            where.remoteStatus = st;
        }
    }
    if (opts?.category?.trim()) {
        where.category = opts.category.trim().toUpperCase();
    }
    if (opts?.language?.trim()) {
        where.language = opts.language.trim();
    }

    const all = await db.datafyManagedTemplate.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
    });

    const counters: ApprovalsCounters = {
        total: all.length,
        pending: 0,
        approved: 0,
        rejected: 0,
        pausedOrDisabled: 0,
    };
    for (const row of all) {
        const b = statusBucket(row.remoteStatus);
        if (b === "pending") counters.pending++;
        else if (b === "approved") counters.approved++;
        else if (b === "rejected") counters.rejected++;
        else if (b === "pausedOrDisabled") counters.pausedOrDisabled++;
    }

    const start = (page - 1) * pageSize;
    const items = all.slice(start, start + pageSize);

    let lastSyncAt: string | null = null;
    if (wabaId) {
        const state = await syncDb().datafyTemplateSyncState.findUnique({
            where: {
                organizationKey_wabaId: { organizationKey: ORG_KEY, wabaId },
            },
        });
        lastSyncAt = state?.lastSyncAt
            ? new Date(state.lastSyncAt).toISOString()
            : null;
    }

    return {
        items,
        total: all.length,
        page,
        pageSize,
        counters,
        lastSyncAt,
        wabaId,
    };
}

export function toApprovalDto(row: ManagedRow) {
    const parsed = parseTemplateComponents(
        Array.isArray(row.componentsJson)
            ? (row.componentsJson as unknown[])
            : undefined
    );
    const variableCount =
        parsed.variableCount || countPositionalVars(row.bodyText);
    return {
        id: row.id,
        technicalName: row.technicalName,
        displayName: row.displayName,
        category: row.category,
        language: row.language,
        wabaId: row.wabaId || null,
        origin: (row.origin || "unknown") as TemplateOrigin,
        originLabel:
            row.origin === "local"
                ? "Criado no ZapBomFrete"
                : row.origin === "meta_import"
                  ? "Importado da Meta"
                  : "Origem desconhecida",
        status: row.remoteStatus,
        remoteTemplateId: row.remoteTemplateId,
        rejectedReason: row.remoteRejectedReason,
        headerText: row.headerText,
        bodyText: row.bodyText,
        footerText: row.footerText,
        variableCount,
        exampleRow: Array.isArray(row.exampleRow)
            ? (row.exampleRow as string[])
            : parsed.exampleRow,
        fieldMappings: Array.isArray(row.fieldMappings)
            ? row.fieldMappings
            : [],
        inLibrary: Boolean(row.inLibrary),
        kind: row.kind,
        builtinId: row.builtinId,
        loadsPerMessage: row.loadsPerMessage,
        lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
        lastSubmittedAt: row.lastSubmittedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        syncError: row.syncError,
        canUseInCampaign:
            String(row.remoteStatus || "").toUpperCase() === "APPROVED" &&
            Boolean(row.inLibrary),
        canImportToLibrary:
            !row.inLibrary &&
            String(row.remoteStatus || "").toUpperCase() === "APPROVED",
    };
}

/** Notify OWNER/SUPERADMIN once per status transition. */
export async function notifyTemplateStatusChange(row: {
    id: string;
    technicalName: string;
    remoteStatus: string | null;
    lastNotifiedStatus: string | null;
}): Promise<boolean> {
    const status = String(row.remoteStatus || "").toUpperCase();
    if (status !== "APPROVED" && status !== "REJECTED") return false;
    if (row.lastNotifiedStatus === status) return false;

    const db = syncDb();
    const users = await db.user.findMany({
        where: { role: { in: ["OWNER", "SUPERADMIN"] } },
    });
    if (!users.length) {
        await db.datafyManagedTemplate.update({
            where: { id: row.id },
            data: { lastNotifiedStatus: status, updatedAt: new Date() },
        });
        return false;
    }

    const title =
        status === "APPROVED"
            ? "Template aprovado pela Meta"
            : "Template rejeitado pela Meta";
    const message =
        status === "APPROVED"
            ? `Seu template ${row.technicalName} foi aprovado pela Meta.`
            : `O template ${row.technicalName} foi rejeitado. Consulte os detalhes.`;
    const href = `/dashboard/boletim/aprovacoes?focus=${encodeURIComponent(row.id)}`;

    await db.notification.createMany({
        data: users.map((u) => ({
            userId: u.id,
            title,
            message,
            type: status === "APPROVED" ? "SUCCESS" : "WARNING",
            href,
            read: false,
        })),
    });

    await db.datafyManagedTemplate.update({
        where: { id: row.id },
        data: { lastNotifiedStatus: status, updatedAt: new Date() },
    });

    try {
        const io = (global as { io?: { to: (r: string) => { emit: (e: string, p: unknown) => void } } }).io;
        if (io) {
            for (const u of users) {
                io.to(`user:${u.id}`).emit("notification:new", {
                    userId: u.id,
                    title,
                    message,
                    type: status === "APPROVED" ? "SUCCESS" : "WARNING",
                    href,
                    createdAt: new Date().toISOString(),
                    read: false,
                });
            }
        }
    } catch {
        /* socket optional */
    }

    return true;
}

export async function applyWebhookTemplateUpdate(value: {
    event?: string;
    message_template_id?: string | number;
    message_template_name?: string;
    message_template_language?: string;
    reason?: string;
}): Promise<boolean> {
    const { normalizeMetaTemplateEvent } = await import("./meta-approval");
    const parsed = normalizeMetaTemplateEvent(value);
    if (!parsed.name || !parsed.status) return false;

    let wabaId = "";
    try {
        wabaId = await resolveWabaId();
    } catch {
        wabaId = "";
    }

    const language = normalizeLanguage(parsed.language);
    const db = syncDb();

    let row =
        (await db.datafyManagedTemplate.findFirst({
            where: {
                organizationKey: ORG_KEY,
                technicalName: parsed.name,
                language,
                deletedAt: null,
                ...(wabaId ? { OR: [{ wabaId }, { wabaId: "" }] } : {}),
            },
        })) ||
        (parsed.templateId
            ? await db.datafyManagedTemplate.findFirst({
                  where: {
                      organizationKey: ORG_KEY,
                      remoteTemplateId: parsed.templateId,
                      deletedAt: null,
                  },
              })
            : null);

    if (!row) {
        // Unknown template — create stub then optionally full sync later
        row = await db.datafyManagedTemplate.create({
            data: {
                organizationKey: ORG_KEY,
                wabaId,
                kind: "remote",
                technicalName: parsed.name,
                displayName: parsed.name,
                category: "MARKETING",
                language,
                bodyText: "(sincronize para carregar o BODY)",
                fieldMappings: [],
                exampleRow: [],
                origin: "meta_import",
                inLibrary: false,
                remoteStatus: parsed.status,
                remoteTemplateId: parsed.templateId,
                remoteRejectedReason: parsed.rejectedReason,
                lastSyncedAt: new Date(),
            },
        });
    } else {
        const apply = shouldApplyRemoteStatus(row.remoteStatus, parsed.status, {
            sameTemplateId:
                !parsed.templateId ||
                !row.remoteTemplateId ||
                parsed.templateId === row.remoteTemplateId,
        });
        if (apply) {
            row = await db.datafyManagedTemplate.update({
                where: { id: row.id },
                data: {
                    wabaId: row.wabaId || wabaId,
                    language: row.language || language,
                    remoteStatus: parsed.status,
                    remoteTemplateId: parsed.templateId || row.remoteTemplateId,
                    remoteRejectedReason:
                        parsed.rejectedReason ?? row.remoteRejectedReason,
                    lastSyncedAt: new Date(),
                    updatedAt: new Date(),
                },
            });
        }
    }

    await notifyTemplateStatusChange({
        id: row.id,
        technicalName: row.technicalName,
        remoteStatus: row.remoteStatus,
        lastNotifiedStatus: row.lastNotifiedStatus,
    });

    return true;
}

export async function importTemplateToLibrary(
    id: string,
    fieldMappings: string[],
    opts?: { loadsPerMessage?: number }
): Promise<ManagedRow> {
    const db = syncDb();
    const row = await db.datafyManagedTemplate.findFirst({
        where: { id, organizationKey: ORG_KEY, deletedAt: null },
    });
    if (!row) throw new Error("Template não encontrado");
    const vars = countPositionalVars(row.bodyText);
    if (fieldMappings.length !== vars) {
        throw new Error(
            `Mapeamentos (${fieldMappings.length}) ≠ variáveis (${vars})`
        );
    }
    return db.datafyManagedTemplate.update({
        where: { id: row.id },
        data: {
            inLibrary: true,
            fieldMappings: fieldMappings as unknown as Prisma.InputJsonValue,
            loadsPerMessage: opts?.loadsPerMessage || row.loadsPerMessage || 1,
            updatedAt: new Date(),
        },
    });
}

/** Periodic reconciliation — skip if synced recently. */
export async function reconcileTemplatesIfStale(
    maxAgeMs = 30 * 60 * 1000
): Promise<SyncStats | null> {
    let wabaId: string;
    try {
        wabaId = await resolveWabaId();
    } catch {
        return null;
    }
    const state = await syncDb().datafyTemplateSyncState.findUnique({
        where: {
            organizationKey_wabaId: { organizationKey: ORG_KEY, wabaId },
        },
    });
    if (
        state?.lastSyncAt &&
        Date.now() - new Date(state.lastSyncAt).getTime() < maxAgeMs
    ) {
        return null;
    }
    return syncTemplatesFromDatafy({ owner: `cron_${Date.now()}` });
}
