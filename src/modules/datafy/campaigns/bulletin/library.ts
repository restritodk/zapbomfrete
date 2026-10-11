/**
 * Reusable Meta template library for daily freight bulletins.
 *
 * v1 (7 vars/load): origem, destino, terminal, lote, localização, pedágio, detalhes
 * v2 (11 vars/load): rich freight fields — kept for history/matching; Meta often
 *   rejects for variable/text density (error_subcode 2388293)
 * v3 (6 vars/load): same freight data via logical composites + descriptive labels
 *
 * Approve once (MARKETING). Daily values change via variables.
 *
 * Meta limits:
 * - Template BODY text ≤ 1024 chars
 * - Each body parameter value ≤ 1024 chars at send time
 * - BODY must not start/end with {{n}}
 * - Too many variables for message length → 2388293
 */

/** Per-parameter text limit (WhatsApp Cloud API). */
export const META_TEMPLATE_PARAM_MAX = 1024;

export type LoadSlotField =
    | "origem"
    | "localCarregamento"
    | "destino"
    | "terminal"
    | "janela"
    | "veiculo"
    | "quantidade"
    | "frete"
    | "lote"
    | "localizacao"
    | "pedagio"
    | "observacoes"
    | "detalhes"
    /** v3 composites — one variable, multiple source fields */
    | "rotaOrigem"
    | "rotaDestino"
    | "veiculoQtd"
    | "fretePedagio"
    | "mapaObs";

/** Legacy 7-slot layout (boletim_1/2/3). */
export const LOAD_SLOT_FIELDS_V1: LoadSlotField[] = [
    "origem",
    "destino",
    "terminal",
    "lote",
    "localizacao",
    "pedagio",
    "detalhes",
];

/** Rich 11-slot layout (boletim_v2_*) — preserved; prefer v3 for new Meta submits. */
export const LOAD_SLOT_FIELDS_V2: LoadSlotField[] = [
    "origem",
    "localCarregamento",
    "destino",
    "terminal",
    "janela",
    "veiculo",
    "quantidade",
    "frete",
    "localizacao",
    "pedagio",
    "observacoes",
];

/**
 * v3 · 6 slots/load — composites cut variable density while keeping freight data.
 * Covers: origem, local, destino, terminal, janela, veículo, qtd, frete, mapa, pedágio, obs.
 */
export const LOAD_SLOT_FIELDS_V3: LoadSlotField[] = [
    "rotaOrigem",
    "rotaDestino",
    "janela",
    "veiculoQtd",
    "fretePedagio",
    "mapaObs",
];

/** @deprecated use LOAD_SLOT_FIELDS_V1 — kept for older imports */
export const LOAD_SLOT_FIELDS = LOAD_SLOT_FIELDS_V1;

export type BulletinTemplateSpec = {
    id: string;
    preferredName: string;
    namePatterns: RegExp[];
    loadsPerMessage: 1 | 2 | 3;
    variableCount: number;
    generation: 1 | 2 | 3;
    slotFields: LoadSlotField[];
    recommendedCategory: "MARKETING" | "UTILITY";
    description: string;
    bodyTextForApproval: string;
    exampleRow: string[];
};

function loadBlockV1(startVar: number, cargaLabel: string): string {
    const n = startVar;
    return [
        `*${cargaLabel}*`,
        `Origem: {{${n}}}`,
        `Destino: {{${n + 1}}}`,
        `Terminal: {{${n + 2}}}`,
        `Lote: {{${n + 3}}}`,
        `Localização: {{${n + 4}}}`,
        `Pedágio: {{${n + 5}}}`,
        // Meta rejects BODY that ends with a {{n}} placeholder — keep trailing static text
        `Detalhes: {{${n + 6}}}.`,
    ].join("\n");
}

