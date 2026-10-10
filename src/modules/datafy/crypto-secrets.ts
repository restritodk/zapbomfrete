import crypto from "node:crypto";

/**
 * Encrypt/decrypt Datafy secrets at rest (AES-256-GCM).
 *
 * Prefer DATAFY_ENCRYPTION_KEY (independent rotation).
 * Fall back to AUTH_SECRET for encryption when DEK is absent,
 * and always try AUTH_SECRET when decrypting legacy payloads.
 * Never log plaintext secrets.
 */

type KeySlot = { label: "dek" | "auth"; key: Buffer };

function sha256(value: string): Buffer {
    return crypto.createHash("sha256").update(value).digest();
}

/** Ordered key slots: first is used for new ciphertext. */
export function resolveEncryptionKeys(): KeySlot[] {
    const slots: KeySlot[] = [];
    const dek = process.env.DATAFY_ENCRYPTION_KEY?.trim();
    if (dek && dek.length >= 16) {
        slots.push({ label: "dek", key: sha256(dek) });
    }
    const auth = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
    if (auth && auth.length >= 16) {
        slots.push({ label: "auth", key: sha256(auth) });
    }
    return slots;
}

function decryptWithKey(key: Buffer, ivHex: string, tagHex: string, dataHex: string): string {
    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const dec = Buffer.concat([
        decipher.update(Buffer.from(dataHex, "hex")),
        decipher.final(),
    ]);
    return dec.toString("utf8");
}

export function encryptSecret(plain: string): string {
    const slots = resolveEncryptionKeys();
    if (slots.length === 0) {
        throw new Error(
            "DATAFY_ENCRYPTION_KEY or AUTH_SECRET is required to store Datafy credentials securely"
        );
    }
    const { label, key } = slots[0];
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${label}.${iv.toString("hex")}.${tag.toString("hex")}.${enc.toString("hex")}`;
}

/**
 * Decrypt ciphertext. Supports:
 * - `dek|auth.iv.tag.data` (current)
 * - `iv.tag.data` (legacy Phase-1, AUTH_SECRET only)
 */
export function decryptSecret(payload: string): string {
    const parts = payload.split(".");
    const slots = resolveEncryptionKeys();
    if (slots.length === 0) {
        throw new Error("No encryption key available to decrypt Datafy secrets");
    }

    if (parts.length === 4) {
        const [label, ivHex, tagHex, dataHex] = parts;
        if (!ivHex || !tagHex || !dataHex) {
            throw new Error("Invalid encrypted secret format");
        }
        const preferred = slots.find((s) => s.label === label);
        const ordered = preferred
            ? [preferred, ...slots.filter((s) => s !== preferred)]
            : slots;
        let lastErr: unknown;
        for (const slot of ordered) {
            try {
                return decryptWithKey(slot.key, ivHex, tagHex, dataHex);
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error("Decryption failed");
    }

    if (parts.length === 3) {
        const [ivHex, tagHex, dataHex] = parts;
        let lastErr: unknown;
        // Legacy: try AUTH_SECRET first, then DEK
        const ordered = [
            ...slots.filter((s) => s.label === "auth"),
            ...slots.filter((s) => s.label === "dek"),
        ];
        for (const slot of ordered) {
            try {
                return decryptWithKey(slot.key, ivHex, tagHex, dataHex);
            } catch (e) {
                lastErr = e;
            }
        }
        throw lastErr instanceof Error ? lastErr : new Error("Decryption failed");
    }

    throw new Error("Invalid encrypted secret format");
}

/** Mask secret for UI: keep prefix hint + last 4 chars. */
export function maskSecret(value: string | null | undefined): string | null {
    if (!value) return null;
    const v = value.trim();
    if (v.length <= 8) return "••••••••";
    const prefix = v.startsWith("sk_live_")
        ? "sk_live_"
        : v.startsWith("whsec_")
          ? "whsec_"
          : v.startsWith("sk_acct_")
            ? "sk_acct_"
            : "";
    const tail = v.slice(-4);
    return `${prefix}••••${tail}`;
}

/** Strip token-like material from error strings before persisting or returning. */
export function redactSecrets(text: string): string {
    return text
        .replace(/sk_live_[A-Za-z0-9_-]+/g, "sk_live_••••")
        .replace(/whsec_[A-Za-z0-9_-]+/g, "whsec_••••")
        .replace(/sk_acct_[A-Za-z0-9_-]+/g, "sk_acct_••••")
        .replace(/Bearer\s+\S+/gi, "Bearer ••••")
        .replace(/Authorization:\s*\S+/gi, "Authorization: ••••");
}
