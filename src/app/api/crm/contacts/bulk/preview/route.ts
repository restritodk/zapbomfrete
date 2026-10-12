import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCrmAccess } from "@/modules/crm/auth-gate";
import {
    parseSelectionFromBody,
    previewBulkSelection,
} from "@/modules/crm/bulk/operations";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
    mode: z.enum(["ids", "filters"]),
    ids: z.array(z.string()).optional(),
    excludeIds: z.array(z.string()).optional(),
    filters: z
        .object({
            search: z.string().optional(),
            company: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            category: z.string().optional(),
            origin: z.string().optional(),
            active: z.union([z.boolean(), z.literal("all")]).optional(),
            consentStatus: z.string().optional(),
            tagIds: z.array(z.string()).optional(),
            blocked: z.union([z.boolean(), z.literal("all")]).optional(),
        })
        .optional(),
});

export async function POST(request: NextRequest) {
    const gate = await requireCrmAccess(request);
    if (gate.error) return gate.error;

    try {
        const body = await request.json().catch(() => null);
        const parsed = bodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Payload inválido" },
                { status: 400 }
            );
        }
        const selection = parseSelectionFromBody(parsed.data);
        const data = await previewBulkSelection(selection);
        return NextResponse.json({ status: true, data });
    } catch {
        return NextResponse.json(
            { status: false, message: "Falha ao pré-visualizar seleção" },
            { status: 500 }
        );
    }
}
