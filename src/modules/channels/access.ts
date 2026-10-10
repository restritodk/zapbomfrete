import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/api-auth";
import type { DatafyOperationalAccessMode } from "./types";

const VALID_MODES: DatafyOperationalAccessMode[] = [
    "ROLE_OWNER",
    "EXPLICIT",
    "SUPERADMIN_ONLY",
];

export function normalizeOperationalAccessMode(
    value: string | null | undefined
): DatafyOperationalAccessMode {
    if (value && VALID_MODES.includes(value as DatafyOperationalAccessMode)) {
        return value as DatafyOperationalAccessMode;
    }
    return "ROLE_OWNER";
}

/**
 * Operational access to the shared Datafy official channel.
 * Credential/admin mutation remains SUPERADMIN-only (separate gate).
 */
export async function canAccessDatafyChannel(
    userId: string,
    userRole: string
): Promise<boolean> {
    if (isAdmin(userRole)) return true;

    let mode: DatafyOperationalAccessMode = "ROLE_OWNER";
    try {
        const row = await prisma.datafyIntegration.findUnique({
            where: { id: "default" },
            select: { operationalAccessMode: true, enabled: true },
        });
        mode = normalizeOperationalAccessMode(row?.operationalAccessMode);
        // Channel may still be listed as unavailable when disabled; access
        // check for selection still requires role grant below.
        void row?.enabled;
    } catch {
        mode = "ROLE_OWNER";
    }

    if (mode === "SUPERADMIN_ONLY") return false;

    if (mode === "ROLE_OWNER") {
        return userRole === "OWNER" || userRole === "SUPERADMIN";
    }

    // EXPLICIT
    try {
        const grant = await prisma.datafyChannelAccess.findUnique({
            where: { userId },
            select: { id: true },
        });
        return Boolean(grant);
    } catch {
        return false;
    }
}

/** SUPERADMIN-only: mutate integration credentials / enable / webhook. */
export function canManageDatafyCredentials(userRole: string): boolean {
    return isAdmin(userRole);
}

/** SUPERADMIN-only: define who may use the shared channel. */
export function canManageDatafyChannelAccess(userRole: string): boolean {
    return isAdmin(userRole);
}

export async function getDatafyAccessState(): Promise<{
    mode: DatafyOperationalAccessMode;
    userIds: string[];
    users: Array<{ id: string; name: string | null; email: string; role: string }>;
}> {
    let mode: DatafyOperationalAccessMode = "ROLE_OWNER";
    try {
        const row = await prisma.datafyIntegration.findUnique({
            where: { id: "default" },
            select: { operationalAccessMode: true },
        });
        mode = normalizeOperationalAccessMode(row?.operationalAccessMode);
    } catch {
        mode = "ROLE_OWNER";
    }

    let grants: Array<{ userId: string }> = [];
    try {
        grants = await prisma.datafyChannelAccess.findMany({
            select: { userId: true },
            orderBy: { createdAt: "asc" },
        });
    } catch {
        grants = [];
    }

    const userIds = grants.map((g) => g.userId);
    let users: Array<{
        id: string;
        name: string | null;
        email: string;
        role: string;
    }> = [];

    if (userIds.length > 0) {
        users = await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true, role: true },
        });
    }

    return { mode, userIds, users };
}

export async function setDatafyAccessMode(
    mode: DatafyOperationalAccessMode
): Promise<void> {
    await prisma.datafyIntegration.upsert({
        where: { id: "default" },
        create: {
            id: "default",
            enabled: false,
            operationalAccessMode: mode,
        },
        update: { operationalAccessMode: mode },
    });
}

export async function setDatafyExplicitAccess(
    userIds: string[],
    grantedById: string | null
): Promise<void> {
    const unique = Array.from(new Set(userIds.filter(Boolean)));

    await prisma.$transaction(async (tx) => {
        if (unique.length === 0) {
            await tx.datafyChannelAccess.deleteMany({});
            return;
        }

        await tx.datafyChannelAccess.deleteMany({
            where: { userId: { notIn: unique } },
        });

        for (const userId of unique) {
            await tx.datafyChannelAccess.upsert({
                where: { userId },
                create: { userId, grantedById },
                update: { grantedById },
            });
        }
    });
}
