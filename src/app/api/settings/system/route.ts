import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        // @ts-ignore
        const config = await prisma.systemConfig.findUnique({
            where: { id: "default" }
        });

        return NextResponse.json({ status: true, message: "System config fetched", data: config || { appName: "WA-AKG", faviconUrl: "/favicon.ico" } });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to fetch settings", error: "Failed to fetch settings" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        // @ts-ignore
        const user = await getAuthenticatedUser(req);
        if (!user || user.role !== "SUPERADMIN") {
            return NextResponse.json({ status: false, message: "Unauthorized", error: "Unauthorized" }, { status: 401 });
        }

        const body = await req.json();
        const { appName, logoUrl, faviconUrl, timezone, enableRegistration } = body;

        // Ignore transient browser preview URLs
        const safeLogo =
            typeof logoUrl === "string" && !logoUrl.startsWith("blob:") ? logoUrl : undefined;
        const safeFavicon =
            typeof faviconUrl === "string" && !faviconUrl.startsWith("blob:") ? faviconUrl : undefined;

        const updateData: Record<string, unknown> = {
            appName,
            timezone,
            enableRegistration: enableRegistration ?? true,
        };
        if (safeLogo !== undefined) updateData.logoUrl = safeLogo;
        if (safeFavicon !== undefined) updateData.faviconUrl = safeFavicon;

        // @ts-ignore
        const config = await prisma.systemConfig.upsert({
            where: { id: "default" },
            update: updateData,
            create: {
                id: "default",
                appName: appName || "WA-AKG",
                logoUrl: safeLogo || "",
                faviconUrl: safeFavicon || "/favicon.ico",
                timezone: timezone || "America/Sao_Paulo",
                enableRegistration: enableRegistration ?? true,
            },
        });

        return NextResponse.json({ status: true, message: "System settings updated", data: config });
    } catch (error) {
        return NextResponse.json({ status: false, message: "Failed to update settings", error: "Failed to update settings" }, { status: 500 });
    }
}
