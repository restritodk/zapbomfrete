import { isAdmin, hasRole } from "@/lib/api-auth";
import { canAccessDatafyChannel } from "@/modules/channels/access";

/**
 * CRM is organization-scoped (Bom Frete shared directory).
 * SUPERADMIN always; OWNER with operational Datafy access (or OWNER role);
 * STAFF only with explicit Datafy channel grant.
 */
export async function canAccessCrm(
    userId: string,
    userRole: string
): Promise<boolean> {
    if (isAdmin(userRole)) return true;
    if (userRole === "OWNER") return true;
    if (userRole === "STAFF") {
        return canAccessDatafyChannel(userId, userRole);
    }
    return hasRole(userRole, "OWNER");
}

export function canMutateCrm(userRole: string): boolean {
    return isAdmin(userRole) || userRole === "OWNER" || userRole === "STAFF";
}

/** Hard delete reserved for SUPERADMIN / OWNER. */
export function canHardDeleteCrm(userRole: string): boolean {
    return isAdmin(userRole) || userRole === "OWNER";
}
