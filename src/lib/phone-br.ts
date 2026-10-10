/**
 * Brazilian phone helpers (safe for client + server — no Prisma).
 */

/**
 * Normalize a Brazilian phone number to digits with country code 55.
 * - Strips +, spaces, dashes and leading zeros
 * - Local numbers (10–11 digits: DDD + subscriber) get prefix 55
 * - Already-BR numbers (55 + 12/13 digits) are kept
 * - Other international lengths are left unchanged (no forced 55)
 */
export function normalizeBrazilianPhone(input: string | undefined | null): string {
    if (!input) return "";

    let digits = String(input).replace(/\D/g, "");
    if (!digits) return "";

    digits = digits.replace(/^0+/, "");
    if (!digits) return "";

    if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
        return digits;
    }

    if (digits.length === 10 || digits.length === 11) {
        return `55${digits}`;
    }

    return digits;
}

/**
 * Format a phone JID / digits as a human BR WhatsApp number.
 * Returns null for LIDs, groups, or invalid values.
 */
export function formatPhoneDisplay(input: string | undefined | null): string | null {
    if (!input) return null;
    const value = String(input).trim();
    if (!value || value.endsWith("@lid") || value.endsWith("@g.us") || value.includes("@broadcast")) {
        return null;
    }

    const digits = normalizeBrazilianPhone(value.includes("@") ? value.split("@")[0] : value);
    if (!digits || digits.length < 10) return null;

    // Never treat LID-looking huge IDs as phones (LIDs are often 14+ digits without being 55…)
    if (!digits.startsWith("55") && digits.length > 13) return null;

    if (digits.startsWith("55") && digits.length >= 12) {
        const ddd = digits.slice(2, 4);
        const rest = digits.slice(4);
        if (rest.length === 9) return `+55 ${ddd} ${rest.slice(0, 5)}-${rest.slice(5)}`;
        if (rest.length === 8) return `+55 ${ddd} ${rest.slice(0, 4)}-${rest.slice(4)}`;
        return `+${digits}`;
    }

    return `+${digits}`;
}

/**
 * Convert a phone number or phone JID into a WhatsApp JID.
 * Groups (@g.us), LIDs and broadcast lists are returned unchanged.
 */
export function toWhatsAppJid(input: string | undefined | null): string {
    if (!input) return "";

    const value = String(input).trim();
    if (!value) return "";

    if (value.includes("@")) {
        if (value.endsWith("@g.us") || value.endsWith("@lid") || value.includes("@broadcast")) {
            return value;
        }

        if (value.endsWith("@c.us") || value.endsWith("@s.whatsapp.net")) {
            const user = value.split("@")[0] || "";
            const phone = normalizeBrazilianPhone(user);
            return phone ? `${phone}@s.whatsapp.net` : "";
        }

        return value;
    }

    const phone = normalizeBrazilianPhone(value);
    return phone ? `${phone}@s.whatsapp.net` : "";
}

/**
 * Extract unique phone numbers (digits only, with BR 55 when needed)
 * from WhatsApp group participant objects.
 * Supports modern Baileys shape: `{ id: "...@lid", phoneNumber: "...@s.whatsapp.net" }`.
 */
export function extractPhonesFromParticipants(participants: unknown): string[] {
    return classifyGroupParticipants(participants).phones;
}

export type GroupParticipantClassification = {
    participantCount: number;
    phones: string[];
    uniquePhoneCount: number;
    duplicates: number;
    lidOnly: number;
    noPhone: number;
    invalid: number;
};

/**
 * Classify group participants: real phones vs LIDs / unavailable numbers.
 * Never treats @lid identifiers as telephone numbers.
 */
export function classifyGroupParticipants(
    participants: unknown
): GroupParticipantClassification {
    if (!Array.isArray(participants)) {
        return {
            participantCount: 0,
            phones: [],
            uniquePhoneCount: 0,
            duplicates: 0,
            lidOnly: 0,
            noPhone: 0,
            invalid: 0,
        };
    }

    const phones = new Set<string>();
    let duplicates = 0;
    let lidOnly = 0;
    let noPhone = 0;
    let invalid = 0;

    const extractOne = (raw?: string | null): string | null => {
        if (!raw || typeof raw !== "string") return null;
        if (raw.endsWith("@g.us") || raw.includes("@broadcast")) return null;
        if (raw.endsWith("@lid")) return null;
        const phone = normalizeBrazilianPhone(
            raw.includes("@") ? raw.split("@")[0] : raw
        );
        if (!phone || phone.length < 12) return null;
        if (!phone.startsWith("55") && phone.length > 13) return null;
        return phone;
    };

    for (const p of participants) {
        if (typeof p === "string") {
            if (p.endsWith("@lid")) {
                lidOnly++;
                continue;
            }
            const phone = extractOne(p);
            if (!phone) {
                invalid++;
                continue;
            }
            if (phones.has(phone)) {
                duplicates++;
            } else {
                phones.add(phone);
            }
            continue;
        }

        const obj = p as {
            id?: string;
            phoneNumber?: string;
            jid?: string;
            pn?: string;
        };
        const fromPhoneField =
            extractOne(obj.phoneNumber) ||
            extractOne(obj.pn) ||
            extractOne(obj.jid);
        if (fromPhoneField) {
            if (phones.has(fromPhoneField)) duplicates++;
            else phones.add(fromPhoneField);
            continue;
        }

        const id = obj.id || "";
        if (id.endsWith("@lid") || (!obj.phoneNumber && !obj.pn && id.includes("@lid"))) {
            lidOnly++;
            continue;
        }
        const fromId = extractOne(obj.id);
        if (fromId) {
            if (phones.has(fromId)) duplicates++;
            else phones.add(fromId);
            continue;
        }
        noPhone++;
    }

    const list = Array.from(phones);
    return {
        participantCount: participants.length,
        phones: list,
        uniquePhoneCount: list.length,
        duplicates,
        lidOnly,
        noPhone,
        invalid,
    };
}

/**
 * Parse a free-text / CSV / TXT list into normalized unique BR phones.
 */
export function parsePhoneList(raw: string): {
    phones: string[];
    invalid: string[];
    duplicates: number;
} {
    const tokens = raw
        .split(/[\n,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);

    const seen = new Set<string>();
    const phones: string[] = [];
    const invalid: string[] = [];
    let duplicates = 0;

    for (const token of tokens) {
        // Skip header-like tokens
        if (/^(phone|telefone|numero|número|jid|number)$/i.test(token)) continue;

        const phone = normalizeBrazilianPhone(token.includes("@") ? token.split("@")[0] : token);
        if (!phone || phone.length < 12) {
            invalid.push(token);
            continue;
        }
        if (seen.has(phone)) {
            duplicates++;
            continue;
        }
        seen.add(phone);
        phones.push(phone);
    }

    return { phones, invalid, duplicates };
}

export const BROADCAST_IMPORT_KEY = "wa_akg_broadcast_import";

/** Handoff from Groups menu → Datafy campaign Step 2 (phones only; no consent). */
export const DATAFY_GROUP_IMPORT_KEY = "wa_akg_datafy_group_import";
