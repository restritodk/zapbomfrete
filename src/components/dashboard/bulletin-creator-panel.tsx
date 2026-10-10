"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    AlertTriangle,
    CheckCircle2,
    Copy,
    Loader2,
    Plus,
    Save,
    Sparkles,
    Trash2,
    Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
    BulletinEditableDraft,
    BulletinLoadFields,
} from "@/modules/datafy/campaigns/bulletin/types";
import {
    duplicateLoad,
    emptyLoad,
    reindexLoads,
    serializeBulletinDraft,
} from "@/modules/datafy/campaigns/bulletin/analyze";
import { DATAFY_BULLETIN_IMPORT_KEY } from "@/modules/datafy/campaigns/bulletin/constants";

type FieldDef = {
    key: keyof BulletinLoadFields;
    label: string;
};

const LOAD_FIELDS: FieldDef[] = [
    { key: "origem", label: "Origem" },
    { key: "localCarregamento", label: "Local de carregamento" },
    { key: "destino", label: "Destino" },
    { key: "terminal", label: "Terminal / descarga" },
    { key: "janela", label: "Janela" },
    { key: "veiculo", label: "Veículo" },
    { key: "quantidade", label: "Quantidade" },
    { key: "frete", label: "Frete" },
    { key: "lote", label: "Lote" },
    { key: "localizacaoUrl", label: "Link Maps" },
    { key: "pedagio", label: "Pedágio" },
    { key: "rotaPedagio", label: "Rota / obs. pedágio" },
    { key: "observacoes", label: "Observações" },
];

function completenessLabel(c: number) {
    if (c >= 0.7) return { text: "Completa", tone: "bg-emerald-50 text-emerald-800 border-emerald-200" };
    if (c >= 0.35) return { text: "Parcial", tone: "bg-amber-50 text-amber-900 border-amber-200" };
    return { text: "Incompleta", tone: "bg-slate-100 text-slate-600 border-slate-200" };
}

