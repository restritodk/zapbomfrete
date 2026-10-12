import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
    requireCampaignEdit,
    requireCampaignView,
} from "@/modules/datafy/campaigns/auth-gate";
import { composeReusableBulletinParts } from "@/modules/datafy/campaigns/bulletin/templates";
import { analyzeBulletinSafe } from "@/modules/datafy/campaigns/bulletin/draft-service";
import {
    listEffectiveManagedTemplates,
    managedToSpecs,
} from "@/modules/datafy/campaigns/bulletin/managed-registry";
import { datafyProvider } from "@/modules/datafy";
import type { CampaignMessagePart } from "@/modules/datafy/campaigns/bulletin/types";
import {
    associateTemplateToCard,
    buildCampaignPartsForVersion,
    createBulletinFromOrphanTemplates,
    createBulletinVersionFromParts,
    getBulletinVersionDetail,
    listGroupedBulletins,
    listOrphanManagedTemplates,
    tryAutoLinkOrphansByExactComposeMatch,
} from "@/modules/datafy/campaigns/bulletin/grouping-service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireCampaignView(request);
    if (gate.error) return gate.error;

    const sp = new URL(request.url).searchParams;
    const versionId = sp.get("versionId");
    const orphans = sp.get("orphans") === "1";

    try {
        if (orphans) {
            const items = await listOrphanManagedTemplates();
            return NextResponse.json({ status: true, data: { orphans: items } });
        }
        if (versionId) {
            const detail = await getBulletinVersionDetail(versionId);
            if (!detail) {
                return NextResponse.json(
                    { status: false, message: "Versão não encontrada" },
                    { status: 404 }
                );
            }
            return NextResponse.json({ status: true, data: { version: detail } });
        }
        const data = await listGroupedBulletins({
            onlyFullyApproved: sp.get("approved") === "1",
            includeHistory: sp.get("history") !== "0",
        });
        return NextResponse.json({ status: true, data });
    } catch (e) {
        return NextResponse.json(
            {
                status: false,
                message:
                    e instanceof Error ? e.message : "Falha ao listar boletins",
            },
            { status: 500 }
        );
    }
}

const createSchema = z.object({
    action: z.literal("create_version"),
    title: z.string().min(1).max(300),
    rawText: z.string().min(1).max(100_000),
    loads: z.unknown().optional(),
    loadCount: z.number().int().min(0).optional(),
    parts: z.array(z.unknown()).optional(),
    bundleId: z.string().nullable().optional(),
    draftId: z.string().nullable().optional(),
    purpose: z.string().optional(),
});

const associateSchema = z.object({
    action: z.literal("associate"),
    cardId: z.string().min(1),
    managedTemplateId: z.string().min(1),
});

const prepareSchema = z.object({
    action: z.literal("prepare_campaign"),
    versionId: z.string().min(1),
    mode: z.enum(["complete_bulletin", "single_card"]),
    cardPosition: z.number().int().min(1).nullable().optional(),
});

const autoLinkSchema = z.object({
    action: z.literal("auto_link"),
    versionId: z.string().min(1),
});

