import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import {
    canEditDatafyCampaigns,
    canLaunchDatafyCampaigns,
    canViewDatafyCampaigns,
} from "./access";

export async function requireCampaignView(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return {
            error: NextResponse.json(
                { status: false, message: "Unauthorized" },
                { status: 401 }
            ),
        };
    }
    const ok = await canViewDatafyCampaigns(user.id, user.role);
    if (!ok) {
        return {
            error: NextResponse.json(
                { status: false, message: "Forbidden" },
                { status: 403 }
            ),
        };
    }
    return { user };
}

export async function requireCampaignEdit(request: NextRequest) {
    const gate = await requireCampaignView(request);
    if (gate.error) return gate;
    const ok = await canEditDatafyCampaigns(gate.user.id, gate.user.role);
    if (!ok) {
        return {
            error: NextResponse.json(
                { status: false, message: "Forbidden" },
                { status: 403 }
            ),
        };
    }
    return gate;
}

export async function requireCampaignLaunch(request: NextRequest) {
    const gate = await requireCampaignEdit(request);
    if (gate.error) return gate;
    if (!canLaunchDatafyCampaigns(gate.user.role)) {
        return {
            error: NextResponse.json(
                {
                    status: false,
                    message:
                        "Apenas OWNER ou SUPERADMIN podem iniciar/pausar campanhas oficiais",
                },
                { status: 403 }
            ),
        };
    }
    return gate;
}
