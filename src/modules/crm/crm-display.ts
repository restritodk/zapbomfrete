/**
 * UI-only helpers for CRM Bom Frete (labels, avatars).
 * Does not mutate consent or contact records.
 */

export function crmConsentLabel(status: string | null | undefined): string {
    switch (String(status || "").toLowerCase()) {
        case "granted":
            return "Concedido";
        case "denied":
            return "Recusado";
        case "opted_out":
            return "Revogado";
        case "unknown":
        case "":
            return "Não informado";
        default:
            return String(status);
    }
}

export function crmConsentTone(
    status: string | null | undefined
): "granted" | "unknown" | "denied" | "revoked" | "other" {
    switch (String(status || "").toLowerCase()) {
        case "granted":
            return "granted";
        case "denied":
            return "denied";
        case "opted_out":
            return "revoked";
        case "unknown":
        case "":
            return "unknown";
        default:
            return "other";
    }
}

/** Initials for avatar; empty when no usable name. */
export function contactInitials(fullName: string | null | undefined): string {
    const parts = String(fullName || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!parts.length) return "";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[parts.length - 1][0] || ""}`.toUpperCase();
}

export function contactDisplayName(
    fullName: string | null | undefined
): string {
    const n = String(fullName || "").trim();
    return n || "Contato sem nome";
}

export function formatCrmDateTime(iso: string | null | undefined): string {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    } catch {
        return iso;
    }
}

export function percentOf(part: number, total: number): string {
    if (!total) return "0%";
    return `${((part / total) * 100).toFixed(1)}%`;
}
