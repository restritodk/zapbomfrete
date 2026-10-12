import { NextRequest, NextResponse } from "next/server";
import { requireDatafyChatAccess } from "@/modules/datafy/chat/auth-gate";
import { getPremiumDatafyDashboard } from "@/modules/datafy/chat/dashboard-panel";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireDatafyChatAccess(request);
    if (gate.error) return gate.error;

    try {
        const sp = new URL(request.url).searchParams;
        const data = await getPremiumDatafyDashboard({
            period: sp.get("period") || "7d",
            from: sp.get("from"),
            to: sp.get("to"),
        });
        return NextResponse.json({ status: true, data });
    } catch (e) {
        return NextResponse.json(
            {
                status: false,
                message:
                    e instanceof Error
                        ? e.message
                        : "Falha ao carregar painel",
            },
            { status: 500 }
        );
    }
}
