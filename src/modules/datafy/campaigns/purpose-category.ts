/**
 * Campaign purpose (Finalidade) vs Meta template category.
 *
 * Purpose is an internal campaign classification (consent, freeform, gates).
 * Meta category (MARKETING | UTILITY | AUTHENTICATION) comes from the approved
 * template sync and is what Meta uses for delivery/billing classification.
 * Selecting Finalidade=Utilidade NEVER reclassifies a MARKETING template.
 */

export type MetaTemplateCategory =
    | "MARKETING"
    | "UTILITY"
    | "AUTHENTICATION"
    | "UNKNOWN";

export function normalizeMetaCategory(
    raw: string | null | undefined
): MetaTemplateCategory {
    const c = String(raw || "")
        .trim()
        .toUpperCase();
    if (c === "MARKETING" || c === "UTILITY" || c === "AUTHENTICATION") {
        return c;
    }
    if (!c) return "UNKNOWN";
    return "UNKNOWN";
}

export function purposeLabelPt(purpose: string | null | undefined): string {
    switch (String(purpose || "").toLowerCase()) {
        case "marketing":
            return "Marketing";
        case "utility":
            return "Utilidade";
        case "transactional":
            return "Transacional";
        case "authentication":
            return "Autenticação";
        case "texto_livre":
            return "Texto livre";
        case "other":
            return "Outra";
        default:
            return String(purpose || "—");
    }
}

export function metaCategoryLabelPt(
    cat: MetaTemplateCategory | string | null | undefined
): string {
    switch (normalizeMetaCategory(cat)) {
        case "MARKETING":
            return "Marketing";
        case "UTILITY":
            return "Utilidade";
        case "AUTHENTICATION":
            return "Autenticação";
        default:
            return "Não confirmado";
    }
}

/**
 * Expected billing classification for UI — derived from Meta-approved category.
 * Never invents UTILITY from campaign purpose.
 */
export function expectedBillingCategory(
    metaCategory: string | null | undefined
): {
    code: MetaTemplateCategory;
    label: string;
    confirmed: boolean;
} {
    const code = normalizeMetaCategory(metaCategory);
    if (code === "UNKNOWN") {
        return {
            code,
            label: "Não confirmado",
            confirmed: false,
        };
    }
    return {
        code,
        label: metaCategoryLabelPt(code),
        confirmed: true,
    };
}

export type PurposeCategoryMismatch = {
    mismatch: boolean;
    purpose: string;
    metaCategories: MetaTemplateCategory[];
    message: string | null;
};

/**
 * Detect Finalidade Utilidade + Meta MARKETING (or mixed) templates.
 */
export function detectPurposeCategoryMismatch(opts: {
    purpose: string | null | undefined;
    templateCategories: Array<string | null | undefined>;
}): PurposeCategoryMismatch {
    const purpose = String(opts.purpose || "").toLowerCase();
    const metaCategories = [
        ...new Set(
            opts.templateCategories.map((c) => normalizeMetaCategory(c))
        ),
    ];
    const hasMarketing = metaCategories.includes("MARKETING");
    if (purpose === "utility" && hasMarketing) {
        return {
            mismatch: true,
            purpose,
            metaCategories,
            message:
                "Esta campanha está marcada como Utilidade, mas o template selecionado está aprovado pela Meta como Marketing. O envio deste template não será convertido em Utilidade por essa seleção.",
        };
    }
    return {
        mismatch: false,
        purpose,
        metaCategories,
        message: null,
    };
}

/**
 * Category to request when *creating* a new custom template for Meta approval.
 * Must NOT silently map utility purpose → UTILITY for freight bulletins.
 * Caller should pass an explicit category; default is MARKETING.
 */
export function categoryForNewTemplateSubmit(opts: {
    explicitCategory?: string | null;
    /** @deprecated Do not use purpose to choose Meta category */
    purpose?: string | null;
}): "MARKETING" | "UTILITY" | "AUTHENTICATION" {
    const explicit = normalizeMetaCategory(opts.explicitCategory);
    if (
        explicit === "MARKETING" ||
        explicit === "UTILITY" ||
        explicit === "AUTHENTICATION"
    ) {
        return explicit;
    }
    // Safe default for Bom Frete frete offers — never invent UTILITY from purpose.
    return "MARKETING";
}

/** Summarize categories across bulletin parts for review UI. */
export function summarizeTemplateCategories(
    parts: Array<{
        templateName?: string | null;
        templateCategory?: string | null;
        templateApprovalStatus?: string | null;
    }>
): Array<{
    name: string;
    category: MetaTemplateCategory;
    categoryLabel: string;
    approvalStatus: string | null;
    billingLabel: string;
}> {
    return parts.map((p) => {
        const category = normalizeMetaCategory(p.templateCategory);
        const billing = expectedBillingCategory(category);
        return {
            name: p.templateName || "—",
            category,
            categoryLabel: metaCategoryLabelPt(category),
            approvalStatus: p.templateApprovalStatus || null,
            billingLabel: billing.label,
        };
    });
}
