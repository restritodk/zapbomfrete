/**
 * Pure helpers for associating APPROVED managed templates to bulletin cards.
 * Compatibility is based on loadsPerMessage (loadIndexes), not name similarity.
 */

export type AssociateCardSource = {
    id: string;
    position: number;
    loadIndexes?: number[] | null;
    loadSummary?: string | null;
    technicalName?: string | null;
    displayName?: string | null;
    approvalStatus?: string | null;
    language?: string | null;
    category?: string | null;
    managedTemplateId?: string | null;
    bodyPreview?: string | null;
};

export type AssociateVersionSource = {
    publicKey: string;
    version: number;
    versionId: string;
    title?: string | null;
    name?: string | null;
    cardCount: number;
    cards: AssociateCardSource[];
};

export type CompatibleCardOption = {
    value: string;
    label: string;
    loads: number;
    versionId: string;
    position: number;
    publicKey: string;
    version: number;
    language: string;
    alreadyLinked: boolean;
    technicalName: string | null;
};

/** Prefer authoritative loadIndexes length; never invent from digit count in summary. */
export function cardLoadsCount(card: AssociateCardSource): number {
    if (Array.isArray(card.loadIndexes) && card.loadIndexes.length > 0) {
        return card.loadIndexes.length;
    }
    return 0;
}

export function isLoadsCompatible(
    templateLoads: number,
    cardLoads: number
): boolean {
    const t = Math.max(0, templateLoads || 0);
    const c = Math.max(0, cardLoads || 0);
    if (t <= 0 || c <= 0) return false;
    return t === c;
}

export function buildCompatibleCardOptions(
    versions: AssociateVersionSource[],
    opts: {
        templateLoadsPerMessage: number;
        templateLanguage?: string | null;
        /** When true, omit cards that already have a managedTemplateId. */
        excludeAlreadyLinked?: boolean;
    }
): CompatibleCardOption[] {
    const templateLoads = Math.max(1, opts.templateLoadsPerMessage || 1);
    const lang = String(opts.templateLanguage || "")
        .trim()
        .toLowerCase();
    const out: CompatibleCardOption[] = [];

    for (const v of versions) {
        for (const c of v.cards || []) {
            const loads = cardLoadsCount(c);
            if (!isLoadsCompatible(templateLoads, loads)) continue;
            if (lang) {
                const cardLang = String(c.language || "pt_BR")
                    .trim()
                    .toLowerCase();
                if (cardLang && cardLang !== lang) continue;
            }
            const alreadyLinked = Boolean(c.managedTemplateId);
            if (opts.excludeAlreadyLinked && alreadyLinked) continue;

            const summary =
                c.loadSummary?.trim() ||
                (loads === 1 ? "1 carga" : `${loads} cargas`);
            out.push({
                value: c.id,
                label: `${v.publicKey} v${v.version} · Card ${c.position}/${v.cardCount} · ${summary}${
                    alreadyLinked ? " · já vinculado" : ""
                }`,
                loads,
                versionId: v.versionId,
                position: c.position,
                publicKey: v.publicKey,
                version: v.version,
                language: String(c.language || "pt_BR"),
                alreadyLinked,
                technicalName: c.technicalName || null,
            });
        }
    }
    return out;
}

export function emptyCompatMessage(opts: {
    templateLoadsPerMessage: number;
    templateLanguage?: string | null;
    totalCards: number;
    totalVersions: number;
}): string {
    if (opts.totalVersions === 0 || opts.totalCards === 0) {
        return "Nenhum card de boletim/versão encontrado. Crie um boletim no Criador ou gere um card compatível a partir deste template.";
    }
    const loads = Math.max(1, opts.templateLoadsPerMessage || 1);
    const lang = opts.templateLanguage || "pt_BR";
    return `Nenhum card compatível encontrado para este template (${loads} carga${loads === 1 ? "" : "s"}/msg · ${lang}). Os cards existentes têm quantidade de cargas ou idioma diferente.`;
}

/** Resolve synthetic builtin:… ids for association APIs. */
export function parseManagedAssociationRef(raw: string): {
    kind: "id" | "builtin";
    value: string;
} {
    const s = String(raw || "").trim();
    if (s.startsWith("builtin:")) {
        return { kind: "builtin", value: s.slice("builtin:".length) };
    }
    return { kind: "id", value: s };
}
