import type {
    BulletinAnalysis,
    BulletinLoad,
    BulletinLoadFields,
    BulletinPart,
    CampaignMessagePart,
} from "./types";
import { META_TEMPLATE_BODY_MAX } from "./types";
import {
    BULLETIN_TEMPLATE_LIBRARY,
    fillTemplatePreview,
    matchLibrarySpec,
    sanitizeTemplateParam,
    type BulletinTemplateSpec,
    type LoadSlotField,
} from "./library";
import {
    expandSlotCoverage,
    filledLoadFieldKeys,
    hasCatchAll,
    uncoveredFilledFields,
} from "./field-map";
import { packParts, stripFieldLabelPrefix } from "./analyze";

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
 * Map APPROVED Datafy templates to library specs.
 * Matching uses name + explicit field mappings — not variable count alone.
 */
export function resolveReusableBulletinTemplates(
    templates: ApprovedTemplateLite[],
    library: BulletinTemplateSpec[] = BULLETIN_TEMPLATE_LIBRARY
): MatchedTemplate[] {
    const approved = templates.filter(
        (t) => String(t.status || "").toUpperCase() === "APPROVED"
    );
    const matched: MatchedTemplate[] = [];
    for (const t of approved) {
        const spec = matchLibrarySpec(t, library);
        if (!spec) continue;
        matched.push({ ...t, spec });
    }
    matched.sort((a, b) => {
        if (b.spec.loadsPerMessage !== a.spec.loadsPerMessage) {
            return b.spec.loadsPerMessage - a.spec.loadsPerMessage;
        }
        // Prefer richer atomic coverage (composites expand), then newer generation
        const covA = expandSlotCoverage(a.spec.slotFields).length;
        const covB = expandSlotCoverage(b.spec.slotFields).length;
        if (covB !== covA) return covB - covA;
        return b.spec.generation - a.spec.generation;
    });
    return matched;
}

function pickTemplateForCapacity(
    matched: MatchedTemplate[],
    capacity: number,
    preferredCategory: string | undefined,
    slice: BulletinLoad[]
): MatchedTemplate | null {
    const pool = matched.filter((m) => m.spec.loadsPerMessage === capacity);
    if (!pool.length) return null;
    const scored = pool.map((m) => {
        const cov = coverageForSlice(slice, m.spec.slotFields);
        return {
            m,
            ok: cov.ok,
            uncovered: cov.uncovered.length,
            fields: expandSlotCoverage(m.spec.slotFields).length,
            gen: m.spec.generation,
            cat: String(m.category || "").toUpperCase(),
        };
    });
    scored.sort((a, b) => {
        if (a.ok !== b.ok) return a.ok ? -1 : 1;
        if (a.uncovered !== b.uncovered) return a.uncovered - b.uncovered;
        if (preferredCategory) {
            const ap = a.cat === preferredCategory.toUpperCase() ? 1 : 0;
            const bp = b.cat === preferredCategory.toUpperCase() ? 1 : 0;
            if (ap !== bp) return bp - ap;
        }
        if (a.fields !== b.fields) return b.fields - a.fields;
        return b.gen - a.gen;
    });
    return scored[0]?.m || null;
}

function cleanParam(
    key: keyof BulletinLoadFields | "localizacao",
    raw: string | null | undefined
): string {
    if (!raw?.trim()) return "N/D";
    const fieldKey: keyof BulletinLoadFields =
        key === "localizacao" ? "localizacaoUrl" : key;
    const stripped = stripFieldLabelPrefix(fieldKey, raw);
    return sanitizeTemplateParam(stripped);
}

function joinComposite(...parts: string[]): string {
    const cleaned = parts
        .map((p) => p.trim())
        .filter((p) => p && p !== "N/D");
    if (!cleaned.length) return "N/D";
    return sanitizeTemplateParam(cleaned.join(" · "));
}

