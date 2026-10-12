import { NextRequest, NextResponse } from "next/server";
import {
    requireCampaignEdit,
    requireCampaignView,
} from "@/modules/datafy/campaigns/auth-gate";
import {
    CampaignError,
    createCampaign,
    listCampaigns,
} from "@/modules/datafy/campaigns/service";
import {
    createCampaignBodySchema,
    formatCreateCampaignZodError,
    persistableBulletinVersionId,
} from "@/modules/datafy/campaigns/create-payload";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireCampaignView(request);
    if (gate.error) return gate.error;

    const sp = new URL(request.url).searchParams;
    try {
        const data = await listCampaigns({
            status: sp.get("status") || undefined,
            search: sp.get("search") || undefined,
            page: Number(sp.get("page") || 1) || 1,
            limit: Number(sp.get("limit") || 10) || 10,
            from: sp.get("from") || undefined,
            to: sp.get("to") || undefined,
        });
        return NextResponse.json({ status: true, data });
    } catch (e) {
        if (e instanceof CampaignError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        return NextResponse.json(
            { status: false, message: "Falha ao listar campanhas" },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    const gate = await requireCampaignEdit(request);
    if (gate.error) return gate.error;

    try {
        const body = await request.json().catch(() => null);
        const parsed = createCampaignBodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    status: false,
                    message: formatCreateCampaignZodError(parsed.error),
                    details: parsed.error.flatten(),
                },
                { status: 400 }
            );
        }
        const data = {
            ...parsed.data,
            bulletinVersionId: persistableBulletinVersionId(
                parsed.data.bulletinVersionId
            ),
        };
        const campaign = await createCampaign(data, gate.user.id);
        return NextResponse.json({ status: true, data: { campaign } });
    } catch (e) {
        if (e instanceof CampaignError) {
            return NextResponse.json(
                { status: false, message: e.message },
                { status: e.statusCode }
            );
        }
        const msg =
            e instanceof Error ? e.message : "Falha ao criar campanha";
        // Surface FK / constraint hints without leaking internals
        const friendly = /Foreign key|bulletinVersion/i.test(msg)
            ? "Não foi possível vincular a versão do boletim. Templates individuais não usam bulletinVersionId — tente novamente."
            : "Falha ao criar campanha";
        return NextResponse.json(
            { status: false, message: friendly },
            { status: 500 }
        );
    }
}
