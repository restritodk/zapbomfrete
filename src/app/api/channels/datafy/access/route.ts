import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser, isAdmin } from "@/lib/api-auth";
import {
    canManageDatafyChannelAccess,
    getDatafyAccessState,
    setDatafyAccessMode,
    setDatafyExplicitAccess,
    type DatafyOperationalAccessMode,
} from "@/modules/channels";
import { z } from "zod";

async function requireSuperAdmin(request: NextRequest) {
    const user = await getAuthenticatedUser(request);
    if (!user) {
        return {
            error: NextResponse.json(
                { status: false, message: "Unauthorized" },
                { status: 401 }
            ),
        };
    }
    if (!isAdmin(user.role) || !canManageDatafyChannelAccess(user.role)) {
        return {
            error: NextResponse.json(
                { status: false, message: "Forbidden" },
                { status: 403 }
            ),
        };
    }
    return { user };
}

/** GET — operational access policy for the shared Datafy channel (admin). */
export async function GET(request: NextRequest) {
    const gate = await requireSuperAdmin(request);
    if (gate.error) return gate.error;

    const state = await getDatafyAccessState();
    return NextResponse.json({ status: true, data: state });
}

const putSchema = z.object({
    mode: z.enum(["ROLE_OWNER", "EXPLICIT", "SUPERADMIN_ONLY"]),
    userIds: z.array(z.string().min(1)).optional(),
});

/** PUT — set who may use the shared official channel (not credentials). */
export async function PUT(request: NextRequest) {
    const gate = await requireSuperAdmin(request);
    if (gate.error) return gate.error;

    const body = await request.json().catch(() => null);
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { status: false, message: "Payload inválido" },
            { status: 400 }
        );
    }

    const mode = parsed.data.mode as DatafyOperationalAccessMode;
    await setDatafyAccessMode(mode);

    if (mode === "EXPLICIT") {
        await setDatafyExplicitAccess(
            parsed.data.userIds ?? [],
            gate.user.id
        );
    }

    const state = await getDatafyAccessState();
    return NextResponse.json({
        status: true,
        message: "Acesso operacional do canal Datafy atualizado",
        data: state,
    });
}