function loadBlockV2(startVar: number, cargaLabel: string): string {
    const n = startVar;
    return [
        `*${cargaLabel}*`,
        `Origem: {{${n}}}`,
        `Local carreg.: {{${n + 1}}}`,
        `Destino: {{${n + 2}}}`,
        `Descarga: {{${n + 3}}}`,
        `Janela: {{${n + 4}}}`,
        `Veículo: {{${n + 5}}}`,
        `Qtd: {{${n + 6}}}`,
        `Frete: {{${n + 7}}}`,
        `Maps: {{${n + 8}}}`,
        `Pedágio: {{${n + 9}}}`,
        // Meta rejects BODY that ends with a {{n}} placeholder — keep trailing static text
        `Obs.: {{${n + 10}}}.`,
    ].join("\n");
}

/**
 * Descriptive labels + fewer vars — addresses Meta 2388293 density rejections.
 * Mid-block lines may end with {{n}}; the full template adds a closing static
 * sentence so Meta 2388299 is satisfied (lone trailing "." is not enough).
 */
function loadBlockV3(startVar: number, cargaLabel: string): string {
    const n = startVar;
    return [
        `*${cargaLabel}*`,
        `Origem e local de carregamento: {{${n}}}`,
        `Destino e terminal: {{${n + 1}}}`,
        `Janela de embarque: {{${n + 2}}}`,
        `Veículo e quantidade: {{${n + 3}}}`,
        `Frete e pedágio: {{${n + 4}}}`,
        `Mapa e observações: {{${n + 5}}}`,
    ].join("\n");
}

/** Closing static sentence required by Meta (2388299) — must be real words, not only punctuation. */
export const META_BODY_CLOSING_STATIC =
    "Confirme a disponibilidade da carga.";

const EXAMPLE_LOAD_V1 = [
    "Rondonopolis/MT",
    "Paranagua/PR",
    "Terminal Exemplo",
    "Lote 123",
    "https://maps.app.goo.gl/exemplo",
    "Tag OK",
    "Embarque confirmado",
];

const EXAMPLE_LOAD_V2 = [
    "Sapezal/MT",
    "FAZ SAUDADES",
    "Rondonopolis/MT",
    "ALG COOPERBEM",
    "D+5 UTEIS",
    "RODOTREM",
    "2",
    "R$ 280,00/TON",
    "https://maps.app.goo.gl/exemplo",
    "PEDAGIO INCLUSO NO FRETE",
    "Sem observacoes",
];

const EXAMPLE_LOAD_V3 = [
    "Sapezal/MT · FAZ SAUDADES",
    "Rondonopolis/MT · ALG COOPERBEM",
    "D+5 UTEIS",
    "RODOTREM · 2",
    "R$ 280,00/TON · PEDAGIO INCLUSO NO FRETE",
    "https://maps.app.goo.gl/exemplo · Sem observacoes",
];

function examplesForLoads(n: number, row: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
        out.push(
            ...row.map((v, j) =>
                j === 3 && row === EXAMPLE_LOAD_V1 ? `Lote ${100 + i}` : v
            )
        );
    }
    return out;
}

function makeV1(
    loads: 1 | 2 | 3,
    id: string,
    preferredName: string,
    patterns: RegExp[],
    description: string
): BulletinTemplateSpec {
    const blocks: string[] = ["*ATUALIZAÇÃO DE EMBARQUE*", ""];
    for (let i = 0; i < loads; i++) {
        if (i > 0) blocks.push("");
        blocks.push(
            loadBlockV1(
                1 + i * 7,
                loads === 1 ? "Carga" : `Carga ${i + 1}`
            )
        );
    }
    return {
        id,
        preferredName,
        namePatterns: patterns,
        loadsPerMessage: loads,
        variableCount: loads * 7,
        generation: 1,
        slotFields: LOAD_SLOT_FIELDS_V1,
        recommendedCategory: "MARKETING",
        description,
        bodyTextForApproval: blocks.join("\n"),
        exampleRow: examplesForLoads(loads, EXAMPLE_LOAD_V1),
    };
}

