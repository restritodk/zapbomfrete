import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { datafyProvider } from "@/modules/datafy";

/** POST — verify channel token via GET /me (no secrets in response). */
export async function POST(request: NextRequest) {
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

    const result = await datafyProvider.verifyConnection();
    return NextResponse.json(
        {
            status: result.ok,
            message: result.ok
                ? "Conexão Datafy verificada"
                : result.error || "Falha na verificação",
            data: {
                integration: result.status,
                me: result.me
                    ? {
                          phone_number_id: result.me.phone_number_id || null,
                          waba_id: result.me.waba_id || null,
                          business_id: result.me.business_id || null,
                          cliente_id: result.me.cliente_id || null,
                      }
                    : null,
            },
        },
        { status: result.ok ? 200 : 400 }
    );
}
