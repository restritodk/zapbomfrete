"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Layers, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { GroupedVersionDto } from "@/components/dashboard/bulletin-grouped-cards";

export type BulletinSendPickMode = "complete_bulletin" | "single_card";

export type BulletinStep3Selection = {
    pickMode: BulletinSendPickMode;
    version: GroupedVersionDto;
    cardPosition: number | null;
    previewIndex: number;
};

type Listed = {
    current: GroupedVersionDto[];
    history: GroupedVersionDto[];
};

export function BulletinCampaignStep3(props: {
    selectedVersionId: string | null;
    pickMode: BulletinSendPickMode | null;
    cardPosition: number | null;
    previewIndex: number;
    onChange: (next: {
        pickMode: BulletinSendPickMode;
        versionId: string;
        version: GroupedVersionDto | null;
        cardPosition: number | null;
        previewIndex: number;
    }) => void;
    /** Keep Envio Direto / freeform outside this picker */
    footerSlot?: React.ReactNode;
}) {
    const [loading, setLoading] = useState(true);
    const [lists, setLists] = useState<Listed>({ current: [], history: [] });
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            try {
                const res = await fetch(
                    "/api/channels/datafy/bulletins/grouped?approved=0&history=1"
                );
                const json = await res.json().catch(() => ({}));
                if (!res.ok) throw new Error(json.message || "Falha ao carregar");
                if (cancelled) return;
                setLists({
                    current: json.data.current || [],
                    history: json.data.history || [],
                });
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

    const selected = useMemo(() => {
        const all = [...lists.current, ...lists.history];
        return all.find((v) => v.versionId === props.selectedVersionId) || null;
    }, [lists, props.selectedVersionId]);

    const emit = (
        pickMode: BulletinSendPickMode,
        version: GroupedVersionDto,
        cardPosition: number | null,
        previewIndex = 0
    ) => {
        props.onChange({
            pickMode,
            versionId: version.versionId,
            version,
            cardPosition,
            previewIndex,
        });
    };

    const previewCards =
        props.pickMode === "single_card" && props.cardPosition != null
            ? selected?.cards.filter((c) => c.position === props.cardPosition) ||
              []
            : selected?.cards || [];

    return (
        <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2">
                <button
                    type="button"
                    onClick={() => {
                        if (selected) emit("complete_bulletin", selected, null, 0);
                        else
                            props.onChange({
                                pickMode: "complete_bulletin",
                                versionId: "",
                                version: null,
                                cardPosition: null,
                                previewIndex: 0,
                            });
                    }}
                    className={cn(
                        "rounded-2xl border px-4 py-4 text-left transition-all",
                        props.pickMode === "complete_bulletin"
                            ? "border-emerald-400 bg-emerald-50/70 shadow-sm ring-1 ring-emerald-200"
                            : "border-slate-200 bg-white hover:border-slate-300"
                    )}
                >
                    <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-emerald-100/80 p-2 text-emerald-800">
                            <Layers className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="font-semibold text-slate-900">
                                Boletim completo
                            </p>
                            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                Envie todos os cards aprovados de um boletim, na
                                sequência correta.
                            </p>
                        </div>
                    </div>
                </button>
                <button
                    type="button"
                    onClick={() => {
                        if (selected) {
                            const first =
                                selected.cards.find(
                                    (c) =>
                                        String(c.approvalStatus).toUpperCase() ===
                                        "APPROVED"
                                )?.position || 1;
                            emit("single_card", selected, first, 0);
                        } else {
                            props.onChange({
                                pickMode: "single_card",
                                versionId: "",
                                version: null,
                                cardPosition: 1,
                                previewIndex: 0,
                            });
                        }
                    }}
                    className={cn(
                        "rounded-2xl border px-4 py-4 text-left transition-all",
                        props.pickMode === "single_card"
                            ? "border-sky-400 bg-sky-50/70 shadow-sm ring-1 ring-sky-200"
                            : "border-slate-200 bg-white hover:border-slate-300"
                    )}
                >
                    <div className="flex items-start gap-3">
                        <div className="rounded-xl bg-sky-100/80 p-2 text-sky-800">
                            <FileText className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="font-semibold text-slate-900">
                                Template individual
                            </p>
                            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                Selecione um único template aprovado de um
                                boletim.
                            </p>
                        </div>
                    </div>
                </button>
            </div>

            {loading ? (
                <p className="text-sm text-slate-500 inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando boletins agrupados…
                </p>
            ) : null}
            {error ? (
                <p className="text-sm text-red-700">{error}</p>
            ) : null}

            {props.pickMode ? (
                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Boletins atuais</Label>
                        <div className="space-y-2">
                            {lists.current.length === 0 ? (
                                <p className="text-xs text-slate-500">
                                    Nenhum boletim registrado ainda. Use o
                                    Criador Inteligente.
                                </p>
                            ) : (
                                lists.current.map((item) => (
                                    <VersionPickRow
                                        key={item.versionId}
                                        item={item}
                                        selected={
                                            props.selectedVersionId ===
                                            item.versionId
                                        }
                                        badge="Atual"
                                        onSelect={() => {
                                            if (
                                                props.pickMode === "single_card"
                                            ) {
                                                const first =
                                                    item.cards.find(
                                                        (c) =>
                                                            String(
                                                                c.approvalStatus
                                                            ).toUpperCase() ===
                                                            "APPROVED"
                                                    )?.position || 1;
                                                emit(
                                                    "single_card",
                                                    item,
                                                    first,
                                                    0
                                                );
                                            } else {
                                                emit(
                                                    "complete_bulletin",
                                                    item,
                                                    null,
                                                    0
                                                );
                                            }
                                        }}
                                    />
                                ))
                            )}
                        </div>
                    </div>

                    {lists.history.length > 0 ? (
                        <div className="space-y-2">
                            <Label>Boletins anteriores / Histórico</Label>
                            <div className="space-y-2">
                                {lists.history.map((item) => (
                                    <VersionPickRow
                                        key={item.versionId}
                                        item={item}
                                        selected={
                                            props.selectedVersionId ===
                                            item.versionId
                                        }
                                        badge="Histórico"
                                        onSelect={() => {
                                            if (
                                                props.pickMode === "single_card"
                                            ) {
                                                const first =
                                                    item.cards.find(
                                                        (c) =>
                                                            String(
                                                                c.approvalStatus
                                                            ).toUpperCase() ===
                                                            "APPROVED"
                                                    )?.position || 1;
                                                emit(
                                                    "single_card",
                                                    item,
                                                    first,
                                                    0
                                                );
                                            } else {
                                                emit(
                                                    "complete_bulletin",
                                                    item,
                                                    null,
                                                    0
                                                );
                                            }
                                        }}
                                    />
                                ))}
                            </div>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {selected && props.pickMode ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                    <div className="space-y-1">
                        <p className="font-semibold text-slate-900">
                            {selected.title}
                        </p>
                        <p className="text-xs text-slate-500 font-mono">
                            {selected.publicKey} · Versão {selected.version} ·{" "}
                            {selected.loadCount} cargas ·{" "}
                            {selected.approvedCardCount}/{selected.cardCount}{" "}
                            cards aprovados
                        </p>
                    </div>

                    {props.pickMode === "complete_bulletin" ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-950">
                            Enviar todos os cards deste boletim (versão{" "}
                            {selected.version}) — ordem preservada.
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <Label>Template deste boletim</Label>
                            <div className="grid gap-2">
                                {selected.cards.map((card) => {
                                    const approved =
                                        String(
                                            card.approvalStatus
                                        ).toUpperCase() === "APPROVED";
                                    return (
                                        <button
                                            key={card.id}
                                            type="button"
                                            disabled={!approved}
                                            onClick={() =>
                                                emit(
                                                    "single_card",
                                                    selected,
                                                    card.position,
                                                    0
                                                )
                                            }
                                            className={cn(
                                                "rounded-xl border px-3 py-2 text-left text-sm",
                                                props.cardPosition ===
                                                    card.position
                                                    ? "border-sky-400 bg-sky-50"
                                                    : "border-slate-200",
                                                !approved && "opacity-50"
                                            )}
                                        >
                                            Card {card.position}/{selected.cardCount}{" "}
                                            — {card.loadSummary} ·{" "}
                                            <span className="font-mono text-xs">
                                                {card.technicalName || "—"}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <Label>Prévia WhatsApp</Label>
                            {previewCards.length > 1 ? (
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <button
                                        type="button"
                                        className="underline"
                                        onClick={() =>
                                            props.onChange({
                                                pickMode: props.pickMode!,
                                                versionId: selected.versionId,
                                                version: selected,
                                                cardPosition:
                                                    props.cardPosition,
                                                previewIndex: Math.max(
                                                    0,
                                                    props.previewIndex - 1
                                                ),
                                            })
                                        }
                                    >
                                        Anterior
                                    </button>
                                    <span>
                                        Mensagem {props.previewIndex + 1} de{" "}
                                        {previewCards.length}
                                    </span>
                                    <button
                                        type="button"
                                        className="underline"
                                        onClick={() =>
                                            props.onChange({
                                                pickMode: props.pickMode!,
                                                versionId: selected.versionId,
                                                version: selected,
                                                cardPosition:
                                                    props.cardPosition,
                                                previewIndex: Math.min(
                                                    previewCards.length - 1,
                                                    props.previewIndex + 1
                                                ),
                                            })
                                        }
                                    >
                                        Próxima
                                    </button>
                                </div>
                            ) : null}
                        </div>
                        {previewCards.map((card, idx) =>
                            idx === props.previewIndex ||
                            previewCards.length === 1 ? (
                                <div
                                    key={card.id}
                                    className="rounded-2xl bg-[#e7fed6] border border-emerald-100 px-3 py-2.5 shadow-sm"
                                >
                                    <p className="text-[11px] text-emerald-900/70 mb-1">
                                        Mensagem {idx + 1} de{" "}
                                        {previewCards.length} · Versão{" "}
                                        {selected.version}
                                    </p>
                                    <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-slate-800">
                                        {card.bodyPreview ||
                                            "(sem prévia disponível)"}
                                    </pre>
                                </div>
                            ) : null
                        )}
                    </div>
                </div>
            ) : null}

            {props.footerSlot}
        </div>
    );
}

function VersionPickRow(props: {
    item: GroupedVersionDto;
    selected: boolean;
    badge: string;
    onSelect: () => void;
}) {
    const item = props.item;
    const ready =
        item.approvedCardCount === item.cardCount && item.cardCount > 0;
    return (
        <button
            type="button"
            onClick={props.onSelect}
            className={cn(
                "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                props.selected
                    ? "border-primary bg-primary/5"
                    : "border-slate-200 bg-white hover:bg-slate-50"
            )}
        >
            <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-slate-900">{item.title}</p>
                <Badge variant="outline" className="rounded-md text-[10px]">
                    {props.badge}
                </Badge>
                <Badge
                    variant="outline"
                    className="rounded-md font-mono text-[10px]"
                >
                    {item.publicKey}
                </Badge>
                <Badge variant="outline" className="rounded-md text-[10px]">
                    v{item.version}
                </Badge>
                <Badge
                    variant="outline"
                    className={cn(
                        "rounded-md text-[10px]",
                        ready
                            ? "border-emerald-300 text-emerald-800"
                            : "border-amber-300 text-amber-900"
                    )}
                >
                    {item.approvedCardCount}/{item.cardCount} aprovados
                </Badge>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">
                {item.loadCount} cargas ·{" "}
                {new Date(item.updatedAt).toLocaleString("pt-BR")}
            </p>
        </button>
    );
}
