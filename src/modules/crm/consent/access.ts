import { isAdmin } from "@/lib/api-auth";

/** OWNER + SUPERADMIN manage consent records; STAFF view-only via CRM access. */
export function canManageConsents(userRole: string): boolean {
    return isAdmin(userRole) || userRole === "OWNER";
}

export function canViewConsents(userRole: string): boolean {
    return (
        isAdmin(userRole) ||
        userRole === "OWNER" ||
        userRole === "STAFF"
    );
}
