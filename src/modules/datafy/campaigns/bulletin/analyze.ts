import {
    BULLETIN_IMPORT_MAX_CHARS,
    BULLETIN_IMPORT_MAX_LOADS,
    BULLETIN_PART_SAFETY_MARGIN,
    META_TEMPLATE_BODY_MAX,
    type BulletinAnalysis,
    type BulletinAmbiguousField,
    type BulletinGeneralMeta,
    type BulletinLoad,
    type BulletinLoadFields,
    type BulletinPart,
} from "./types";

/** Horizontal separators commonly used in freight bulletins */
const SEPARATOR_LINE =
    /^(?:[-_=─━═\*~]{3,}|\.{3,}|▪️{2,}|●{2,}|•{3,})\s*$/;

const MAPS_URL_RE =
    /(https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[^\s]+|www\.google\.[^\s]*maps[^\s]*|maps\.apple\.[^\s]+)[^\s]*)/i;

const GROUP_URL_RE = /(https?:\/\/chat\.whatsapp\.com\/[^\s]+)/i;

const LABEL_PATTERNS: Array<{
    key: keyof BulletinLoadFields;
    re: RegExp;
}> = [
    {
        key: "origem",
        re: /^(?:origem|orige[mn]|de)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "destino",
        re: /^(?:destino|para|até|ate)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "terminal",
        re: /^(?:terminal|porto|descarga|local\s*de\s*descarga|armaz[eé]m)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "localCarregamento",
        re: /^(?:local\s*(?:de\s*)?carreg(?:amento)?|carregamento|fazenda|algodoeira|cooperativa|ind[uú]stria)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "janela",
        re: /^(?:janela|carreg(?:amento)?\/?entrega|prazo|data(?:\s*de\s*carregamento)?|agendamento)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "veiculo",
        re: /^(?:ve[ií]culo|tipo\s*(?:de\s*)?ve[ií]culo|caminh[aã]o|equipamento)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "quantidade",
        re: /^(?:qtd|quantidade|qtde|ve[ií]culos?|lote\s*de\s*ve[ií]culos?)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "frete",
        re: /^(?:frete|valor(?:\s*do\s*frete)?|pre[cç]o)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "lote",
        re: /^(?:lote|pedido|os|n[ºo°]\s*lote)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "pedagio",
        re: /^(?:ped[aá]gio|tag|condi[cç][aã]o\s*(?:do\s*)?ped[aá]gio)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "rotaPedagio",
        re: /^(?:rota|observa[cç][aã]o\s*(?:de\s*)?ped[aá]gio|obs\.?\s*ped[aá]gio)\s*[:：\-–]\s*(.+)$/i,
    },
    {
        key: "observacoes",
        re: /^(?:observa[cç][oõ]es?|obs\.?|notas?|info(?:rma[cç][oõ]es?)?)\s*[:：\-–]\s*(.+)$/i,
    },
];

const PLACE_PREFIX =
    /^(?:FAZ(?:ENDA)?|ALG(?:ODOEIRA)?|COOP(?:ERATIVA)?|ARMAZ(?:[EÉ]M)?|IND(?:[UÚ]STRIA)?|TERMINAL|PORTO)\b[\s.\-]*(.+)$/i;

const VEHICLE_INLINE =
    /\b(rodotrem|bitrem|tritrem|carreta|truck|toco|3\/4|quarto\s*eixo|4[ºo°]?\s*eixo|ls|vanderleia|graneleiro|sider|bau|baú)\b/i;

