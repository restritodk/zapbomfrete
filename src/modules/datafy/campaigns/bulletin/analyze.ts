import {
    BULLETIN_PART_SAFETY_MARGIN,
    META_TEMPLATE_BODY_MAX,
    type BulletinAnalysis,
    type BulletinLoad,
    type BulletinPart,
} from "./types";

/** Horizontal separators commonly used in freight bulletins */
const SEPARATOR_LINE =
    /^(?:[-_=─━═\*~]{3,}|\.{3,}|▪️{2,}|●{2,}|•{3,})\s*$/;

const FIELD_PATTERNS: Array<{
    key: keyof BulletinLoad["fields"];
    re: RegExp;
}> = [
    { key: "origem", re: /(?:^|\n)\s*(?:origem|orige[mn]|de)\s*[:：]\s*(.+)/i },
    {
        key: "destino",
        re: /(?:^|\n)\s*(?:destino|para|até)\s*[:：]\s*(.+)/i,
    },
    {
        key: "terminal",
        re: /(?:^|\n)\s*(?:terminal|porto|armazém|armazem)\s*[:：]\s*(.+)/i,
    },
    { key: "lote", re: /(?:^|\n)\s*(?:lote|pedido|os)\s*[:：]\s*(.+)/i },
    {
        key: "pedagio",
        re: /(?:^|\n)\s*(?:pedágio|pedagio|tag)\s*[:：]\s*(.+)/i,
    },
    {
        key: "localizacaoUrl",
        re: /(https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[^\s]+|www\.google\.[^\s]*maps[^\s]*|maps\.apple\.[^\s]+)[^\s]*)/i,
    },
    {
        key: "grupoUrl",
        re: /(https?:\/\/chat\.whatsapp\.com\/[^\s]+)/i,
    },
];

const STRUCTURED_LINE =
    /^\s*(?:origem|destino|terminal|porto|armaz[eé]m|lote|pedido|os|pedágio|pedagio|tag|localiza[cç][aã]o|grupo)\s*[:：]/i;

function extractFields(text: string): BulletinLoad["fields"] {
    const fields: BulletinLoad["fields"] = {};
    for (const { key, re } of FIELD_PATTERNS) {
        const m = text.match(re);
        if (m?.[1]) {
            const v = m[1].trim().split(/\n/)[0].trim();
            if (v) fields[key] = v;
        }
    }
    if (!fields.localizacaoUrl) {
        const anyUrl = text.match(
            /(https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|maps\.google\.[^\s]+|www\.google\.[^\s]*maps[^\s]*|maps\.apple\.[^\s]+)[^\s]*)/i
        );
        if (anyUrl?.[1]) fields.localizacaoUrl = anyUrl[1];
    }
    if (!fields.grupoUrl) {
        const g = text.match(/(https?:\/\/chat\.whatsapp\.com\/[^\s]+)/i);
        if (g?.[1]) fields.grupoUrl = g[1];
    }

    // Preserve unmapped lines as detalhes (never invent; keep leftover content)
    const leftover = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .filter((l) => !STRUCTURED_LINE.test(l))
        .filter((l) => !/^https?:\/\//i.test(l))
        .filter((l) => !/^[🚛📦✅⭐🔥💪📍⏰🎉\-_=─━═\*~•▪●.]{1,}$/u.test(l))
        .join(" · ");
    if (leftover) {
        const withGrupo = fields.grupoUrl
            ? `${leftover} · Grupo: ${fields.grupoUrl}`
            : leftover;
        fields.detalhes = withGrupo;
    } else if (fields.grupoUrl) {
        fields.detalhes = `Grupo: ${fields.grupoUrl}`;
    }
    return fields;
}

function isSeparatorLine(line: string): boolean {
    return SEPARATOR_LINE.test(line.trim());
}

/**
 * Split raw bulletin into ordered load blocks without dropping content.
 * Prefer explicit separators; fall back to blank-line groups after the title.
 */
