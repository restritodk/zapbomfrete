import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { canAccessDatafyChannel } from "@/modules/channels/access";
import {
    canManageBulletinTemplates,
    canViewDatafyCampaigns,
} from "@/modules/datafy/campaigns/access";
import { datafyProvider, DatafyApiError } from "@/modules/datafy";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";
import { loadDatafyConfig } from "@/modules/datafy/config";
import {
    buildBulletinTemplateSubmission,
    findBulletinSpecByName,
} from "@/modules/datafy/campaigns/bulletin/library";
import {
    createCustomTemplate,
    findManagedByTechnicalName,
    listEffectiveManagedTemplates,
    managedToClientLibrary,
    managedToSpecs,
    markSubmitted,
    syncRemoteStatuses,
} from "@/modules/datafy/campaigns/bulletin/managed-registry";
import { validateTemplateDraft } from "@/modules/datafy/campaigns/bulletin/template-validation";
import { FIELD_MAP_OPTIONS } from "@/modules/datafy/campaigns/bulletin/field-map";
import {
    buildTemplateCreatePayload,
    formatMetaTemplateApiError,
} from "@/modules/datafy/campaigns/bulletin/template-submit-payload";
import {
    formatLocalTemplateZodError,
    localTemplateButtonsSchema,
    localTemplateCreateSchema,
} from "@/modules/datafy/campaigns/bulletin/template-local-save";

export const dynamic = "force-dynamic";

const submitSchema = z.object({
    action: z.literal("submit"),
    name: z.string().min(3).max(64),
    confirmSubmit: z.literal(true),
});

const refreshSchema = z.object({
    action: z.literal("refresh"),
});

const validateSchema = z.object({
    action: z.literal("validate"),
    technicalName: z.string(),
    displayName: z.string(),
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
    headerText: z.string().optional().nullable(),
    bodyText: z.string(),
    footerText: z.string().optional().nullable(),
    buttons: localTemplateButtonsSchema,
    fieldMappings: z.array(z.string()),
    exampleRow: z.array(z.string()),
    loadsPerMessage: z.number().optional(),
    description: z.string().optional().nullable(),
});

async function requireAccess(request: NextRequest, write: boolean) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return {
            error: NextResponse.json(
                { status: false, message: "Unauthorized" },
                { status: 401 }
            ),
        };
    }
    if (write) {
        if (!canManageBulletinTemplates(user.role)) {
            return {
                error: NextResponse.json(
                    {
                        status: false,
                        message:
                            "Apenas OWNER ou SUPERADMIN podem gerenciar/submeter templates",
                    },
                    { status: 403 }
                ),
            };
        }
    } else {
        const allowed =
            canManageBulletinTemplates(user.role) ||
            (await canViewDatafyCampaigns(user.id, user.role)) ||
            (await canAccessDatafyChannel(user.id, user.role));
        if (!allowed) {
            return {
                error: NextResponse.json(
                    { status: false, message: "Forbidden" },
                    { status: 403 }
                ),
            };
        }
    }
    return { user };
}

async function fetchRemoteMap() {
    const remoteByName: Record<
        string,
        {
            id?: string;
            name: string;
            status: string;
            category?: string;
            language?: string;
            rejected_reason?: string | null;
        }
    > = {};
    let remoteError: string | null = null;
    try {
        const library = await listEffectiveManagedTemplates();
        const names = new Set(library.map((t) => t.technicalName.toLowerCase()));
        const statuses = ["APPROVED", "PENDING", "REJECTED"] as const;
        const pages = await Promise.all(
            statuses.map((status) =>
                datafyProvider
                    .listTemplates({ status, limit: 100 })
                    .catch(() => ({ data: [] as unknown[] }))
            )
        );
        for (const page of pages) {
            const rows = Array.isArray(page?.data) ? page.data : [];
            for (const raw of rows) {
                const t = raw as {
                    id?: string;
                    name?: string;
                    status?: string;
                    category?: string;
                    language?: string;
                    rejected_reason?: string | null;
                };
                if (!t.name || !names.has(t.name.toLowerCase())) continue;
                const lang = String(t.language || "pt_BR");
                if (lang !== "pt_BR" && lang !== "pt_br") continue;
                const key = t.name;
                const prev = remoteByName[key];
                const rank = (s: string) =>
                    s === "APPROVED" ? 3 : s === "PENDING" ? 2 : 1;
                if (
                    !prev ||
                    rank(String(t.status || "").toUpperCase()) >
                        rank(String(prev.status || "").toUpperCase())
                ) {
                    remoteByName[key] = {
                        id: t.id,
                        name: t.name,
                        status: String(t.status || "UNKNOWN").toUpperCase(),
                        category: t.category,
                        language: lang,
                        rejected_reason: t.rejected_reason ?? null,
                    };
                }
            }
        }
        await syncRemoteStatuses(remoteByName);
    } catch (e) {
        remoteError =
            e instanceof DatafyApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "Falha ao consultar templates remotos";
    }
    return { remoteByName, remoteError };
}

