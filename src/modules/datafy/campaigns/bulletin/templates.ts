import type {
    BulletinAnalysis,
    BulletinLoad,
    BulletinLoadFields,
    BulletinPart,
    CampaignMessagePart,
} from "./types";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    fillTemplatePreview,
    matchLibrarySpec,
    sanitizeTemplateParam,
    type BulletinTemplateSpec,
    type LoadSlotField,
} from "./library";

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
 * Map APPROVED Datafy templates to library specs (v1 + v2).
 * Prefer richer (v2) and larger packs when sorting.
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
    matched.sort((a, b) => {
        if (b.spec.loadsPerMessage !== a.spec.loadsPerMessage) {
            return b.spec.loadsPerMessage - a.spec.loadsPerMessage;
        }
        return b.spec.generation - a.spec.generation;
    });
    return matched;
}

function pickTemplateForCapacity(
    matched: MatchedTemplate[],
    capacity: number,
    preferredCategory?: string
): MatchedTemplate | null {
    const pool = matched.filter((m) => m.spec.loadsPerMessage === capacity);
    if (!pool.length) return null;
    // Prefer v2 (richer) then category
    const sorted = [...pool].sort(
        (a, b) => b.spec.generation - a.spec.generation
    );
    if (preferredCategory) {
        const pref = sorted.find(
            (m) =>
                String(m.category || "").toUpperCase() ===
                preferredCategory.toUpperCase()
        );
        if (pref) return pref;
    }
    const marketing = sorted.find(
        (m) => String(m.category || "").toUpperCase() === "MARKETING"
    );
    return marketing || sorted[0];
}

function fieldValue(
    fields: BulletinLoadFields,
    key: LoadSlotField
): string {
    switch (key) {
        case "localizacao":
            return sanitizeTemplateParam(fields.localizacaoUrl);
        case "origem":
            return sanitizeTemplateParam(fields.origem);
        case "localCarregamento":
            return sanitizeTemplateParam(fields.localCarregamento);
        case "destino":
            return sanitizeTemplateParam(fields.destino);
        case "terminal":
            return sanitizeTemplateParam(fields.terminal);
        case "janela":
            return sanitizeTemplateParam(fields.janela);
        case "veiculo":
            return sanitizeTemplateParam(fields.veiculo);
        case "quantidade":
            return sanitizeTemplateParam(
                fields.quantidade || fields.lote
            );
        case "frete":
            return sanitizeTemplateParam(fields.frete);
        case "lote":
            return sanitizeTemplateParam(fields.lote);
        case "pedagio":
            return sanitizeTemplateParam(fields.pedagio);
        case "observacoes":
            return sanitizeTemplateParam(
                fields.observacoes || fields.detalhes
            );
        case "detalhes":
            return sanitizeTemplateParam(fields.detalhes);
        default:
            return "N/D";
    }
}

export function valuesForLoad(
    load: BulletinLoad,
    slotFields: LoadSlotField[]
): string[] {
    return slotFields.map((key) => fieldValue(load.fields, key));
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
                    "Nenhum template APPROVED da biblioteca de boletins (v1 boletim_* ou v2 boletim_v2_*). Aprove os modelos em Integrações → Datafy.",
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

        const bodyValues = slice.flatMap((load) =>
            valuesForLoad(load, tmpl.spec.slotFields)
        );
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
        if (preferredCategory === "MARKETING" && cat === "UTILITY") {
            policyWarning =
                "Template UTILITY selecionado para divulgação de cargas — revise a classificação Meta (geralmente MARKETING).";
        }
        if (tmpl.spec.generation === 1) {
            policyWarning = [
                policyWarning,
                "Usando template v1 (7 campos). Campos ricos (frete/janela/veículo) vão em Detalhes até aprovar boletim_v2_*.",
            ]
                .filter(Boolean)
                .join(" ");
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

    const total = parts.length;
    if (total > 1) {
        for (const p of parts) {
            p.label = `${analysis.title} — PARTE ${p.index + 1}/${total}`;
        }
    }

    return parts;
}

/**
 * @deprecated Prefer composeReusableBulletinParts
 */
export function associatePartsWithTemplates(
    parts: BulletinPart[],
    templates: ApprovedTemplateLite[],
    opts?: { purpose?: string }
): CampaignMessagePart[] {
    const loads: BulletinLoad[] = parts.flatMap((p) =>
        p.loadIndexes.map((idx) => ({
            index: idx,
            text: p.bodyText,
            fields: {},
            unrecognizedLines: [],
            ambiguous: [],
            charCount: p.bodyText.length,
            exceedsLimit: false,
            completeness: 0,
        }))
    );
    const byIdx = new Map<number, BulletinLoad>();
    for (const l of loads) {
        if (!byIdx.has(l.index)) byIdx.set(l.index, l);
    }
    const analysis: BulletinAnalysis = {
        title: "Boletim de cargas",
        rawText: parts.map((p) => p.bodyText).join("\n\n"),
        general: { title: "Boletim de cargas" },
        loads: Array.from(byIdx.values()).sort((a, b) => a.index - b.index),
        parts,
        loadCount: byIdx.size,
        partCount: parts.length,
        warnings: [],
        totalChars: parts.reduce((s, p) => s + p.charCount, 0),
        unrecognizedLines: [],
    };
    if (!analysis.loads.length) {
        return composeReusableBulletinParts(
            {
                ...analysis,
                loads: parts.map((p, i) => ({
                    index: i,
                    text: p.bodyText,
                    fields: {},
                    unrecognizedLines: [],
                    ambiguous: [],
                    charCount: p.charCount,
                    exceedsLimit: false,
                    completeness: 0,
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
    generation: number;
    recommendedCategory: string;
    description: string;
}> {
    return BULLETIN_TEMPLATE_LIBRARY.map((s) => ({
        preferredName: s.preferredName,
        loadsPerMessage: s.loadsPerMessage,
        variableCount: s.variableCount,
        generation: s.generation,
        recommendedCategory: s.recommendedCategory,
        description: s.description,
    }));
}
