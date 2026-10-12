import { prisma } from "@/lib/prisma";
import { CRM_ORG_DEFAULT } from "../constants";
import { CONSENT_DECISION } from "../consent/constants";
import { applyConsentDecision } from "../consent/decisions";
import { deleteCrmContact } from "../service";
import {
    bulkGrantSkipLabel,
    bulkGrantSkipReason,
    validateBulkGrantEvidence,
    type BulkGrantEvidenceInput,
} from "./grant-evidence";
import {
    buildCrmListWhere,
    normalizeIdList,
    MAX_BULK_IDS,
    type BulkSelectionInput,
    type CrmListFilters,
} from "./selection";

export type BulkAction = "grant_consent" | "block" | "delete";

export type BulkResult = {
    operationId: string;
    action: BulkAction;
    requested: number;
    success: number;
    failed: number;
    skipped: number;
    skippedReasons: Record<string, number>;
    errors: Array<{ id: string; message: string }>;
};

type ResolvedContact = {
    id: string;
    waId: string;
    fullName: string | null;
    consentStatus: string;
    consentSource: string | null;
    consentAt: Date | null;
    consentPurpose: string | null;
    consentWabaId: string | null;
    consentEvidence: string | null;
    active: boolean;
    blocked: boolean;
};

async function resolveContacts(
    selection: BulkSelectionInput,
    organizationKey = CRM_ORG_DEFAULT
): Promise<ResolvedContact[]> {
    if (selection.mode === "ids") {
        const ids = normalizeIdList(selection.ids);
        if (!ids.length) return [];
        return prisma.crmContact.findMany({
            where: {
                organizationKey,
                id: { in: ids },
            },
            select: {
                id: true,
                waId: true,
                fullName: true,
                consentStatus: true,
                consentSource: true,
                consentAt: true,
                consentPurpose: true,
                consentWabaId: true,
                consentEvidence: true,
                active: true,
                blocked: true,
            },
            take: MAX_BULK_IDS,
        }) as Promise<ResolvedContact[]>;
    }

    const where = buildCrmListWhere(selection.filters, organizationKey);
    const exclude = normalizeIdList(selection.excludeIds);
    if (exclude.length) {
        where.id = { notIn: exclude };
    }

    return prisma.crmContact.findMany({
        where: where as never,
        select: {
            id: true,
            waId: true,
            fullName: true,
            consentStatus: true,
            consentSource: true,
            consentAt: true,
            consentPurpose: true,
            consentWabaId: true,
            consentEvidence: true,
            active: true,
            blocked: true,
        },
        take: MAX_BULK_IDS,
        orderBy: { updatedAt: "desc" },
    }) as Promise<ResolvedContact[]>;
}

export async function previewBulkSelection(
    selection: BulkSelectionInput,
    organizationKey = CRM_ORG_DEFAULT
) {
    const contacts = await resolveContacts(selection, organizationKey);
    const byStatus: Record<string, number> = {};
    let blocked = 0;
    let inactive = 0;
    for (const c of contacts) {
        byStatus[c.consentStatus] = (byStatus[c.consentStatus] || 0) + 1;
        if (c.blocked) blocked++;
        if (!c.active) inactive++;
    }
    return {
        count: contacts.length,
        byStatus,
        blocked,
        inactive,
        samples: contacts.slice(0, 8).map((c) => ({
            id: c.id,
            waId: c.waId,
            fullName: c.fullName,
            consentStatus: c.consentStatus,
            consentSource: c.consentSource,
            consentAt: c.consentAt?.toISOString() ?? null,
            consentPurpose: c.consentPurpose,
            consentWabaId: c.consentWabaId,
            blocked: c.blocked,
            active: c.active,
        })),
    };
}

async function writeBulkAudit(opts: {
    action: BulkAction;
    actorUserId: string;
    selection: BulkSelectionInput;
    requested: number;
    success: number;
    failed: number;
    skipped: number;
    payload?: Record<string, unknown>;
    result?: Record<string, unknown>;
}) {
    try {
        return await prisma.crmBulkOperation.create({
            data: {
                organizationKey: CRM_ORG_DEFAULT,
                action: opts.action,
                actorUserId: opts.actorUserId,
                selectionMode: opts.selection.mode,
                selectionMeta: {
                    mode: opts.selection.mode,
                    ...(opts.selection.mode === "ids"
                        ? { idCount: opts.selection.ids.length }
                        : {
                              filters: opts.selection.filters,
                              excludeCount:
                                  opts.selection.excludeIds?.length || 0,
                          }),
                } as never,
                requestedCount: opts.requested,
                successCount: opts.success,
                failedCount: opts.failed,
                skippedCount: opts.skipped,
                payload: (opts.payload || undefined) as never,
                result: (opts.result || undefined) as never,
            },
        });
    } catch {
        // Schema may not be pushed yet — return synthetic id
        return { id: `local_${Date.now()}` };
    }
}

