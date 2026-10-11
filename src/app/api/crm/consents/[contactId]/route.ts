import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCrmAccess, requireCrmMutate } from "@/modules/crm/auth-gate";
import { canManageConsents } from "@/modules/crm/consent/access";
import { recordManualConsent } from "@/modules/crm/consent/decisions";
import { getConsentDetail } from "@/modules/crm/consent/service";

export const dynamic = "force-dynamic";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ contactId: string }> }
) {
    const gate = await requireCrmAccess(request);
    if (gate.error) return gate.error;

    try {
        const { contactId } = await params;
        const data = await getConsentDetail(contactId);
        if (!data) {
            return NextResponse.json(
                { status: false, message: "Contato não encontrado" },
                { status: 404 }
            );
        }
        return NextResponse.json({ status: true, data });
    } catch {
        return NextResponse.json(
            { status: false, message: "Falha ao carregar histórico" },
            { status: 500 }
        );
    }
}

const manualSchema = z.object({
    decision: z.enum(["GRANTED", "DENIED", "REVOKED"]),
    evidenceText: z.string().min(10).max(2000),
    wabaId: z.string().max(64).optional().nullable(),
});

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ contactId: string }> }
) {
    const gate = await requireCrmMutate(request);
    if (gate.error) return gate.error;
    if (!canManageConsents(gate.user.role)) {
        return NextResponse.json(
            { status: false, message: "Forbidden" },
            { status: 403 }
        );
    }

    try {
        const { contactId } = await params;
        const body = await request.json().catch(() => null);
        const parsed = manualSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    status: false,
                    message:
                        "Registro manual exige decisão e evidência válida (mín. 10 caracteres).",
                },
                { status: 400 }
            );
        }
        const result = await recordManualConsent({
            crmContactId: contactId,
            decision: parsed.data.decision,
            evidenceText: parsed.data.evidenceText,
            actorUserId: gate.user.id,
            wabaId: parsed.data.wabaId,
        });
        if (!result.ok) {
            return NextResponse.json(
                { status: false, message: result.message || "Falha" },
                { status: 400 }
            );
        }
        const detail = await getConsentDetail(contactId);
        return NextResponse.json({ status: true, data: { result, detail } });
    } catch {
        return NextResponse.json(
            { status: false, message: "Falha ao registrar consentimento" },
            { status: 500 }
        );
    }
}
