import { NextRequest, NextResponse } from "next/server";
import { requireDatafyChatAccess } from "@/modules/datafy/chat/auth-gate";
import { listDatafyConversations } from "@/modules/datafy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireDatafyChatAccess(request);
    if (gate.error) return gate.error;

    const { searchParams } = new URL(request.url);
    const data = await listDatafyConversations({
        search: searchParams.get("search") || undefined,
        cursor: searchParams.get("cursor"),
        limit: Number(searchParams.get("limit") || 40) || 40,
    });

    return NextResponse.json({ status: true, data });
}
