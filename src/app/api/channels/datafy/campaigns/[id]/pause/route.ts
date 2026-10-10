import { NextRequest, NextResponse } from "next/server";
import { requireCampaignLaunch } from "@/modules/datafy/campaigns/auth-gate";
import {
    CampaignError,
    pauseCampaign,
} from "@/modules/datafy/campaigns/service";

export const dynamic = "force-dynamic";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireCampaignLaunch(request);
    if (gate.error) return gate.error;
    try {
        const { id } = await params;
        const campaign = await pauseCampaign(id, gate.user.id);
        return NextResponse.json({ status: true, data: { campaign } });
    } catch (e) {
        if (e instanceof CampaignError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao pausar" },
            { status: 500 }
        );
    }
}