const WINDOW_INLINE =
    /\b(D\s*\+\s*\d+\s*(?:[uú]teis?|dias?)?|\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\b/i;

const FRETE_INLINE =
    /(?:R\$\s*[\d.]+(?:,\d{2})?(?:\s*\/?\s*(?:TON|t|kg|un|viagem)?)?|[\d.]+(?:,\d{2})?\s*(?:\/\s*)?(?:TON|t)\b)/i;

const PEDAGIO_INLINE =
    /ped[aá]gio\s+(incluso|n[aã]o\s+incluso|por\s+conta|tag\s*ok|ok)/i;

const CITY_UF =
    /\b([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,40})\s*[\/\-]\s*([A-Z]{2})\b/;

const EMOJI_OR_DECOR =
    /^[🚛📦✅⭐🔥💪📍⏰🎉🛣🚚🏭📅🔢💰➡️▪️●•▪\-_=─━═\*~.]+$/u;

function trimLine(line: string): string {
    return line
        .replace(/^[\s🚛📦✅⭐🔥💪📍⏰🎉🛣🚚🏭📅🔢💰➡️▪️●•▪]+/u, "")
        .trim();
}

/**
 * Remove rótulos redundantes do valor (evita "Frete: FRETE: R$ …" / "Janela: JANELA …").
 */
export function stripFieldLabelPrefix(
    key: keyof BulletinLoadFields,
    value: string
): string {
    let v = value.trim();
    if (!v) return v;
    const patterns: Partial<Record<keyof BulletinLoadFields, RegExp[]>> = {
        origem: [/^(?:origem|orige[mn]|de)\s*[:：\-–]?\s*/i],
        destino: [/^(?:destino|para|até|ate)\s*[:：\-–]?\s*/i],
        terminal: [
            /^(?:terminal|porto|descarga|local\s*de\s*descarga|armaz[eé]m)\s*[:：\-–]?\s*/i,
        ],
        localCarregamento: [
            /^(?:local\s*(?:de\s*)?carreg(?:amento)?|carregamento|fazenda|algodoeira)\s*[:：\-–]?\s*/i,
        ],
        janela: [
            /^(?:janela|carreg(?:amento)?\/?entrega|prazo|data(?:\s*de\s*carregamento)?|agendamento|tipo\s*de\s*janela)\s*[:：\-–]?\s*/i,
        ],
        veiculo: [
            /^(?:ve[ií]culo|tipo\s*(?:de\s*)?ve[ií]culo|caminh[aã]o|equipamento)\s*[:：\-–]?\s*/i,
        ],
        quantidade: [
            /^(?:qtd|quantidade|qtde|ve[ií]culos?)\s*[:：\-–]?\s*/i,
        ],
        frete: [
            /^(?:frete|valor(?:\s*do\s*frete)?|pre[cç]o)\s*[:：\-–]?\s*/i,
        ],
        lote: [/^(?:lote|pedido|os)\s*[:：\-–]?\s*/i],
        pedagio: [
            /^(?:ped[aá]gio|tag|condi[cç][aã]o\s*(?:do\s*)?ped[aá]gio)\s*[:：\-–]?\s*/i,
        ],
        localizacaoUrl: [
            /^(?:localiza[cç][aã]o|maps?|link)\s*[:：\-–]?\s*/i,
        ],
        observacoes: [
            /^(?:observa[cç][oõ]es?|obs\.?|notas?)\s*[:：\-–]?\s*/i,
        ],
    };
    for (const re of patterns[key] || []) {
        v = v.replace(re, "").trim();
    }
    return v || value.trim();
}

function setField(
    fields: BulletinLoadFields,
    key: keyof BulletinLoadFields,
    value: string,
    ambiguous: BulletinAmbiguousField[],
    loadIndex: number
) {
    const v = stripFieldLabelPrefix(key, value.trim());
    if (!v) return;
    const prev = fields[key];
    if (prev && prev !== v) {
        ambiguous.push({
            loadIndex,
            field: key,
            raw: v,
            reason: `Conflito com valor já capturado ("${prev}") — preservado o primeiro; revise.`,
        });
        return;
    }
    fields[key] = v;
}

function extractFieldsFromBlock(
    text: string,
    loadIndex: number
): {
    fields: BulletinLoadFields;
    unrecognizedLines: string[];
    ambiguous: BulletinAmbiguousField[];
} {
    const fields: BulletinLoadFields = {};
    const unrecognizedLines: string[] = [];
    const ambiguous: BulletinAmbiguousField[] = [];
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    for (const rawLine of lines) {
        const line = trimLine(rawLine);
        if (!line || EMOJI_OR_DECOR.test(line)) continue;

        const maps = line.match(MAPS_URL_RE);
        if (maps?.[1]) {
            setField(fields, "localizacaoUrl", maps[1], ambiguous, loadIndex);
            const rest = line.replace(maps[1], "").trim();
            if (!rest || /^(localiza[cç][aã]o|maps?|link)\s*[:：]?$/i.test(rest)) {
                continue;
            }
        }

        const group = line.match(GROUP_URL_RE);
        if (group?.[1]) {
            setField(fields, "grupoUrl", group[1], ambiguous, loadIndex);
            continue;
        }

        let matchedLabel = false;
        for (const { key, re } of LABEL_PATTERNS) {
            const m = line.match(re);
            if (m?.[1]) {
                setField(fields, key, m[1].trim(), ambiguous, loadIndex);
                matchedLabel = true;
                break;
            }
        }
        if (matchedLabel) continue;

        // Unlabeled place tokens: FAZ SAUDADES / ALG COOPERBEM
        const place = line.match(PLACE_PREFIX);
        if (place) {
            const kind = line.slice(0, 3).toUpperCase();
            const name = place[1]?.trim() || line;
            if (/^(FAZ|ALG|COO|ARM|IND)/i.test(kind) || /FAZ|ALG|COOP/i.test(line)) {
                if (!fields.localCarregamento) {
                    setField(
                        fields,
                        "localCarregamento",
                        line,
                        ambiguous,
                        loadIndex
                    );
                } else if (!fields.terminal) {
                    setField(fields, "terminal", line, ambiguous, loadIndex);
                } else {
                    unrecognizedLines.push(line);
                }
                continue;
            }
            if (/TERMINAL|PORTO/i.test(line)) {
                setField(fields, "terminal", line, ambiguous, loadIndex);
                continue;
            }
        }

        if (!fields.origem && CITY_UF.test(line) && /origem|^de\b/i.test(rawLine)) {
            const m = line.match(CITY_UF);
            if (m) {
                setField(
                    fields,
                    "origem",
                    `${m[1].trim()}/${m[2]}`,
                    ambiguous,
                    loadIndex
                );
                continue;
            }
        }

        // Bare city/UF: first → origem, second → destino
        const city = line.match(CITY_UF);
        if (city && line.length <= 48 && !/[?:]/.test(line)) {
            const value = `${city[1].trim()}/${city[2]}`;
            if (!fields.origem) {
                setField(fields, "origem", value, ambiguous, loadIndex);
                continue;
            }
            if (!fields.destino) {
                setField(fields, "destino", value, ambiguous, loadIndex);
                continue;
            }
        }

        if (!fields.veiculo) {
            const vm = line.match(VEHICLE_INLINE);
            if (vm) {
                setField(fields, "veiculo", line, ambiguous, loadIndex);
                continue;
            }
        }

        if (!fields.janela && WINDOW_INLINE.test(line)) {
            setField(fields, "janela", line, ambiguous, loadIndex);
            continue;
        }

        if (!fields.frete && FRETE_INLINE.test(line)) {
            setField(fields, "frete", line, ambiguous, loadIndex);
            continue;
        }

        if (!fields.pedagio && PEDAGIO_INLINE.test(line)) {
            setField(fields, "pedagio", line, ambiguous, loadIndex);
            continue;
        }

        if (/^https?:\/\//i.test(line)) {
            unrecognizedLines.push(line);
            continue;
        }

        unrecognizedLines.push(line);
    }

    // Drop lines that only repeat Maps URL already captured as localizacaoUrl
    const mapsUrl = fields.localizacaoUrl?.trim();
    const cleanUnrecognized = unrecognizedLines.filter((line) => {
        if (mapsUrl && line.includes(mapsUrl)) return false;
        if (MAPS_URL_RE.test(line) && mapsUrl) return false;
        const onlyMaps = line.match(MAPS_URL_RE);
        if (
            onlyMaps?.[1] &&
            line.replace(onlyMaps[1], "").replace(/localiza[cç][aã]o|maps?|link|[:：]/gi, "").trim() ===
                ""
        ) {
            // Prefer structured localizacaoUrl; do not dump link into obs
            if (!fields.localizacaoUrl) {
                fields.localizacaoUrl = onlyMaps[1];
            }
            return false;
        }
        return true;
    });

    // Compose observacoes / detalhes without inventing or duplicating maps
    const obsParts: string[] = [];
    if (fields.observacoes) obsParts.push(fields.observacoes);
    if (fields.rotaPedagio) obsParts.push(`Rota: ${fields.rotaPedagio}`);
    if (cleanUnrecognized.length) {
        obsParts.push(...cleanUnrecognized);
    }
    if (obsParts.length) {
        fields.observacoes = obsParts.join(" · ");
    }
    // v1 catch-all: structured extras without re-prefixing values that still carry labels
    const detalheBits = [
        fields.localCarregamento && `Local: ${fields.localCarregamento}`,
        fields.janela && `Janela: ${fields.janela}`,
        fields.veiculo && `Veículo: ${fields.veiculo}`,
        fields.quantidade && `Qtd: ${fields.quantidade}`,
        fields.frete && `Frete: ${fields.frete}`,
        fields.observacoes,
        fields.grupoUrl && `Grupo: ${fields.grupoUrl}`,
    ].filter(Boolean) as string[];
    if (detalheBits.length) {
        fields.detalhes = detalheBits.join(" · ");
    } else if (fields.grupoUrl) {
        fields.detalhes = `Grupo: ${fields.grupoUrl}`;
    }

    return { fields, unrecognizedLines: cleanUnrecognized, ambiguous };
}

function completenessOf(fields: BulletinLoadFields): number {
    const keys: (keyof BulletinLoadFields)[] = [
        "origem",
        "destino",
        "localCarregamento",
        "terminal",
        "janela",
        "veiculo",
        "quantidade",
        "frete",
        "localizacaoUrl",
        "pedagio",
    ];
    const filled = keys.filter((k) => Boolean(fields[k])).length;
    return filled / keys.length;
}

function isSeparatorLine(line: string): boolean {
    return SEPARATOR_LINE.test(line.trim());
}

/**
 * Split raw bulletin into ordered load blocks without dropping content.
 * Prefer explicit separators; fall back to blank-line groups after the title.
 */
export function splitLoads(raw: string): {
    title: string;
    blocks: string[];
    headerLines: string[];
} {
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const lines = normalized.split("\n");

    const hasSeparators = lines.some(isSeparatorLine);

    if (hasSeparators) {
        const blocks: string[] = [];
        let titleLines: string[] = [];
        let current: string[] = [];
        let titleDone = false;

        const flush = () => {
            const text = current.join("\n").trim();
            if (text) blocks.push(text);
            current = [];
        };

        for (const line of lines) {
            if (isSeparatorLine(line)) {
                if (!titleDone) {
                    titleDone = true;
                    if (current.length) {
                        const joined = current.join("\n").trim();
                        if (
                            joined &&
                            joined.length < 160 &&
                            blocks.length === 0 &&
                            !MAPS_URL_RE.test(joined)
                        ) {
                            titleLines = [...current];
                            current = [];
                        } else {
                            flush();
                        }
                    }
                    continue;
                }
                flush();
                continue;
            }
            if (!titleDone && current.length === 0 && !line.trim()) {
                continue;
            }
            current.push(line);
        }
        flush();

        let title = titleLines.join("\n").trim();
        if (!title && blocks[0]) {
            const first = blocks[0];
            const firstLine = first.split("\n")[0]?.trim() || "";
            if (
                firstLine.length <= 100 &&
                /atualiza|embarque|boletim|cotton|carga|frete/i.test(firstLine)
            ) {
                title = firstLine;
                const rest = first.slice(firstLine.length).replace(/^\n+/, "");
                if (rest.trim()) blocks[0] = rest.trim();
                else blocks.shift();
            }
        }
        if (!title) title = "Boletim de cargas";
        return {
            title,
            blocks: blocks.filter((b) => b.trim()),
            headerLines: titleLines.map((l) => l.trim()).filter(Boolean),
        };
    }

    const paragraphs = normalized
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);

    if (!paragraphs.length) {
        return { title: "Boletim de cargas", blocks: [], headerLines: [] };
    }

    let title = "Boletim de cargas";
    let blocks = paragraphs;
    const headerLines: string[] = [];
    const first = paragraphs[0];
    if (first.length <= 120 && first.split("\n").length <= 3) {
        title = first.split("\n")[0].trim() || title;
        headerLines.push(...first.split("\n").map((l) => l.trim()).filter(Boolean));
        blocks = paragraphs.slice(1);
    }
    if (!blocks.length && paragraphs.length === 1) {
        blocks = [paragraphs[0]];
    }
    return { title, blocks, headerLines };
}

