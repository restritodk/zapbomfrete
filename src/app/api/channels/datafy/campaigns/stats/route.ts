import { NextRequest, NextResponse } from "next/server";
import { requireCampaignView } from "@/modules/datafy/campaigns/auth-gate";
import { getCampaignStats } from "@/modules/datafy/campaigns/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireCampaignView(request);
    if (gate.error) return gate.error;
    const stats = await getCampaignStats();
    return NextResponse.json({ status: true, data: { stats } });
}