function makeV2(
    loads: 1 | 2 | 3,
    id: string,
    preferredName: string,
    patterns: RegExp[],
    description: string
): BulletinTemplateSpec {
    const blocks: string[] = ["*ATUALIZAÇÃO DE EMBARQUE*", ""];
    for (let i = 0; i < loads; i++) {
        if (i > 0) blocks.push("");
        blocks.push(
            loadBlockV2(
                1 + i * 11,
                loads === 1 ? "Carga" : `Carga ${i + 1}`
            )
        );
    }
    return {
        id,
        preferredName,
        namePatterns: patterns,
        loadsPerMessage: loads,
        variableCount: loads * 11,
        generation: 2,
        slotFields: LOAD_SLOT_FIELDS_V2,
        recommendedCategory: "MARKETING",
        description,
        bodyTextForApproval: blocks.join("\n"),
        exampleRow: examplesForLoads(loads, EXAMPLE_LOAD_V2),
    };
}

function makeV3(
    loads: 1 | 2 | 3,
    id: string,
    preferredName: string,
    patterns: RegExp[],
    description: string
): BulletinTemplateSpec {
    const blocks: string[] = ["*ATUALIZAÇÃO DE EMBARQUE*", ""];
    for (let i = 0; i < loads; i++) {
        if (i > 0) blocks.push("");
        blocks.push(
            loadBlockV3(
                1 + i * 6,
                loads === 1 ? "Carga" : `Carga ${i + 1}`
            )
        );
    }
    // Meta 2388299: BODY must not end with a variable (punctuation-only suffix is insufficient)
    blocks.push("", META_BODY_CLOSING_STATIC);
    return {
        id,
        preferredName,
        namePatterns: patterns,
        loadsPerMessage: loads,
        variableCount: loads * 6,
        generation: 3,
        slotFields: LOAD_SLOT_FIELDS_V3,
        recommendedCategory: "MARKETING",
        description,
        bodyTextForApproval: blocks.join("\n"),
        exampleRow: examplesForLoads(loads, EXAMPLE_LOAD_V3),
    };
}

/**
 * Full library: v3 first (preferred for new Meta submits), then v2 (history),
 * then v1 (legacy APPROVED). Do not mutate APPROVED bodies — new structure → new name.
 */
export const BULLETIN_TEMPLATE_LIBRARY: BulletinTemplateSpec[] = [
    makeV3(
        1,
        "boletim_v3_1_carga",
        "boletim_v3_1_carga",
        [/^boletim_v3_1_carga$/i, /^bf_boletim_v3_1(_carga)?$/i],
        "v3 · 1 carga (6 variáveis: rota, janela, frete…)"
    ),
    makeV3(
        2,
        "boletim_v3_2_cargas",
        "boletim_v3_2_cargas",
        [/^boletim_v3_2_cargas$/i, /^bf_boletim_v3_2(_cargas)?$/i],
        "v3 · 2 cargas (12 variáveis)"
    ),
    makeV3(
        3,
        "boletim_v3_3_cargas",
        "boletim_v3_3_cargas",
        [/^boletim_v3_3_cargas$/i, /^bf_boletim_v3_3(_cargas)?$/i],
        "v3 · 3 cargas (18 variáveis) — BODY estrutural ≤ 1024"
    ),
    makeV2(
        1,
        "boletim_v2_1_carga",
        "boletim_v2_1_carga",
        [/^boletim_v2_1_carga$/i, /^bf_boletim_v2_1(_carga)?$/i],
        "v2 · 1 carga (11 variáveis) — legado; Meta pode rejeitar por densidade (2388293)"
    ),
    makeV2(
        2,
        "boletim_v2_2_cargas",
        "boletim_v2_2_cargas",
        [/^boletim_v2_2_cargas$/i, /^bf_boletim_v2_2(_cargas)?$/i],
        "v2 · 2 cargas (22 variáveis) — legado"
    ),
    makeV2(
        3,
        "boletim_v2_3_cargas",
        "boletim_v2_3_cargas",
        [/^boletim_v2_3_cargas$/i, /^bf_boletim_v2_3(_cargas)?$/i],
        "v2 · 3 cargas (33 variáveis) — legado"
    ),
    makeV1(
        1,
        "boletim_1_carga",
        "boletim_1_carga",
        [
            /^boletim_1_carga$/i,
            /^bf_boletim_1(_carga)?$/i,
            /^bomfrete_boletim_1$/i,
        ],
        "v1 · 1 carga (7 variáveis) — legado"
    ),
    makeV1(
        2,
        "boletim_2_cargas",
        "boletim_2_cargas",
        [
            /^boletim_2_cargas$/i,
            /^bf_boletim_2(_cargas)?$/i,
            /^bomfrete_boletim_2$/i,
        ],
        "v1 · 2 cargas (14 variáveis) — legado"
    ),
    makeV1(
        3,
        "boletim_3_cargas",
        "boletim_3_cargas",
        [
            /^boletim_3_cargas$/i,
            /^bf_boletim_3(_cargas)?$/i,
            /^bomfrete_boletim_3$/i,
        ],
        "v1 · 3 cargas (21 variáveis) — legado"
    ),
];

