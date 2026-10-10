import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCrmAccess, requireCrmMutate } from "@/modules/crm/auth-gate";
import { CrmError, createCrmTag, listCrmTags } from "@/modules/crm/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireCrmAccess(request);
    if (gate.error) return gate.error;
    const tags = await listCrmTags();
    return NextResponse.json({ status: true, data: { tags } });
}

const postSchema = z.object({
    name: z.string().min(1).max(80),
    colorHex: z.string().max(16).optional(),
});

export async function POST(request: NextRequest) {
    const gate = await requireCrmMutate(request);
    if (gate.error) return gate.error;

    try {
        const body = await request.json().catch(() => null);
        const parsed = postSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Payload inválido" },
                { status: 400 }
            );
        }
        const tag = await createCrmTag(parsed.data.name, parsed.data.colorHex);
        return NextResponse.json({ status: true, data: { tag } });
    } catch (e) {
        if (e instanceof CrmError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao criar etiqueta" },
            { status: 500 }
        );
    }
}
