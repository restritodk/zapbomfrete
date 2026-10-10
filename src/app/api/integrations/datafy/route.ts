import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import { datafyProvider, DATAFY_WEBHOOK_EVENTS } from "@/modules/datafy";
import { z } from "zod";

async function requireAdmin(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return {
            error: NextResponse.json(
                { status: false, message: "Unauthorized" },
                { status: 401 }
            ),
        };
    }
    if (!isAdmin(user.role)) {
        return {
            error: NextResponse.json(
                { status: false, message: "Forbidden" },
                { status: 403 }
            ),
        };
    }
    return { user };
}

/** GET — public status for admin UI (masked secrets only). */
export async function GET(request: NextRequest) {
    const gate = await requireAdmin(request);
    if (gate.error) return gate.error;

    const status = await datafyProvider.getPublicStatus();
    return NextResponse.json({
        status: true,
        data: {
            ...status,
            recommendedWebhookEvents: DATAFY_WEBHOOK_EVENTS,
            docsUrl: "https://developers.datafyapi.com.br/",
        },
    });
}

const putSchema = z.object({
    enabled: z.boolean().optional(),
    channelToken: z.string().nullable().optional(),
    webhookSecret: z.string().nullable().optional(),
    clearChannelToken: z.boolean().optional(),
    clearWebhookSecret: z.boolean().optional(),
    webhookConfigured: z.boolean().optional(),
    displayPhoneNumber: z.string().nullable().optional(),
});

/** PUT — save settings. Full secrets never echoed back. */
export async function PUT(request: NextRequest) {
    const gate = await requireAdmin(request);
    if (gate.error) return gate.error;

    const body = await request.json().catch(() => null);
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { status: false, message: "Payload inválido" },
            { status: 400 }
        );
    }

    const status = await datafyProvider.saveSettings(parsed.data);
    return NextResponse.json({
        status: true,
        message: "Configuração Datafy salva",
        data: status,
    });
}