function extractGeneralMeta(
    title: string,
    headerLines: string[],
    loads: BulletinLoad[]
): BulletinGeneralMeta {
    const allHeader = headerLines.join("\n");
    const groupFromHeader = allHeader.match(GROUP_URL_RE)?.[1];
    const groupFromLoads = loads
        .map((l) => l.fields.grupoUrl)
        .find(Boolean);
    const groupUrl = groupFromHeader || groupFromLoads;

    let operationType: string | undefined;
    if (/cotton|algod/i.test(title + allHeader)) operationType = "Cotton / Algodão";
    else if (/soja/i.test(title + allHeader)) operationType = "Soja";
    else if (/milho/i.test(title + allHeader)) operationType = "Milho";
    else if (/frete|embarque|boletim/i.test(title)) operationType = "Embarque";

    const dateMatch =
        allHeader.match(/\b(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\b/) ||
        title.match(/\b(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\b/);

    const notes = headerLines
        .filter((l) => l !== title)
        .filter((l) => !GROUP_URL_RE.test(l))
        .filter((l) => !EMOJI_OR_DECOR.test(l));

    return {
        title,
        operationType,
        groupUrl,
        referenceDate: dateMatch?.[1],
        generalNotes: notes.length ? notes.join(" · ") : undefined,
    };
}

export function buildLoads(blocks: string[]): BulletinLoad[] {
    return blocks.slice(0, BULLETIN_IMPORT_MAX_LOADS).map((text, index) => {
        const charCount = text.length;
        const { fields, unrecognizedLines, ambiguous } = extractFieldsFromBlock(
            text,
            index
        );
        return {
            index,
            text,
            fields,
            unrecognizedLines,
            ambiguous,
            charCount,
            exceedsLimit: charCount > META_TEMPLATE_BODY_MAX,
            completeness: completenessOf(fields),
        };
    });
}

function partHeader(title: string, index: number, total: number): string {
    const base = title.trim() || "Boletim de cargas";
    if (total <= 1) return base;
    return `${base} — PARTE ${index + 1}/${total}`;
}

/**
 * Pack complete loads into parts under Meta BODY limit.
 * Never splits a load mid-block. Oversized loads become solo parts flagged.
 */
export function packParts(
    title: string,
    loads: BulletinLoad[],
    maxBody = META_TEMPLATE_BODY_MAX
): { parts: BulletinPart[]; warnings: string[] } {
    const warnings: string[] = [];
    if (!loads.length) {
        return {
            parts: [],
            warnings: ["Nenhuma carga identificada no boletim."],
        };
    }

    const maxContent = maxBody - BULLETIN_PART_SAFETY_MARGIN;

    type Bucket = { loadIndexes: number[]; texts: string[] };
    const buckets: Bucket[] = [];
    let current: Bucket = { loadIndexes: [], texts: [] };

    const headerReserve = (n: number) =>
        partHeader(title, 0, Math.max(n, 1)).length + 2;

    for (const load of loads) {
        if (load.exceedsLimit) {
            warnings.push(
                `Carga #${load.index + 1} tem ${load.charCount} caracteres e excede o limite de ${META_TEMPLATE_BODY_MAX} do template Meta. Não será truncada — revise manualmente.`
            );
            if (current.loadIndexes.length) {
                buckets.push(current);
                current = { loadIndexes: [], texts: [] };
            }
            buckets.push({
                loadIndexes: [load.index],
                texts: [load.text],
            });
            continue;
        }

        const trialTexts = [...current.texts, load.text];
        const trialBody = trialTexts.join("\n\n");
        const reserve = headerReserve(99);
        if (
            current.loadIndexes.length > 0 &&
            trialBody.length + reserve > maxContent
        ) {
            buckets.push(current);
            current = { loadIndexes: [load.index], texts: [load.text] };
        } else {
            current.loadIndexes.push(load.index);
            current.texts.push(load.text);
        }
    }
    if (current.loadIndexes.length) buckets.push(current);

    const total = buckets.length;
    const parts: BulletinPart[] = buckets.map((b, i) => {
        const header = partHeader(title, i, total);
        const body = `${header}\n\n${b.texts.join("\n\n")}`.trim();

        const oversized = body.length > maxBody;
        if (oversized) {
            warnings.push(
                `Parte ${i + 1}/${total} ficou com ${body.length} caracteres (limite ${maxBody}).`
            );
        }

        const loadOversized = b.loadIndexes.some(
            (idx) => loads[idx]?.exceedsLimit
        );

        return {
            index: i,
            label: header,
            bodyText: body,
            loadIndexes: b.loadIndexes,
            charCount: body.length,
            readyForRealSend: false,
            blockReason: loadOversized
                ? "Carga individual excede o limite do template Meta"
                : oversized
                  ? "Parte excede o limite do corpo do template"
                  : "Template aprovado ainda não associado",
        };
    });

    return { parts, warnings };
}

/** Rebuild original-ish text from editable loads (for campaign handoff). */
export function serializeBulletinDraft(opts: {
    general: BulletinGeneralMeta;
    loads: BulletinLoad[];
}): string {
    const sep = "────────────────────";
    const chunks: string[] = [opts.general.title || "Boletim de cargas"];
    if (opts.general.groupUrl) chunks.push(opts.general.groupUrl);
    if (opts.general.generalNotes) chunks.push(opts.general.generalNotes);
    for (const load of opts.loads) {
        chunks.push(sep);
        const f = load.fields;
        const lines: string[] = [];
        if (f.origem) lines.push(`Origem: ${f.origem}`);
        if (f.localCarregamento) lines.push(`Local de carregamento: ${f.localCarregamento}`);
        if (f.destino) lines.push(`Destino: ${f.destino}`);
        if (f.terminal) lines.push(`Terminal: ${f.terminal}`);
        if (f.janela) lines.push(`Janela: ${f.janela}`);
        if (f.veiculo) lines.push(`Veículo: ${f.veiculo}`);
        if (f.quantidade) lines.push(`Quantidade: ${f.quantidade}`);
        if (f.frete) lines.push(`Frete: ${f.frete}`);
        if (f.lote) lines.push(`Lote: ${f.lote}`);
        if (f.localizacaoUrl) lines.push(`Localização: ${f.localizacaoUrl}`);
        if (f.pedagio) lines.push(`Pedágio: ${f.pedagio}`);
        if (f.rotaPedagio) lines.push(`Rota: ${f.rotaPedagio}`);
        if (f.observacoes) lines.push(`Observações: ${f.observacoes}`);
        if (!lines.length && load.text) {
            chunks.push(load.text);
        } else {
            chunks.push(lines.join("\n"));
        }
    }
    return chunks.join("\n");
}

export function duplicateLoad(load: BulletinLoad, newIndex: number): BulletinLoad {
    return {
        ...load,
        index: newIndex,
        fields: { ...load.fields },
        unrecognizedLines: [...load.unrecognizedLines],
        ambiguous: load.ambiguous.map((a) => ({ ...a, loadIndex: newIndex })),
    };
}

export function emptyLoad(index: number): BulletinLoad {
    return {
        index,
        text: "",
        fields: {},
        unrecognizedLines: [],
        ambiguous: [],
        charCount: 0,
        exceedsLimit: false,
        completeness: 0,
    };
}

export function reindexLoads(loads: BulletinLoad[]): BulletinLoad[] {
    return loads.map((l, index) => ({
        ...l,
        index,
        ambiguous: l.ambiguous.map((a) => ({ ...a, loadIndex: index })),
        completeness: completenessOf(l.fields),
        charCount: l.text.length || JSON.stringify(l.fields).length,
    }));
}

/** Full analysis pipeline for a pasted bulletin. */
export function analyzeBulletin(raw: string): BulletinAnalysis {
    const text = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const warnings: string[] = [];

    if (!text.trim()) {
        return {
            title: "Boletim de cargas",
            rawText: text,
            general: { title: "Boletim de cargas" },
            loads: [],
            parts: [],
            loadCount: 0,
            partCount: 0,
            warnings: ["Cole o texto do boletim para analisar."],
            totalChars: 0,
            unrecognizedLines: [],
        };
    }

    if (text.length > BULLETIN_IMPORT_MAX_CHARS) {
        warnings.push(
            `Texto excede ${BULLETIN_IMPORT_MAX_CHARS} caracteres — analisando apenas o início.`
        );
    }
    const clipped = text.slice(0, BULLETIN_IMPORT_MAX_CHARS);

    const { title, blocks, headerLines } = splitLoads(clipped);
    let loads = buildLoads(blocks);

    if (blocks.length > BULLETIN_IMPORT_MAX_LOADS) {
        warnings.push(
            `Limite técnico de ${BULLETIN_IMPORT_MAX_LOADS} cargas por importação — restante ignorado para processamento.`
        );
    }

    if (!loads.length) {
        loads = buildLoads([clipped.trim()]);
    }

    const general = extractGeneralMeta(title, headerLines, loads);
    const packed = packParts(general.title, loads);

    const ambiguousCount = loads.reduce((s, l) => s + l.ambiguous.length, 0);
    if (ambiguousCount) {
        warnings.push(
            `${ambiguousCount} campo(s) ambíguo(s) — revise antes de confirmar.`
        );
    }
    const unrecognized = loads.flatMap((l) =>
        l.unrecognizedLines.map((line) => `#${l.index + 1}: ${line}`)
    );

    return {
        title: general.title,
        rawText: text,
        general,
        loads,
        parts: packed.parts,
        loadCount: loads.length,
        partCount: packed.parts.length,
        warnings: [...warnings, ...packed.warnings],
        totalChars: text.length,
        unrecognizedLines: unrecognized,
    };
}

export function estimateMessageTotal(
    eligibleRecipients: number,
    partCount: number
): number {
    return Math.max(0, eligibleRecipients) * Math.max(0, partCount);
}

/** Analysis → editable draft for the smart creator. */
export function analysisToEditableDraft(
    analysis: BulletinAnalysis
): import("./types").BulletinEditableDraft {
    return {
        rawText: analysis.rawText,
        general: { ...analysis.general },
        loads: analysis.loads.map((l) => ({
            ...l,
            fields: { ...l.fields },
            unrecognizedLines: [...l.unrecognizedLines],
            ambiguous: l.ambiguous.map((a) => ({ ...a })),
        })),
        warnings: [...analysis.warnings],
        confirmed: false,
    };
}
