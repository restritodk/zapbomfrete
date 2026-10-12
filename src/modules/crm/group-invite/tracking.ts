import { createHmac, timingSafeEqual } from "crypto";
import { CRM_ORG_DEFAULT } from "@/modules/crm/constants";

export type GroupInviteTrackPayload = {
    organizationKey: string;
    waId: string;
    campaignId?: string | null;
    recipientId?: string | null;
    inviteUrl: string;
    exp: number;
};

function secret(): string {
    return (
        process.env.AUTH_SECRET ||
        process.env.NEXTAUTH_SECRET ||
        process.env.DATAFY_WEBHOOK_SECRET ||
        "dev-group-invite-secret"
    );
}

function b64url(buf: Buffer | string): string {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8");
    return b
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function fromB64url(s: string): Buffer {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    return Buffer.from(b64, "base64");
}

export function signGroupInviteToken(
    payload: Omit<GroupInviteTrackPayload, "exp"> & { exp?: number }
): string {
    const body: GroupInviteTrackPayload = {
        organizationKey: payload.organizationKey || CRM_ORG_DEFAULT,
        waId: payload.waId,
        campaignId: payload.campaignId || null,
        recipientId: payload.recipientId || null,
        inviteUrl: payload.inviteUrl,
        exp: payload.exp ?? Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
    };
    const data = b64url(JSON.stringify(body));
    const sig = b64url(
        createHmac("sha256", secret()).update(data).digest()
    );
    return `${data}.${sig}`;
}

export function verifyGroupInviteToken(
    token: string
): { ok: true; payload: GroupInviteTrackPayload } | { ok: false; error: string } {
    const parts = String(token || "").split(".");
    if (parts.length !== 2) {
        return { ok: false, error: "Token inválido" };
    }
    const [data, sig] = parts;
    const expected = b64url(
        createHmac("sha256", secret()).update(data).digest()
    );
    try {
        const a = Buffer.from(sig);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
            return { ok: false, error: "Assinatura inválida" };
        }
    } catch {
        return { ok: false, error: "Assinatura inválida" };
    }
    try {
        const payload = JSON.parse(
            fromB64url(data).toString("utf8")
        ) as GroupInviteTrackPayload;
        if (!payload.waId || !payload.inviteUrl) {
            return { ok: false, error: "Payload incompleto" };
        }
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return { ok: false, error: "Link expirado" };
        }
        return {
            ok: true,
            payload: {
                ...payload,
                organizationKey: payload.organizationKey || CRM_ORG_DEFAULT,
            },
        };
    } catch {
        return { ok: false, error: "Payload inválido" };
    }
}

export function buildTrackedGroupInvitePath(token: string): string {
    return `/api/r/grupo/${encodeURIComponent(token)}`;
}
