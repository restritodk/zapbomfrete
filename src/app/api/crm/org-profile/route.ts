import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { CRM_ORG_DEFAULT } from "@/modules/crm/constants";
import {
    getOrgSenderProfile,
    resolveSenderVariableFields,
    setOrgSenderProfile,
} from "@/modules/crm/org-profile";

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json(
            { status: false, message: "Unauthorized" },
            { status: 401 }
        );
    }
    const profile = await getOrgSenderProfile(CRM_ORG_DEFAULT);
    const resolved = await resolveSenderVariableFields(CRM_ORG_DEFAULT);
    return NextResponse.json({
        status: true,
        data: {
            profile,
            resolved,
            note:
                "O nome exibido no cabeçalho do WhatsApp (ex.: «Usuário desconhecido») é o verified_name da Meta Business Manager — não pode ser alterado só pelo ZapBomFrete. Use o campo Nome comercial abaixo para {{company}} nas mensagens.",
        },
    });
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
            { status: false, message: "Sem permissão." },
            { status: 403 }
        );
    }
    const body = await request.json().catch(() => ({}));
    const result = await setOrgSenderProfile({
        organizationKey: CRM_ORG_DEFAULT,
        companyName:
            body.companyName !== undefined ? body.companyName : undefined,
        city: body.city !== undefined ? body.city : undefined,
        state: body.state !== undefined ? body.state : undefined,
        defaultGroupInviteUrl:
            body.defaultGroupInviteUrl !== undefined
                ? body.defaultGroupInviteUrl
                : undefined,
        actorUserId: user.id,
    });
    if (!result.ok) {
        return NextResponse.json(
            { status: false, message: result.error },
            { status: 400 }
        );
    }
    const resolved = await resolveSenderVariableFields(CRM_ORG_DEFAULT);
    return NextResponse.json({
        status: true,
        data: { profile: result.profile, resolved },
    });
}
