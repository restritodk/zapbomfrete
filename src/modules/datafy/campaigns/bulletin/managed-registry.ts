import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    buildBulletinTemplateSubmission,
    countPositionalVars,
    type BulletinTemplateSpec,
    type LoadSlotField,
} from "./library";
import { parseFieldMappings } from "./field-map";
import {
    validateTemplateDraft,
    type TemplateDraftInput,
} from "./template-validation";

const ORG = "default";

export type ManagedTemplateView = {
    id: string;
    kind: "builtin" | "custom";
    builtinId: string | null;
    source: "code" | "db";
    technicalName: string;
    displayName: string;
    category: string;
    language: string;
    headerText: string | null;
    bodyText: string;
    footerText: string | null;
    fieldMappings: LoadSlotField[];
    exampleRow: string[];
    loadsPerMessage: number;
    variableCount: number;
    bodyCharCount: number;
    description: string;
    previewFilled: string;
    hidden: boolean;
    remoteStatus: string | null;
    remoteTemplateId: string | null;
    remoteRejectedReason: string | null;
    lastSubmittedAt: string | null;
    readyForManualSubmit: boolean;
    notes: string[];
    /** Spec id used in compose (builtin id or custom:technicalName) */
    libraryId: string;
};

type DbRow = {
    id: string;
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
    fieldMappings: unknown;
    exampleRow: unknown;
    loadsPerMessage: number;
    description: string | null;
    remoteStatus: string | null;
    remoteTemplateId: string | null;
    remoteRejectedReason: string | null;
    lastSubmittedAt: Date | null;
};

function managedDb() {
    return (
        prisma as unknown as {
            datafyManagedTemplate: {
                findMany: (args: unknown) => Promise<DbRow[]>;
                findFirst: (args: unknown) => Promise<DbRow | null>;
                findUnique: (args: unknown) => Promise<DbRow | null>;
                create: (args: unknown) => Promise<DbRow>;
                update: (args: unknown) => Promise<DbRow>;
                upsert: (args: unknown) => Promise<DbRow>;
            };
            datafyCampaign: {
                count: (args: unknown) => Promise<number>;
                findMany: (args: unknown) => Promise<Array<{ id: string; name: string; status: string; templateName: string | null; messageParts: unknown }>>;
            };
        }
    );
}

function exampleRowOf(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((x) => String(x ?? ""));
}

function specFromBuiltin(spec: BulletinTemplateSpec): ManagedTemplateView {
    const sub = buildBulletinTemplateSubmission(spec);
    return {
        id: `builtin:${spec.id}`,
        kind: "builtin",
        builtinId: spec.id,
        source: "code",
        technicalName: spec.preferredName,
        displayName: spec.preferredName,
        category: spec.recommendedCategory,
        language: "pt_BR",
        headerText: null,
        bodyText: spec.bodyTextForApproval,
        footerText: null,
        fieldMappings: [...spec.slotFields],
        exampleRow: [...spec.exampleRow],
        loadsPerMessage: spec.loadsPerMessage,
        variableCount: spec.variableCount,
        bodyCharCount: sub.bodyCharCount,
        description: spec.description,
        previewFilled: sub.previewFilled,
        hidden: false,
        remoteStatus: null,
        remoteTemplateId: null,
        remoteRejectedReason: null,
        lastSubmittedAt: null,
        readyForManualSubmit: sub.checks.readyForManualSubmit,
        notes: sub.checks.notes,
        libraryId: spec.id,
    };
}

function viewFromDbRow(row: DbRow): ManagedTemplateView {
    const fieldMappings = parseFieldMappings(row.fieldMappings);
    const exampleRow = exampleRowOf(row.exampleRow);
    const variableCount = countPositionalVars(row.bodyText);
    const validation = validateTemplateDraft({
        technicalName: row.technicalName,
        displayName: row.displayName,
        category: row.category as "MARKETING",
        language: row.language,
        headerText: row.headerText,
        bodyText: row.bodyText,
        footerText: row.footerText,
        fieldMappings,
        exampleRow,
        loadsPerMessage: row.loadsPerMessage,
        description: row.description,
    });
    return {
        id: row.id,
        kind: row.kind === "builtin" ? "builtin" : "custom",
        builtinId: row.builtinId,
        source: "db",
        technicalName: row.technicalName,
        displayName: row.displayName,
        category: row.category,
        language: row.language,
        headerText: row.headerText,
        bodyText: row.bodyText,
        footerText: row.footerText,
        fieldMappings,
        exampleRow,
        loadsPerMessage: row.loadsPerMessage,
        variableCount,
        bodyCharCount: row.bodyText.length,
        description: row.description || "",
        previewFilled: validation.previewFilled,
        hidden: row.hidden,
        remoteStatus: row.remoteStatus,
        remoteTemplateId: row.remoteTemplateId,
        remoteRejectedReason: row.remoteRejectedReason,
        lastSubmittedAt: row.lastSubmittedAt?.toISOString() ?? null,
        readyForManualSubmit: validation.ok,
        notes: [...validation.errors, ...validation.warnings],
        libraryId:
            row.kind === "builtin" && row.builtinId
                ? row.builtinId
                : `custom:${row.technicalName}`,
    };
}

