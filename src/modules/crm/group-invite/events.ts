import { normalizeBrazilianPhone } from "@/lib/phone-br";
import { logger } from "@/lib/logger";
import { CRM_ORG_DEFAULT } from "@/modules/crm/constants";
import {
    GROUP_INVITE_DECISION,
    GROUP_INVITE_PURPOSE,
} from "@/modules/crm/consent/constants";
import { consentDb } from "@/modules/crm/consent/db";
import { validateWhatsappGroupInviteUrl } from "@/modules/crm/consent/group-invite-url";

export type GroupInviteMemberRow = {
    id: string;
    waId: string;
    fullName: string | null;
    company: string | null;
    status: "clicked" | "joined";
    statusLabel: string;
    inviteUrl: string | null;
    campaignId: string | null;
    clickedAt: string;
    joinedAt: string | null;
    crmContactId: string | null;
};

/**
 * Record a tracked link click. Idempotent per token.
 * Does NOT mark the contact as joined — only Meta/Baileys join evidence can.
 */
export async function recordGroupInviteClick(opts: {
    organizationKey?: string;
    waId: string;
    inviteUrl: string;
    campaignId?: string | null;
    recipientId?: string | null;
    trackingToken: string;
}): Promise<{
    ok: boolean;
    duplicate?: boolean;
    decisionId: string | null;
    crmContactId: string | null;
    message?: string;
}> {
    const organizationKey = opts.organizationKey || CRM_ORG_DEFAULT;
    const waId = normalizeBrazilianPhone(opts.waId);
    if (!waId) {
        return {
            ok: false,
            decisionId: null,
            crmContactId: null,
            message: "Telefone inválido",
        };
    }
    const urlCheck = validateWhatsappGroupInviteUrl(opts.inviteUrl);
    if (!urlCheck.ok) {
        return {
            ok: false,
            decisionId: null,
            crmContactId: null,
            message: urlCheck.error,
        };
    }

    const db = consentDb();
    const idempotencyKey = `group_click:${opts.trackingToken.slice(0, 120)}`;

    const existing = await db.crmConsentDecision.findUnique({
        where: { idempotencyKey },
        select: { id: true, crmContactId: true },
    });
    if (existing) {
        return {
            ok: true,
            duplicate: true,
            decisionId: existing.id,
            crmContactId: existing.crmContactId,
            message: "Clique já registrado",
        };
    }

    let contact = await db.crmContact.findUnique({
        where: { organizationKey_waId: { organizationKey, waId } },
    });
    if (!contact) {
        contact = await db.crmContact.create({
            data: {
                organizationKey,
                waId,
                origin: "datafy_webhook",
                consentStatus: "unknown",
            } as never,
        });
    }

    const decidedAt = new Date();
    const row = await db.crmConsentDecision.create({
        data: {
            organizationKey,
            crmContactId: contact.id,
            waId,
            purpose: GROUP_INVITE_PURPOSE,
            decision: GROUP_INVITE_DECISION.CLICKED,
            resultingStatus: contact.consentStatus,
            source: "group_invite_link",
            evidenceText: `Clique no convite do grupo: ${urlCheck.normalized}`,
            evidencePayload: {
                inviteUrl: urlCheck.normalized,
                inviteCode: urlCheck.inviteCode,
                campaignId: opts.campaignId || null,
                recipientId: opts.recipientId || null,
                status: "clicked",
                joinedConfirmed: false,
            },
            buttonId: "group_invite",
            buttonTitle: "Entrar no grupo exclusivo",
            decidedAt,
            idempotencyKey,
            appliedToContact: false,
        } as never,
    });

    await db.crmContact.update({
        where: { id: contact.id },
        data: { lastInteractionAt: decidedAt },
    });

    return {
        ok: true,
        decisionId: row.id,
        crmContactId: contact.id,
    };
}

/**
 * Confirm join only with explicit evidence (never invent from click alone).
 */
export async function confirmGroupInviteJoin(opts: {
    organizationKey?: string;
    waId: string;
    evidenceText: string;
    actorUserId?: string | null;
    inviteUrl?: string | null;
}): Promise<{ ok: boolean; decisionId: string | null; message?: string }> {
    const organizationKey = opts.organizationKey || CRM_ORG_DEFAULT;
    const waId = normalizeBrazilianPhone(opts.waId);
    if (!waId) {
        return { ok: false, decisionId: null, message: "Telefone inválido" };
    }
    const evidence = opts.evidenceText.trim();
    if (evidence.length < 8) {
        return {
            ok: false,
            decisionId: null,
            message: "Informe evidência de ingresso no grupo.",
        };
    }

    const db = consentDb();
    let contact = await db.crmContact.findUnique({
        where: { organizationKey_waId: { organizationKey, waId } },
    });
    if (!contact) {
        contact = await db.crmContact.create({
            data: {
                organizationKey,
                waId,
                origin: "manual",
                consentStatus: "unknown",
            } as never,
        });
    }

    const decidedAt = new Date();
    const idempotencyKey = `group_join:${organizationKey}:${waId}:${decidedAt.getTime()}`;
    const row = await db.crmConsentDecision.create({
        data: {
            organizationKey,
            crmContactId: contact.id,
            waId,
            purpose: GROUP_INVITE_PURPOSE,
            decision: GROUP_INVITE_DECISION.JOINED,
            resultingStatus: contact.consentStatus,
            source: opts.actorUserId ? "manual_evidence" : "system",
            evidenceText: evidence,
            evidencePayload: {
                inviteUrl: opts.inviteUrl || null,
                status: "joined",
                joinedConfirmed: true,
            },
            decidedAt,
            actorUserId: opts.actorUserId || null,
            idempotencyKey,
            appliedToContact: false,
        } as never,
    });

    return { ok: true, decisionId: row.id };
}

