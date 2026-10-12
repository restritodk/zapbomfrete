import { promises as fs } from "fs";
import path from "path";
import { CRM_ORG_DEFAULT } from "@/modules/crm/constants";
import { validateWhatsappGroupInviteUrl } from "@/modules/crm/consent/group-invite-url";

export type OrgGroupInviteSettings = {
    organizationKey: string;
    defaultGroupInviteUrl: string | null;
    updatedAt: string | null;
    updatedById: string | null;
};

function settingsPath(organizationKey: string): string {
    const safe = organizationKey.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
    return path.join(process.cwd(), "data", "org-settings", `${safe}.json`);
}

/**
 * Org-scoped default WhatsApp group invite URL.
 * Persisted in data/org-settings (no DB migration). Never shared across orgs.
 */
export async function getOrgGroupInviteSettings(
    organizationKey = CRM_ORG_DEFAULT
): Promise<OrgGroupInviteSettings> {
    const envFallback =
        organizationKey === CRM_ORG_DEFAULT
            ? String(process.env.WHATSAPP_GROUP_INVITE_URL || "").trim() || null
            : null;
    try {
        const raw = await fs.readFile(settingsPath(organizationKey), "utf8");
        const o = JSON.parse(raw) as Record<string, unknown>;
        const url = String(o.defaultGroupInviteUrl || "").trim() || null;
        return {
            organizationKey,
            defaultGroupInviteUrl: url || envFallback,
            updatedAt: o.updatedAt ? String(o.updatedAt) : null,
            updatedById: o.updatedById ? String(o.updatedById) : null,
        };
    } catch {
        return {
            organizationKey,
            defaultGroupInviteUrl: envFallback,
            updatedAt: null,
            updatedById: null,
        };
    }
}

export async function setOrgGroupInviteSettings(opts: {
    organizationKey?: string;
    defaultGroupInviteUrl: string | null;
    actorUserId: string;
}): Promise<
    | { ok: true; settings: OrgGroupInviteSettings }
    | { ok: false; error: string }
> {
    const organizationKey = opts.organizationKey || CRM_ORG_DEFAULT;
    let normalized: string | null = null;
    if (opts.defaultGroupInviteUrl != null && opts.defaultGroupInviteUrl.trim()) {
        const v = validateWhatsappGroupInviteUrl(opts.defaultGroupInviteUrl);
        if (!v.ok) return { ok: false, error: v.error };
        normalized = v.normalized;
    }
    const settings: OrgGroupInviteSettings = {
        organizationKey,
        defaultGroupInviteUrl: normalized,
        updatedAt: new Date().toISOString(),
        updatedById: opts.actorUserId,
    };
    const file = settingsPath(organizationKey);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(settings, null, 2), "utf8");
    return { ok: true, settings };
}
