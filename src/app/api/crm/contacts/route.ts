import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCrmAccess, requireCrmMutate } from "@/modules/crm/auth-gate";
import {
    CrmError,
    createCrmContact,
    listCrmContacts,
} from "@/modules/crm/service";
import { CRM_CATEGORIES, CRM_CONSENT_STATUSES } from "@/modules/crm/constants";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireCrmAccess(request);
    if (gate.error) return gate.error;

    const sp = new URL(request.url).searchParams;
    const activeParam = sp.get("active");
    const tagIds = sp.getAll("tagId").filter(Boolean);

    try {
        const data = await listCrmContacts({
            search: sp.get("search") || undefined,
            company: sp.get("company") || undefined,
            city: sp.get("city") || undefined,
            state: sp.get("state") || undefined,
            category: sp.get("category") || undefined,
            origin: sp.get("origin") || undefined,
            consentStatus: sp.get("consentStatus") || undefined,
            tagIds: tagIds.length ? tagIds : undefined,
            active:
                activeParam === "all"
                    ? "all"
                    : activeParam === "false"
                      ? false
                      : activeParam === "true"
                        ? true
                        : undefined,
            page: Number(sp.get("page") || 1) || 1,
            limit: Number(sp.get("limit") || 20) || 20,
        });
        return NextResponse.json({ status: true, data });
    } catch (e) {
        if (e instanceof CrmError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao listar contatos" },
            { status: 500 }
        );
    }
}

const postSchema = z.object({
    waId: z.string().min(8),
    fullName: z.string().max(200).nullable().optional(),
    company: z.string().max(200).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(2).nullable().optional(),
    category: z.enum(CRM_CATEGORIES).nullable().optional(),
    notes: z.string().max(5000).nullable().optional(),
    consentStatus: z.enum(CRM_CONSENT_STATUSES).optional(),
    consentSource: z.string().max(120).nullable().optional(),
    tagIds: z.array(z.string()).optional(),
    tagNames: z.array(z.string()).optional(),
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
        const contact = await createCrmContact(
            { ...parsed.data, origin: "manual" },
            gate.user.id
        );
        return NextResponse.json({ status: true, data: { contact } });
    } catch (e) {
        if (e instanceof CrmError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao criar contato" },
            { status: 500 }
        );
    }
}
