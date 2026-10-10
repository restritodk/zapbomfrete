import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { canAccessCrm, canMutateCrm } from "./access";

export async function requireCrmAccess(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return {
            error: NextResponse.json(
                { status: false, message: "Unauthorized" },
                { status: 401 }
            ),
        };
    }
    const allowed = await canAccessCrm(user.id, user.role);
    if (!allowed) {
        return {
            error: NextResponse.json(
                { status: false, message: "Forbidden" },
                { status: 403 }
            ),
        };
    }
    return { user };
}

export async function requireCrmMutate(request: NextRequest) {
    const gate = await requireCrmAccess(request);
    if (gate.error) return gate;
    if (!canMutateCrm(gate.user.role)) {
        return {
            error: NextResponse.json(
                { status: false, message: "Forbidden" },
                { status: 403 }
            ),
        };
    }
    return gate;
}
