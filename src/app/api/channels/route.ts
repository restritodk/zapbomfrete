import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { listAccessibleChannels } from "@/modules/channels";

export const dynamic = "force-dynamic";

/**
 * GET — unified channel list (Datafy official + authorized Baileys sessions).
 * Never returns tokens or webhook secrets.
 */
export async function GET(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return NextResponse.json(
            { status: false, message: "Unauthorized" },
            { status: 401 }
        );
    }

    const channels = await listAccessibleChannels(user.id, user.role);

    return NextResponse.json({
        status: true,
        data: {
            channels,
            datafyOfficialId: channels.find((c) => c.provider === "datafy")?.id ?? null,
        },
    });
}
