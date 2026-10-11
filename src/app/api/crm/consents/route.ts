import { NextRequest, NextResponse } from "next/server";
import { requireCrmAccess } from "@/modules/crm/auth-gate";
import {
    getConsentStats,
    listConsentContacts,
} from "@/modules/crm/consent/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireCrmAccess(request);
    if (gate.error) return gate.error;

    try {
        const sp = request.nextUrl.searchParams;
        const tab =
            sp.get("tab") === "granted" ? "granted" : "not_granted";
        const fromRaw = sp.get("from");
        const toRaw = sp.get("to");
        const [stats, list] = await Promise.all([
            getConsentStats(),
            listConsentContacts({
                tab,
                status: sp.get("status"),
                source: sp.get("source"),
                search: sp.get("search"),
                from: fromRaw ? new Date(fromRaw) : null,
                to: toRaw ? new Date(toRaw) : null,
                page: Number(sp.get("page") || 1),
                pageSize: Number(sp.get("pageSize") || 10),
            }),
        ]);
        return NextResponse.json({
            status: true,
            data: { stats, ...list },
        });
    } catch {
        return NextResponse.json(
            { status: false, message: "Falha ao listar consentimentos" },
            { status: 500 }
        );
    }
}
