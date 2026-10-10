import { NextRequest, NextResponse } from "next/server";
import { requireCrmMutate } from "@/modules/crm/auth-gate";
import { CrmError, importCrmPhones } from "@/modules/crm/service";
import { parsePhoneList } from "@/lib/phone-br";

export const dynamic = "force-dynamic";

/**
 * Import phones using the same parsePhoneList contract as Disparo TXT/CSV.
 * Does not alter the Disparo UI. Consent is never auto-granted.
 */
export async function POST(request: NextRequest) {
    const gate = await requireCrmMutate(request);
    if (gate.error) return gate.error;

    try {
        const body = await request.json().catch(() => null);
        const text = typeof body?.text === "string" ? body.text : "";
        if (!text.trim()) {
            return NextResponse.json(
                { status: false, message: "Conteúdo vazio" },
                { status: 400 }
            );
        }

        const { phones, invalid, duplicates } = parsePhoneList(text);
        const result = await importCrmPhones({
            phones,
            userId: gate.user.id,
            category: body?.category || null,
            tagNames: Array.isArray(body?.tagNames) ? body.tagNames : undefined,
        });

        return NextResponse.json({
            status: true,
            data: {
                ...result,
                invalidCount: invalid.length,
                duplicatesInFile: duplicates,
            },
        });
    } catch (e) {
        if (e instanceof CrmError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha na importação CRM" },
            { status: 500 }
        );
    }
}
