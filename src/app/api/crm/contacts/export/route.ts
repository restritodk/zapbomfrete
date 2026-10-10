import { NextRequest, NextResponse } from "next/server";
import { requireCrmAccess } from "@/modules/crm/auth-gate";
import { exportCrmContactsCsv } from "@/modules/crm/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireCrmAccess(request);
    if (gate.error) return gate.error;

    const csv = await exportCrmContactsCsv();
    return new NextResponse(csv, {
        status: 200,
        headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="crm-contatos-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
    });
}