export function BulletinCreatorPanel() {
    const router = useRouter();
    const [rawText, setRawText] = useState("");
    const [draft, setDraft] = useState<BulletinEditableDraft | null>(null);
    const [draftId, setDraftId] = useState<string | null>(null);
    const [partsPreview, setPartsPreview] = useState<
        Array<{ label: string; bodyText: string; templateName?: string | null; readyForRealSend?: boolean }>
    >([]);
    const [analyzing, setAnalyzing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [preparing, setPreparing] = useState(false);
    const [editIndex, setEditIndex] = useState<number | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [, startTransition] = useTransition();

    const editLoad = editIndex != null ? draft?.loads[editIndex] : null;

    const incompleteCount = useMemo(() => {
        if (!draft) return 0;
        return draft.loads.filter((l) => l.completeness < 0.35).length;
    }, [draft]);

    const analyze = useCallback(async () => {
        if (!rawText.trim()) {
            toast.error("Cole o boletim completo antes de analisar.");
            return;
        }
        setAnalyzing(true);
        try {
            const res = await fetch("/api/channels/datafy/bulletins/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    rawText,
                    includePartsPreview: true,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Falha ao analisar");
            }
            setDraft(data.draft);
            setPartsPreview(data.partsPreview || []);
            setDraftId(null);
            toast.success(
                `${data.analysis.loadCount} carga(s) identificada(s)`
            );
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro na análise");
        } finally {
            setAnalyzing(false);
        }
    }, [rawText]);

    const updateGeneral = (key: string, value: string) => {
        if (!draft) return;
        setDraft({
            ...draft,
            general: { ...draft.general, [key]: value || undefined },
        });
    };

    const updateLoadField = (
        index: number,
        key: keyof BulletinLoadFields,
        value: string
    ) => {
        if (!draft) return;
        const loads = draft.loads.map((l, i) => {
            if (i !== index) return l;
            const fields = { ...l.fields, [key]: value || undefined };
            const filled = LOAD_FIELDS.filter((f) => Boolean(fields[f.key])).length;
            return {
                ...l,
                fields,
                completeness: filled / LOAD_FIELDS.length,
                text: l.text,
            };
        });
        setDraft({ ...draft, loads: reindexLoads(loads) });
    };

    const removeLoad = (index: number) => {
        if (!draft) return;
        const loads = reindexLoads(draft.loads.filter((_, i) => i !== index));
        setDraft({ ...draft, loads });
        toast.message("Carga removida");
    };

    const dupLoad = (index: number) => {
        if (!draft) return;
        const src = draft.loads[index];
        const copy = duplicateLoad(src, draft.loads.length);
        setDraft({
            ...draft,
            loads: reindexLoads([...draft.loads, copy]),
        });
        toast.message("Carga duplicada");
    };

    const addManual = () => {
        if (!draft) {
            setDraft({
                rawText,
                general: { title: "Boletim de cargas" },
                loads: [emptyLoad(0)],
                warnings: [],
                confirmed: false,
            });
            return;
        }
        setDraft({
            ...draft,
            loads: reindexLoads([...draft.loads, emptyLoad(draft.loads.length)]),
        });
    };

    const saveDraft = async () => {
        if (!draft) return;
        setSaving(true);
        try {
            const payload = {
                rawText: draft.rawText || rawText,
                draft: {
                    ...draft,
                    loads: draft.loads,
                },
            };
            const res = await fetch(
                draftId
                    ? `/api/channels/datafy/bulletins/${draftId}`
                    : "/api/channels/datafy/bulletins",
                {
                    method: draftId ? "PATCH" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(
                        draftId
                            ? {
                                  general: draft.general,
                                  loads: draft.loads,
                                  warnings: draft.warnings,
                                  rawText: serializeBulletinDraft({
                                      general: draft.general,
                                      loads: draft.loads,
                                  }),
                              }
                            : payload
                    ),
                }
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Falha ao salvar");
            setDraftId(data.draft.id);
            toast.success("Rascunho salvo");
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao salvar");
        } finally {
            setSaving(false);
        }
    };

    const prepareCampaign = async () => {
        if (!draft?.loads.length) {
            toast.error("Nenhuma carga para preparar.");
            return;
        }
        setPreparing(true);
        try {
            let id = draftId;
            if (!id) {
                const res = await fetch("/api/channels/datafy/bulletins", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        rawText: draft.rawText || rawText,
                        draft,
                    }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Falha ao salvar");
                id = data.draft.id;
                setDraftId(id);
            } else {
                await fetch(`/api/channels/datafy/bulletins/${id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        general: draft.general,
                        loads: draft.loads,
                        rawText: serializeBulletinDraft({
                            general: draft.general,
                            loads: draft.loads,
                        }),
                    }),
                });
            }

            const prep = await fetch(
                `/api/channels/datafy/bulletins/${id}/prepare`,
                { method: "POST" }
            );
            const prepData = await prep.json();
            if (!prep.ok) throw new Error(prepData.error || "Falha ao preparar");

            sessionStorage.setItem(
                DATAFY_BULLETIN_IMPORT_KEY,
                JSON.stringify(prepData.handoff)
            );
            toast.success("Boletim confirmado — abrindo campanhas");
            startTransition(() => {
                router.push("/dashboard/broadcast?bulletin=1");
            });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao preparar");
        } finally {
            setPreparing(false);
            setConfirmOpen(false);
        }
    };

    const finalPreview = draft
        ? serializeBulletinDraft({
              general: draft.general,
              loads: draft.loads,
          })
        : "";

    return (
        <div className="mx-auto w-full max-w-5xl space-y-6 px-1 pb-16">
            <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                    Criador inteligente de boletins
                </h1>
                <p className="max-w-2xl text-sm text-slate-600">
                    Cole o boletim completo, revise cada carga e prepare a
                    campanha oficial Datafy — sem disparo automático.
                </p>
            </div>

            <Card className="border-slate-200/80 shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg">1. Colar boletim</CardTitle>
                    <CardDescription>
                        Aceita 1, 8, 30 ou mais cargas. Texto, emojis e
                        separadores são preservados.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    <Textarea
                        value={rawText}
                        onChange={(e) => setRawText(e.target.value)}
                        placeholder="Cole aqui o boletim completo (ex.: ATUALIZAÇÃO DE EMBARQUE COTTON)…"
                        className="min-h-[220px] resize-y whitespace-pre-wrap rounded-xl border-slate-200 bg-white text-[15px] leading-relaxed"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            onClick={() => void analyze()}
                            disabled={analyzing}
                            className="rounded-xl"
                        >
                            {analyzing ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Wand2 className="mr-2 h-4 w-4" />
                            )}
                            Analisar boletim
                        </Button>
                        <span className="text-xs tabular-nums text-slate-400">
                            {rawText.length.toLocaleString("pt-BR")} caracteres
                        </span>
                    </div>
                </CardContent>
            </Card>

            {draft && (
                <>
                    <Card className="border-slate-200/80 shadow-sm">
                        <CardHeader className="pb-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <CardTitle className="text-lg">
                                        2. Dados gerais
                                    </CardTitle>
                                    <CardDescription>
                                        {draft.loads.length} carga(s)
                                        {incompleteCount
                                            ? ` · ${incompleteCount} incompleta(s)`
                                            : ""}
                                    </CardDescription>
                                </div>
                                <Badge variant="outline" className="rounded-lg">
                                    <Sparkles className="mr-1 h-3 w-3" />
                                    Revisar antes de confirmar
                                </Badge>
                            </div>
                        </CardHeader>
                        <CardContent className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label>Título</Label>
                                <Input
                                    value={draft.general.title}
                                    onChange={(e) =>
                                        updateGeneral("title", e.target.value)
                                    }
                                    className="h-11 rounded-xl"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Tipo / mercadoria</Label>
                                <Input
                                    value={draft.general.operationType || ""}
                                    onChange={(e) =>
                                        updateGeneral(
                                            "operationType",
                                            e.target.value
                                        )
                                    }
                                    className="h-11 rounded-xl"
                                    placeholder="Ex.: Cotton / Algodão"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Data de referência</Label>
                                <Input
                                    value={draft.general.referenceDate || ""}
                                    onChange={(e) =>
                                        updateGeneral(
                                            "referenceDate",
                                            e.target.value
                                        )
                                    }
                                    className="h-11 rounded-xl"
                                />
                            </div>
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label>
                                    Link do grupo WhatsApp{" "}
                                    <span className="font-normal text-slate-400">
                                        (não entra automaticamente na campanha)
                                    </span>
                                </Label>
                                <Input
                                    value={draft.general.groupUrl || ""}
                                    onChange={(e) =>
                                        updateGeneral("groupUrl", e.target.value)
                                    }
                                    className="h-11 rounded-xl font-mono text-sm"
                                />
                            </div>
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label>Observações gerais</Label>
                                <Textarea
                                    value={draft.general.generalNotes || ""}
                                    onChange={(e) =>
                                        updateGeneral(
                                            "generalNotes",
                                            e.target.value
                                        )
                                    }
                                    className="min-h-[72px] rounded-xl"
                                />
                            </div>
                            {draft.warnings.length > 0 && (
                                <div className="sm:col-span-2 space-y-1 rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-900">
                                    {draft.warnings.slice(0, 6).map((w) => (
                                        <p key={w} className="flex gap-1.5">
                                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                            {w}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    <div className="space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-lg font-semibold text-slate-900">
                                3. Cargas
                            </h2>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-xl"
                                onClick={addManual}
                            >
                                <Plus className="mr-1.5 h-4 w-4" />
                                Adicionar carga
                            </Button>
                        </div>

                        <div className="grid gap-3">
                            {draft.loads.map((load, index) => {
                                const badge = completenessLabel(load.completeness);
                                return (
                                    <Card
                                        key={`load-${index}`}
                                        className="border-slate-200/80 shadow-sm overflow-hidden"
                                    >
                                        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0 pb-2">
                                            <div className="min-w-0 space-y-1">
                                                <CardTitle className="text-base">
                                                    Carga {index + 1}
                                                    {load.fields.origem
                                                        ? ` · ${load.fields.origem}`
                                                        : ""}
                                                    {load.fields.destino
                                                        ? ` → ${load.fields.destino}`
                                                        : ""}
                                                </CardTitle>
                                                <div className="flex flex-wrap gap-1.5">
                                                    <span
                                                        className={cn(
                                                            "rounded-md border px-2 py-0.5 text-[11px] font-medium",
                                                            badge.tone
                                                        )}
                                                    >
                                                        {badge.text}
                                                    </span>
                                                    {load.fields.frete && (
                                                        <Badge
                                                            variant="secondary"
                                                            className="rounded-md text-[11px]"
                                                        >
                                                            {load.fields.frete}
                                                        </Badge>
                                                    )}
                                                    {load.ambiguous.length >
                                                        0 && (
                                                        <Badge
                                                            variant="outline"
                                                            className="rounded-md border-amber-300 text-[11px] text-amber-800"
                                                        >
                                                            {load.ambiguous.length}{" "}
                                                            ambíguo(s)
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-1">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="rounded-lg"
                                                    onClick={() =>
                                                        setEditIndex(index)
                                                    }
                                                >
                                                    Editar
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="rounded-lg"
                                                    onClick={() =>
                                                        dupLoad(index)
                                                    }
                                                >
                                                    <Copy className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="ghost"
                                                    className="rounded-lg text-red-600 hover:text-red-700"
                                                    onClick={() =>
                                                        removeLoad(index)
                                                    }
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="grid gap-x-4 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
                                            {LOAD_FIELDS.filter(
                                                (f) => load.fields[f.key]
                                            )
                                                .slice(0, 8)
                                                .map((f) => (
                                                    <p
                                                        key={f.key}
                                                        className="truncate"
                                                    >
                                                        <span className="text-slate-400">
                                                            {f.label}:{" "}
                                                        </span>
                                                        {String(
                                                            load.fields[f.key]
                                                        )}
                                                    </p>
                                                ))}
                                            {load.unrecognizedLines.length >
                                                0 && (
                                                <p className="sm:col-span-2 text-xs text-amber-800">
                                                    Não reconhecido:{" "}
                                                    {load.unrecognizedLines
                                                        .slice(0, 2)
                                                        .join(" · ")}
                                                </p>
                                            )}
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </div>

                    <Card className="border-slate-200/80 shadow-sm">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg">
                                4. Prévia e preparação
                            </CardTitle>
                            <CardDescription>
                                Templates APPROVED são validados no wizard de
                                campanhas. Este passo não dispara mensagens.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() => setPreviewOpen(true)}
                            >
                                Prévia do boletim
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                className="rounded-xl"
                                onClick={() => void saveDraft()}
                                disabled={saving}
                            >
                                {saving ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Save className="mr-2 h-4 w-4" />
                                )}
                                Salvar rascunho
                            </Button>
                            <Button
                                type="button"
                                className="rounded-xl"
                                onClick={() => setConfirmOpen(true)}
                            >
                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                Confirmar e preparar campanha
                            </Button>
                        </CardContent>
                        {partsPreview.length > 0 && (
                            <CardContent className="space-y-2 border-t pt-4">
                                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                                    Estimativa de partes (templates)
                                </p>
                                {partsPreview.map((p, i) => (
                                    <div
                                        key={i}
                                        className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600"
                                    >
                                        <p className="font-medium text-slate-800">
                                            {p.label}
                                            {p.templateName
                                                ? ` · ${p.templateName}`
                                                : ""}
                                            {!p.readyForRealSend
                                                ? " · bloqueado até APPROVED"
                                                : ""}
                                        </p>
                                    </div>
                                ))}
                            </CardContent>
                        )}
                    </Card>
                </>
            )}

            <Dialog
                open={editIndex != null}
                onOpenChange={(o) => !o && setEditIndex(null)}
            >
                <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            Editar carga {(editIndex ?? 0) + 1}
                        </DialogTitle>
                    </DialogHeader>
                    {editLoad && editIndex != null && (
                        <div className="grid gap-3 py-1">
                            {LOAD_FIELDS.map((f) => (
                                <div key={f.key} className="space-y-1">
                                    <Label>{f.label}</Label>
                                    <Input
                                        value={
                                            (editLoad.fields[
                                                f.key
                                            ] as string) || ""
                                        }
                                        onChange={(e) =>
                                            updateLoadField(
                                                editIndex,
                                                f.key,
                                                e.target.value
                                            )
                                        }
                                        className="rounded-xl"
                                    />
                                </div>
                            ))}
                            {editLoad.text && (
                                <div className="space-y-1">
                                    <Label>Texto original da carga</Label>
                                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-xs text-slate-600">
                                        {editLoad.text}
                                    </pre>
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button
                            type="button"
                            className="rounded-xl"
                            onClick={() => setEditIndex(null)}
                        >
                            Concluir
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Prévia do boletim final</DialogTitle>
                    </DialogHeader>
                    <pre className="whitespace-pre-wrap rounded-xl border bg-slate-50 p-4 text-sm text-slate-700">
                        {finalPreview}
                    </pre>
                </DialogContent>
            </Dialog>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmar interpretação</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-slate-600">
                        Você revisou {draft?.loads.length || 0} carga(s). O
                        sistema abrirá o disparo em massa com o boletim
                        preparado. Nenhum envio real acontece sem autorização
                        explícita na Etapa 5.
                    </p>
                    {incompleteCount > 0 && (
                        <p className="text-sm text-amber-800">
                            Há {incompleteCount} carga(s) com poucos campos —
                            você pode continuar e completar depois.
                        </p>
                    )}
                    <DialogFooter className="gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => setConfirmOpen(false)}
                        >
                            Voltar
                        </Button>
                        <Button
                            type="button"
                            className="rounded-xl"
                            disabled={preparing}
                            onClick={() => void prepareCampaign()}
                        >
                            {preparing ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Confirmar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
