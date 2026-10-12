import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { CRM_ORG_DEFAULT } from "@/modules/crm/constants";
import {
    getOrgGroupInviteSettings,
    setOrgGroupInviteSettings,
} from "@/modules/crm/group-invite/org-settings";

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json(
            { status: false, message: "Unauthorized" },
            { status: 401 }
        );
    }
    const settings = await getOrgGroupInviteSettings(CRM_ORG_DEFAULT);
    return NextResponse.json({ status: true, data: { settings } });
}

export async function PUT(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json(
            { status: false, message: "Unauthorized" },
            { status: 401 }
        );
    }
    if (!["OWNER", "SUPERADMIN"].includes(String(user.role))) {
        return NextResponse.json(
            { status: false, message: "Sem permissão para alterar o link do grupo." },
            { status: 403 }
        );
    }
    const body = await request.json().catch(() => ({}));
    const url =
        body.defaultGroupInviteUrl === null ||
        body.defaultGroupInviteUrl === undefined
            ? null
            : String(body.defaultGroupInviteUrl || "");
    const result = await setOrgGroupInviteSettings({
        organizationKey: CRM_ORG_DEFAULT,
        defaultGroupInviteUrl: url,
        actorUserId: user.id,
    });
    if (!result.ok) {
        return NextResponse.json(
            { status: false, message: result.error },
            { status: 400 }
        );
    }
    return NextResponse.json({
        status: true,
        data: { settings: result.settings },
    });
}
