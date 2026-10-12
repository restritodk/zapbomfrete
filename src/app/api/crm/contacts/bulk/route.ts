import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCrmMutate } from "@/modules/crm/auth-gate";
import { canHardDeleteCrm } from "@/modules/crm/access";
import {
    bulkBlockContacts,
    bulkDeleteContacts,
    bulkGrantConsent,
    parseSelectionFromBody,
} from "@/modules/crm/bulk/operations";

export const dynamic = "force-dynamic";

const selectionSchema = z.object({
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

const bodySchema = z.object({
    action: z.enum(["grant_consent", "block", "delete"]),
    selection: selectionSchema,
    evidence: z
        .object({
            evidenceText: z.string().optional(),
            consentSource: z.string().optional(),
            authorizedAt: z.string().optional(),
            purpose: z.string().optional(),
            wabaId: z.string().optional(),
            originLabel: z.string().optional(),
        })
        .optional(),
    blocked: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
    const gate = await requireCrmMutate(request);
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

        const selection = parseSelectionFromBody(parsed.data.selection);
        if (
            selection.mode === "ids" &&
            selection.ids.length === 0
        ) {
            return NextResponse.json(
                { status: false, message: "Nenhum contato selecionado" },
                { status: 400 }
            );
        }

        if (parsed.data.action === "delete") {
            if (!canHardDeleteCrm(gate.user.role)) {
                return NextResponse.json(
                    { status: false, message: "Forbidden" },
                    { status: 403 }
                );
            }
            const result = await bulkDeleteContacts({
                selection,
                actorUserId: gate.user.id,
            });
            return NextResponse.json({ status: true, data: result });
        }

        if (parsed.data.action === "block") {
            const result = await bulkBlockContacts({
                selection,
                actorUserId: gate.user.id,
                blocked: parsed.data.blocked !== false,
            });
            return NextResponse.json({ status: true, data: result });
        }

        // grant_consent
        const result = await bulkGrantConsent({
            selection,
            actorUserId: gate.user.id,
            evidence: parsed.data.evidence || {},
        });
        return NextResponse.json({ status: true, data: result });
    } catch (e) {
        const statusCode =
            typeof e === "object" &&
            e &&
            "statusCode" in e &&
            typeof (e as { statusCode: unknown }).statusCode === "number"
                ? (e as { statusCode: number }).statusCode
                : 500;
        return NextResponse.json(
            {
                status: false,
                message:
                    e instanceof Error
                        ? e.message
                        : "Falha na operação em massa",
            },
            { status: statusCode }
        );
    }
}