export async function GET(request: NextRequest) {
    const gate = await requireAccess(request, false);
    if (gate.error) return gate.error;

    const library = await listEffectiveManagedTemplates();
    const { remoteByName, remoteError } = await fetchRemoteMap();

    const linkedIds = new Set<string>();
    const linkedBuiltinIds = new Set<string>();
    const linkedNameLang = new Set<string>();
    let lastSyncAt: string | null = null;
    try {
        const { prisma } = await import("@/lib/prisma");
        const cards = await prisma.datafyBulletinCard.findMany({
            where: { managedTemplateId: { not: null } },
            select: { managedTemplateId: true },
        });
        for (const c of cards) {
            if (c.managedTemplateId) linkedIds.add(c.managedTemplateId);
        }
        if (linkedIds.size) {
            const linkedManaged = await prisma.datafyManagedTemplate.findMany({
                where: { id: { in: [...linkedIds] } },
                select: {
                    id: true,
                    technicalName: true,
                    language: true,
                    builtinId: true,
                },
            });
            for (const m of linkedManaged) {
                if (m.builtinId) linkedBuiltinIds.add(m.builtinId);
                linkedNameLang.add(
                    `${m.technicalName.toLowerCase()}|${String(m.language || "pt_BR").toLowerCase()}`
                );
            }
        }
        const syncState = await prisma.datafyTemplateSyncState.findFirst({
            orderBy: { lastSyncAt: "desc" },
            select: { lastSyncAt: true },
        });
        lastSyncAt = syncState?.lastSyncAt?.toISOString() ?? null;
    } catch {
        /* association / sync metadata optional */
    }

    // Merge cached remote onto views
    const items = library.map((item) => {
        const remote =
            remoteByName[item.technicalName] ||
            (item.remoteStatus
                ? {
                      id: item.remoteTemplateId || undefined,
                      name: item.technicalName,
                      status: item.remoteStatus,
                      rejected_reason: item.remoteRejectedReason,
                  }
                : null);
        const remoteStatus =
            remote?.status || item.remoteStatus || "NÃO ENVIADO";
        const nameKey = `${item.technicalName.toLowerCase()}|${String(item.language || "pt_BR").toLowerCase()}`;
        const associated =
            linkedIds.has(item.id) ||
            (Boolean(item.builtinId) &&
                linkedBuiltinIds.has(String(item.builtinId))) ||
            linkedNameLang.has(nameKey);
        return {
            ...item,
            remoteStatus,
            remoteTemplateId: remote?.id || item.remoteTemplateId,
            remoteRejectedReason:
                remote?.rejected_reason ?? item.remoteRejectedReason,
            associated,
            lastSyncAt,
        };
    });

    return NextResponse.json({
        status: true,
        data: {
            language: "pt_BR",
            fieldMapOptions: FIELD_MAP_OPTIONS,
            submissionChannel: "datafy_api",
            metaNote:
                "A Datafy encaminha POST message_templates à Meta. Exclusão local não remove templates da Meta.",
            library: items,
            lastSyncAt,
            composeLibrary: managedToClientLibrary(library),
            remote: remoteByName,
            remoteError: remoteError ? redactSecrets(remoteError) : null,
            specs: managedToSpecs(library).map((s) =>
                buildBulletinTemplateSubmission(s)
            ),
        },
    });
}

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => null);
    const action = body?.action;

    if (action === "validate") {
        const gate = await requireAccess(request, false);
        if (gate.error) return gate.error;
        const parsed = validateSchema.safeParse(body);
        if (!parsed.success) {
            const formatted = formatLocalTemplateZodError(parsed.error);
            return NextResponse.json(
                {
                    status: false,
                    message: formatted.message,
                    details: parsed.error.flatten(),
                    fieldErrors: formatted.fieldErrors,
                },
                { status: 400 }
            );
        }
        const result = validateTemplateDraft(parsed.data);
        return NextResponse.json({ status: true, data: result });
    }

    if (action === "refresh") {
        const gate = await requireAccess(request, false);
        if (gate.error) return gate.error;
        refreshSchema.parse(body);
        const { remoteByName, remoteError } = await fetchRemoteMap();
        return NextResponse.json({
            status: true,
            data: {
                remote: remoteByName,
                remoteError: remoteError ? redactSecrets(remoteError) : null,
            },
        });
    }

    if (action === "create") {
        const gate = await requireAccess(request, true);
        if (gate.error) return gate.error;
        const parsed = localTemplateCreateSchema.safeParse(body);
        if (!parsed.success) {
            const formatted = formatLocalTemplateZodError(parsed.error);
            return NextResponse.json(
                {
                    status: false,
                    message: formatted.message,
                    details: parsed.error.flatten(),
                    fieldErrors: formatted.fieldErrors,
                },
                { status: 400 }
            );
        }
        try {
            const row = await createCustomTemplate(parsed.data, gate.user!.id);
            return NextResponse.json({ status: true, data: { id: row.id } });
        } catch (e) {
            const validation = (e as { validation?: unknown }).validation;
            const raw =
                e instanceof Error ? e.message : "Não foi possível salvar. Tente novamente.";
            const message = /já existe/i.test(raw)
                ? "O template já existe nesta organização."
                : raw;
            return NextResponse.json(
                {
                    status: false,
                    message,
                    data: validation ? { validation } : undefined,
                },
                { status: 400 }
            );
        }
    }

    if (action === "submit") {
        const gate = await requireAccess(request, true);
        if (gate.error) return gate.error;
        const parsed = submitSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Informe name + confirmSubmit: true + action:submit",
                },
                { status: 400 }
            );
        }

        const managed = await findManagedByTechnicalName(parsed.data.name);
        if (!managed) {
            return NextResponse.json(
                { status: false, message: "Template não encontrado na biblioteca" },
                { status: 404 }
            );
        }
        if (!managed.readyForManualSubmit) {
            return NextResponse.json(
                {
                    status: false,
                    message: "Modelo inválido para submissão",
                    data: { notes: managed.notes },
                },
                { status: 400 }
            );
        }

        try {
            const cfg = await loadDatafyConfig();
            let wabaId = cfg.wabaId;
            if (!wabaId) {
                const verified = await datafyProvider.verifyConnection();
                wabaId = verified.me?.waba_id || null;
                if (verified.ok && verified.verifiedName) {
                    const { syncVerifiedNameFromApi } = await import(
                        "@/modules/crm/org-profile"
                    );
                    await syncVerifiedNameFromApi(verified.verifiedName);
                }
            }
            if (!wabaId) {
                return NextResponse.json(
                    {
                        status: false,
                        message: "waba_id indisponível — verifique a integração",
                    },
                    { status: 400 }
                );
            }

            // Prefer code-library BODY for known builtins so stale DB rows
            // (e.g. trailing "." only after {{n}}) cannot reintroduce Meta 2388299.
            const librarySpec = findBulletinSpecByName(managed.technicalName);
            const bodyForSubmit =
                librarySpec?.bodyTextForApproval || managed.bodyText;
            const examplesForSubmit = librarySpec?.exampleRow?.length
                ? librarySpec.exampleRow
                : (managed.exampleRow as string[]);

            const built = buildTemplateCreatePayload({
                name: managed.technicalName,
                language: "pt_BR",
                category: managed.category as "MARKETING",
                bodyText: bodyForSubmit,
                exampleRow: examplesForSubmit,
                buttons: managed.buttons,
            });
            if (!built.ok) {
                return NextResponse.json(
                    {
                        status: false,
                        message: built.errors.join(" "),
                        data: { errors: built.errors, guidance: built.warnings },
                    },
                    { status: 400 }
                );
            }

            const components: Array<Record<string, unknown>> = [
                ...built.payload.components,
            ];
            // Builtins from library: do not attach custom HEADER/FOOTER that
            // could reintroduce dangling variables. Customs keep optional parts.
            if (!librarySpec && managed.headerText?.trim()) {
                components.unshift({
                    type: "HEADER",
                    format: "TEXT",
                    text: managed.headerText.trim(),
                });
            }
            if (!librarySpec && managed.footerText?.trim()) {
                components.push({
                    type: "FOOTER",
                    text: managed.footerText.trim(),
                });
            }

            const client = await datafyProvider.createClient();
            const created = await client.createTemplate(wabaId, {
                name: built.payload.name,
                language: built.payload.language,
                category: built.payload.category,
                components,
            });

            await markSubmitted(managed.technicalName, {
                id: created.id,
                status: created.status || "PENDING",
                language: "pt_BR",
            });

            return NextResponse.json({
                status: true,
                data: {
                    templateName: managed.technicalName,
                    templateId: created.id || null,
                    approvalStatus: String(
                        created.status || "PENDING"
                    ).toUpperCase(),
                    category: created.category || managed.category,
                    language: "pt_BR",
                    message:
                        "Template enviado à Meta via Datafy. Campanhas reais só com APPROVED.",
                },
            });
        } catch (e) {
            const formatted = formatMetaTemplateApiError(e);
            return NextResponse.json(
                {
                    status: false,
                    message: redactSecrets(formatted.message),
                    data: {
                        code: formatted.code,
                        subcode: formatted.subcode,
                        fbtraceId: formatted.fbtraceId,
                        guidance: formatted.guidance,
                    },
                },
                { status: e instanceof DatafyApiError ? e.statusCode : 500 }
            );
        }
    }

    // Backward-compat: old clients sent { name, confirmSubmit: true }
    if (body?.confirmSubmit === true && body?.name && !action) {
        return POST(
            new NextRequest(request.url, {
                method: "POST",
                headers: request.headers,
                body: JSON.stringify({
                    action: "submit",
                    name: body.name,
                    confirmSubmit: true,
                }),
            })
        );
    }

    return NextResponse.json(
        { status: false, message: "action inválida" },
        { status: 400 }
    );
}
