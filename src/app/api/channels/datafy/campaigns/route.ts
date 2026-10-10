import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
    requireCampaignEdit,
    requireCampaignView,
} from "@/modules/datafy/campaigns/auth-gate";
import {
    CampaignError,
    createCampaign,
    listCampaigns,
} from "@/modules/datafy/campaigns/service";
import { CAMPAIGN_PURPOSES } from "@/modules/datafy/campaigns/constants";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireCampaignView(request);
    if (gate.error) return gate.error;

    const sp = new URL(request.url).searchParams;
    try {
        const data = await listCampaigns({
            status: sp.get("status") || undefined,
            search: sp.get("search") || undefined,
            page: Number(sp.get("page") || 1) || 1,
            limit: Number(sp.get("limit") || 20) || 20,
        });
        return NextResponse.json({ status: true, data });
    } catch (e) {
        if (e instanceof CampaignError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao listar campanhas" },
            { status: 500 }
        );
    }
}

const createSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    purpose: z.enum(CAMPAIGN_PURPOSES).optional(),
    templateName: z.string().max(200).nullable().optional(),
    templateLanguage: z.string().max(20).nullable().optional(),
    templateCategory: z.string().max(40).nullable().optional(),
    templateComponents: z.unknown().optional(),
    templateApprovalStatus: z.string().max(40).nullable().optional(),
    contentSource: z.string().max(40).optional(),
    contentKind: z.enum(["message", "bulletin"]).optional(),
    messageBody: z.string().max(100_000).nullable().optional(),
    messageParts: z.unknown().optional(),
    bulletinMeta: z.unknown().optional(),
    headerImageUrl: z.string().max(2000).nullable().optional(),
    headerImageHandle: z.string().max(2000).nullable().optional(),
    variableMapping: z.unknown().optional(),
    segmentFilter: z
        .object({
            selectAllEligible: z.boolean().optional(),
            source: z.enum(["import", "crm", "groups"]).optional(),
            phones: z.array(z.string()).max(20000).optional(),
            contactIds: z.array(z.string()).optional(),
            tagIds: z.array(z.string()).optional(),
            category: z.string().nullable().optional(),
            city: z.string().nullable().optional(),
            state: z.string().nullable().optional(),
            company: z.string().nullable().optional(),
            origin: z.string().nullable().optional(),
            search: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    timezone: z.string().max(80).optional(),
    scheduledAt: z.string().nullable().optional(),
    delayMs: z.number().int().optional(),
    batchSize: z.number().int().optional(),
    dryRun: z.boolean().optional(),
    requireConsent: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
    const gate = await requireCampaignEdit(request);
    if (gate.error) return gate.error;

    try {
        const body = await request.json().catch(() => null);
        const parsed = createSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Payload inválido" },
                { status: 400 }
            );
        }
        const campaign = await createCampaign(parsed.data, gate.user.id);
        return NextResponse.json({ status: true, data: { campaign } });
    } catch (e) {
        if (e instanceof CampaignError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao criar campanha" },
            { status: 500 }
        );
    }
}
