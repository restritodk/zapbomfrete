import { NextRequest, NextResponse } from "next/server";
import { requireCampaignView } from "@/modules/datafy/campaigns/auth-gate";
import {
    CampaignError,
    listCampaignRecipients,
} from "@/modules/datafy/campaigns/service";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireCampaignView(request);
    if (gate.error) return gate.error;
    try {
        const { id } = await params;
        const sp = new URL(request.url).searchParams;
        const data = await listCampaignRecipients(id, {
            status: sp.get("status") || undefined,
            page: Number(sp.get("page") || 1) || 1,
            limit: Number(sp.get("limit") || 50) || 50,
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
            { status: false, message: "Falha ao listar destinatários" },
            { status: 500 }
        );
    }
}
