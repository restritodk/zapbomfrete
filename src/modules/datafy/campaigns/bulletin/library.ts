/**
 * Reusable Meta template library for daily freight bulletins.
 *
 * Approve these once (MARKETING recommended for divulgação de cargas).
 * Daily values change via variables — no new approval per bulletin.
 *
 * Meta limits used here:
 * - Template BODY text ≤ 1024 chars (fixed structure + {{n}})
 * - Each body parameter value ≤ 1024 chars at send time
 */

/** Per-parameter text limit (WhatsApp Cloud API). */
export const META_TEMPLATE_PARAM_MAX = 1024;

export type LoadSlotField =
    | "origem"
    | "destino"
    | "terminal"
    | "lote"
    | "localizacao"
    | "pedagio"
    | "detalhes";

export const LOAD_SLOT_FIELDS: LoadSlotField[] = [
    "origem",
    "destino",
    "terminal",
    "lote",
    "localizacao",
    "pedagio",
    "detalhes",
];

export type BulletinTemplateSpec = {
    /** Stable library id */
    id: string;
    /** Preferred Meta template name (snake_case) */
    preferredName: string;
    /** Alternate names accepted when matching APPROVED templates */
    namePatterns: RegExp[];
    loadsPerMessage: 1 | 2 | 3;
    /** Expected {{n}} count in BODY */
    variableCount: number;
    /**
     * Recommended Meta category for Bom Frete load broadcasts.
     * Divulgação de cargas is typically MARKETING — do not force UTILITY.
     */
    recommendedCategory: "MARKETING" | "UTILITY";
    /** Human description */
    description: string;
    /** BODY text to submit once for Meta approval (pt_BR) */
    bodyTextForApproval: string;
    /** Example row for Meta template examples */
    exampleRow: string[];
};

function loadBlock(startVar: number, cargaLabel: string): string {
    const n = startVar;
    return [
        `*${cargaLabel}*`,
        `Origem: {{${n}}}`,
        `Destino: {{${n + 1}}}`,
        `Terminal: {{${n + 2}}}`,
        `Lote: {{${n + 3}}}`,
        `Localização: {{${n + 4}}}`,
        `Pedágio: {{${n + 5}}}`,
        `Detalhes: {{${n + 6}}}`,
    ].join("\n");
}

/**
 * Meta example values: no newlines, no leading/trailing spaces,
 * ≤ 1024 chars. URL samples are allowed in MARKETING body params.
 */
const EXAMPLE_LOAD = [
    "Rondonopolis/MT",
    "Paranagua/PR",
    "Terminal Exemplo",
    "Lote 123",
    "https://maps.app.goo.gl/exemplo",
    "Tag OK",
    "Embarque confirmado",
];

function examplesForLoads(n: number): string[] {
    const row: string[] = [];
    for (let i = 0; i < n; i++) {
        row.push(...EXAMPLE_LOAD.map((v, j) => (j === 3 ? `Lote ${100 + i}` : v)));
    }
    return row;
}

