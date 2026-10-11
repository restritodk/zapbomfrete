import { isAdmin } from "@/lib/api-auth";
import { canAccessDatafyChannel } from "@/modules/channels/access";

/** View campaigns: SUPERADMIN, OWNER, or STAFF with Datafy grant. */
export async function canViewDatafyCampaigns(
    userId: string,
    userRole: string
): Promise<boolean> {
    if (isAdmin(userRole)) return true;
    if (userRole === "OWNER") return true;
    if (userRole === "STAFF") {
        return canAccessDatafyChannel(userId, userRole);
    }
    return false;
}

/** Create/edit drafts: same as view for operational roles. */
export async function canEditDatafyCampaigns(
    userId: string,
    userRole: string
): Promise<boolean> {
    return canViewDatafyCampaigns(userId, userRole);
}

/**
 * Start / pause / resume / cancel live sends.
 * STAFF may edit drafts but cannot launch unless OWNER/SUPERADMIN.
 */
export function canLaunchDatafyCampaigns(userRole: string): boolean {
    return isAdmin(userRole) || userRole === "OWNER";
}

/**
 * Manage bulletin / Meta template library (create, edit, submit, sync, import).
 * OWNER + SUPERADMIN. Credentials/global Datafy settings remain SUPERADMIN-only.
 */
export function canManageBulletinTemplates(userRole: string): boolean {
    return isAdmin(userRole) || userRole === "OWNER";
}
