import { NextRequest, NextResponse } from "next/server";
import { requireDatafyChatAccess } from "@/modules/datafy/chat/auth-gate";
import { getDatafyDashboardStats, datafyProvider } from "@/modules/datafy";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    const gate = await requireDatafyChatAccess(request);
    if (gate.error) return gate.error;

    const [stats, status] = await Promise.all([
        getDatafyDashboardStats(),
        datafyProvider.getPublicStatus(),
    ]);

    return NextResponse.json({
        status: true,
        data: {
            ...stats,
            channel: {
                enabled: status.enabled,
                configured: status.configured,
                displayPhoneNumber: status.displayPhoneNumber,
                lastVerifiedAt: status.lastVerifiedAt,
                lastError: status.lastError,
                healthy: Boolean(
                    status.enabled &&
                        status.hasChannelToken &&
                        status.displayPhoneNumber &&
                        status.lastVerifiedAt &&
                        !status.lastError
                ),
            },
        },
    });
}
