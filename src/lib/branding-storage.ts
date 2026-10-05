import path from "path";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";

const MAX_BYTES = 2 * 1024 * 1024; // 2MB

const LOGO_MIME = new Set([
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/svg+xml",
]);

const FAVICON_MIME = new Set([
    "image/png",
    "image/x-icon",
    "image/vnd.microsoft.icon",
    "image/jpeg",
    "image/jpg",
    "image/webp",
]);

const LOGO_EXTS = new Set(["png", "jpg", "jpeg", "webp", "svg"]);
const FAVICON_EXTS = new Set(["png", "ico", "jpg", "jpeg", "webp"]);

/**
 * Branding assets live under MEDIA_STORAGE_PATH/branding (or data/branding),
 * not only public/ — so uploads work on Linux/PM2 even when public is static-only.
 */
export function getBrandingDir(): string {
    const configured = (process.env.MEDIA_STORAGE_PATH || "data").trim() || "data";
    const root = path.isAbsolute(configured)
        ? configured
        : path.join(process.cwd(), configured);
    return path.join(root, "branding");
}

/** Legacy folder used by older uploads */
export function getLegacyBrandingDir(): string {
    return path.join(process.cwd(), "public", "branding");
}

export async function ensureBrandingDir(): Promise<string> {
    const dir = getBrandingDir();
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
    }
    return dir;
}

export function resolveBrandingFile(fileName: string): string | null {
    if (!/^(logo|favicon)\.(png|jpe?g|webp|svg|ico|gif)$/i.test(fileName)) {
        return null;
    }
    if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
        return null;
    }

    const primary = path.join(getBrandingDir(), fileName);
    if (existsSync(primary)) {
        const resolved = path.resolve(primary);
        if (!resolved.startsWith(path.resolve(getBrandingDir()))) return null;
        return resolved;
    }

    const legacy = path.join(getLegacyBrandingDir(), fileName);
    if (existsSync(legacy)) {
        const resolved = path.resolve(legacy);
        if (!resolved.startsWith(path.resolve(getLegacyBrandingDir()))) return null;
        return resolved;
    }

    return null;
}

export function contentTypeForExt(ext: string): string {
    switch (ext.toLowerCase()) {
        case ".png":
            return "image/png";
        case ".jpg":
        case ".jpeg":
            return "image/jpeg";
        case ".webp":
            return "image/webp";
        case ".svg":
            return "image/svg+xml";
        case ".ico":
            return "image/x-icon";
        case ".gif":
            return "image/gif";
        default:
            return "application/octet-stream";
    }
}

export function detectExtFromNameAndMime(fileName: string, mime: string): string | null {
    const name = fileName.toLowerCase();
    if (name.endsWith(".ico")) return "ico";
    if (name.endsWith(".svg")) return "svg";
    if (name.endsWith(".webp")) return "webp";
    if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "jpg";
    if (name.endsWith(".png")) return "png";

    const mt = (mime || "").toLowerCase();
    if (mt.includes("svg")) return "svg";
    if (mt.includes("webp")) return "webp";
    if (mt.includes("jpeg") || mt.includes("jpg")) return "jpg";
    if (mt.includes("icon") || mt.includes("ico")) return "ico";
    if (mt.includes("png")) return "png";
    return null;
}

/** Magic-byte / content sniffing (do not trust client MIME alone). */
export function sniffImageKind(buffer: Buffer): "png" | "jpg" | "webp" | "gif" | "ico" | "svg" | null {
    if (buffer.length < 12) {
        const asText = buffer.toString("utf8").trim().toLowerCase();
        if (asText.startsWith("<svg") || asText.startsWith("<?xml")) return "svg";
        return null;
    }

    // PNG
    if (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47
    ) {
        return "png";
    }

    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "jpg";
    }

    // GIF
    if (
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46
    ) {
        return "gif";
    }

    // WEBP: RIFF....WEBP
    if (
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
    ) {
        return "webp";
    }

    // ICO
    if (
        buffer[0] === 0x00 &&
        buffer[1] === 0x00 &&
        (buffer[2] === 0x01 || buffer[2] === 0x02) &&
        buffer[3] === 0x00
    ) {
        return "ico";
    }

    const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").trim().toLowerCase();
    if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
        return "svg";
    }

    return null;
}

/**
 * Strip dangerous constructs from SVG (scripts, event handlers, foreignObject, etc.).
 */
export function sanitizeSvg(svgText: string): string {
    let out = svgText;
    out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
    out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
    out = out.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    out = out.replace(/javascript\s*:/gi, "");
    out = out.replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
    out = out.replace(/xlink:href\s*=\s*("|')\s*javascript:[^"']*\1/gi, "");
    return out;
}

export function validateBrandingUpload(opts: {
    type: "logo" | "favicon";
    fileName: string;
    mime: string;
    size: number;
    buffer: Buffer;
}): { ok: true; ext: string; buffer: Buffer } | { ok: false; message: string } {
    const { type, fileName, mime, size, buffer } = opts;

    if (size <= 0) {
        return { ok: false, message: "Arquivo vazio" };
    }
    if (size > MAX_BYTES) {
        return { ok: false, message: "Arquivo maior que 2 MB" };
    }

    const allowedExts = type === "logo" ? LOGO_EXTS : FAVICON_EXTS;
    const allowedMime = type === "logo" ? LOGO_MIME : FAVICON_MIME;
    const mt = (mime || "").toLowerCase();
    const nameExt = detectExtFromNameAndMime(fileName, mt);

    if (nameExt && !allowedExts.has(nameExt === "jpeg" ? "jpg" : nameExt)) {
        return {
            ok: false,
            message:
                type === "logo"
                    ? "Formato não permitido. Use PNG, JPG, WEBP ou SVG"
                    : "Formato não permitido. Use PNG ou ICO (também JPG/WEBP)",
        };
    }

    if (mt && !allowedMime.has(mt) && !nameExt) {
        return {
            ok: false,
            message:
                type === "logo"
                    ? "Formato não permitido. Use PNG, JPG, WEBP ou SVG"
                    : "Formato não permitido. Use PNG ou ICO",
        };
    }

    const sniffed = sniffImageKind(buffer);
    if (!sniffed) {
        return { ok: false, message: "Arquivo de imagem inválido ou corrompido" };
    }

    // Favicon: UI says PNG/ICO; allow jpg/webp for practicality; reject svg/gif for favicon
    if (type === "favicon" && (sniffed === "svg" || sniffed === "gif")) {
        return { ok: false, message: "Favicon deve ser PNG ou ICO" };
    }

    if (type === "logo" && sniffed === "ico") {
        return { ok: false, message: "Use PNG, JPG, WEBP ou SVG para o logo" };
    }

    if (type === "logo" && sniffed === "gif") {
        // UI lists PNG/JPG/WEBP/SVG — reject gif for logo too for consistency
        return { ok: false, message: "Formato não permitido. Use PNG, JPG, WEBP ou SVG" };
    }

    let outBuffer = buffer;
    let ext = sniffed;

    if (sniffed === "svg") {
        const sanitized = sanitizeSvg(buffer.toString("utf8"));
        if (!/<svg[\s>]/i.test(sanitized)) {
            return { ok: false, message: "SVG inválido após sanitização" };
        }
        outBuffer = Buffer.from(sanitized, "utf8");
        ext = "svg";
    }

    return { ok: true, ext, buffer: outBuffer };
}

export const BRANDING_MAX_BYTES = MAX_BYTES;
