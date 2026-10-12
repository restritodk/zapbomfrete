/**
 * Backward-compatible wrappers — org profile lives in org-profile.ts
 * (same data/org-settings JSON file).
 */
import {
    getOrgSenderProfile,
    setOrgSenderProfile,
    type OrgSenderProfile,
} from "@/modules/crm/org-profile";

export type OrgGroupInviteSettings = {
    organizationKey: string;
    defaultGroupInviteUrl: string | null;
    updatedAt: string | null;
    updatedById: string | null;
};

export async function getOrgGroupInviteSettings(
    organizationKey?: string
): Promise<OrgGroupInviteSettings> {
    const p = await getOrgSenderProfile(organizationKey);
    return {
        organizationKey: p.organizationKey,
        defaultGroupInviteUrl: p.defaultGroupInviteUrl,
        updatedAt: p.updatedAt,
        updatedById: p.updatedById,
    };
}

export async function setOrgGroupInviteSettings(opts: {
    organizationKey?: string;
    defaultGroupInviteUrl: string | null;
    actorUserId: string;
}): Promise<
    | { ok: true; settings: OrgGroupInviteSettings }
    | { ok: false; error: string }
> {
    const result = await setOrgSenderProfile({
        organizationKey: opts.organizationKey,
        defaultGroupInviteUrl: opts.defaultGroupInviteUrl,
        actorUserId: opts.actorUserId,
    });
    if (!result.ok) return result;
    return {
        ok: true,
        settings: {
            organizationKey: result.profile.organizationKey,
            defaultGroupInviteUrl: result.profile.defaultGroupInviteUrl,
            updatedAt: result.profile.updatedAt,
            updatedById: result.profile.updatedById,
        },
    };
}

export type { OrgSenderProfile };