export function countPositionalVars(bodyText: string): number {
    const matches = bodyText.match(/\{\{(\d+)\}\}/g);
    if (!matches?.length) return 0;
    const nums = matches.map((m) => Number(m.replace(/\D/g, "")));
    return Math.max(...nums);
}

/** True when {{1}}…{{n}} appear in order without gaps. */
export function hasSequentialPlaceholders(bodyText: string): boolean {
    const n = countPositionalVars(bodyText);
    if (n < 1) return false;
    for (let i = 1; i <= n; i++) {
        if (!bodyText.includes(`{{${i}}}`)) return false;
    }
    return true;
}

export function sanitizeTemplateParam(value: string | null | undefined): string {
    const raw = (value || "").trim();
    if (!raw) return "N/D";
    const flat = raw
        .replace(/\r\n/g, "\n")
        .replace(/\n+/g, " · ")
        .replace(/\s+/g, " ");
    if (flat.length <= META_TEMPLATE_PARAM_MAX) return flat;
    return flat.slice(0, META_TEMPLATE_PARAM_MAX - 1) + "…";
}

export function matchLibrarySpec(
    template: {
        name: string;
        components?: unknown[];
    },
    library: BulletinTemplateSpec[] = BULLETIN_TEMPLATE_LIBRARY
): BulletinTemplateSpec | null {
    for (const spec of library) {
        if (spec.namePatterns.some((re) => re.test(template.name))) {
            return spec;
        }
    }
    // Name equality fallback (custom templates)
    const byName = library.find(
        (s) => s.preferredName.toLowerCase() === template.name.toLowerCase()
    );
    if (byName) return byName;

    if (Array.isArray(template.components)) {
        for (const c of template.components) {
            const comp = c as { type?: string; text?: string };
            if (
                String(comp.type || "").toUpperCase() === "BODY" &&
                comp.text
            ) {
                const n = countPositionalVars(comp.text);
                // Prefer exact variable count + same loadsPerMessage when multiple
                const candidates = library.filter((s) => s.variableCount === n);
                if (candidates.length === 1) return candidates[0];
                // Do not guess among multiple custom templates by count alone
            }
        }
    }
    return null;
}

export function fillTemplatePreview(
    bodyText: string,
    values: string[]
): string {
    return bodyText.replace(/\{\{(\d+)\}\}/g, (_m, num) => {
        const idx = Number(num) - 1;
        return values[idx] ?? "N/D";
    });
}

export type BulletinTemplateSubmission = {
    name: string;
    language: "pt_BR";
    category: "MARKETING";
    parameter_format: "POSITIONAL";
    bodyText: string;
    exampleRow: string[];
    variableCount: number;
    bodyCharCount: number;
    loadsPerMessage: 1 | 2 | 3;
    generation: 1 | 2 | 3;
    description: string;
    previewFilled: string;
    checks: {
        bodyWithinLimit: boolean;
        examplesMatchVars: boolean;
        categoryMarketing: boolean;
        languagePtBr: boolean;
        readyForManualSubmit: boolean;
        notes: string[];
    };
};