const createFromOrphansSchema = z.object({
    action: z.literal("create_from_orphans"),
    title: z.string().min(1).max(300),
    managedTemplateIds: z.array(z.string().min(1)).min(1).max(40),
    bundleId: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
    const gate = await requireCampaignEdit(request);
    if (gate.error) return gate.error;

    try {
        const body = await request.json().catch(() => null);
        const action = body?.action;

        if (action === "create_version") {
            const parsed = createSchema.safeParse(body);
            if (!parsed.success) {
                return NextResponse.json(
                    { status: false, message: "Payload inválido" },
                    { status: 400 }
                );
            }
            const analysis = analyzeBulletinSafe(parsed.data.rawText);
            const managedLib = managedToSpecs(
                await listEffectiveManagedTemplates()
            );

            let parts = (parsed.data.parts || []) as CampaignMessagePart[];
            if (!parts.length) {
                let approved: Array<{
                    name: string;
                    language: string;
                    status: string;
                    category?: string;
                    components?: unknown[];
                }> = [];
                try {
                    const templates = await datafyProvider.listTemplates({
                        status: "APPROVED",
                        limit: 100,
                    });
                    approved = (templates.data || []).map((t) => ({
                        name: t.name,
                        language: t.language || "pt_BR",
                        status: t.status,
                        category: t.category,
                        components: t.components,
                    }));
                } catch {
                    approved = managedLib
                        .filter(() => true)
                        .map((s) => ({
                            name: s.preferredName,
                            language: "pt_BR",
                            status: "APPROVED",
                            category: s.recommendedCategory,
                        }));
                }
                parts = composeReusableBulletinParts(analysis, approved, {
                    purpose: parsed.data.purpose || "marketing",
                    library: managedLib,
                });
            }

            const created = await createBulletinVersionFromParts({
                title: parsed.data.title || analysis.title,
                rawText: parsed.data.rawText,
                loads: parsed.data.loads ?? analysis.loads,
                loadCount: parsed.data.loadCount ?? analysis.loadCount,
                parts,
                userId: gate.user.id,
                bundleId: parsed.data.bundleId,
                draftId: parsed.data.draftId,
            });

            await tryAutoLinkOrphansByExactComposeMatch({
                versionId: created.version.id,
            });

            const detail = await getBulletinVersionDetail(created.version.id);
            return NextResponse.json({
                status: true,
                data: {
                    bundle: created.bundle,
                    version: detail,
                },
            });
        }

        if (action === "associate") {
            const parsed = associateSchema.safeParse(body);
            if (!parsed.success) {
                return NextResponse.json(
                    { status: false, message: "Payload inválido" },
                    { status: 400 }
                );
            }
            const card = await associateTemplateToCard({
                cardId: parsed.data.cardId,
                managedTemplateId: parsed.data.managedTemplateId,
            });
            return NextResponse.json({ status: true, data: { card } });
        }

        if (action === "prepare_campaign") {
            const parsed = prepareSchema.safeParse(body);
            if (!parsed.success) {
                return NextResponse.json(
                    { status: false, message: "Payload inválido" },
                    { status: 400 }
                );
            }
            const prepared = await buildCampaignPartsForVersion({
                versionId: parsed.data.versionId,
                mode: parsed.data.mode,
                cardPosition: parsed.data.cardPosition,
            });
            return NextResponse.json({ status: true, data: prepared });
        }

        if (action === "auto_link") {
            const parsed = autoLinkSchema.safeParse(body);
            if (!parsed.success) {
                return NextResponse.json(
                    { status: false, message: "Payload inválido" },
                    { status: 400 }
                );
            }
            const linked = await tryAutoLinkOrphansByExactComposeMatch({
                versionId: parsed.data.versionId,
            });
            const detail = await getBulletinVersionDetail(parsed.data.versionId);
            return NextResponse.json({
                status: true,
                data: { linked, version: detail },
            });
        }

        if (action === "create_from_orphans") {
            const parsed = createFromOrphansSchema.safeParse(body);
            if (!parsed.success) {
                return NextResponse.json(
                    { status: false, message: "Payload inválido" },
                    { status: 400 }
                );
            }
            const created = await createBulletinFromOrphanTemplates({
                title: parsed.data.title,
                managedTemplateIds: parsed.data.managedTemplateIds,
                bundleId: parsed.data.bundleId,
                userId: gate.user.id,
            });
            const detail = await getBulletinVersionDetail(created.version.id);
            return NextResponse.json({
                status: true,
                data: {
                    bundle: created.bundle,
                    version: detail,
                },
            });
        }

        return NextResponse.json(
            { status: false, message: "Ação desconhecida" },
            { status: 400 }
        );
    } catch (e) {
        return NextResponse.json(
            {
                status: false,
                message: e instanceof Error ? e.message : "Falha na operação",
            },
            { status: 400 }
        );
    }
}
