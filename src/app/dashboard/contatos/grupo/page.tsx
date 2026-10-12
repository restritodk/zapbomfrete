"use client";

import { SessionGuard } from "@/components/dashboard/session-guard";
import { GroupInviteMembersPanel } from "@/components/dashboard/group-invite-members-panel";

export default function UsuariosNoGrupoPage() {
    return (
        <SessionGuard>
            <GroupInviteMembersPanel />
        </SessionGuard>
    );
}
