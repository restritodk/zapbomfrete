import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
    analyzeBulletin,
    analysisToEditableDraft,
    serializeBulletinDraft,
} from "./analyze";
import type { BulletinEditableDraft, BulletinLoad } from "./types";
import { BULLETIN_IMPORT_MAX_CHARS } from "./types";

/**
 * Delegate to Prisma model after `prisma generate` / db push.
 * Cast keeps the build green when the Windows query engine DLL is locked
 * by a running Node process during local generate.
 */
function bulletinDraftDb() {
    return (
        prisma as unknown as {
            datafyBulletinDraft: {
                create: (args: unknown) => Promise<BulletinDraftRow>;
                update: (args: unknown) => Promise<BulletinDraftRow>;
                findUnique: (args: unknown) => Promise<BulletinDraftRow | null>;
                findMany: (args: unknown) => Promise<BulletinDraftListItem[]>;
                delete: (args: unknown) => Promise<unknown>;
            };
        }
    ).datafyBulletinDraft;
}

export type BulletinDraftRow = {
    id: string;
    organizationKey: string;
    status: string;
    title: string;
    operationType: string | null;
    groupUrl: string | null;
    referenceDate: string | null;
    generalNotes: string | null;
    rawText: string;
    loads: unknown;
    warnings: unknown;
    loadCount: number;
    campaignId: string | null;
    confirmedAt: Date | null;
    createdById: string | null;
    createdAt: Date;
    updatedAt: Date;
};

export type BulletinDraftListItem = {
    id: string;
    title: string;
    status: string;
    loadCount: number;
    operationType: string | null;
    confirmedAt: Date | null;
    campaignId: string | null;
    createdAt: Date;
    updatedAt: Date;
};

function asLoads(value: unknown): BulletinLoad[] {
    if (!Array.isArray(value)) return [];
    return value as BulletinLoad[];
}

export function analyzeBulletinSafe(rawText: string) {
    const text = String(rawText || "");
    if (text.length > BULLETIN_IMPORT_MAX_CHARS) {
        return analyzeBulletin(text.slice(0, BULLETIN_IMPORT_MAX_CHARS));
    }
    return analyzeBulletin(text);
}

export async function createBulletinDraft(opts: {
    userId: string;
    rawText: string;
    draft?: BulletinEditableDraft;
}) {
    const analysis = opts.draft
        ? null
        : analyzeBulletinSafe(opts.rawText);
    const editable =
        opts.draft ||
        (analysis ? analysisToEditableDraft(analysis) : null);
    if (!editable) throw new Error("Draft inválido");

    const title = editable.general.title || "Boletim de cargas";
    return bulletinDraftDb().create({
        data: {
            title,
            operationType: editable.general.operationType || null,
            groupUrl: editable.general.groupUrl || null,
            referenceDate: editable.general.referenceDate || null,
            generalNotes: editable.general.generalNotes || null,
            rawText: editable.rawText || opts.rawText,
            loads: editable.loads as unknown as Prisma.InputJsonValue,
            warnings: (editable.warnings || []) as unknown as Prisma.InputJsonValue,
            loadCount: editable.loads.length,
            status: "draft",
            createdById: opts.userId,
        },
    });
}

export async function updateBulletinDraft(
    id: string,
    patch: {
        general?: BulletinEditableDraft["general"];
        loads?: BulletinLoad[];
        warnings?: string[];
        rawText?: string;
        status?: string;
    }
) {
    const existing = await bulletinDraftDb().findUnique({
        where: { id },
    });
    if (!existing) return null;

    const loads = patch.loads ?? asLoads(existing.loads);
    const general = patch.general || {
        title: existing.title,
        operationType: existing.operationType || undefined,
        groupUrl: existing.groupUrl || undefined,
        referenceDate: existing.referenceDate || undefined,
        generalNotes: existing.generalNotes || undefined,
    };

    const rawText =
        patch.rawText ??
        serializeBulletinDraft({ general, loads });

    return bulletinDraftDb().update({
        where: { id },
        data: {
            title: general.title,
            operationType: general.operationType || null,
            groupUrl: general.groupUrl || null,
            referenceDate: general.referenceDate || null,
            generalNotes: general.generalNotes || null,
            rawText,
            loads: loads as unknown as Prisma.InputJsonValue,
            warnings: (patch.warnings ??
                (existing.warnings as string[] | null) ??
                []) as unknown as Prisma.InputJsonValue,
            loadCount: loads.length,
            ...(patch.status ? { status: patch.status } : {}),
            ...(patch.status === "confirmed"
                ? { confirmedAt: new Date() }
                : {}),
        },
    });
}

export async function getBulletinDraft(id: string) {
    return bulletinDraftDb().findUnique({ where: { id } });
}

export async function listBulletinDrafts(limit = 30) {
    return bulletinDraftDb().findMany({
        orderBy: { updatedAt: "desc" },
        take: Math.min(100, Math.max(1, limit)),
        select: {
            id: true,
            title: true,
            status: true,
            loadCount: true,
            operationType: true,
            confirmedAt: true,
            campaignId: true,
            createdAt: true,
            updatedAt: true,
        },
    });
}

export async function deleteBulletinDraft(id: string) {
    return bulletinDraftDb().delete({ where: { id } });
}

export function draftToHandoff(row: {
    id: string;
    title: string;
    rawText: string;
    loadCount: number;
    operationType: string | null;
    groupUrl: string | null;
    referenceDate: string | null;
    generalNotes: string | null;
    loads: unknown;
}) {
    return {
        title: row.title,
        rawText: row.rawText,
        purpose: "marketing" as const,
        contentKind: "bulletin" as const,
        draftId: row.id,
        loadCount: row.loadCount,
        general: {
            title: row.title,
            operationType: row.operationType || undefined,
            groupUrl: row.groupUrl || undefined,
            referenceDate: row.referenceDate || undefined,
            generalNotes: row.generalNotes || undefined,
        },
        loads: asLoads(row.loads),
        createdAt: new Date().toISOString(),
    };
}
