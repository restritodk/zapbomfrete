import type {
    BulletinAnalysis,
    BulletinLoad,
    BulletinPart,
    CampaignMessagePart,
} from "./types";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    LOAD_SLOT_FIELDS,
    fillTemplatePreview,
    matchLibrarySpec,
    sanitizeTemplateParam,
    type BulletinTemplateSpec,
} from "./library";

// Re-export match helpers that library doesn't export as ApprovedTemplateLite
export type { BulletinTemplateSpec };

export type ApprovedTemplateLite = {
    name: string;
    language: string;
    status: string;
    category?: string;
    components?: unknown[];
};

type MatchedTemplate = ApprovedTemplateLite & {
    spec: BulletinTemplateSpec;
};

/**
 * Map APPROVED Datafy templates to library specs (1/2/3 loads).
 */
export function resolveReusableBulletinTemplates(
    templates: ApprovedTemplateLite[]
): MatchedTemplate[] {
    const approved = templates.filter(
        (t) => String(t.status || "").toUpperCase() === "APPROVED"
    );
    const matched: MatchedTemplate[] = [];
    for (const t of approved) {
        const spec = matchLibrarySpec(t);
        if (!spec) continue;
        matched.push({ ...t, spec });
    }
    // Prefer larger packs when multiple matches for same capacity
    matched.sort((a, b) => b.spec.loadsPerMessage - a.spec.loadsPerMessage);
    return matched;
}

function pickTemplateForCapacity(
    matched: MatchedTemplate[],
    capacity: number,
    preferredCategory?: string
): MatchedTemplate | null {
    const pool = matched.filter((m) => m.spec.loadsPerMessage === capacity);
    if (!pool.length) return null;
    if (preferredCategory) {
        const pref = pool.find(
            (m) =>
                String(m.category || "").toUpperCase() ===
                preferredCategory.toUpperCase()
        );
        if (pref) return pref;
    }
    // Prefer MARKETING for load broadcast when available
    const marketing = pool.find(
        (m) => String(m.category || "").toUpperCase() === "MARKETING"
    );
    return marketing || pool[0];
}

function valuesForLoad(load: BulletinLoad): string[] {
    const f = load.fields;
    return LOAD_SLOT_FIELDS.map((key) => {
        if (key === "localizacao") {
            return sanitizeTemplateParam(f.localizacaoUrl);
        }
        if (key === "detalhes") {
            return sanitizeTemplateParam(f.detalhes);
        }
        if (key === "origem") return sanitizeTemplateParam(f.origem);
        if (key === "destino") return sanitizeTemplateParam(f.destino);
        if (key === "terminal") return sanitizeTemplateParam(f.terminal);
        if (key === "lote") return sanitizeTemplateParam(f.lote);
        if (key === "pedagio") return sanitizeTemplateParam(f.pedagio);
        return "N/D";
    });
}

function bodyTextOf(t: ApprovedTemplateLite): string | null {
    if (!Array.isArray(t.components)) return null;
    for (const c of t.components) {
        const comp = c as { type?: string; text?: string };
        if (String(comp.type || "").toUpperCase() === "BODY" && comp.text) {
            return comp.text;
        }
    }
    return null;
}

/**
 * Pack loads into 1/2/3-load messages using available reusable templates,
 * fill positional variables, and mark compatibility.
 */