export async function listGroupInviteMembers(opts?: {
    organizationKey?: string;
    status?: "all" | "clicked" | "joined";
    q?: string;
    limit?: number;
}): Promise<{ rows: GroupInviteMemberRow[]; stats: { clicked: number; joined: number; total: number } }> {
    const organizationKey = opts?.organizationKey || CRM_ORG_DEFAULT;
    const limit = Math.min(500, Math.max(1, opts?.limit || 200));
    const db = consentDb();

    const decisions = await db.crmConsentDecision.findMany({
        where: {
            organizationKey,
            purpose: GROUP_INVITE_PURPOSE,
            decision: {
                in: [GROUP_INVITE_DECISION.CLICKED, GROUP_INVITE_DECISION.JOINED],
            },
        },
        orderBy: { decidedAt: "desc" },
        take: 2000,
        include: {
            crmContact: {
                select: {
                    id: true,
                    waId: true,
                    fullName: true,
                    company: true,
                },
            },
        },
    });

    type Acc = {
        waId: string;
        fullName: string | null;
        company: string | null;
        crmContactId: string | null;
        clickedAt: Date | null;
        joinedAt: Date | null;
        inviteUrl: string | null;
        campaignId: string | null;
        lastId: string;
    };
    const byWa = new Map<string, Acc>();

    for (const d of decisions) {
        const waId = String(d.waId || d.crmContact?.waId || "");
        if (!waId) continue;
        const payload = (d.evidencePayload || {}) as Record<string, unknown>;
        let acc = byWa.get(waId);
        if (!acc) {
            acc = {
                waId,
                fullName: d.crmContact?.fullName || null,
                company: d.crmContact?.company || null,
                crmContactId: d.crmContactId || d.crmContact?.id || null,
                clickedAt: null,
                joinedAt: null,
                inviteUrl: payload.inviteUrl
                    ? String(payload.inviteUrl)
                    : null,
                campaignId: payload.campaignId
                    ? String(payload.campaignId)
                    : null,
                lastId: d.id,
            };
            byWa.set(waId, acc);
        }
        if (d.decision === GROUP_INVITE_DECISION.JOINED) {
            if (!acc.joinedAt || d.decidedAt > acc.joinedAt) {
                acc.joinedAt = d.decidedAt;
                acc.lastId = d.id;
            }
        }
        if (d.decision === GROUP_INVITE_DECISION.CLICKED) {
            if (!acc.clickedAt || d.decidedAt > acc.clickedAt) {
                acc.clickedAt = d.decidedAt;
            }
            if (!acc.inviteUrl && payload.inviteUrl) {
                acc.inviteUrl = String(payload.inviteUrl);
            }
            if (!acc.campaignId && payload.campaignId) {
                acc.campaignId = String(payload.campaignId);
            }
        }
        if (!acc.fullName && d.crmContact?.fullName) {
            acc.fullName = d.crmContact.fullName;
        }
    }

    let rows: GroupInviteMemberRow[] = [...byWa.values()].map((a) => {
        const joined = Boolean(a.joinedAt);
        const clickedAt = a.clickedAt || a.joinedAt || new Date();
        return {
            id: a.lastId,
            waId: a.waId,
            fullName: a.fullName,
            company: a.company,
            status: joined ? "joined" : "clicked",
            statusLabel: joined
                ? "Entrou no grupo"
                : "Clicou no link (ingresso não confirmado)",
            inviteUrl: a.inviteUrl,
            campaignId: a.campaignId,
            clickedAt: clickedAt.toISOString(),
            joinedAt: a.joinedAt ? a.joinedAt.toISOString() : null,
            crmContactId: a.crmContactId,
        };
    });

    const q = String(opts?.q || "")
        .trim()
        .toLowerCase();
    if (q) {
        rows = rows.filter(
            (r) =>
                r.waId.includes(q.replace(/\D/g, "")) ||
                (r.fullName || "").toLowerCase().includes(q) ||
                (r.company || "").toLowerCase().includes(q)
        );
    }
    if (opts?.status === "clicked") {
        rows = rows.filter((r) => r.status === "clicked");
    } else if (opts?.status === "joined") {
        rows = rows.filter((r) => r.status === "joined");
    }

    rows.sort(
        (a, b) =>
            new Date(b.clickedAt).getTime() - new Date(a.clickedAt).getTime()
    );
    rows = rows.slice(0, limit);

    const all = [...byWa.values()];
    const joinedCount = all.filter((a) => a.joinedAt).length;
    const stats = {
        total: all.length,
        joined: joinedCount,
        clicked: all.length - joinedCount,
    };

    return { rows, stats };
}

/** Best-effort outbound notice after click (opens 24h window). Never throws. */
export async function sendGroupExclusiveNotice(opts: {
    waId: string;
    phoneNumberId: string;
}): Promise<boolean> {
    try {
        const { datafyProvider } = await import("@/modules/datafy/provider");
        const client = await datafyProvider.createClient();
        const { brazilianWaIdVariants } = await import(
            "@/modules/datafy/chat/window"
        );
        const text = "*Usuário no grupo exclusivo*";
        for (const to of brazilianWaIdVariants(opts.waId)) {
            try {
                const res = await client.sendText(opts.phoneNumberId, {
                    to,
                    text,
                });
                if (res.messages?.[0]?.id) return true;
            } catch {
                /* try next variant */
            }
        }
        return false;
    } catch (e) {
        logger.warn(
            "GroupInvite",
            e instanceof Error ? e.message : "Falha ao enviar aviso de grupo"
        );
        return false;
    }
}
