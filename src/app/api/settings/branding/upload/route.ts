import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/api-auth";
import { prisma } from "@/lib/prisma";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import {
    ensureBrandingDir,
    getBrandingDir,
    validateBrandingUpload,
} from "@/lib/branding-storage";

function isUploadFile(value: FormDataEntryValue | null): value is File {
    return (
        !!value &&
        typeof value !== "string" &&
        typeof (value as File).arrayBuffer === "function"
    );
}

export async function POST(request: NextRequest) {
    try {
        const user = await getAuthenticatedUser(request);
        if (!user) {
            return NextResponse.json(
                { status: false, message: "Não autenticado", error: "Unauthorized" },
                { status: 401 }
            );
        }
        if (user.role !== "SUPERADMIN") {
            return NextResponse.json(
                { status: false, message: "Sem permissão. Apenas SuperAdmin pode enviar branding.", error: "Forbidden" },
                { status: 403 }
            );
        }

        const form = await request.formData();
        const type = String(form.get("type") || "");
        const fileEntry = form.get("file");

        if (type !== "logo" && type !== "favicon") {
            return NextResponse.json(
                { status: false, message: "type deve ser logo ou favicon", error: "Invalid type" },
                { status: 400 }
            );
        }

        if (!isUploadFile(fileEntry)) {
            return NextResponse.json(
                { status: false, message: "Arquivo é obrigatório", error: "file required" },
                { status: 400 }
            );
        }

        const fileName =
            typeof (fileEntry as File).name === "string" && (fileEntry as File).name
                ? (fileEntry as File).name
                : `${type}.bin`;
        const mime = (fileEntry as File).type || "";
        const buffer = Buffer.from(await fileEntry.arrayBuffer());

        const validation = validateBrandingUpload({
            type,
            fileName,
            mime,
            size: buffer.length,
            buffer,
        });

        if (!validation.ok) {
            return NextResponse.json(
                { status: false, message: validation.message, error: "Validation failed" },
                { status: 400 }
            );
        }

        const brandingDir = await ensureBrandingDir();
        const safeName = `${type}.${validation.ext}`;
        const absPath = path.join(brandingDir, safeName);

        // Path traversal guard (fixed filenames only)
        if (!path.resolve(absPath).startsWith(path.resolve(getBrandingDir()))) {
            return NextResponse.json(
                { status: false, message: "Caminho de arquivo inválido", error: "Invalid path" },
                { status: 400 }
            );
        }

        // Remove previous variants of the same asset
        for (const oldExt of ["png", "jpg", "jpeg", "webp", "svg", "gif", "ico"]) {
            const oldPath = path.join(brandingDir, `${type}.${oldExt}`);
            if (oldPath !== absPath && existsSync(oldPath)) {
                await unlink(oldPath).catch(() => {});
            }
        }

        await writeFile(absPath, validation.buffer);

        // Public URL served by App Router route (works with PM2/Nginx, not only static public/)
        const publicUrl = `/branding/${safeName}?v=${Date.now()}`;

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
            {
                status: false,
                message: "Falha ao gravar o arquivo no servidor",
                error: e instanceof Error ? e.message : "Upload failed",
            },
            { status: 500 }
        );
    }
}
