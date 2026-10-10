import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canEditDatafyCampaigns } from "@/modules/datafy/campaigns/access";
import {
    createBulletinDraft,
    listBulletinDrafts,
} from "@/modules/datafy/campaigns/bulletin/draft-service";
import { BULLETIN_IMPORT_MAX_CHARS } from "@/modules/datafy/campaigns/bulletin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createSchema = z.object({
    rawText: z.string().min(1).max(BULLETIN_IMPORT_MAX_CHARS),
    draft: z
        .object({
            rawText: z.string(),
            general: z.object({
                title: z.string(),
                operationType: z.string().optional(),
                groupUrl: z.string().optional(),
                referenceDate: z.string().optional(),
                generalNotes: z.string().optional(),
            }),
            loads: z.array(z.unknown()),
            warnings: z.array(z.string()),
            confirmed: z.boolean(),
        })
        .optional(),
});

export async function GET() {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role || "";
    if (!(await canEditDatafyCampaigns(session.user.id, role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const items = await listBulletinDrafts();
    return NextResponse.json({ status: true, drafts: items });
}

export async function POST(request: NextRequest) {
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role || "";
    if (!(await canEditDatafyCampaigns(session.user.id, role))) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let json: unknown;
    try {
        json = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const parsed = createSchema.safeParse(json);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Payload inválido", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const row = await createBulletinDraft({
        userId: session.user.id,
        rawText: parsed.data.rawText,
        draft: parsed.data.draft as Parameters<
            typeof createBulletinDraft
        >[0]["draft"],
    });

    return NextResponse.json({ status: true, draft: row });
}
