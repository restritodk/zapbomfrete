import { NextRequest, NextResponse } from "next/server";
import { requireCampaignView } from "@/modules/datafy/campaigns/auth-gate";
import {
    CampaignError,
    exportCampaignCsv,
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
        const csv = await exportCampaignCsv(id);
        return new NextResponse(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="campaign-${id}.csv"`,
            },
        });
    } catch (e) {
        if (e instanceof CampaignError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha na exportação" },
            { status: 500 }
        );
    }
}
