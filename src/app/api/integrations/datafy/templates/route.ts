import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { DatafyApiError, datafyProvider, redactSecrets } from "@/modules/datafy";

/** GET — list Meta templates via Datafy (Phase 1 read-only). */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json(
            { status: false, message: "Unauthorized" },
            { status: 401 }
        );
    }
    if (!isAdmin(user.role)) {
        return NextResponse.json(
            { status: false, message: "Forbidden" },
            { status: 403 }
        );
    }

    try {
        const { searchParams } = new URL(request.url);
        const templates = await datafyProvider.listTemplates({
            status: searchParams.get("status") || "APPROVED",
            name: searchParams.get("name") || undefined,
            after: searchParams.get("after") || undefined,
            limit: searchParams.get("limit")
                ? Number(searchParams.get("limit"))
                : 50,
        });

        return NextResponse.json({
            status: true,
            data: templates,
        });
    } catch (e) {
        const statusCode = e instanceof DatafyApiError ? e.statusCode : 500;
        const raw =
            e instanceof Error ? e.message : "Falha ao listar templates";
        const message = redactSecrets(raw).slice(0, 240);
        return NextResponse.json(
            { status: false, message },
            { status: statusCode >= 400 && statusCode < 600 ? statusCode : 500 }
        );
    }
}