function fieldValue(
    fields: BulletinLoadFields,
    key: LoadSlotField
): string {
    switch (key) {
        case "localizacao":
            return cleanParam("localizacao", fields.localizacaoUrl);
        case "origem":
            return cleanParam("origem", fields.origem);
        case "localCarregamento":
            return cleanParam("localCarregamento", fields.localCarregamento);
        case "destino":
            return cleanParam("destino", fields.destino);
        case "terminal":
            return cleanParam("terminal", fields.terminal);
        case "janela":
            return cleanParam("janela", fields.janela);
        case "veiculo":
            return cleanParam("veiculo", fields.veiculo);
        case "quantidade":
            return cleanParam(
                "quantidade",
                fields.quantidade || fields.lote
            );
        case "frete":
            return cleanParam("frete", fields.frete);
        case "lote":
            return cleanParam("lote", fields.lote);
        case "pedagio":
            return cleanParam("pedagio", fields.pedagio);
        case "rotaOrigem":
            return joinComposite(
                cleanParam("origem", fields.origem),
                cleanParam("localCarregamento", fields.localCarregamento)
            );
        case "rotaDestino":
            return joinComposite(
                cleanParam("destino", fields.destino),
                cleanParam("terminal", fields.terminal)
            );
        case "veiculoQtd":
            return joinComposite(
                cleanParam("veiculo", fields.veiculo),
                cleanParam("quantidade", fields.quantidade || fields.lote)
            );
        case "fretePedagio":
            return joinComposite(
                cleanParam("frete", fields.frete),
                cleanParam("pedagio", fields.pedagio)
            );
        case "mapaObs": {
            let obs = fields.observacoes || "";
            if (fields.localizacaoUrl && obs) {
                obs = obs
                    .split(" · ")
                    .filter((p) => !p.includes(fields.localizacaoUrl!))
                    .join(" · ");
            }
            return joinComposite(
                cleanParam("localizacao", fields.localizacaoUrl),
                obs.trim() ? cleanParam("observacoes", obs) : "N/D"
            );
        }
        case "observacoes": {
            // Never fall back to detalhes — that re-injects Janela/Frete into Obs.
            let obs = fields.observacoes || "";
            if (fields.localizacaoUrl && obs) {
                obs = obs
                    .split(" · ")
                    .filter((p) => !p.includes(fields.localizacaoUrl!))
                    .join(" · ");
            }
            return obs.trim()
                ? cleanParam("observacoes", obs)
                : "N/D";
        }
        case "detalhes":
            return cleanParam("detalhes" as keyof BulletinLoadFields, fields.detalhes);
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
function coverageForSlice(
    slice: BulletinLoad[],
    mappings: LoadSlotField[]
): { ok: boolean; uncovered: LoadSlotField[]; usesCatchAll: boolean } {
    const filled = new Set<LoadSlotField>();
    for (const load of slice) {
        for (const k of filledLoadFieldKeys(load.fields)) filled.add(k);
    }
    const uncovered = uncoveredFilledFields([...filled], mappings);
    const catchAll = hasCatchAll(mappings);
    return {
        ok: uncovered.length === 0 || catchAll,
        uncovered,
        usesCatchAll: catchAll && uncovered.length > 0,
    };
}

export function composeReusableBulletinParts(
    analysis: BulletinAnalysis,
    templates: ApprovedTemplateLite[],
    opts?: { purpose?: string; library?: BulletinTemplateSpec[] }
): CampaignMessagePart[] {
    const loads = analysis.loads;
    if (!loads.length) {
        return [];
    }

    const library = opts?.library?.length
        ? opts.library
        : BULLETIN_TEMPLATE_LIBRARY;
    const matched = resolveReusableBulletinTemplates(templates, library);
    const availableCaps = ([3, 2, 1] as const).filter((c) =>
        matched.some((m) => m.spec.loadsPerMessage === c)
    );

    const preferredCategory =
        opts?.purpose === "utility" ? "UTILITY" : "MARKETING";

    if (!availableCaps.length) {
        // Full char-aware packing for preview — never silently truncate to 500 chars
        const packed =
            analysis.parts?.length > 0
                ? analysis.parts
                : packParts(analysis.title, loads).parts;
        const partsOut: CampaignMessagePart[] = packed.map((p, i) => ({
            index: i,
            label: p.label,
            bodyText: p.bodyText,
            loadIndexes: p.loadIndexes,
            charCount: p.charCount,
            readyForRealSend: false,
            compatibility: "missing_template" as const,
            blockReason:
                "Nenhum template APPROVED compatível na biblioteca gerenciada. Crie/aprove modelos em Integrações → Datafy com mapeamento de campos.",
            policyWarning:
                "Divulgação de cargas costuma ser MARKETING na Meta — não force UTILITY só para facilitar aprovação." +
                (p.charCount > META_TEMPLATE_BODY_MAX
                    ? ` Parte ${i + 1} tem ${p.charCount} chars (limite ${META_TEMPLATE_BODY_MAX}).`
                    : ""),
        }));
        return partsOut.length
            ? partsOut
            : [
                  {
                      index: 0,
                      label: `${analysis.title} — sem template reutilizável`,
                      bodyText: analysis.rawText,
                      loadIndexes: loads.map((l) => l.index),
                      charCount: analysis.rawText.length,
                      readyForRealSend: false,
                      compatibility: "missing_template",
                      blockReason:
                          "Nenhum template APPROVED compatível na biblioteca gerenciada. Crie/aprove modelos em Integrações → Datafy com mapeamento de campos.",
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
            preferredCategory,
            slice
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

        const coverage = coverageForSlice(slice, tmpl.spec.slotFields);
        const bodyValues = slice.flatMap((load) => {
            const vals = valuesForLoad(load, tmpl.spec.slotFields);
            if (coverage.usesCatchAll) {
                // Append uncovered filled fields into catch-all slot (last observacoes/detalhes)
                const catchIdx = [...tmpl.spec.slotFields]
                    .map((k, i) =>
                        k === "observacoes" ||
                        k === "detalhes" ||
                        k === "mapaObs"
                            ? i
                            : -1
                    )
                    .filter((i) => i >= 0)
                    .pop();
                const catchKey =
                    catchIdx != null && catchIdx >= 0
                        ? tmpl.spec.slotFields[catchIdx]
                        : null;
                // `detalhes` already aggregates frete/janela/veículo — never re-append
                if (
                    catchIdx != null &&
                    catchIdx >= 0 &&
                    (catchKey === "observacoes" || catchKey === "mapaObs")
                ) {
                    const extra = uncoveredFilledFields(
                        filledLoadFieldKeys(load.fields),
                        tmpl.spec.slotFields
                    )
                        .map((k) => {
                            const f = load.fields;
                            const map: Record<string, string | undefined> = {
                                origem: f.origem,
                                localCarregamento: f.localCarregamento,
                                destino: f.destino,
                                terminal: f.terminal,
                                janela: f.janela,
                                veiculo: f.veiculo,
                                quantidade: f.quantidade,
                                frete: f.frete,
                                lote: f.lote,
                                localizacao: f.localizacaoUrl,
                                pedagio: f.pedagio,
                            };
                            const val = map[k];
                            if (!val) return null;
                            const base =
                                vals[catchIdx] === "N/D" ? "" : vals[catchIdx];
                            // Skip if already present in observações text
                            if (
                                base &&
                                base.toLowerCase().includes(val.toLowerCase())
                            ) {
                                return null;
                            }
                            return `${k}: ${val}`;
                        })
                        .filter(Boolean);
                    if (extra.length) {
                        const base = vals[catchIdx] === "N/D" ? "" : vals[catchIdx];
                        vals[catchIdx] = sanitizeTemplateParam(
                            [base, ...extra].filter(Boolean).join(" · ")
                        );
                    }
                }
            }
            return vals;
        });
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
        if (coverage.usesCatchAll) {
            policyWarning = [
                policyWarning,
                `Campos sem slot dedicado (${coverage.uncovered.join(", ")}) foram anexados em observações/detalhes — revise a prévia.`,
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

        const blockedCoverage = !coverage.ok;
        const bodyTooLong = filled.length > META_TEMPLATE_BODY_MAX;
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
            readyForRealSend:
                !overflow && !blockedCoverage && !bodyTooLong,
            compatibility: blockedCoverage
                ? "incomplete_fields"
                : overflow || bodyTooLong
                  ? "param_overflow"
                  : "ready",
            blockReason: blockedCoverage
                ? `Template incompatível: campos preenchidos sem mapeamento (${coverage.uncovered.join(", ")}). Ajuste o template ou os dados — nada foi descartado.`
                : bodyTooLong
                  ? `Mensagem gerada com ${filled.length} caracteres excede o limite Meta de ${META_TEMPLATE_BODY_MAX} no corpo — reduza cargas por parte ou revise o template.`
                  : overflow
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
