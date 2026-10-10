import type { LoadSlotField } from "./library";
import type { BulletinLoadFields } from "./types";

/** UI labels for template variable ↔ load field mapping */
export const FIELD_MAP_OPTIONS: Array<{
    key: LoadSlotField;
    label: string;
}> = [
    { key: "origem", label: "Origem" },
    { key: "localCarregamento", label: "Local de carregamento" },
    { key: "destino", label: "Destino" },
    { key: "terminal", label: "Terminal / descarga" },
    { key: "janela", label: "Janela" },
    { key: "veiculo", label: "Veículo" },
    { key: "quantidade", label: "Quantidade" },
    { key: "frete", label: "Frete" },
    { key: "lote", label: "Lote" },
    { key: "localizacao", label: "Localização (Maps)" },
    { key: "pedagio", label: "Pedágio" },
    { key: "observacoes", label: "Observações" },
    { key: "detalhes", label: "Detalhes (catch-all)" },
];

export const VALID_FIELD_KEYS = new Set(
    FIELD_MAP_OPTIONS.map((f) => f.key)
);

/** Fields that count for compatibility (grupoUrl is meta, not a template slot). */
export function filledLoadFieldKeys(
    fields: BulletinLoadFields
): LoadSlotField[] {
    const out: LoadSlotField[] = [];
    const push = (k: LoadSlotField, v?: string) => {
        if (v?.trim()) out.push(k);
    };
    push("origem", fields.origem);
    push("localCarregamento", fields.localCarregamento);
    push("destino", fields.destino);
    push("terminal", fields.terminal);
    push("janela", fields.janela);
    push("veiculo", fields.veiculo);
    push("quantidade", fields.quantidade);
    push("frete", fields.frete);
    push("lote", fields.lote);
    push("localizacao", fields.localizacaoUrl);
    push("pedagio", fields.pedagio);
    push("observacoes", fields.observacoes);
    push("detalhes", fields.detalhes);
    return out;
}

export function hasCatchAll(mappings: LoadSlotField[]): boolean {
    return (
        mappings.includes("observacoes") || mappings.includes("detalhes")
    );
}

/**
 * Uncovered filled fields that would be silently dropped without a catch-all.
 */
export function uncoveredFilledFields(
    filled: LoadSlotField[],
    mappings: LoadSlotField[]
): LoadSlotField[] {
    const mapped = new Set(mappings);
    return filled.filter(
        (k) =>
            k !== "detalhes" &&
            k !== "observacoes" &&
            !mapped.has(k)
    );
}

export function parseFieldMappings(raw: unknown): LoadSlotField[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .map((x) => String(x || "").trim())
        .filter((x): x is LoadSlotField => VALID_FIELD_KEYS.has(x as LoadSlotField));
}
