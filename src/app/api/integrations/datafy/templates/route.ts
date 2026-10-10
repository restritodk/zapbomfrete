import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { canAccessDatafyChannel } from "@/modules/channels/access";
import { datafyProvider, DatafyApiError } from "@/modules/datafy";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";

/**
 * GET templates — SUPERADMIN or users with operational Datafy channel access.
 * Read-only; never returns credentials.
 */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json(
            { status: false, message: "Unauthorized" },
            { status: 401 }
        );
    }

    const allowed =
        isAdmin(user.role) ||
        (await canAccessDatafyChannel(user.id, user.role));
    if (!allowed) {
        return NextResponse.json(
            { status: false, message: "Forbidden" },
            { status: 403 }
        );
    }

    const { searchParams } = new URL(request.url);
    try {
        const data = await datafyProvider.listTemplates({
            status: searchParams.get("status") || "APPROVED",
            name: searchParams.get("name") || undefined,
            after: searchParams.get("after") || undefined,
            limit: Number(searchParams.get("limit") || 50) || 50,
        });
        return NextResponse.json({ status: true, data });
    } catch (e) {
        const message =
            e instanceof DatafyApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "Falha ao listar templates";
        return NextResponse.json(
            { status: false, message: redactSecrets(message) },
            { status: e instanceof DatafyApiError ? e.statusCode : 500 }
        );
    }
}
