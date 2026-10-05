import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { existsSync } from "fs";

const BRANDING_DIR = path.join(process.cwd(), "public", "branding");
const MAX_BYTES = 2 * 1024 * 1024; // 2MB

const LOGO_TYPES = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/svg+xml",
    "image/gif",
]);

const FAVICON_TYPES = new Set([
    "image/png",
    "image/x-icon",
    "image/vnd.microsoft.icon",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/svg+xml",
    "image/gif",
]);

function extFromFile(file: File): string {
    const name = file.name.toLowerCase();
    if (name.endsWith(".ico")) return "ico";
    if (name.endsWith(".svg")) return "svg";
    if (name.endsWith(".webp")) return "webp";
    if (name.endsWith(".gif")) return "gif";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
    if (file.type.includes("svg")) return "svg";
    if (file.type.includes("webp")) return "webp";
    if (file.type.includes("gif")) return "gif";
    if (file.type.includes("jpeg") || file.type.includes("jpg")) return "jpg";
    if (file.type.includes("icon") || file.type.includes("ico")) return "ico";
    return "png";
}

export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user || user.role !== "SUPERADMIN") {
            return NextResponse.json(
                { status: false, message: "Unauthorized", error: "Unauthorized" },
                { status: 401 }
            );
        }

        const form = await request.formData();
        const type = String(form.get("type") || "");
        const file = form.get("file");

        if (type !== "logo" && type !== "favicon") {
            return NextResponse.json(
                { status: false, message: "type deve ser logo ou favicon", error: "Invalid type" },
                { status: 400 }
            );
        }

        if (!(file instanceof File)) {
            return NextResponse.json(
                { status: false, message: "Arquivo é obrigatório", error: "file required" },
                { status: 400 }
            );
        }

        if (file.size > MAX_BYTES) {
            return NextResponse.json(
                { status: false, message: "Arquivo muito grande (máx. 2MB)", error: "File too large" },
                { status: 400 }
            );
        }

        const allowed = type === "logo" ? LOGO_TYPES : FAVICON_TYPES;
        const mt = (file.type || "").toLowerCase();
        const nameOk =
            type === "favicon"
                ? /\.(png|ico|jpe?g|webp|svg|gif)$/i.test(file.name)
                : /\.(png|jpe?g|webp|svg|gif)$/i.test(file.name);

        if (mt && !allowed.has(mt) && !nameOk) {
            return NextResponse.json(
                {
                    status: false,
                    message:
                        type === "logo"
                            ? "Use PNG, JPG, WEBP ou SVG para o logo"
                            : "Use PNG, ICO, JPG ou WEBP para o favicon",
                    error: "Unsupported type",
                },
                { status: 400 }
            );
        }

        if (!existsSync(BRANDING_DIR)) {
            await mkdir(BRANDING_DIR, { recursive: true });
        }

        const ext = extFromFile(file);
        const fileName = `${type}.${ext}`;
        const absPath = path.join(BRANDING_DIR, fileName);

        // Remove previous variants of the same asset
        for (const oldExt of ["png", "jpg", "jpeg", "webp", "svg", "gif", "ico"]) {
            const oldPath = path.join(BRANDING_DIR, `${type}.${oldExt}`);
            if (oldPath !== absPath && existsSync(oldPath)) {
                await unlink(oldPath).catch(() => {});
            }
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        await writeFile(absPath, buffer);

        // Cache-bust so browsers pick up the new file
        const publicUrl = `/branding/${fileName}?v=${Date.now()}`;

        const updateData =
            type === "logo" ? { logoUrl: publicUrl } : { faviconUrl: publicUrl };

        const config = await prisma.systemConfig.upsert({
            where: { id: "default" },
            update: updateData,
            create: {
                id: "default",
                appName: "WA-AKG",
                logoUrl: type === "logo" ? publicUrl : "",
                faviconUrl: type === "favicon" ? publicUrl : "/favicon.ico",
                timezone: "America/Sao_Paulo",
                enableRegistration: true,
            },
        });

        return NextResponse.json({
            status: true,
            message: type === "logo" ? "Logo atualizado" : "Favicon atualizado",
            data: {
                url: publicUrl,
                logoUrl: config.logoUrl,
                faviconUrl: config.faviconUrl,
            },
        });
    } catch (e) {
        console.error("Branding upload error", e);
        return NextResponse.json(
            { status: false, message: "Falha no upload", error: "Upload failed" },
            { status: 500 }
        );
    }
}
