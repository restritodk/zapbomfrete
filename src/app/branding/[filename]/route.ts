import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { contentTypeForExt, resolveBrandingFile } from "@/lib/branding-storage";

/**
 * Public branding assets (logo / favicon).
 * Served from MEDIA_STORAGE_PATH/branding (or legacy public/branding).
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ filename: string }> }
) {
    try {
        const { filename: raw } = await params;
        // Strip accidental query fragments if proxied oddly
        const filename = decodeURIComponent(raw).split("?")[0];

        const filePath = resolveBrandingFile(filename);
        if (!filePath) {
            return NextResponse.json(
                { status: false, message: "Arquivo não encontrado", error: "Not found" },
                { status: 404 }
            );
        }

        const buffer = await readFile(filePath);
        const ext = path.extname(filename).toLowerCase();
        const contentType = contentTypeForExt(ext);

        return new NextResponse(buffer, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=3600, must-revalidate",
                "X-Content-Type-Options": "nosniff",
            },
        });
    } catch (e) {
        console.error("Branding serve error", e);
        return NextResponse.json(
            { status: false, message: "Erro ao servir arquivo", error: "Serve failed" },
            { status: 500 }
        );
    }
}
