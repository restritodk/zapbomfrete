import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { requireCampaignEdit } from "@/modules/datafy/campaigns/auth-gate";
import { datafyProvider, DatafyApiError } from "@/modules/datafy";
import { redactSecrets } from "@/modules/datafy/crypto-secrets";

export const dynamic = "force-dynamic";

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

function publicBaseUrl() {
    return (process.env.BASE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(
        /\/$/,
        ""
    );
}

/**
 * Upload optional campaign header image.
 * Stores locally under /public/campaign-media and optionally obtains Meta handle via Datafy.
 */
export async function POST(request: NextRequest) {
    const gate = await requireCampaignEdit(request);
    if (gate.error) return gate.error;

    try {
        const form = await request.formData();
        const file = form.get("file");
        if (!file || typeof file === "string" || typeof (file as File).arrayBuffer !== "function") {
            return NextResponse.json(
                { status: false, message: "Arquivo de imagem obrigatório" },
                { status: 400 }
            );
        }
        const f = file as File;
        const mime = f.type || "";
        if (!ALLOWED.has(mime)) {
            return NextResponse.json(
                { status: false, message: "Use JPEG, PNG ou WebP" },
                { status: 400 }
            );
        }
        if (f.size > MAX_BYTES) {
            return NextResponse.json(
                { status: false, message: "Imagem deve ter no máximo 5 MB" },
                { status: 400 }
            );
        }

        const ext =
            mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
        const name = `camp_${Date.now()}_${randomBytes(6).toString("hex")}.${ext}`;
        const dir = path.join(process.cwd(), "public", "campaign-media");
        await mkdir(dir, { recursive: true });
        const buffer = Buffer.from(await f.arrayBuffer());
        await writeFile(path.join(dir, name), buffer);

        const url = `${publicBaseUrl()}/campaign-media/${name}`;

        let handle: string | null = null;
        try {
            const client = await datafyProvider.createClient();
            const res = await client.createFileHandle(url);
            handle = res.handle || null;
        } catch (e) {
            // Local URL may be unreachable from Datafy in dev — keep URL for send-time link
            handle = null;
            void e;
        }

        return NextResponse.json({
            status: true,
            data: {
                url,
                handle,
                mime,
                size: f.size,
                filename: name,
            },
        });
    } catch (e) {
        const message =
            e instanceof DatafyApiError
                ? e.message
                : e instanceof Error
                  ? e.message
                  : "Falha no upload";
        return NextResponse.json(
            { status: false, message: redactSecrets(message) },
            { status: e instanceof DatafyApiError ? e.statusCode : 500 }
        );
    }
}
