import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DatafyApiError } from "@/modules/datafy/client";
import {
    requireCampaignEdit,
    requireCampaignView,
} from "@/modules/datafy/campaigns/auth-gate";
import {
    importTemplateToLibrary,
    listSyncedApprovals,
    syncTemplatesFromDatafy,
    toApprovalDto,
} from "@/modules/datafy/campaigns/bulletin/template-sync";
import { FIELD_MAP_OPTIONS } from "@/modules/datafy/campaigns/bulletin/field-map";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const listSchema = z.object({
    q: z.string().optional(),
    status: z.string().optional(),
    category: z.string().optional(),
    language: z.string().optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(50).optional(),
});

const postSchema = z.discriminatedUnion("action", [
    z.object({ action: z.literal("sync") }),
    z.object({ action: z.literal("refresh") }),
    z.object({
        action: z.literal("import_to_library"),
        id: z.string().min(1),
        fieldMappings: z.array(z.string()).default([]),
        loadsPerMessage: z.number().int().min(1).max(3).optional(),
    }),
]);

export async function GET(request: NextRequest) {
    const gate = await requireCampaignView(request);
    if (gate.error) return gate.error;

    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
        const row = await (
            prisma as unknown as {
                datafyManagedTemplate: {
                    findFirst: (
                        a: unknown
                    ) => Promise<Record<string, unknown> | null>;
                };
            }
        ).datafyManagedTemplate.findFirst({
            where: { id, organizationKey: "default", deletedAt: null },
        });
        if (!row) {
            return NextResponse.json(
                { status: false, message: "Template não encontrado" },
                { status: 404 }
            );
        }
        return NextResponse.json({
            status: true,
            data: {
                item: toApprovalDto(row as never),
                fieldMapOptions: FIELD_MAP_OPTIONS,
            },
        });
    }

    const parsed = listSchema.safeParse({
        q: url.searchParams.get("q") || undefined,
        status: url.searchParams.get("status") || undefined,
        category: url.searchParams.get("category") || undefined,
        language: url.searchParams.get("language") || undefined,
        page: url.searchParams.get("page") || undefined,
        pageSize: url.searchParams.get("pageSize") || undefined,
    });
    if (!parsed.success) {
        return NextResponse.json(
            { status: false, message: "Parâmetros inválidos" },
            { status: 400 }
        );
    }

    try {
        const result = await listSyncedApprovals(parsed.data);
        return NextResponse.json({
            status: true,
            data: {
                items: result.items.map(toApprovalDto),
                total: result.total,
                page: result.page,
                pageSize: result.pageSize,
                counters: result.counters,
                lastSyncAt: result.lastSyncAt,
                wabaId: result.wabaId,
                fieldMapOptions: FIELD_MAP_OPTIONS,
            },
        });
    } catch (e) {
        const message =
            e instanceof DatafyApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "Falha ao listar aprovações";
        return NextResponse.json(
            { status: false, message },
            {
                status:
                    e instanceof DatafyApiError ? e.statusCode || 500 : 500,
            }
        );
    }
}

export async function POST(request: NextRequest) {
    const gate = await requireCampaignEdit(request);
    if (gate.error) return gate.error;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { status: false, message: "JSON inválido" },
            { status: 400 }
        );
    }

    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            {
                status: false,
                message: "Payload inválido",
                data: { issues: parsed.error.issues },
            },
            { status: 400 }
        );
    }

    try {
        if (
            parsed.data.action === "sync" ||
            parsed.data.action === "refresh"
        ) {
            const stats = await syncTemplatesFromDatafy({
                owner: `user_${gate.user!.id}_${Date.now()}`,
            });
            return NextResponse.json({
                status: true,
                data: {
                    stats,
                    message:
                        parsed.data.action === "sync"
                            ? `Sincronização concluída: ${stats.fetched} na Meta, ${stats.imported} importados, ${stats.updated} atualizados.`
                            : `Status atualizados: ${stats.updated} alterações em ${stats.fetched} templates.`,
                },
            });
        }

        if (parsed.data.action === "import_to_library") {
            const row = await importTemplateToLibrary(
                parsed.data.id,
                parsed.data.fieldMappings,
                { loadsPerMessage: parsed.data.loadsPerMessage }
            );
            return NextResponse.json({
                status: true,
                data: {
                    item: toApprovalDto(row),
                    message: "Template importado para a biblioteca local.",
                },
            });
        }

        return NextResponse.json(
            { status: false, message: "Ação desconhecida" },
            { status: 400 }
        );
    } catch (e) {
        const message =
            e instanceof DatafyApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "Falha na operação";
        const code = e instanceof DatafyApiError ? e.statusCode || 500 : 500;
        return NextResponse.json({ status: false, message }, { status: code });
    }
}
