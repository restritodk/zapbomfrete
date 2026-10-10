import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { canEditDatafyCampaigns } from "@/modules/datafy/campaigns/access";
import {
    draftToHandoff,
    getBulletinDraft,
    updateBulletinDraft,
} from "@/modules/datafy/campaigns/bulletin/draft-service";
import { serializeBulletinDraft } from "@/modules/datafy/campaigns/bulletin/analyze";
import type { BulletinLoad } from "@/modules/datafy/campaigns/bulletin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Confirm draft + return handoff payload for Disparo em massa.
 * Does NOT start a real campaign send.
 */
export async function POST(
    _request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role || "";
    if (!(await canEditDatafyCampaigns(session.user.id, role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const row = await getBulletinDraft(id);
    if (!row) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const loads = (Array.isArray(row.loads) ? row.loads : []) as BulletinLoad[];
    if (!loads.length) {
        return NextResponse.json(
            { error: "Confirme ao menos uma carga antes de preparar a campanha." },
            { status: 400 }
        );
    }

    const general = {
        title: row.title,
        operationType: row.operationType || undefined,
        groupUrl: row.groupUrl || undefined,
        referenceDate: row.referenceDate || undefined,
        generalNotes: row.generalNotes || undefined,
    };
    const rawText = serializeBulletinDraft({ general, loads });

    const updated = await updateBulletinDraft(id, {
        general,
        loads,
        rawText,
        status: "confirmed",
    });

    if (!updated) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const handoff = draftToHandoff(updated);
    return NextResponse.json({
        status: true,
        handoff,
        redirectTo: "/dashboard/broadcast?bulletin=1",
        note: "Nenhum disparo real foi iniciado. Selecione o público e autorize o envio no wizard de campanhas.",
    });
}
