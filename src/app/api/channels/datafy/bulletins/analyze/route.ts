import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { canEditDatafyCampaigns } from "@/modules/datafy/campaigns/access";
import { analyzeBulletinSafe } from "@/modules/datafy/campaigns/bulletin/draft-service";
import {
    analysisToEditableDraft,
    composeReusableBulletinParts,
} from "@/modules/datafy/campaigns/bulletin";
import { datafyProvider } from "@/modules/datafy";
import { BULLETIN_IMPORT_MAX_CHARS } from "@/modules/datafy/campaigns/bulletin/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
    rawText: z.string().min(1).max(BULLETIN_IMPORT_MAX_CHARS),
    includePartsPreview: z.boolean().optional(),
});

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
    const parsed = bodySchema.safeParse(json);
    if (!parsed.success) {
        return NextResponse.json(
            { error: "Payload inválido", details: parsed.error.flatten() },
            { status: 400 }
        );
    }

    const analysis = analyzeBulletinSafe(parsed.data.rawText);
    const draft = analysisToEditableDraft(analysis);

    let partsPreview = null;
    if (parsed.data.includePartsPreview) {
        try {
            const templates = await datafyProvider.listTemplates({
                status: "APPROVED",
                limit: 100,
            });
            partsPreview = composeReusableBulletinParts(
                analysis,
                (templates.data || []).map((t) => ({
                    name: t.name,
                    language: t.language || "pt_BR",
                    status: t.status,
                    category: t.category,
                    components: t.components,
                })),
                { purpose: "marketing" }
            );
        } catch {
            partsPreview = composeReusableBulletinParts(analysis, [], {
                purpose: "marketing",
            });
        }
    }

    return NextResponse.json({
        status: true,
        analysis: {
            title: analysis.title,
            loadCount: analysis.loadCount,
            partCount: analysis.partCount,
            warnings: analysis.warnings,
            totalChars: analysis.totalChars,
            unrecognizedLines: analysis.unrecognizedLines,
            general: analysis.general,
        },
        draft,
        partsPreview,
    });
}
