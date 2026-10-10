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

const EXAMPLE_LOAD = [
    "Rondonópolis/MT",
    "Paranaguá/PR",
    "Terminal XXX",
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