export const BULLETIN_TEMPLATE_LIBRARY: BulletinTemplateSpec[] = [
    {
        id: "boletim_1_carga",
        preferredName: "boletim_1_carga",
        namePatterns: [
            /^boletim_1_carga$/i,
            /^bf_boletim_1(_carga)?$/i,
            /^bomfrete_boletim_1$/i,
        ],
        loadsPerMessage: 1,
        variableCount: 7,
        recommendedCategory: "MARKETING",
        description: "1 carga por mensagem (7 variáveis)",
        bodyTextForApproval: [
            "*ATUALIZAÇÃO DE EMBARQUE*",
            "",
            loadBlock(1, "Carga"),
        ].join("\n"),
        exampleRow: examplesForLoads(1),
    },
    {
        id: "boletim_2_cargas",
        preferredName: "boletim_2_cargas",
        namePatterns: [
            /^boletim_2_cargas$/i,
            /^bf_boletim_2(_cargas)?$/i,
            /^bomfrete_boletim_2$/i,
        ],
        loadsPerMessage: 2,
        variableCount: 14,
        recommendedCategory: "MARKETING",
        description: "2 cargas por mensagem (14 variáveis)",
        bodyTextForApproval: [
            "*ATUALIZAÇÃO DE EMBARQUE*",
            "",
            loadBlock(1, "Carga 1"),
            "",
            loadBlock(8, "Carga 2"),
        ].join("\n"),
        exampleRow: examplesForLoads(2),
    },
    {
        id: "boletim_3_cargas",
        preferredName: "boletim_3_cargas",
        namePatterns: [
            /^boletim_3_cargas$/i,
            /^bf_boletim_3(_cargas)?$/i,
            /^bomfrete_boletim_3$/i,
        ],
        loadsPerMessage: 3,
        variableCount: 21,
        recommendedCategory: "MARKETING",
        description: "3 cargas por mensagem (21 variáveis)",
        bodyTextForApproval: [
            "*ATUALIZAÇÃO DE EMBARQUE*",
            "",
            loadBlock(1, "Carga 1"),
            "",
            loadBlock(8, "Carga 2"),
            "",
            loadBlock(15, "Carga 3"),
        ].join("\n"),
        exampleRow: examplesForLoads(3),
    },
];

export function countPositionalVars(bodyText: string): number {
    const matches = bodyText.match(/\{\{(\d+)\}\}/g);
    if (!matches?.length) return 0;
    const nums = matches.map((m) => Number(m.replace(/\D/g, "")));
    return Math.max(...nums);
}

export function sanitizeTemplateParam(value: string | null | undefined): string {
    const raw = (value || "").trim();
    if (!raw) return "N/D";
    const flat = raw.replace(/\r\n/g, "\n").replace(/\n+/g, " · ").replace(/\s+/g, " ");
    if (flat.length <= META_TEMPLATE_PARAM_MAX) return flat;
    return flat.slice(0, META_TEMPLATE_PARAM_MAX - 1) + "…";
}

export function matchLibrarySpec(
    template: { name: string; components?: unknown[] }
): BulletinTemplateSpec | null {
    for (const spec of BULLETIN_TEMPLATE_LIBRARY) {
        if (spec.namePatterns.some((re) => re.test(template.name))) {
            return spec;
        }
    }
    // Fallback: variable count
    if (Array.isArray(template.components)) {
        for (const c of template.components) {
            const comp = c as { type?: string; text?: string };
            if (
                String(comp.type || "").toUpperCase() === "BODY" &&
                comp.text
            ) {
                const n = countPositionalVars(comp.text);
                const byCount = BULLETIN_TEMPLATE_LIBRARY.find(
                    (s) => s.variableCount === n
                );
                if (byCount) return byCount;
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
    const categoryMarketing = spec.recommendedCategory === "MARKETING";
    if (!categoryMarketing) {
        notes.push("Categoria recomendada deveria ser MARKETING para divulgação.");
    }
    notes.push(
        "Submissão via Datafy POST /v1/{waba_id}/message_templates — Meta analisa e retorna PENDING."
    );
    notes.push(
        "Não usar em campanha real até status APPROVED na listagem oficial."
    );

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
        description: spec.description,
        previewFilled: fillTemplatePreview(bodyText, exampleRow),
        checks: {
            bodyWithinLimit,
            examplesMatchVars,
            categoryMarketing,
            languagePtBr: true,
            readyForManualSubmit:
                bodyWithinLimit &&
                examplesMatchVars &&
                categoryMarketing &&
                variableCount === spec.variableCount,
            notes,
        },
    };
}

export function buildAllBulletinTemplateSubmissions(): BulletinTemplateSubmission[] {
    return BULLETIN_TEMPLATE_LIBRARY.map(buildBulletinTemplateSubmission);
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
