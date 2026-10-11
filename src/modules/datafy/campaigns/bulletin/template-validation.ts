import {
    countPositionalVars,
    sanitizeTemplateParam,
    type LoadSlotField,
} from "./library";
import { parseFieldMappings, VALID_FIELD_KEYS } from "./field-map";

export const META_BODY_MAX = 1024;
export const META_NAME_RE = /^[a-z][a-z0-9_]{2,63}$/;

export type TemplateDraftInput = {
    technicalName: string;
    displayName: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    language?: string;
    headerText?: string | null;
    bodyText: string;
    footerText?: string | null;
    /** Phase 9 — optional QUICK_REPLY buttons (consent etc.) */
    buttons?: unknown;
    fieldMappings: string[];
    exampleRow: string[];
    loadsPerMessage?: number;
    description?: string | null;
};

export type TemplateValidationResult = {
    ok: boolean;
    errors: string[];
    warnings: string[];
    variableCount: number;
    bodyCharCount: number;
    fieldMappings: LoadSlotField[];
    exampleRow: string[];
    previewFilled: string;
};

export function validateTemplateDraft(
    input: TemplateDraftInput
): TemplateValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const technicalName = String(input.technicalName || "")
        .trim()
        .toLowerCase();
    if (!META_NAME_RE.test(technicalName)) {
        errors.push(
            "Nome técnico inválido: use minúsculas, números e _, começando com letra (3–64)."
        );
    }

    const displayName = String(input.displayName || "").trim();
    if (!displayName || displayName.length > 120) {
        errors.push("Nome de exibição é obrigatório (máx. 120).");
    }

    const category = String(input.category || "").toUpperCase();
    if (!["MARKETING", "UTILITY", "AUTHENTICATION"].includes(category)) {
        errors.push("Categoria inválida.");
    }
    if (category === "AUTHENTICATION") {
        warnings.push(
            "AUTHENTICATION é raro para boletins de frete — confirme a política Meta."
        );
    }

    const language = (input.language || "pt_BR").trim() || "pt_BR";
    if (language !== "pt_BR" && language !== "pt_br") {
        errors.push("Idioma suportado neste painel: pt_BR.");
    }

    const bodyText = String(input.bodyText || "").replace(/\r\n/g, "\n");
    if (!bodyText.trim()) errors.push("Corpo da mensagem é obrigatório.");
    const bodyCharCount = bodyText.length;
    if (bodyCharCount > META_BODY_MAX) {
        errors.push(`Corpo excede ${META_BODY_MAX} caracteres (${bodyCharCount}).`);
    }

    const variableCount = countPositionalVars(bodyText);
    if (variableCount < 1) {
        errors.push("Inclua ao menos uma variável {{1}} no corpo.");
    }
    // Ensure sequential {{1}}..{{n}}
    for (let i = 1; i <= variableCount; i++) {
        if (!bodyText.includes(`{{${i}}}`)) {
            errors.push(`Variável {{${i}}} ausente — use sequência contínua.`);
            break;
        }
    }

    const fieldMappings = parseFieldMappings(input.fieldMappings);
    if (fieldMappings.length !== variableCount) {
        errors.push(
            `Mapeamentos (${fieldMappings.length}) devem coincidir com variáveis (${variableCount}).`
        );
    }
    for (const m of fieldMappings) {
        if (!VALID_FIELD_KEYS.has(m)) {
            errors.push(`Campo de mapeamento inválido: ${m}`);
        }
    }

    let exampleRow = Array.isArray(input.exampleRow)
        ? input.exampleRow.map((v) => sanitizeTemplateParam(String(v || "")))
        : [];
    while (exampleRow.length < variableCount) exampleRow.push("Exemplo");
    exampleRow = exampleRow.slice(0, variableCount);
    if (exampleRow.some((e) => !e || e === "N/D")) {
        warnings.push("Preencha exemplos realistas para cada variável (Meta exige).");
    }

    const loadsPerMessage = Number(input.loadsPerMessage || 1);
    if (![1, 2, 3].includes(loadsPerMessage)) {
        errors.push("Cargas por mensagem deve ser 1, 2 ou 3.");
    } else if (variableCount % loadsPerMessage !== 0) {
        warnings.push(
            "Quantidade de variáveis não é múltiplo de cargas/mensagem — confira o mapeamento."
        );
    }

    if (input.headerText && input.headerText.length > 60) {
        warnings.push("Cabeçalho TEXT da Meta costuma limitar a ~60 caracteres.");
    }
    if (input.footerText && input.footerText.length > 60) {
        warnings.push("Rodapé Meta costuma limitar a ~60 caracteres.");
    }

    const previewFilled = bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
        const idx = Number(n) - 1;
        return exampleRow[idx] || "N/D";
    });

    return {
        ok: errors.length === 0,
        errors,
        warnings,
        variableCount,
        bodyCharCount,
        fieldMappings,
        exampleRow,
        previewFilled,
    };
}

export function buildBodyFromMappings(
    title: string,
    mappingsPerLoad: LoadSlotField[],
    loadsPerMessage: 1 | 2 | 3
): string {
    const label: Record<string, string> = {
        origem: "Origem",
        localCarregamento: "Local carreg.",
        destino: "Destino",
        terminal: "Descarga",
        janela: "Janela",
        veiculo: "Veículo",
        quantidade: "Qtd",
        frete: "Frete",
        lote: "Lote",
        localizacao: "Maps",
        pedagio: "Pedágio",
        observacoes: "Obs.",
        detalhes: "Detalhes",
    };
    const blocks: string[] = [`*${title || "ATUALIZAÇÃO DE EMBARQUE"}*`, ""];
    let n = 1;
    for (let i = 0; i < loadsPerMessage; i++) {
        if (i > 0) blocks.push("");
        blocks.push(
            `*${loadsPerMessage === 1 ? "Carga" : `Carga ${i + 1}`}*`
        );
        for (const key of mappingsPerLoad) {
            blocks.push(`${label[key] || key}: {{${n}}}`);
            n++;
        }
    }
    return blocks.join("\n");
}
