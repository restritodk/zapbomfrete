import { NextRequest, NextResponse } from "next/server";
import { getApiDocs } from "@/lib/swagger";
import { getAuthenticatedUser, canAccessDeveloperTools } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json(
            { status: false, message: "Unauthorized" },
            { status: 401 }
        );
    }
    if (!canAccessDeveloperTools(user.role)) {
        return NextResponse.json(
            { status: false, message: "Forbidden" },
            { status: 403 }
        );
    }
    const spec = getApiDocs();
    return NextResponse.json(spec);
}
