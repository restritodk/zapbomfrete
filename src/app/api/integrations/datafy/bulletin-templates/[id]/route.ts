import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import {
    campaignsUsingTemplate,
    deleteOrHideManaged,
    duplicateManaged,
    findManagedByTechnicalName,
    listEffectiveManagedTemplates,
    updateManagedTemplate,
    upsertBuiltinOverride,
} from "@/modules/datafy/campaigns/bulletin/managed-registry";
import { validateTemplateDraft } from "@/modules/datafy/campaigns/bulletin/template-validation";

export const dynamic = "force-dynamic";

const draftSchema = z.object({
    technicalName: z.string().min(3).max(64).optional(),
    displayName: z.string().min(1).max(120).optional(),
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]).optional(),
    headerText: z.string().max(120).optional().nullable(),
    bodyText: z.string().min(1).max(2000).optional(),
    footerText: z.string().max(120).optional().nullable(),
    fieldMappings: z.array(z.string()).min(1).max(60).optional(),
    exampleRow: z.array(z.string()).max(60).optional(),
    loadsPerMessage: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    description: z.string().max(500).optional().nullable(),
});

const duplicateSchema = z.object({
    action: z.literal("duplicate"),
    technicalName: z.string().min(3).max(64).optional(),
});

async function requireAdmin(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return {
            error: NextResponse.json(
                { status: false, message: "Unauthorized" },
                { status: 401 }
            ),
        };
    }
    if (!isAdmin(user.role)) {
        return {
            error: NextResponse.json(
                {
                    status: false,
                    message: "Apenas SUPERADMIN pode gerenciar templates",
                },
                { status: 403 }
            ),
        };
    }
    return { user };
}

async function resolveView(id: string) {
    const all = await listEffectiveManagedTemplates();
    return all.find((t) => t.id === id) || null;
}

export async function GET(
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdmin(request);
    if (gate.error) return gate.error;
    const { id } = await ctx.params;
    const view = await resolveView(decodeURIComponent(id));
    if (!view) {
        return NextResponse.json(
            { status: false, message: "Template não encontrado" },
            { status: 404 }
        );
    }
    const deps = await campaignsUsingTemplate(view.technicalName);
    return NextResponse.json({ status: true, data: { ...view, campaigns: deps } });
}

export async function PATCH(
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdmin(request);
    if (gate.error) return gate.error;
    const { id } = await ctx.params;
    const viewId = decodeURIComponent(id);
    const body = await request.json().catch(() => null);
    const parsed = draftSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { status: false, message: "Payload inválido", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const view = await resolveView(viewId);
    if (!view) {
        return NextResponse.json(
            { status: false, message: "Template não encontrado" },
            { status: 404 }
        );
    }

    const draft = {
        technicalName: parsed.data.technicalName || view.technicalName,
        displayName: parsed.data.displayName || view.displayName,
        category: (parsed.data.category ||
            view.category) as "MARKETING" | "UTILITY" | "AUTHENTICATION",
        headerText:
            parsed.data.headerText !== undefined
                ? parsed.data.headerText
                : view.headerText,
        bodyText: parsed.data.bodyText ?? view.bodyText,
        footerText:
            parsed.data.footerText !== undefined
                ? parsed.data.footerText
                : view.footerText,
        fieldMappings: parsed.data.fieldMappings || view.fieldMappings,
        exampleRow: parsed.data.exampleRow || view.exampleRow,
        loadsPerMessage: parsed.data.loadsPerMessage ?? view.loadsPerMessage,
        description:
            parsed.data.description !== undefined
                ? parsed.data.description
                : view.description,
    };

    const validation = validateTemplateDraft(draft);
    if (!validation.ok) {
        return NextResponse.json(
            {
                status: false,
                message: validation.errors.join(" "),
                data: { validation },
            },
            { status: 400 }
        );
    }

    try {
        if (view.kind === "builtin" && viewId.startsWith("builtin:")) {
            await upsertBuiltinOverride(
                view.builtinId!,
                draft,
                gate.user!.id
            );
        } else if (view.kind === "builtin") {
            await updateManagedTemplate(view.id, draft);
        } else {
            await updateManagedTemplate(view.id, draft);
        }
        const refreshed = await findManagedByTechnicalName(draft.technicalName);
        return NextResponse.json({ status: true, data: refreshed });
    } catch (e) {
        return NextResponse.json(
            {
                status: false,
                message: e instanceof Error ? e.message : "Falha ao atualizar",
            },
            { status: 400 }
        );
    }
}

export async function POST(
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdmin(request);
    if (gate.error) return gate.error;
    const { id } = await ctx.params;
    const viewId = decodeURIComponent(id);
    const body = await request.json().catch(() => null);
    const parsed = duplicateSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { status: false, message: "Use action: duplicate" },
            { status: 400 }
        );
    }
    try {
        const row = await duplicateManaged(
            viewId,
            gate.user!.id,
            parsed.data.technicalName
        );
        return NextResponse.json({
            status: true,
            data: { id: row.id, technicalName: row.technicalName },
        });
    } catch (e) {
        return NextResponse.json(
            {
                status: false,
                message: e instanceof Error ? e.message : "Falha ao duplicar",
            },
            { status: 400 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
) {
    const gate = await requireAdmin(request);
    if (gate.error) return gate.error;
    const { id } = await ctx.params;
    const viewId = decodeURIComponent(id);
    try {
        const result = await deleteOrHideManaged(viewId, gate.user!.id);
        return NextResponse.json({ status: true, data: result });
    } catch (e) {
        return NextResponse.json(
            {
                status: false,
                message: e instanceof Error ? e.message : "Falha ao excluir",
            },
            { status: 400 }
        );
    }
}
