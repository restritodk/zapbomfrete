import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
    requireCampaignEdit,
    requireCampaignView,
} from "@/modules/datafy/campaigns/auth-gate";
import {
    CampaignError,
    getCampaign,
    updateCampaign,
} from "@/modules/datafy/campaigns/service";
import { CAMPAIGN_PURPOSES } from "@/modules/datafy/campaigns/constants";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireCampaignView(request);
    if (gate.error) return gate.error;
    try {
        const { id } = await params;
        const data = await getCampaign(id);
        return NextResponse.json({ status: true, data });
    } catch (e) {
        if (e instanceof CampaignError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao carregar campanha" },
            { status: 500 }
        );
    }
}

const putSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    purpose: z.enum(CAMPAIGN_PURPOSES).optional(),
    templateName: z.string().max(200).nullable().optional(),
    templateLanguage: z.string().max(20).nullable().optional(),
    templateCategory: z.string().max(40).nullable().optional(),
    templateComponents: z.unknown().optional(),
    variableMapping: z.unknown().optional(),
    segmentFilter: z
        .object({
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
    delayMs: z
        .number()
        .int()
        .min(3_000)
        .max(60_000)
        .optional(),
    batchSize: z.number().int().optional(),
    dryRun: z.boolean().optional(),
    requireConsent: z.boolean().optional(),
});

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireCampaignEdit(request);
    if (gate.error) return gate.error;
    try {
        const { id } = await params;
        const body = await request.json().catch(() => null);
        const parsed = putSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Payload inválido" },
                { status: 400 }
            );
        }
        const campaign = await updateCampaign(id, parsed.data, gate.user.id);
        return NextResponse.json({ status: true, data: { campaign } });
    } catch (e) {
        if (e instanceof CampaignError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao atualizar campanha" },
            { status: 500 }
        );
    }
}