/** Effective visible library for UI + compose (builtins not hidden + customs). */
export async function listEffectiveManagedTemplates(): Promise<
    ManagedTemplateView[]
> {
    let rows: DbRow[] = [];
    try {
        rows = await managedDb().datafyManagedTemplate.findMany({
            where: {
                organizationKey: ORG,
                OR: [{ deletedAt: null }, { deletedAt: { equals: null } }],
            },
            orderBy: { updatedAt: "desc" },
        });
    } catch {
        rows = [];
    }
    // Prisma null filter — also filter in memory
    rows = rows.filter((r) => !r.deletedAt);

    const byBuiltin = new Map<string, DbRow>();
    const customs: DbRow[] = [];
    for (const r of rows) {
        if (r.kind === "builtin" && r.builtinId) {
            byBuiltin.set(r.builtinId, r);
        } else if (r.kind === "custom") {
            customs.push(r);
        }
    }

    const out: ManagedTemplateView[] = [];
    for (const spec of BULLETIN_TEMPLATE_LIBRARY) {
        const override = byBuiltin.get(spec.id);
        if (override?.hidden) continue;
        if (override) {
            out.push(viewFromDbRow(override));
        } else {
            out.push(specFromBuiltin(spec));
        }
    }
    for (const c of customs) {
        if (!c.hidden) out.push(viewFromDbRow(c));
    }
    return out;
}

/** Convert managed views to BulletinTemplateSpec for compose/match. */
export function managedToSpecs(
    views: ManagedTemplateView[]
): BulletinTemplateSpec[] {
    return views.map((v) => ({
        id: v.libraryId,
        preferredName: v.technicalName,
        namePatterns: [
            new RegExp(`^${escapeRegExp(v.technicalName)}$`, "i"),
        ],
        loadsPerMessage: (v.loadsPerMessage === 2
            ? 2
            : v.loadsPerMessage === 3
              ? 3
              : 1) as 1 | 2 | 3,
        variableCount: v.variableCount,
        generation:
            v.kind === "builtin" && v.builtinId?.includes("v3")
                ? 3
                : v.kind === "builtin" && v.builtinId?.includes("v2")
                  ? 2
                  : 1,
        slotFields: v.fieldMappings,
        recommendedCategory:
            v.category === "UTILITY" ? "UTILITY" : "MARKETING",
        description: v.description || v.displayName,
        bodyTextForApproval: v.bodyText,
        exampleRow: v.exampleRow,
    }));
}

/** JSON-safe library for client-side compose (RegExp rebuilt on hydrate). */
export type ClientLibrarySpec = {
    id: string;
    preferredName: string;
    loadsPerMessage: 1 | 2 | 3;
    variableCount: number;
    generation: 1 | 2 | 3;
    slotFields: LoadSlotField[];
    recommendedCategory: "MARKETING" | "UTILITY";
    description: string;
    bodyTextForApproval: string;
    exampleRow: string[];
};

export function managedToClientLibrary(
    views: ManagedTemplateView[]
): ClientLibrarySpec[] {
    return managedToSpecs(views).map((s) => ({
        id: s.id,
        preferredName: s.preferredName,
        loadsPerMessage: s.loadsPerMessage,
        variableCount: s.variableCount,
        generation: s.generation,
        slotFields: s.slotFields,
        recommendedCategory: s.recommendedCategory,
        description: s.description,
        bodyTextForApproval: s.bodyTextForApproval,
        exampleRow: s.exampleRow,
    }));
}