/** Payload + validation for one-time Meta approval via Datafy API. */
export function buildBulletinTemplateSubmission(
    spec: BulletinTemplateSpec
): BulletinTemplateSubmission {
    const bodyText = spec.bodyTextForApproval;
    const variableCount = countPositionalVars(bodyText);
    const exampleRow = spec.exampleRow.map((v) =>
        sanitizeTemplateParam(v).replace(/…$/, "").slice(0, META_TEMPLATE_PARAM_MAX)
    );
    const notes: string[] = [];
    const bodyWithinLimit = bodyText.length <= 1024;
    if (!bodyWithinLimit) {
        notes.push(`BODY excede 1024 caracteres (${bodyText.length}).`);
    }
    const examplesMatchVars = exampleRow.length === variableCount;
    if (!examplesMatchVars) {
        notes.push(
            `Exemplos (${exampleRow.length}) ≠ variáveis (${variableCount}).`
        );
    }
    if (variableCount !== spec.variableCount) {
        notes.push(
            `Contagem de {{n}} (${variableCount}) diverge do spec (${spec.variableCount}).`
        );
    }
    if (!hasSequentialPlaceholders(bodyText)) {
        notes.push("Placeholders {{n}} fora de sequência contínua.");
    }
    const categoryMarketing = spec.recommendedCategory === "MARKETING";
    if (!categoryMarketing) {
        notes.push("Categoria recomendada deveria ser MARKETING para divulgação.");
    }
    if (spec.generation === 3) {
        notes.push(
            "Template v3 — nomes boletim_v3_*; não altera v1/v2 já APPROVED ou REJECTED."
        );
    } else if (spec.generation === 2) {
        notes.push(
            "Template v2 legado — Meta pode rejeitar (2388293: variáveis demais para o texto). Prefira boletim_v3_*."
        );
    }
    notes.push(
        "Submissão via Datafy POST /v1/{waba_id}/message_templates — Meta analisa e retorna PENDING."
    );
    notes.push(
        "Não usar em campanha real até status APPROVED na listagem oficial."
    );
    notes.push(
        "Links de grupo WhatsApp não entram automaticamente nas variáveis — política e revisão humana."
    );

    // Prefer v3 for new Meta submits; keep v2 buildable for history/tests but not "ready"
    const preferNewSubmit = spec.generation !== 2;

    return {
        name: spec.preferredName,
        language: "pt_BR",
        category: "MARKETING",
        parameter_format: "POSITIONAL",
        bodyText,
        exampleRow,
        variableCount,
        bodyCharCount: bodyText.length,
        loadsPerMessage: spec.loadsPerMessage,
        generation: spec.generation,
        description: spec.description,
        previewFilled: fillTemplatePreview(bodyText, exampleRow),
        checks: {
            bodyWithinLimit,
            examplesMatchVars,
            categoryMarketing,
            languagePtBr: true,
            readyForManualSubmit:
                preferNewSubmit &&
                bodyWithinLimit &&
                examplesMatchVars &&
                categoryMarketing &&
                variableCount === spec.variableCount &&
                hasSequentialPlaceholders(bodyText),
            notes,
        },
    };
}

export function buildAllBulletinTemplateSubmissions(): BulletinTemplateSubmission[] {
    return BULLETIN_TEMPLATE_LIBRARY.map(buildBulletinTemplateSubmission);
}

/** Only v2 specs — kept for regression / history checks. */
export function buildV2BulletinTemplateSubmissions(): BulletinTemplateSubmission[] {
    return BULLETIN_TEMPLATE_LIBRARY.filter((s) => s.generation === 2).map(
        buildBulletinTemplateSubmission
    );
}

/** Preferred generation for new Meta approvals. */
export function buildV3BulletinTemplateSubmissions(): BulletinTemplateSubmission[] {
    return BULLETIN_TEMPLATE_LIBRARY.filter((s) => s.generation === 3).map(
        buildBulletinTemplateSubmission
    );
}

export function findBulletinSpecByName(
    name: string
): BulletinTemplateSpec | null {
    const n = String(name || "").trim();
    if (!n) return null;
    return (
        BULLETIN_TEMPLATE_LIBRARY.find((s) =>
            s.namePatterns.some((re) => re.test(n))
        ) || null
    );
}