export function splitLoads(raw: string): { title: string; blocks: string[] } {
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
                        // First separator after content: content before may be title+first load
                        // If we only collected short title-like lines, treat as title
                        const joined = current.join("\n").trim();
                        if (
                            joined &&
                            joined.length < 120 &&
                            !/\n/.test(joined) &&
                            blocks.length === 0
                        ) {
                            titleLines = [...current];
                            current = [];
                        } else {
                            flush();
                        }
                    }
                    titleDone = true;
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
            // Infer title from first line of first block if it looks like a header
            const first = blocks[0];
            const firstLine = first.split("\n")[0]?.trim() || "";
            if (
                firstLine.length <= 80 &&
                /atualiza|embarque|boletim|cotton|carga|frete/i.test(firstLine)
            ) {
                title = firstLine;
                const rest = first.slice(firstLine.length).replace(/^\n+/, "");
                if (rest.trim()) blocks[0] = rest.trim();
                else blocks.shift();
            }
        }
        if (!title) title = "Boletim de cargas";
        return { title, blocks: blocks.filter((b) => b.trim()) };
    }

    // Blank-line separated: first paragraph = title if short
    const paragraphs = normalized
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean);

    if (!paragraphs.length) {
        return { title: "Boletim de cargas", blocks: [] };
    }

    let title = "Boletim de cargas";
    let blocks = paragraphs;
    const first = paragraphs[0];
    if (first.length <= 100 && first.split("\n").length <= 2) {
        title = first.split("\n")[0].trim() || title;
        blocks = paragraphs.slice(1);
    }
    if (!blocks.length && paragraphs.length === 1) {
        // Single blob — treat whole as one load
        blocks = [paragraphs[0]];
        if (title === paragraphs[0].split("\n")[0]) {
            // already set
        }
    }
    return { title, blocks };
}

export function buildLoads(blocks: string[]): BulletinLoad[] {
    return blocks.map((text, index) => {
        const charCount = text.length;
        return {
            index,
            text,
            fields: extractFields(text),
            charCount,
            exceedsLimit: charCount > META_TEMPLATE_BODY_MAX,
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

    // Estimate total parts with greedy packing (two-pass for correct PARTE X/Y)
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
        // Reserve for worst-case part header (up to 99 parts)
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
        const body =
            total <= 1 && b.texts.length
                ? `${header}\n\n${b.texts.join("\n\n")}`.trim()
                : `${header}\n\n${b.texts.join("\n\n")}`.trim();

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

/** Full analysis pipeline for a pasted bulletin. */
export function analyzeBulletin(raw: string): BulletinAnalysis {
    const text = (raw || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const warnings: string[] = [];
    if (!text.trim()) {
        return {
            title: "Boletim de cargas",
            rawText: text,
            loads: [],
            parts: [],
            loadCount: 0,
            partCount: 0,
            warnings: ["Cole o texto do boletim para analisar."],
            totalChars: 0,
        };
    }

    const { title, blocks } = splitLoads(text);
    const loads = buildLoads(blocks);
    if (!loads.length) {
        // Fallback: entire text as one load
        const single = buildLoads([text.trim()]);
        const packed = packParts(title, single);
        return {
            title,
            rawText: text,
            loads: single,
            parts: packed.parts,
            loadCount: single.length,
            partCount: packed.parts.length,
            warnings: [...warnings, ...packed.warnings],
            totalChars: text.length,
        };
    }

    const packed = packParts(title, loads);
    return {
        title,
        rawText: text,
        loads,
        parts: packed.parts,
        loadCount: loads.length,
        partCount: packed.parts.length,
        warnings: [...warnings, ...packed.warnings],
        totalChars: text.length,
    };
}

export function estimateMessageTotal(
    eligibleRecipients: number,
    partCount: number
): number {
    return Math.max(0, eligibleRecipients) * Math.max(0, partCount);
}
