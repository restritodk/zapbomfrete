import { promises as fs } from "fs";
import path from "path";
import { CRM_ORG_DEFAULT } from "@/modules/crm/constants";
import { validateWhatsappGroupInviteUrl } from "@/modules/crm/consent/group-invite-url";
import { prisma } from "@/lib/prisma";

export type OrgSenderProfile = {
    organizationKey: string;
    /** {{company}} — commercial name of the sending business */
    companyName: string | null;
    /** {{city}} — origin city of the sending business */
    city: string | null;
    /** {{state}} — UF of the sending business (e.g. MT) */
    state: string | null;
    defaultGroupInviteUrl: string | null;
    /** Last verified_name synced from Datafy/Meta phone numbers API */
    verifiedNameFromApi: string | null;
    updatedAt: string | null;
    updatedById: string | null;
};

function settingsPath(organizationKey: string): string {
    const safe = organizationKey.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
    return path.join(process.cwd(), "data", "org-settings", `${safe}.json`);
}

function normalizeUf(raw: string | null | undefined): string | null {
    const s = String(raw || "")
        .trim()
        .toUpperCase();
    if (!s) return null;
    if (/^[A-Z]{2}$/.test(s)) return s;
    const map: Record<string, string> = {
        ACRE: "AC",
        ALAGOAS: "AL",
        AMAPA: "AP",
        AMAZONAS: "AM",
        BAHIA: "BA",
        CEARA: "CE",
        DISTRITOFEDERAL: "DF",
        "DISTRITO FEDERAL": "DF",
        ESPIRITOSANTO: "ES",
        "ESPIRITO SANTO": "ES",
        GOIAS: "GO",
        MARANHAO: "MA",
        MATOGROSSO: "MT",
        "MATO GROSSO": "MT",
        MATOGROSSODOSUL: "MS",
        "MATO GROSSO DO SUL": "MS",
        MINASGERAIS: "MG",
        "MINAS GERAIS": "MG",
        PARA: "PA",
        PARAIBA: "PB",
        PARANA: "PR",
        PERNAMBUCO: "PE",
        PIAUI: "PI",
        RIODEJANEIRO: "RJ",
        "RIO DE JANEIRO": "RJ",
        RIOGRANDEDONORTE: "RN",
        "RIO GRANDE DO NORTE": "RN",
        RIOGRANDEDOSUL: "RS",
        "RIO GRANDE DO SUL": "RS",
        RONDONIA: "RO",
        RORAIMA: "RR",
        SANTACATARINA: "SC",
        "SANTA CATARINA": "SC",
        SAOPAULO: "SP",
        "SAO PAULO": "SP",
        SERGIPE: "SE",
        TOCANTINS: "TO",
    };
    const key = s
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/\s+/g, " ");
    return map[key.replace(/\s/g, "")] || map[key] || (s.length <= 3 ? s : null);
}

async function readRaw(
    organizationKey: string
): Promise<Record<string, unknown>> {
    try {
        const raw = await fs.readFile(settingsPath(organizationKey), "utf8");
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return {};
    }
}

async function writeRaw(
    organizationKey: string,
    data: Record<string, unknown>
): Promise<void> {
    const file = settingsPath(organizationKey);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

export async function getOrgSenderProfile(
    organizationKey = CRM_ORG_DEFAULT
): Promise<OrgSenderProfile> {
    const o = await readRaw(organizationKey);
    const envGroup =
        organizationKey === CRM_ORG_DEFAULT
            ? String(process.env.WHATSAPP_GROUP_INVITE_URL || "").trim() || null
            : null;
    const envCompany =
        organizationKey === CRM_ORG_DEFAULT
            ? String(process.env.WHATSAPP_BUSINESS_NAME || "").trim() || null
            : null;

    return {
        organizationKey,
        companyName:
            String(o.companyName || "").trim() || envCompany || null,
        city: String(o.city || "").trim() || null,
        state: normalizeUf(String(o.state || "").trim() || null),
        defaultGroupInviteUrl:
            String(o.defaultGroupInviteUrl || "").trim() || envGroup || null,
        verifiedNameFromApi:
            String(o.verifiedNameFromApi || "").trim() || null,
        updatedAt: o.updatedAt ? String(o.updatedAt) : null,
        updatedById: o.updatedById ? String(o.updatedById) : null,
    };
}

/**
 * Resolve values used in campaign {{company}} / {{city}} / {{state}}.
 * Never uses recipient CRM geo fields.
 */
export async function resolveSenderVariableFields(
    organizationKey = CRM_ORG_DEFAULT
): Promise<{ company: string; city: string; state: string }> {
    const profile = await getOrgSenderProfile(organizationKey);
    let appName: string | null = null;
    try {
        const cfg = await prisma.systemConfig.findUnique({
            where: { id: "default" },
            select: { appName: true },
        });
        appName = cfg?.appName?.trim() || null;
    } catch {
        appName = null;
    }

    const company =
        profile.companyName ||
        profile.verifiedNameFromApi ||
        appName ||
        "";

    return {
        company,
        city: profile.city || "",
        state: profile.state || "",
    };
}

export async function setOrgSenderProfile(opts: {
    organizationKey?: string;
    companyName?: string | null;
    city?: string | null;
    state?: string | null;
    defaultGroupInviteUrl?: string | null;
    verifiedNameFromApi?: string | null;
    actorUserId?: string | null;
}): Promise<
    | { ok: true; profile: OrgSenderProfile }
    | { ok: false; error: string }
> {
    const organizationKey = opts.organizationKey || CRM_ORG_DEFAULT;
    const prev = await readRaw(organizationKey);

    let groupUrl =
        opts.defaultGroupInviteUrl !== undefined
            ? opts.defaultGroupInviteUrl
            : (prev.defaultGroupInviteUrl as string | null | undefined) ?? null;
    if (groupUrl != null && String(groupUrl).trim()) {
        const v = validateWhatsappGroupInviteUrl(String(groupUrl));
        if (!v.ok) return { ok: false, error: v.error };
        groupUrl = v.normalized;
    } else if (opts.defaultGroupInviteUrl !== undefined) {
        groupUrl = null;
    }

    const next = {
        ...prev,
        organizationKey,
        companyName:
            opts.companyName !== undefined
                ? String(opts.companyName || "").trim() || null
                : prev.companyName ?? null,
        city:
            opts.city !== undefined
                ? String(opts.city || "").trim() || null
                : prev.city ?? null,
        state:
            opts.state !== undefined
                ? normalizeUf(opts.state)
                : normalizeUf(
                      prev.state != null ? String(prev.state) : null
                  ),
        defaultGroupInviteUrl: groupUrl,
        verifiedNameFromApi:
            opts.verifiedNameFromApi !== undefined
                ? String(opts.verifiedNameFromApi || "").trim() || null
                : prev.verifiedNameFromApi ?? null,
        updatedAt: new Date().toISOString(),
        updatedById: opts.actorUserId || prev.updatedById || null,
    };

    await writeRaw(organizationKey, next);
    return { ok: true, profile: await getOrgSenderProfile(organizationKey) };
}

/** Persist verified_name from Datafy phone_numbers (no migration). */
export async function syncVerifiedNameFromApi(
    verifiedName: string | null | undefined
): Promise<void> {
    const name = String(verifiedName || "").trim();
    if (!name) return;
    await setOrgSenderProfile({
        verifiedNameFromApi: name,
        actorUserId: null,
    });
}
