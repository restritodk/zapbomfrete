import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCampaignEdit } from "@/modules/datafy/campaigns/auth-gate";
import { previewCampaignAudience } from "@/modules/datafy/campaigns/service";
import { CAMPAIGN_PURPOSES } from "@/modules/datafy/campaigns/constants";

export const dynamic = "force-dynamic";

const schema = z.object({
    purpose: z.enum(CAMPAIGN_PURPOSES).optional(),
    requireConsent: z.boolean().optional(),
    segmentFilter: z.object({
        contactIds: z.array(z.string()).optional(),
        tagIds: z.array(z.string()).optional(),
        category: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        state: z.string().nullable().optional(),
        company: z.string().nullable().optional(),
        origin: z.string().nullable().optional(),
        search: z.string().nullable().optional(),
    }),
});

export async function POST(request: NextRequest) {
    const gate = await requireCampaignEdit(request);
    if (gate.error) return gate.error;

    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { status: false, message: "Payload inválido" },
            { status: 400 }
        );
    }

    const data = await previewCampaignAudience(parsed.data.segmentFilter, {
        purpose: parsed.data.purpose || "marketing",
        requireConsent: parsed.data.requireConsent !== false,
    });
    return NextResponse.json({ status: true, data });
}