export function composeReusableBulletinParts(
    analysis: BulletinAnalysis,
    templates: ApprovedTemplateLite[],
    opts?: { purpose?: string }
): CampaignMessagePart[] {
    const loads = analysis.loads;
    if (!loads.length) {
        return [];
    }

    const matched = resolveReusableBulletinTemplates(templates);
    const availableCaps = ([3, 2, 1] as const).filter((c) =>
        matched.some((m) => m.spec.loadsPerMessage === c)
    );

    const preferredCategory =
        opts?.purpose === "utility" ? "UTILITY" : "MARKETING";

    if (!availableCaps.length) {
        // No reusable library template approved — one blocked part explaining the gap
        return [
            {
                index: 0,
                label: `${analysis.title} — sem template reutilizável`,
                bodyText: analysis.rawText.slice(0, 500),
                loadIndexes: loads.map((l) => l.index),
                charCount: analysis.rawText.length,
                readyForRealSend: false,
                compatibility: "missing_template",
                blockReason:
                    "Nenhum template APPROVED da biblioteca de boletins (boletim_1_carga / boletim_2_cargas / boletim_3_cargas). Aprove esses modelos uma vez em Integrações → Datafy e reutilize diariamente.",
                policyWarning:
                    "Divulgação de cargas costuma ser MARKETING na Meta — não force UTILITY só para facilitar aprovação.",
            },
        ];
    }

    const parts: CampaignMessagePart[] = [];
    let cursor = 0;
    let partIndex = 0;

    while (cursor < loads.length) {
        const remaining = loads.length - cursor;
        const capacity =
            availableCaps.find((c) => c <= remaining) ||
            availableCaps[availableCaps.length - 1];
        const slice = loads.slice(cursor, cursor + capacity);
        const tmpl = pickTemplateForCapacity(
            matched,
            capacity,
            preferredCategory
        );

        if (!tmpl) {
            parts.push({
                index: partIndex,
                label: `${analysis.title} — PARTE ${partIndex + 1}`,
                bodyText: slice.map((l) => l.text).join("\n\n"),
                loadIndexes: slice.map((l) => l.index),
                charCount: slice.reduce((s, l) => s + l.charCount, 0),
                readyForRealSend: false,
                compatibility: "missing_template",
                blockReason: `Sem template APPROVED para ${capacity} carga(s) por mensagem.`,
            });
            cursor += slice.length;
            partIndex++;
            continue;
        }

        const bodyValues = slice.flatMap(valuesForLoad);
        // Pad to expected variable count with N/D
        while (bodyValues.length < tmpl.spec.variableCount) {
            bodyValues.push("N/D");
        }
        const trimmed = bodyValues.slice(0, tmpl.spec.variableCount);

        const overflow = trimmed.some(
            (v) => v.length >= 1024 && v.endsWith("…")
        );

        const templateBody =
            bodyTextOf(tmpl) || tmpl.spec.bodyTextForApproval;
        const filled = fillTemplatePreview(templateBody, trimmed);

        const cat = String(tmpl.category || "").toUpperCase();
        let policyWarning: string | null = null;
        if (
            preferredCategory === "MARKETING" &&
            cat === "UTILITY"
        ) {
            policyWarning =
                "Template UTILITY selecionado para divulgação de cargas — revise a classificação Meta (geralmente MARKETING).";
        }

        const totalPartsEstimate = Math.ceil(
            loads.length / (availableCaps[0] || 1)
        );
        const label =
            totalPartsEstimate > 1 || loads.length > capacity
                ? `${analysis.title} — PARTE ${partIndex + 1}`
                : analysis.title;

        parts.push({
            index: partIndex,
            label,
            bodyText: filled,
            loadIndexes: slice.map((l) => l.index),
            charCount: filled.length,
            templateName: tmpl.name,
            templateLanguage: tmpl.language || "pt_BR",
            templateCategory: tmpl.category || tmpl.spec.recommendedCategory,
            templateApprovalStatus: "APPROVED",
            templateComponents: tmpl.components || null,
            variableMapping: { body: trimmed },
            libraryTemplateId: tmpl.spec.id,
            readyForRealSend: !overflow,
            compatibility: overflow ? "param_overflow" : "ready",
            blockReason: overflow
                ? "Um ou mais campos excedem o limite de 1024 caracteres da variável Meta (valor truncado na prévia — revise o boletim)."
                : null,
            policyWarning,
        });

        cursor += slice.length;
        partIndex++;
    }

    // Fix PART X/Y labels with final count
    const total = parts.length;
    if (total > 1) {
        for (const p of parts) {
            p.label = `${analysis.title} — PARTE ${p.index + 1}/${total}`;
        }
    }

    return parts;
}

/**
 * @deprecated Prefer composeReusableBulletinParts — kept for transitional callers.
 * Exact body match is no longer the primary strategy for daily bulletins.
 */
export function associatePartsWithTemplates(
    parts: BulletinPart[],
    templates: ApprovedTemplateLite[],
    opts?: { purpose?: string }
): CampaignMessagePart[] {
    // Bridge: rebuild a minimal analysis from free-text parts (legacy)
    const loads: BulletinLoad[] = parts.flatMap((p) =>
        p.loadIndexes.map((idx) => ({
            index: idx,
            text: p.bodyText,
            fields: {},
            charCount: p.bodyText.length,
            exceedsLimit: false,
        }))
    );
    // Deduplicate by index
    const byIdx = new Map<number, BulletinLoad>();
    for (const l of loads) {
        if (!byIdx.has(l.index)) byIdx.set(l.index, l);
    }
    const analysis: BulletinAnalysis = {
        title: "Boletim de cargas",
        rawText: parts.map((p) => p.bodyText).join("\n\n"),
        loads: Array.from(byIdx.values()).sort((a, b) => a.index - b.index),
        parts,
        loadCount: byIdx.size,
        partCount: parts.length,
        warnings: [],
        totalChars: parts.reduce((s, p) => s + p.charCount, 0),
    };
    if (!analysis.loads.length) {
        return composeReusableBulletinParts(
            {
                ...analysis,
                loads: parts.map((p, i) => ({
                    index: i,
                    text: p.bodyText,
                    fields: {},
                    charCount: p.charCount,
                    exceedsLimit: false,
                })),
            },
            templates,
            opts
        );
    }
    return composeReusableBulletinParts(analysis, templates, opts);
}

export function allPartsReadyForRealSend(parts: CampaignMessagePart[]): boolean {
    return parts.length > 0 && parts.every((p) => p.readyForRealSend);
}

export function partsBlockingReasons(parts: CampaignMessagePart[]): string[] {
    return parts
        .filter((p) => !p.readyForRealSend)
        .map(
            (p) =>
                `Parte ${p.index + 1}: ${p.blockReason || "Template não aprovado"}`
        );
}

export function libraryApprovalChecklist(): Array<{
    preferredName: string;
    loadsPerMessage: number;
    variableCount: number;
    recommendedCategory: string;
    description: string;
}> {
    return BULLETIN_TEMPLATE_LIBRARY.map((s) => ({
        preferredName: s.preferredName,
        loadsPerMessage: s.loadsPerMessage,
        variableCount: s.variableCount,
        recommendedCategory: s.recommendedCategory,
        description: s.description,
    }));
}
