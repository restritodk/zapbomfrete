import { readFile } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { resolveBrandingFile } from "@/lib/branding-storage";
import { ImageResponse } from "next/og";
import path from "path";

export const runtime = "nodejs";

export const size = {
    width: 32,
    height: 32,
};

export const contentType = "image/png";

/**
 * Dynamic app icon: prefer uploaded favicon from SystemConfig; fallback to letter mark.
 */
export default async function Icon() {
    try {
        const config = await prisma.systemConfig.findUnique({
            where: { id: "default" },
        });

        const faviconUrl = config?.faviconUrl || "";
        const pathOnly = faviconUrl.split("?")[0] || "";

        if (pathOnly.startsWith("/branding/")) {
            const fileName = path.basename(pathOnly);
            const filePath = resolveBrandingFile(fileName);
            if (filePath) {
                const buf = await readFile(filePath);
                const ext = path.extname(fileName).toLowerCase();
                const mime =
                    ext === ".ico"
                        ? "image/x-icon"
                        : ext === ".jpg" || ext === ".jpeg"
                          ? "image/jpeg"
                          : ext === ".webp"
                            ? "image/webp"
                            : ext === ".svg"
                              ? "image/svg+xml"
                              : "image/png";

                return new Response(buf, {
                    headers: {
                        "Content-Type": mime,
                        "Cache-Control": "public, max-age=3600, must-revalidate",
                    },
                });
            }
        }

        const letter = (config?.appName || "W").charAt(0).toUpperCase();
        return new ImageResponse(
            (
                <div
                    style={{
                        fontSize: 20,
                        fontWeight: 800,
                        background: "#16a34a",
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white",
                        borderRadius: "20%",
                        fontFamily: "sans-serif",
                    }}
                >
                    {letter}
                </div>
            ),
            { ...size }
        );
    } catch (e) {
        console.error("Failed to build favicon", e);
        return new ImageResponse(
            (
                <div
                    style={{
                        fontSize: 20,
                        fontWeight: 800,
                        background: "#16a34a",
                        width: "100%",
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "white",
                        borderRadius: "20%",
                    }}
                >
                    W
                </div>
            ),
            { ...size }
        );
    }
}
