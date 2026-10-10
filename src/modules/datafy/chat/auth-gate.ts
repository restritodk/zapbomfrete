import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { canAccessDatafyChannel } from "@/modules/channels/access";

export async function requireDatafyChatAccess(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return {
            error: NextResponse.json(
                { status: false, message: "Unauthorized" },
                { status: 401 }
            ),
        };
    }
    const allowed = await canAccessDatafyChannel(user.id, user.role);
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