export function hydrateClientLibrary(
    rows: ClientLibrarySpec[]
): BulletinTemplateSpec[] {
    return rows.map((r) => ({
        ...r,
        namePatterns: [
            new RegExp(`^${escapeRegExp(r.preferredName)}$`, "i"),
        ],
    }));
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function findManagedByTechnicalName(
    name: string
): Promise<ManagedTemplateView | null> {
    const all = await listEffectiveManagedTemplates();
    return (
        all.find(
            (t) => t.technicalName.toLowerCase() === name.trim().toLowerCase()
        ) || null
    );
}

export async function hideBuiltin(builtinId: string, userId: string) {
    const spec = BULLETIN_TEMPLATE_LIBRARY.find((s) => s.id === builtinId);
    if (!spec) throw new Error("Builtin desconhecido");

    const existing = await managedDb().datafyManagedTemplate.findFirst({
        where: { organizationKey: ORG, builtinId, kind: "builtin" },
    });
    if (existing) {
        return managedDb().datafyManagedTemplate.update({
            where: { id: existing.id },
            data: { hidden: true, updatedAt: new Date() },
        });
    }
    return managedDb().datafyManagedTemplate.create({
        data: {
            organizationKey: ORG,
            kind: "builtin",
            builtinId,
            hidden: true,
            technicalName: spec.preferredName,
            displayName: spec.preferredName,
            category: spec.recommendedCategory,
            language: "pt_BR",
            bodyText: spec.bodyTextForApproval,
            fieldMappings: spec.slotFields as unknown as Prisma.InputJsonValue,
            exampleRow: spec.exampleRow as unknown as Prisma.InputJsonValue,
            loadsPerMessage: spec.loadsPerMessage,
            description: spec.description,
            createdById: userId,
        },
    });
}

export async function createCustomTemplate(
    input: TemplateDraftInput,
    userId: string
) {
    const v = validateTemplateDraft(input);
    if (!v.ok) {
        const err = new Error(v.errors.join(" "));
        (err as Error & { validation: typeof v }).validation = v;
        throw err;
    }
    const technicalName = input.technicalName.trim().toLowerCase();
    const clash = await findManagedByTechnicalName(technicalName);
    if (clash) throw new Error("Já existe um template com este nome técnico");

    return managedDb().datafyManagedTemplate.create({
        data: {
            organizationKey: ORG,
            kind: "custom",
            builtinId: null,
            hidden: false,
            technicalName,
            displayName: input.displayName.trim(),
            category: input.category,
            language: "pt_BR",
            headerText: input.headerText?.trim() || null,
            bodyText: input.bodyText.replace(/\r\n/g, "\n"),
            footerText: input.footerText?.trim() || null,
            fieldMappings: v.fieldMappings as unknown as Prisma.InputJsonValue,
            exampleRow: v.exampleRow as unknown as Prisma.InputJsonValue,
            loadsPerMessage: Number(input.loadsPerMessage || 1),
            description: input.description?.trim() || null,
            createdById: userId,
        },
    });
}

export async function updateManagedTemplate(
    id: string,
    input: Partial<TemplateDraftInput> & { displayName?: string }
) {
    const row = await managedDb().datafyManagedTemplate.findUnique({
        where: { id },
    });
    if (!row || row.deletedAt) throw new Error("Template não encontrado");
    if (row.kind === "builtin" && row.hidden) {
        throw new Error("Template oculto — restaure ou duplique antes de editar");
    }

    // Meta APPROVED body cannot be edited in place — force new technical name path via UI
    if (
        row.remoteStatus === "APPROVED" &&
        input.bodyText &&
        input.bodyText !== row.bodyText
    ) {
        throw new Error(
            "Template já APPROVED na Meta: duplique para criar nova versão em vez de alterar o corpo."
        );
    }

    const merged: TemplateDraftInput = {
        technicalName: input.technicalName || row.technicalName,
        displayName: input.displayName || row.displayName,
        category: (input.category || row.category) as TemplateDraftInput["category"],
        language: "pt_BR",
        headerText:
            input.headerText !== undefined ? input.headerText : row.headerText,
        bodyText: input.bodyText ?? row.bodyText,
        footerText:
            input.footerText !== undefined ? input.footerText : row.footerText,
        fieldMappings:
            input.fieldMappings || parseFieldMappings(row.fieldMappings),
        exampleRow: input.exampleRow || exampleRowOf(row.exampleRow),
        loadsPerMessage: input.loadsPerMessage ?? row.loadsPerMessage,
        description:
            input.description !== undefined
                ? input.description
                : row.description,
    };

    // Builtin edit without prior row: ensure we update the override
    if (row.kind === "builtin" && !row.id) {
        /* n/a */
    }

    const v = validateTemplateDraft(merged);
    if (!v.ok) {
        const err = new Error(v.errors.join(" "));
        (err as Error & { validation: typeof v }).validation = v;
        throw err;
    }

    // Renaming technical name of APPROVED is blocked
    if (
        merged.technicalName !== row.technicalName &&
        row.remoteStatus === "APPROVED"
    ) {
        throw new Error(
            "Não altere o nome técnico de um template APPROVED — duplique."
        );
    }

    return managedDb().datafyManagedTemplate.update({
        where: { id },
        data: {
            technicalName: merged.technicalName.trim().toLowerCase(),
            displayName: merged.displayName.trim(),
            category: merged.category,
            headerText: merged.headerText?.trim() || null,
            bodyText: merged.bodyText.replace(/\r\n/g, "\n"),
            footerText: merged.footerText?.trim() || null,
            fieldMappings: v.fieldMappings as unknown as Prisma.InputJsonValue,
            exampleRow: v.exampleRow as unknown as Prisma.InputJsonValue,
            loadsPerMessage: Number(merged.loadsPerMessage || 1),
            description: merged.description?.trim() || null,
            updatedAt: new Date(),
        },
    });
}

/** Upsert builtin override when editing a code-only builtin (id = builtin:xxx). */
export async function upsertBuiltinOverride(
    builtinId: string,
    input: TemplateDraftInput,
    userId: string
) {
    const spec = BULLETIN_TEMPLATE_LIBRARY.find((s) => s.id === builtinId);
    if (!spec) throw new Error("Builtin desconhecido");
    const v = validateTemplateDraft(input);
    if (!v.ok) {
        const err = new Error(v.errors.join(" "));
        (err as Error & { validation: typeof v }).validation = v;
        throw err;
    }

    const existing = await managedDb().datafyManagedTemplate.findFirst({
        where: { organizationKey: ORG, builtinId, kind: "builtin" },
    });
    const data = {
        organizationKey: ORG,
        kind: "builtin" as const,
        builtinId,
        hidden: false,
        technicalName: input.technicalName.trim().toLowerCase(),
        displayName: input.displayName.trim(),
        category: input.category,
        language: "pt_BR",
        headerText: input.headerText?.trim() || null,
        bodyText: input.bodyText.replace(/\r\n/g, "\n"),
        footerText: input.footerText?.trim() || null,
        fieldMappings: v.fieldMappings as unknown as Prisma.InputJsonValue,
        exampleRow: v.exampleRow as unknown as Prisma.InputJsonValue,
        loadsPerMessage: Number(input.loadsPerMessage || spec.loadsPerMessage),
        description: input.description?.trim() || spec.description,
        createdById: userId,
        updatedAt: new Date(),
    };
    if (existing) {
        if (existing.remoteStatus === "APPROVED" && input.bodyText !== existing.bodyText) {
            throw new Error(
                "Template já APPROVED: duplique para nova versão."
            );
        }
        return managedDb().datafyManagedTemplate.update({
            where: { id: existing.id },
            data,
        });
    }
    return managedDb().datafyManagedTemplate.create({ data });
}

export async function duplicateManaged(
    viewId: string,
    userId: string,
    newTechnicalName?: string
) {
    const all = await listEffectiveManagedTemplates();
    const src = all.find((t) => t.id === viewId);
    if (!src) throw new Error("Template não encontrado");

    let base =
        newTechnicalName?.trim().toLowerCase() ||
        `${src.technicalName}_copia`.slice(0, 60);
    if (!/^[a-z][a-z0-9_]*$/.test(base)) {
        base = `boletim_copia_${Date.now().toString(36)}`;
    }
    let candidate = base;
    let n = 2;
    while (await findManagedByTechnicalName(candidate)) {
        candidate = `${base}_${n++}`.slice(0, 64);
    }

    return createCustomTemplate(
        {
            technicalName: candidate,
            displayName: `${src.displayName} (cópia)`,
            category: src.category as TemplateDraftInput["category"],
            bodyText: src.bodyText,
            headerText: src.headerText,
            footerText: src.footerText,
            fieldMappings: src.fieldMappings,
            exampleRow: src.exampleRow,
            loadsPerMessage: src.loadsPerMessage,
            description: src.description,
        },
        userId
    );
}

export async function campaignsUsingTemplate(
    technicalName: string
): Promise<Array<{ id: string; name: string; status: string }>> {
    const rows = await managedDb().datafyCampaign.findMany({
        where: {
            OR: [
                { templateName: technicalName },
                { contentKind: "bulletin" },
            ],
        },
        select: {
            id: true,
            name: true,
            status: true,
            templateName: true,
            messageParts: true,
        },
    });
    return rows
        .filter((c) => {
            if (c.templateName === technicalName) return true;
            if (!Array.isArray(c.messageParts)) return false;
            return (c.messageParts as Array<{ templateName?: string }>).some(
                (p) => p.templateName === technicalName
            );
        })
        .map((c) => ({ id: c.id, name: c.name, status: c.status }));
}

export async function deleteOrHideManaged(viewId: string, userId: string) {
    const all = await listEffectiveManagedTemplates();
    const view = all.find((t) => t.id === viewId);
    if (!view) throw new Error("Template não encontrado");

    const deps = await campaignsUsingTemplate(view.technicalName);
    const activeDeps = deps.filter((d) =>
        ["scheduled", "preparing", "running", "paused"].includes(d.status)
    );
    if (activeDeps.length) {
        throw new Error(
            `Template usado por campanha(s) ativa(s): ${activeDeps
                .map((d) => d.name)
                .join(", ")}. Pause/cancele antes.`
        );
    }

    if (view.kind === "builtin") {
        await hideBuiltin(view.builtinId!, userId);
        return {
            action: "hidden_builtin" as const,
            metaUntouched: true,
            warning:
                view.remoteStatus === "APPROVED" ||
                view.remoteStatus === "PENDING"
                    ? "Oculto só na biblioteca local. O template na Meta permanece — exclusão remota é ação separada."
                    : "Builtin oculto localmente (não reaparece após deploy).",
        };
    }

    // Soft-delete custom
    await managedDb().datafyManagedTemplate.update({
        where: { id: view.id },
        data: {
            deletedAt: new Date(),
            hidden: true,
            updatedAt: new Date(),
        },
    });
    return {
        action: "deleted_custom" as const,
        metaUntouched: true,
        warning:
            view.remoteStatus === "APPROVED" || view.remoteStatus === "PENDING"
                ? "Removido da biblioteca local. Meta/Datafy não foram alterados."
                : null,
    };
}

export async function markSubmitted(
    technicalName: string,
    remote: { id?: string | null; status?: string | null; rejected_reason?: string | null }
) {
    const row = await managedDb().datafyManagedTemplate.findFirst({
        where: { organizationKey: ORG, technicalName, deletedAt: null },
    });
    if (!row) {
        // Create tracking stub for code builtin after submit
        const builtin = BULLETIN_TEMPLATE_LIBRARY.find(
            (s) => s.preferredName === technicalName
        );
        if (!builtin) return null;
        return managedDb().datafyManagedTemplate.create({
            data: {
                organizationKey: ORG,
                kind: "builtin",
                builtinId: builtin.id,
                hidden: false,
                technicalName: builtin.preferredName,
                displayName: builtin.preferredName,
                category: builtin.recommendedCategory,
                language: "pt_BR",
                bodyText: builtin.bodyTextForApproval,
                fieldMappings:
                    builtin.slotFields as unknown as Prisma.InputJsonValue,
                exampleRow:
                    builtin.exampleRow as unknown as Prisma.InputJsonValue,
                loadsPerMessage: builtin.loadsPerMessage,
                description: builtin.description,
                remoteStatus: String(remote.status || "PENDING").toUpperCase(),
                remoteTemplateId: remote.id || null,
                remoteRejectedReason: remote.rejected_reason || null,
                lastSubmittedAt: new Date(),
            },
        });
    }
    return managedDb().datafyManagedTemplate.update({
        where: { id: row.id },
        data: {
            remoteStatus: String(remote.status || "PENDING").toUpperCase(),
            remoteTemplateId: remote.id || row.remoteTemplateId,
            remoteRejectedReason: remote.rejected_reason ?? null,
            lastSubmittedAt: new Date(),
            updatedAt: new Date(),
        },
    });
}

export async function syncRemoteStatuses(
    remoteByName: Record<
        string,
        {
            id?: string;
            status: string;
            rejected_reason?: string | null;
        }
    >
) {
    for (const [name, remote] of Object.entries(remoteByName)) {
        try {
            await markSubmitted(name, remote);
        } catch {
            /* ignore per-row */
        }
    }
}
