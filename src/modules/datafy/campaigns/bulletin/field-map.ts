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
    { key: "rotaOrigem", label: "Rota origem + local (v3)" },
    { key: "rotaDestino", label: "Destino + terminal (v3)" },
    { key: "veiculoQtd", label: "Veículo + quantidade (v3)" },
    { key: "fretePedagio", label: "Frete + pedágio (v3)" },
    { key: "mapaObs", label: "Mapa + observações (v3)" },
];

export const VALID_FIELD_KEYS = new Set(
    FIELD_MAP_OPTIONS.map((f) => f.key)
);

/**
 * Atomic freight fields covered by a slot (composites expand).
 * Used for compatibility / uncovered-field checks.
 */
export const SLOT_FIELD_COVERAGE: Record<LoadSlotField, LoadSlotField[]> = {
    origem: ["origem"],
    localCarregamento: ["localCarregamento"],
    destino: ["destino"],
    terminal: ["terminal"],
    janela: ["janela"],
    veiculo: ["veiculo"],
    quantidade: ["quantidade"],
    frete: ["frete"],
    lote: ["lote"],
    localizacao: ["localizacao"],
    pedagio: ["pedagio"],
    observacoes: ["observacoes"],
    detalhes: ["detalhes"],
    rotaOrigem: ["origem", "localCarregamento"],
    rotaDestino: ["destino", "terminal"],
    veiculoQtd: ["veiculo", "quantidade"],
    fretePedagio: ["frete", "pedagio"],
    mapaObs: ["localizacao", "observacoes"],
};

export function expandSlotCoverage(mappings: LoadSlotField[]): LoadSlotField[] {
    const out = new Set<LoadSlotField>();
    for (const m of mappings) {
        for (const k of SLOT_FIELD_COVERAGE[m] || [m]) {
            out.add(k);
        }
    }
    return [...out];
}

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
    const covered = expandSlotCoverage(mappings);
    return (
        covered.includes("observacoes") ||
        covered.includes("detalhes") ||
        mappings.includes("observacoes") ||
        mappings.includes("detalhes") ||
        mappings.includes("mapaObs")
    );
}

/**
 * Uncovered filled fields that would be silently dropped without a catch-all.
 * Composites (rotaOrigem, etc.) count as covering their atomic parts.
 */
export function uncoveredFilledFields(
    filled: LoadSlotField[],
    mappings: LoadSlotField[]
): LoadSlotField[] {
    const mapped = new Set(expandSlotCoverage(mappings));
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
