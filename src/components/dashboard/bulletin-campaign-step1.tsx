"use client";

import { useEffect, useMemo, useState } from "react";
import {
    CheckCircle2,
    History,
    Layers,
    Loader2,
    Search,
    Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { GroupedVersionDto } from "@/components/dashboard/bulletin-grouped-cards";
import type { BulletinVersionPick } from "@/modules/datafy/campaigns/bulletin/selection";
import {
    flattenBulletinSelections,
    validateBulletinPicks,
} from "@/modules/datafy/campaigns/bulletin/selection";

function toPick(
    v: GroupedVersionDto,
    mode: "complete_bulletin" | "selected_cards",
    positions: number[]
): BulletinVersionPick {
    return {
        bundleId: v.bundleId,
        versionId: v.versionId,
        publicKey: v.publicKey,
        title: v.title,
        version: v.version,
        isCurrent: v.isCurrent,
        loadCount: v.loadCount,
        cardCount: v.cardCount,
        approvedCardCount: v.approvedCardCount,
        approvalStatus: v.approvalStatus,
        mode,
        cardPositions: positions,
        cards: v.cards.map((c) => ({
            cardId: c.id,
            position: c.position,
            loadIndexes: c.loadIndexes || [],
            technicalName: c.technicalName,
            displayName: c.displayName,
            approvalStatus: c.approvalStatus,
            loadSummary: c.loadSummary,
            bodyPreview: c.bodyPreview,
            libraryTemplateId: c.libraryTemplateId,
        })),
    };
}

export function BulletinCampaignStep1(props: {
    selections: BulletinVersionPick[];
    onChange: (next: BulletinVersionPick[]) => void;
    preselectVersionId?: string | null;
}) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [current, setCurrent] = useState<GroupedVersionDto[]>([]);
    const [history, setHistory] = useState<GroupedVersionDto[]>([]);
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "partial">(
        "all"
    );
    const [expandId, setExpandId] = useState<string | null>(null);
    const [draftPositions, setDraftPositions] = useState<Record<string, number[]>>(
        {}
    );

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const res = await fetch(
                    "/api/channels/datafy/bulletins/grouped?history=1"
                );
                const json = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(json.message || "Falha ao carregar");
                if (cancelled) return;
                setCurrent(json.data.current || []);
                setHistory(json.data.history || []);
            } catch (e) {
                if (!cancelled) {
                    setError(
                        e instanceof Error ? e.message : "Erro ao carregar boletins"
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    // Deep-link preselect
    useEffect(() => {
        if (!props.preselectVersionId || props.selections.length) return;
        const all = [...current, ...history];
        const v = all.find((x) => x.versionId === props.preselectVersionId);
        if (!v) return;
        if (v.approvedCardCount === v.cardCount && v.cardCount > 0) {
            props.onChange([
                toPick(
                    v,
                    "complete_bulletin",
                    v.cards.map((c) => c.position)
                ),
            ]);
        } else {
            setExpandId(v.versionId);
            setDraftPositions({
                [v.versionId]: v.cards
                    .filter(
                        (c) =>
                            String(c.approvalStatus).toUpperCase() === "APPROVED"
                    )
                    .map((c) => c.position),
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.preselectVersionId, current, history]);

    const filterList = (list: GroupedVersionDto[]) =>
        list.filter((v) => {
            const q = query.trim().toLowerCase();
            if (
                q &&
                !`${v.title} ${v.publicKey}`.toLowerCase().includes(q)
            ) {
                return false;
            }
            if (statusFilter === "approved") {
                return v.approvedCardCount === v.cardCount && v.cardCount > 0;
            }
            if (statusFilter === "partial") {
                return v.approvedCardCount < v.cardCount;
            }
            return true;
        });

    const selectedIds = useMemo(
        () => new Set(props.selections.map((s) => s.versionId)),
        [props.selections]
    );

    const prepared = flattenBulletinSelections(props.selections);
    const validation = validateBulletinPicks(props.selections);

    const addComplete = (v: GroupedVersionDto) => {
        if (v.approvedCardCount !== v.cardCount || !v.cardCount) return;
        if (selectedIds.has(v.versionId)) return;
        props.onChange([
            ...props.selections,
            toPick(
                v,
                "complete_bulletin",
                v.cards.map((c) => c.position)
            ),
        ]);
    };

    const addSelectedCards = (v: GroupedVersionDto) => {
        const positions = (draftPositions[v.versionId] || []).sort(
            (a, b) => a - b
        );
        if (!positions.length) return;
        const next = props.selections.filter((s) => s.versionId !== v.versionId);
        props.onChange([
            ...next,
            toPick(v, "selected_cards", positions),
        ]);
        setExpandId(null);
    };

    const remove = (versionId: string) => {
        props.onChange(props.selections.filter((s) => s.versionId !== versionId));
    };

    const renderRow = (v: GroupedVersionDto, badge: string) => {
        const fully =
            v.approvedCardCount === v.cardCount && v.cardCount > 0;
        const selected = selectedIds.has(v.versionId);
        const expanded = expandId === v.versionId;
        return (
            <div
                key={v.versionId}
                className={cn(
                    "rounded-2xl border px-3.5 py-3 space-y-2.5 transition-colors",
                    selected
                        ? "border-emerald-400 bg-emerald-50/50 ring-1 ring-emerald-200"
                        : "border-slate-200 bg-white"
                )}
            >
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-sm font-semibold text-slate-900">
                                {v.title}
                            </p>
                            <Badge variant="outline" className="rounded-md text-[10px]">
                                {badge}
                            </Badge>
                            {!v.isCurrent ? (
                                <Badge
                                    variant="outline"
                                    className="rounded-md text-[10px] border-amber-300 text-amber-900"
                                >
                                    Versão histórica
                                </Badge>
                            ) : null}
                        </div>
                        <p className="text-[11px] text-slate-500 font-mono">
                            {v.publicKey} · v{v.version} · {v.loadCount} cargas ·{" "}
                            {v.approvedCardCount}/{v.cardCount} cards
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {selected ? (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() => remove(v.versionId)}
                            >
                                <Trash2 className="h-3.5 w-3.5 mr-1" />
                                Remover
                            </Button>
                        ) : (
                            <>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="rounded-xl"
                                    disabled={!fully}
                                    onClick={() => addComplete(v)}
                                    title={
                                        fully
                                            ? "Enviar todos os cards aprovados"
                                            : "Boletim incompleto"
                                    }
                                >
                                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                    Enviar todos os cards
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="rounded-xl"
                                    onClick={() => {
                                        setExpandId(
                                            expanded ? null : v.versionId
                                        );
                                        if (!draftPositions[v.versionId]) {
                                            setDraftPositions((prev) => ({
                                                ...prev,
                                                [v.versionId]: v.cards
                                                    .filter(
                                                        (c) =>
                                                            String(
                                                                c.approvalStatus
                                                            ).toUpperCase() ===
                                                            "APPROVED"
                                                    )
                                                    .map((c) => c.position),
                                            }));
                                        }
                                    }}
                                >
                                    Cards específicos
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {!fully ? (
                    <p className="text-[11px] text-amber-900">
                        Boletim incompleto — {v.approvedCardCount}/{v.cardCount}{" "}
                        aprovados. Só cards APPROVED podem ser selecionados.
                    </p>
                ) : null}

                {expanded && !selected ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-2.5 space-y-2">
                        <Label className="text-xs">
                            Selecione cards APPROVED (ordem preservada)
                        </Label>
                        {v.cards.map((card) => {
                            const approved =
                                String(card.approvalStatus).toUpperCase() ===
                                "APPROVED";
                            const checked = (
                                draftPositions[v.versionId] || []
                            ).includes(card.position);
                            return (
                                <label
                                    key={card.id}
                                    className={cn(
                                        "flex items-start gap-2 rounded-lg border bg-white px-2.5 py-2 text-sm",
                                        !approved && "opacity-50"
                                    )}
                                >
                                    <input
                                        type="checkbox"
                                        className="mt-1"
                                        disabled={!approved}
                                        checked={checked}
                                        onChange={(e) => {
                                            setDraftPositions((prev) => {
                                                const cur = new Set(
                                                    prev[v.versionId] || []
                                                );
                                                if (e.target.checked)
                                                    cur.add(card.position);
                                                else cur.delete(card.position);
                                                return {
                                                    ...prev,
                                                    [v.versionId]: [
                                                        ...cur,
                                                    ].sort((a, b) => a - b),
                                                };
                                            });
                                        }}
                                    />
                                    <span className="min-w-0 space-y-0.5">
                                        <span className="block font-medium">
                                            Card {card.position}/{v.cardCount} —{" "}
                                            {card.loadSummary}
                                        </span>
                                        <span className="block text-[11px] font-mono text-slate-500">
                                            {card.technicalName || "—"} ·{" "}
                                            {card.approvalStatus}
                                        </span>
                                        {card.bodyPreview ? (
                                            <pre className="max-h-20 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600 mt-1">
                                                {card.bodyPreview.slice(0, 280)}
                                            </pre>
                                        ) : null}
                                    </span>
                                </label>
                            );
                        })}
                        <Button
                            type="button"
                            size="sm"
                            className="rounded-xl"
                            onClick={() => addSelectedCards(v)}
                        >
                            Confirmar cards deste boletim
                        </Button>
                    </div>
                ) : null}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-3">
                <p className="text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Selecionar boletins para envio
                </p>
                <p className="text-xs text-slate-500 mt-1">
                    Escolha boletins cadastrados e aprovados. Não é necessário
                    colar o texto novamente. A Etapa 3 só valida esta seleção.
                </p>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Pesquisar boletim ou chave…"
                        className="pl-9 h-10 rounded-xl"
                    />
                </div>
                <select
                    className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                    value={statusFilter}
                    onChange={(e) =>
                        setStatusFilter(
                            e.target.value as "all" | "approved" | "partial"
                        )
                    }
                >
                    <option value="all">Todos os status</option>
                    <option value="approved">Completos aprovados</option>
                    <option value="partial">Parciais / pendentes</option>
                </select>
            </div>

            {loading ? (
                <p className="text-sm text-slate-500 inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando boletins…
                </p>
            ) : null}
            {error ? <p className="text-sm text-red-700">{error}</p> : null}

            {!loading && !error && !current.length && !history.length ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                    Nenhum boletim registrado. Use o Criador Inteligente para
                    analisar, registrar a versão e aguardar aprovação dos cards.
                </div>
            ) : null}

            {filterList(current).length ? (
                <div className="space-y-2">
                    <Label>Boletins atuais</Label>
                    {filterList(current).map((v) => renderRow(v, "Atual"))}
                </div>
            ) : null}

            {filterList(history).length ? (
                <div className="space-y-2">
                    <Label className="inline-flex items-center gap-1.5">
                        <History className="h-3.5 w-3.5" />
                        Histórico / versões anteriores
                    </Label>
                    {filterList(history).map((v) =>
                        renderRow(v, "Histórico")
                    )}
                </div>
            ) : null}

            {props.selections.length ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 px-4 py-3 space-y-2">
                    <p className="text-sm font-semibold text-emerald-950">
                        Sequência da campanha — {prepared.meta.bulletinCount}{" "}
                        boletim(ns) · {prepared.meta.cardCount} card(s) por
                        destinatário
                    </p>
                    <ol className="space-y-1.5 text-xs text-emerald-950 list-decimal pl-4">
                        {prepared.meta.selections.map((s) => (
                            <li key={s.versionId}>
                                <span className="font-medium">{s.title}</span>{" "}
                                <span className="font-mono">
                                    {s.publicKey}
                                </span>{" "}
                                v{s.version}
                                {s.isHistorical ? " (histórica)" : ""} —{" "}
                                {s.cardCount} card(s)
                                {s.mode === "complete_bulletin"
                                    ? " · completo"
                                    : " · parcial"}
                            </li>
                        ))}
                    </ol>
                    {!validation.ok ? (
                        <ul className="text-[11px] text-amber-900 list-disc pl-4">
                            {validation.errors.map((e) => (
                                <li key={e}>{e}</li>
                            ))}
                        </ul>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