export async function bulkGrantConsent(opts: {
    selection: BulkSelectionInput;
    actorUserId: string;
    evidence: BulkGrantEvidenceInput;
}): Promise<BulkResult> {
    const validated = validateBulkGrantEvidence(opts.evidence);
    if (!validated.ok) {
        throw Object.assign(new Error(validated.message), { statusCode: 400 });
    }

    const contacts = await resolveContacts(opts.selection);
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const skippedReasons: Record<string, number> = {};
    const errors: Array<{ id: string; message: string }> = [];

    for (const contact of contacts) {
        const skip = bulkGrantSkipReason(contact);
        if (skip) {
            skipped++;
            skippedReasons[skip] = (skippedReasons[skip] || 0) + 1;
            continue;
        }
        try {
            const result = await applyConsentDecision({
                organizationKey: CRM_ORG_DEFAULT,
                waId: contact.waId,
                decision: CONSENT_DECISION.GRANTED,
                source: validated.consentSource,
                evidenceText: validated.evidenceText,
                evidencePayload: {
                    bulk: true,
                    originLabel: validated.originLabel,
                    authorizedAt: validated.authorizedAt.toISOString(),
                    previousStatus: contact.consentStatus,
                },
                purpose: validated.purpose,
                wabaId: validated.wabaId || null,
                decidedAt: validated.authorizedAt,
                actorUserId: opts.actorUserId,
                createContactIfMissing: false,
                idempotencyKey: `bulk_grant:${opts.actorUserId}:${contact.id}:${validated.authorizedAt.toISOString()}:${validated.evidenceText.slice(0, 40)}`,
            });
            if (result.applied || result.ok) {
                success++;
            } else {
                skipped++;
                skippedReasons[result.message || "not_applied"] =
                    (skippedReasons[result.message || "not_applied"] || 0) + 1;
            }
        } catch (e) {
            failed++;
            errors.push({
                id: contact.id,
                message: e instanceof Error ? e.message : "Falha",
            });
        }
    }

    const op = await writeBulkAudit({
        action: "grant_consent",
        actorUserId: opts.actorUserId,
        selection: opts.selection,
        requested: contacts.length,
        success,
        failed,
        skipped,
        payload: {
            purpose: validated.purpose,
            consentSource: validated.consentSource,
            authorizedAt: validated.authorizedAt.toISOString(),
            wabaId: validated.wabaId,
            evidencePreview: validated.evidenceText.slice(0, 200),
            originLabel: validated.originLabel,
        },
        result: { skippedReasons, errorCount: errors.length },
    });

    return {
        operationId: op.id,
        action: "grant_consent",
        requested: contacts.length,
        success,
        failed,
        skipped,
        skippedReasons: Object.fromEntries(
            Object.entries(skippedReasons).map(([k, v]) => [
                bulkGrantSkipLabel(k) || k,
                v,
            ])
        ),
        errors: errors.slice(0, 20),
    };
}

export async function bulkBlockContacts(opts: {
    selection: BulkSelectionInput;
    actorUserId: string;
    blocked?: boolean;
}): Promise<BulkResult> {
    const blocked = opts.blocked !== false;
    const contacts = await resolveContacts(opts.selection);
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const skippedReasons: Record<string, number> = {};
    const errors: Array<{ id: string; message: string }> = [];

    for (const contact of contacts) {
        if (contact.blocked === blocked) {
            skipped++;
            skippedReasons[blocked ? "already_blocked" : "already_unblocked"] =
                (skippedReasons[
                    blocked ? "already_blocked" : "already_unblocked"
                ] || 0) + 1;
            continue;
        }
        try {
            await prisma.crmContact.update({
                where: { id: contact.id },
                data: {
                    blocked,
                    updatedById: opts.actorUserId,
                } as never,
            });
            success++;
        } catch (e) {
            failed++;
            errors.push({
                id: contact.id,
                message: e instanceof Error ? e.message : "Falha",
            });
        }
    }

    const op = await writeBulkAudit({
        action: "block",
        actorUserId: opts.actorUserId,
        selection: opts.selection,
        requested: contacts.length,
        success,
        failed,
        skipped,
        payload: { blocked },
        result: { skippedReasons, errorCount: errors.length },
    });

    return {
        operationId: op.id,
        action: "block",
        requested: contacts.length,
        success,
        failed,
        skipped,
        skippedReasons,
        errors: errors.slice(0, 20),
    };
}

export async function bulkDeleteContacts(opts: {
    selection: BulkSelectionInput;
    actorUserId: string;
}): Promise<BulkResult> {
    const contacts = await resolveContacts(opts.selection);
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const skippedReasons: Record<string, number> = {};
    const errors: Array<{ id: string; message: string }> = [];
    let deactivated = 0;
    let hardDeleted = 0;

    for (const contact of contacts) {
        try {
            const result = await deleteCrmContact(contact.id);
            success++;
            if (result.deactivated) deactivated++;
            if (result.deleted) hardDeleted++;
        } catch (e) {
            failed++;
            errors.push({
                id: contact.id,
                message: e instanceof Error ? e.message : "Falha",
            });
        }
    }

    const op = await writeBulkAudit({
        action: "delete",
        actorUserId: opts.actorUserId,
        selection: opts.selection,
        requested: contacts.length,
        success,
        failed,
        skipped,
        payload: { actorUserId: opts.actorUserId },
        result: {
            deactivated,
            hardDeleted,
            skippedReasons,
            errorCount: errors.length,
        },
    });

    return {
        operationId: op.id,
        action: "delete",
        requested: contacts.length,
        success,
        failed,
        skipped,
        skippedReasons: {
            ...skippedReasons,
            ...(deactivated ? { deactivated } : {}),
            ...(hardDeleted ? { hardDeleted } : {}),
        },
        errors: errors.slice(0, 20),
    };
}

export function parseSelectionFromBody(body: {
    mode?: string;
    ids?: unknown;
    filters?: CrmListFilters;
    excludeIds?: unknown;
}): BulkSelectionInput {
    if (body.mode === "filters") {
        return {
            mode: "filters",
            filters: body.filters || {},
            excludeIds: normalizeIdList(body.excludeIds),
        };
    }
    return {
        mode: "ids",
        ids: normalizeIdList(body.ids),
    };
}
