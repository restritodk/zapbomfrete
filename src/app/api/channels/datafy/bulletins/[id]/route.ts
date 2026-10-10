import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canEditDatafyCampaigns } from "@/modules/datafy/campaigns/access";
import {
    deleteBulletinDraft,
    getBulletinDraft,
    updateBulletinDraft,
} from "@/modules/datafy/campaigns/bulletin/draft-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
    general: z
        .object({
            title: z.string().min(1).max(200),
            operationType: z.string().max(120).optional(),
            groupUrl: z.string().max(500).optional(),
            referenceDate: z.string().max(80).optional(),
            generalNotes: z.string().max(4000).optional(),
        })
        .optional(),
    loads: z.array(z.unknown()).max(200).optional(),
    warnings: z.array(z.string()).optional(),
    rawText: z.string().max(100_000).optional(),
    status: z.enum(["draft", "confirmed", "archived"]).optional(),
});

async function requireEditor() {
    const session = await auth();
    if (!session?.user?.id) {
        return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    }
    const role = (session.user as { role?: string }).role || "";
    if (!(await canEditDatafyCampaigns(session.user.id, role))) {
        return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return { session };
}

export async function GET(
    _request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
) {
    const gate = await requireEditor();
    if ("error" in gate && gate.error) return gate.error;
    const { id } = await ctx.params;
    const row = await getBulletinDraft(id);
    if (!row) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ status: true, draft: row });
}

export async function PATCH(
    request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
) {
    const gate = await requireEditor();
    if ("error" in gate && gate.error) return gate.error;
    const { id } = await ctx.params;

    let json: unknown;
    try {
        json = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Payload inválido", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const row = await updateBulletinDraft(id, {
        general: parsed.data.general,
        loads: parsed.data.loads as Parameters<typeof updateBulletinDraft>[1]["loads"],
        warnings: parsed.data.warnings,
        rawText: parsed.data.rawText,
        status: parsed.data.status,
    });
    if (!row) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ status: true, draft: row });
}

export async function DELETE(
    _request: NextRequest,
    ctx: { params: Promise<{ id: string }> }
) {
    const gate = await requireEditor();
    if ("error" in gate && gate.error) return gate.error;
    const { id } = await ctx.params;
    try {
        await deleteBulletinDraft(id);
    } catch {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ status: true });
}
