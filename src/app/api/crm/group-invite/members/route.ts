import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { CRM_ORG_DEFAULT } from "@/modules/crm/constants";
import {
    confirmGroupInviteJoin,
    listGroupInviteMembers,
} from "@/modules/crm/group-invite/events";

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json(
            { status: false, message: "Unauthorized" },
            { status: 401 }
        );
    }
    const sp = request.nextUrl.searchParams;
    const status = sp.get("status") || "all";
    const data = await listGroupInviteMembers({
        organizationKey: CRM_ORG_DEFAULT,
        status:
            status === "clicked" || status === "joined" ? status : "all",
        q: sp.get("q") || "",
        limit: Number(sp.get("limit") || 200),
    });
    return NextResponse.json({ status: true, data });
}

const confirmSchema = z.object({
    action: z.literal("confirm_join"),
    waId: z.string().min(8).max(40),
    evidenceText: z.string().min(8).max(2000),
    inviteUrl: z.string().max(500).nullable().optional(),
});

export async function POST(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json(
            { status: false, message: "Unauthorized" },
            { status: 401 }
        );
    }
    const body = await request.json().catch(() => ({}));
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { status: false, message: "Payload inválido" },
            { status: 400 }
        );
    }
    const result = await confirmGroupInviteJoin({
        organizationKey: CRM_ORG_DEFAULT,
        waId: parsed.data.waId,
        evidenceText: parsed.data.evidenceText,
        inviteUrl: parsed.data.inviteUrl || null,
        actorUserId: user.id,
    });
    if (!result.ok) {
        return NextResponse.json(
            { status: false, message: result.message },
            { status: 400 }
        );
    }
    return NextResponse.json({
        status: true,
        data: { decisionId: result.decisionId },
    });
}
