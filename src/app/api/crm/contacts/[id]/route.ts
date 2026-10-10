import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCrmAccess, requireCrmMutate } from "@/modules/crm/auth-gate";
import {
    CrmError,
    deleteCrmContact,
    getCrmContact,
    updateCrmContact,
} from "@/modules/crm/service";
import { canHardDeleteCrm } from "@/modules/crm/access";
import { CRM_CATEGORIES, CRM_CONSENT_STATUSES } from "@/modules/crm/constants";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireCrmAccess(request);
    if (gate.error) return gate.error;

    try {
        const { id } = await params;
        const data = await getCrmContact(id);
        return NextResponse.json({ status: true, data });
    } catch (e) {
        if (e instanceof CrmError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao carregar contato" },
            { status: 500 }
        );
    }
}

const putSchema = z.object({
    waId: z.string().min(8).optional(),
    fullName: z.string().max(200).nullable().optional(),
    company: z.string().max(200).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(2).nullable().optional(),
    category: z.enum(CRM_CATEGORIES).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    active: z.boolean().optional(),
    consentStatus: z.enum(CRM_CONSENT_STATUSES).optional(),
    consentSource: z.string().max(120).nullable().optional(),
    optOut: z.boolean().optional(),
    clearOptOut: z.boolean().optional(),
    tagIds: z.array(z.string()).optional(),
    tagNames: z.array(z.string()).optional(),
});

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireCrmMutate(request);
    if (gate.error) return gate.error;

    try {
        const { id } = await params;
        const body = await request.json().catch(() => null);
        const parsed = putSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { status: false, message: "Payload inválido" },
                { status: 400 }
            );
        }
        const contact = await updateCrmContact(id, parsed.data, gate.user.id);
        return NextResponse.json({ status: true, data: { contact } });
    } catch (e) {
        if (e instanceof CrmError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao atualizar contato" },
            { status: 500 }
        );
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const gate = await requireCrmMutate(request);
    if (gate.error) return gate.error;
    if (!canHardDeleteCrm(gate.user.role)) {
        return NextResponse.json(
            { status: false, message: "Forbidden" },
            { status: 403 }
        );
    }

    try {
        const { id } = await params;
        const result = await deleteCrmContact(id);
        return NextResponse.json({ status: true, data: result });
    } catch (e) {
        if (e instanceof CrmError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao excluir contato" },
            { status: 500 }
        );
    }
}
