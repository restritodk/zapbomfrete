"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
    ArrowDown,
    ArrowUp,
    CheckCircle2,
    FileText,
    History,
    Layers,
    Link2,
    Loader2,
    Search,
    Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { GroupedVersionDto } from "@/components/dashboard/bulletin-grouped-cards";
import type { BulletinVersionPick } from "@/modules/datafy/campaigns/bulletin/selection";
import {
    flattenBulletinSelections,
    isOrphanVersionId,
    orphanToBulletinPick,
    validateBulletinPicks,
} from "@/modules/datafy/campaigns/bulletin/selection";

type OrphanDto = {
    id: string;
    technicalName: string;
    displayName: string;
    language: string;
    category: string;
    loadsPerMessage: number;
    remoteStatus: string | null;
    lastSyncedAt: string | null;
    bodyPreview: string;
    templateComponents?: unknown;
    suggestedBundleKey: string | null;
    associationStatus: string;
};

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
            language: c.language || "pt_BR",
            category: c.category || "MARKETING",
            templateComponents: c.templateComponents ?? null,
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
    const [orphans, setOrphans] = useState<OrphanDto[]>([]);
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<"all" | "approved" | "partial">(
        "all"
    );
    const [expandId, setExpandId] = useState<string | null>(null);
    const [draftPositions, setDraftPositions] = useState<Record<string, number[]>>(
        {}
    );
    const [associateOrphanId, setAssociateOrphanId] = useState<string | null>(
        null
    );
    const [assocMode, setAssocMode] = useState<"new" | "existing">("new");
    const [assocTitle, setAssocTitle] = useState("");
    const [assocCardId, setAssocCardId] = useState("");
    const [assocExtraIds, setAssocExtraIds] = useState<string[]>([]);
    const [assocBusy, setAssocBusy] = useState(false);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [gRes, oRes] = await Promise.all([
                fetch("/api/channels/datafy/bulletins/grouped?history=1"),
                fetch("/api/channels/datafy/bulletins/grouped?orphans=1"),
            ]);
            const gJson = await gRes.json().catch(() => ({}));
            const oJson = await oRes.json().catch(() => ({}));
            if (!gRes.ok) throw new Error(gJson.message || "Falha ao carregar boletins");
            if (!oRes.ok) throw new Error(oJson.message || "Falha ao carregar templates");
            setCurrent(gJson.data.current || []);
            setHistory(gJson.data.history || []);
            setOrphans(oJson.data.orphans || []);
        } catch (e) {
            setError(
                e instanceof Error ? e.message : "Erro ao carregar boletins"
            );
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

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

    const filteredOrphans = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return orphans;
        return orphans.filter((o) =>
            `${o.technicalName} ${o.displayName} ${o.category} ${o.language}`
                .toLowerCase()
                .includes(q)
        );
    }, [orphans, query]);

    const selectedIds = useMemo(
        () => new Set(props.selections.map((s) => s.versionId)),
        [props.selections]
    );

    const selectedOrphanIds = useMemo(() => {
        const ids = new Set<string>();
        for (const s of props.selections) {
            if (isOrphanVersionId(s.versionId)) {
                ids.add(s.versionId.slice("orphan:".length));
            }
        }
        return ids;
    }, [props.selections]);

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

    const moveSelection = (versionId: string, dir: -1 | 1) => {
        const idx = props.selections.findIndex((s) => s.versionId === versionId);
        if (idx < 0) return;
        const j = idx + dir;
        if (j < 0 || j >= props.selections.length) return;
        const next = [...props.selections];
        const [row] = next.splice(idx, 1);
        next.splice(j, 0, row);
        props.onChange(next);
    };

    const useOrphanIndividual = (o: OrphanDto) => {
        if (selectedOrphanIds.has(o.id)) return;
        props.onChange([...props.selections, orphanToBulletinPick(o)]);
        toast.success(`Template ${o.technicalName} adicionado à campanha`);
    };

    const openAssociate = (o: OrphanDto) => {
        setAssociateOrphanId(o.id);
        setAssocMode(current.length || history.length ? "existing" : "new");
        setAssocTitle(o.displayName || o.technicalName);
        setAssocCardId("");
        setAssocExtraIds([]);
    };

    const confirmAssociate = async () => {
        if (!associateOrphanId) return;
        setAssocBusy(true);
        try {
            if (assocMode === "new") {
                const ids = [associateOrphanId, ...assocExtraIds];
                const res = await fetch(
                    "/api/channels/datafy/bulletins/grouped",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "create_from_orphans",
                            title: assocTitle.trim() || "Boletim",
                            managedTemplateIds: ids,
                        }),
                    }
                );
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(json.message || "Falha ao criar boletim");
                }
                toast.success(
                    "Boletim criado e templates associados (sem reenvio Meta)"
                );
                const versionId = json.data?.version?.versionId as
                    | string
                    | undefined;
                setAssociateOrphanId(null);
                await reload();
                if (versionId) {
                    // Wait next tick for state; selection applied after reload in effect below
                    setExpandId(versionId);
                }
            } else {
                if (!assocCardId) {
                    toast.error("Escolha o card do boletim/versão");
                    return;
                }
                const res = await fetch(
                    "/api/channels/datafy/bulletins/grouped",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "associate",
                            cardId: assocCardId,
                            managedTemplateId: associateOrphanId,
                        }),
                    }
                );
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(json.message || "Falha na associação");
                }
                toast.success("Template associado ao card (sem reenvio Meta)");
                setAssociateOrphanId(null);
                await reload();
            }
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro na associação");
        } finally {
            setAssocBusy(false);
        }
    };

    const cardOptions = useMemo(
        () =>
            [...current, ...history].flatMap((v) =>
                v.cards.map((c) => ({
                    value: c.id,
                    label: `${v.publicKey} v${v.version} · Card ${c.position}/${v.cardCount} · ${c.loadSummary}`,
                    loads:
                        (c.loadIndexes || []).length ||
                        (c.loadSummary.match(/\d+/g) || []).length ||
                        1,
                    occupied: Boolean(c.technicalName && c.libraryTemplateId),
                }))
            ),
        [current, history]
    );

    const associateOrphan = orphans.find((o) => o.id === associateOrphanId);

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

    const hasRegistered =
        filterList(current).length > 0 || filterList(history).length > 0;
    const hasOrphans = filteredOrphans.length > 0;

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-3">
                <p className="text-sm font-semibold text-slate-900 inline-flex items-center gap-2">
                    <Layers className="h-4 w-4" />
                    Selecionar boletins para envio
                </p>
                <p className="text-xs text-slate-500 mt-1">
                    Use boletins registrados ou templates APPROVED ainda sem
                    associação. Não é necessário colar o texto novamente.
                </p>
            </div>

            <div className="flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[180px]">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Pesquisar boletim ou template…"
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
                    Carregando biblioteca…
                </p>
            ) : null}
            {error ? <p className="text-sm text-red-700">{error}</p> : null}

            {/* A — Boletins registrados */}
            <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-800">
                    A — Boletins registrados
                </Label>
                {!loading && !error && !hasRegistered ? (
                    <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
                        Nenhum boletim agrupado ainda. Você pode usar os
                        templates APPROVED abaixo ou associá-los a um boletim.
                    </div>
                ) : null}
                {filterList(current).length ? (
                    <div className="space-y-2">
                        <p className="text-xs text-slate-500">Boletins atuais</p>
                        {filterList(current).map((v) => renderRow(v, "Atual"))}
                    </div>
                ) : null}
                {filterList(history).length ? (
                    <div className="space-y-2">
                        <p className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                            <History className="h-3.5 w-3.5" />
                            Histórico / versões anteriores
                        </p>
                        {filterList(history).map((v) =>
                            renderRow(v, "Histórico")
                        )}
                    </div>
                ) : null}
            </div>

            {/* B — Templates APPROVED sem associação */}
            <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-800 inline-flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    B — Templates aprovados sem associação
                </Label>
                <p className="text-[11px] text-slate-500">
                    Templates APPROVED da Meta ainda não ligados a um boletim.
                    Use individualmente ou associe para enviar como boletim
                    completo.
                </p>
                {!loading && !error && !hasOrphans ? (
                    <div className="rounded-xl border border-dashed border-slate-300 px-4 py-4 text-center text-sm text-slate-500">
                        Nenhum template APPROVED sem associação. Se a página
                        Aprovações Meta listar templates, sincronize e tente
                        novamente.
                    </div>
                ) : null}
                {filteredOrphans.map((o) => {
                    const selected = selectedOrphanIds.has(o.id);
                    return (
                        <div
                            key={o.id}
                            className={cn(
                                "rounded-2xl border px-3.5 py-3 space-y-2 transition-colors",
                                selected
                                    ? "border-emerald-400 bg-emerald-50/50 ring-1 ring-emerald-200"
                                    : "border-slate-200 bg-white"
                            )}
                        >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="space-y-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        <p className="text-sm font-semibold font-mono text-slate-900">
                                            {o.technicalName}
                                        </p>
                                        <Badge
                                            variant="outline"
                                            className="rounded-md text-[10px] border-emerald-300 text-emerald-800"
                                        >
                                            APPROVED
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            className="rounded-md text-[10px]"
                                        >
                                            {o.category}
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            className="rounded-md text-[10px]"
                                        >
                                            {o.language}
                                        </Badge>
                                    </div>
                                    <p className="text-[11px] text-slate-500">
                                        {o.loadsPerMessage} carga(s)/msg
                                        {o.lastSyncedAt
                                            ? ` · sync ${new Date(o.lastSyncedAt).toLocaleString("pt-BR")}`
                                            : ""}
                                    </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {selected ? (
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            className="rounded-xl"
                                            onClick={() =>
                                                remove(`orphan:${o.id}`)
                                            }
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
                                                onClick={() =>
                                                    useOrphanIndividual(o)
                                                }
                                            >
                                                Usar template individual
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="rounded-xl"
                                                onClick={() => openAssociate(o)}
                                            >
                                                <Link2 className="h-3.5 w-3.5 mr-1" />
                                                Associar a boletim
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                            {o.bodyPreview ? (
                                <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 border border-slate-100 p-2 text-[11px] text-slate-600">
                                    {o.bodyPreview.slice(0, 500)}
                                </pre>
                            ) : null}
                        </div>
                    );
                })}
            </div>

            {associateOrphanId && associateOrphan ? (
                <div className="rounded-2xl border border-slate-300 bg-white p-4 space-y-3 shadow-sm">
                    <p className="text-sm font-semibold text-slate-900">
                        Associar{" "}
                        <span className="font-mono">
                            {associateOrphan.technicalName}
                        </span>
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant={assocMode === "new" ? "default" : "outline"}
                            className="rounded-xl"
                            onClick={() => setAssocMode("new")}
                        >
                            Criar novo boletim
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant={
                                assocMode === "existing" ? "default" : "outline"
                            }
                            className="rounded-xl"
                            disabled={!cardOptions.length}
                            onClick={() => setAssocMode("existing")}
                        >
                            Card de boletim existente
                        </Button>
                    </div>
                    {assocMode === "new" ? (
                        <div className="space-y-2">
                            <Label className="text-xs">Nome do boletim</Label>
                            <Input
                                value={assocTitle}
                                onChange={(e) => setAssocTitle(e.target.value)}
                                className="rounded-xl h-10"
                                placeholder="Ex.: Atualização Embarque Cotton"
                            />
                            {orphans.filter((o) => o.id !== associateOrphanId)
                                .length ? (
                                <div className="space-y-1.5">
                                    <Label className="text-xs">
                                        Incluir outros templates nesta versão
                                        (ordem)
                                    </Label>
                                    {orphans
                                        .filter(
                                            (o) => o.id !== associateOrphanId
                                        )
                                        .map((o) => {
                                            const checked =
                                                assocExtraIds.includes(o.id);
                                            return (
                                                <label
                                                    key={o.id}
                                                    className="flex items-center gap-2 text-xs rounded-lg border px-2 py-1.5 bg-slate-50"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={(e) => {
                                                            setAssocExtraIds(
                                                                (prev) =>
                                                                    e.target
                                                                        .checked
                                                                        ? [
                                                                              ...prev,
                                                                              o.id,
                                                                          ]
                                                                        : prev.filter(
                                                                              (
                                                                                  id
                                                                              ) =>
                                                                                  id !==
                                                                                  o.id
                                                                          )
                                                            );
                                                        }}
                                                    />
                                                    <span className="font-mono">
                                                        {o.technicalName}
                                                    </span>
                                                    <span className="text-slate-400">
                                                        · {o.language} ·{" "}
                                                        {o.loadsPerMessage}{" "}
                                                        carga(s)
                                                    </span>
                                                </label>
                                            );
                                        })}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div className="space-y-1.5">
                            <Label className="text-xs">
                                Card compatível ({associateOrphan.loadsPerMessage}{" "}
                                carga(s)/msg)
                            </Label>
                            <select
                                className="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm"
                                value={assocCardId}
                                onChange={(e) => setAssocCardId(e.target.value)}
                            >
                                <option value="">Selecione o card…</option>
                                {cardOptions
                                    .filter(
                                        (c) =>
                                            c.loads ===
                                                associateOrphan.loadsPerMessage ||
                                            c.loads === 0
                                    )
                                    .map((c) => (
                                        <option key={c.value} value={c.value}>
                                            {c.label}
                                            {c.occupied ? " (já tem template)" : ""}
                                        </option>
                                    ))}
                            </select>
                        </div>
                    )}
                    <div className="flex flex-wrap gap-2 justify-end">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-xl"
                            disabled={assocBusy}
                            onClick={() => setAssociateOrphanId(null)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            className="rounded-xl"
                            disabled={assocBusy}
                            onClick={() => void confirmAssociate()}
                        >
                            {assocBusy ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                            ) : (
                                <Link2 className="h-3.5 w-3.5 mr-1" />
                            )}
                            Confirmar associação
                        </Button>
                    </div>
                </div>
            ) : null}

            {props.selections.length ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 px-4 py-3 space-y-2">
                    <p className="text-sm font-semibold text-emerald-950">
                        Sequência da campanha — {prepared.meta.bulletinCount}{" "}
                        item(ns) · {prepared.meta.cardCount} mensagem(ns) por
                        destinatário
                    </p>
                    <p className="text-[11px] text-emerald-900/80">
                        Cada destinatário recebe todas as mensagens nesta ordem
                        antes do próximo contato. Use as setas para reordenar.
                    </p>
                    <ul className="space-y-1.5">
                        {props.selections.map((s, i) => (
                            <li
                                key={s.versionId}
                                className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200/80 bg-white px-2.5 py-2 text-xs text-emerald-950"
                            >
                                <span className="font-semibold tabular-nums text-emerald-700 w-5">
                                    {i + 1}.
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="font-medium">{s.title}</span>{" "}
                                    <span className="font-mono">
                                        {s.publicKey}
                                    </span>
                                    {isOrphanVersionId(s.versionId)
                                        ? " · template individual"
                                        : ` v${s.version} — ${s.cardCount} card(s)`}
                                </span>
                                <div className="flex gap-1 shrink-0">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 w-7 p-0 rounded-lg"
                                        disabled={i === 0}
                                        title="Mover para cima"
                                        onClick={() =>
                                            moveSelection(s.versionId, -1)
                                        }
                                    >
                                        <ArrowUp className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 w-7 p-0 rounded-lg"
                                        disabled={
                                            i === props.selections.length - 1
                                        }
                                        title="Mover para baixo"
                                        onClick={() =>
                                            moveSelection(s.versionId, 1)
                                        }
                                    >
                                        <ArrowDown className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-7 w-7 p-0 rounded-lg"
                                        title="Remover"
                                        onClick={() => remove(s.versionId)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
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
