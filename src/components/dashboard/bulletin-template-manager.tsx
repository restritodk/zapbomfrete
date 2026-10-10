"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
    Copy,
    Eye,
    Loader2,
    MoreHorizontal,
    Pencil,
    Plus,
    RefreshCw,
    Send,
    Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FIELD_MAP_OPTIONS } from "@/modules/datafy/campaigns/bulletin/field-map";
import { META_BODY_MAX } from "@/modules/datafy/campaigns/bulletin/template-validation";

type ManagedItem = {
    id: string;
    kind: "builtin" | "custom";
    builtinId: string | null;
    technicalName: string;
    displayName: string;
    category: string;
    language: string;
    headerText: string | null;
    bodyText: string;
    footerText: string | null;
    fieldMappings: string[];
    exampleRow: string[];
    loadsPerMessage: number;
    variableCount: number;
    bodyCharCount: number;
    description: string;
    previewFilled: string;
    remoteStatus: string | null;
    remoteRejectedReason: string | null;
    readyForManualSubmit: boolean;
    notes: string[];
};

type FieldOpt = { key: string; label: string };

type DraftForm = {
    technicalName: string;
    displayName: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    headerText: string;
    bodyText: string;
    footerText: string;
    fieldMappings: string[];
    exampleRow: string[];
    loadsPerMessage: 1 | 2 | 3;
    description: string;
};

const emptyDraft = (): DraftForm => ({
    technicalName: "",
    displayName: "",
    category: "MARKETING",
    headerText: "",
    bodyText: "",
    footerText: "",
    fieldMappings: ["origem", "destino", "frete"],
    exampleRow: ["Lucas do Rio Verde/MT", "Rondonópolis/MT", "R$ 280/t"],
    loadsPerMessage: 1,
    description: "",
});

function statusBadgeClass(status: string) {
    const s = status.toUpperCase();
    if (s === "APPROVED")
        return "border-emerald-300 bg-emerald-50 text-emerald-800";
    if (s === "PENDING") return "border-amber-300 bg-amber-50 text-amber-900";
    if (s === "REJECTED") return "border-red-300 bg-red-50 text-red-800";
    return "border-slate-200 bg-slate-50 text-slate-600";
}

function syncMappingsToBody(body: string, mappings: string[], examples: string[]) {
    const vars = new Set<number>();
    for (const m of body.matchAll(/\{\{(\d+)\}\}/g)) {
        vars.add(Number(m[1]));
    }
    const n = vars.size ? Math.max(...vars) : 0;
    const fieldMappings = [...mappings];
    const exampleRow = [...examples];
    while (fieldMappings.length < n) fieldMappings.push("detalhes");
    while (exampleRow.length < n) exampleRow.push("Exemplo");
    return {
        fieldMappings: fieldMappings.slice(0, Math.max(n, 0)),
        exampleRow: exampleRow.slice(0, Math.max(n, 0)),
        variableCount: n,
    };
}

type Props = {
    canManage: boolean;
    hasChannelToken: boolean;
};

export function BulletinTemplateManager({
    canManage,
    hasChannelToken,
}: Props) {
    const [loading, setLoading] = useState(false);
    const [items, setItems] = useState<ManagedItem[]>([]);
    const [fieldOpts, setFieldOpts] = useState<FieldOpt[]>(FIELD_MAP_OPTIONS);
    const [metaNote, setMetaNote] = useState<string | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<DraftForm>(emptyDraft);
    const [saving, setSaving] = useState(false);
    const [submitting, setSubmitting] = useState<string | null>(null);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<ManagedItem | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [submitTarget, setSubmitTarget] = useState<ManagedItem | null>(null);

    const load = useCallback(async (quiet = false) => {
        setLoading(true);
        try {
            const res = await fetch(
                "/api/integrations/datafy/bulletin-templates"
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (!quiet) toast.error(data.message || "Falha ao carregar");
                return;
            }
            setItems(
                Array.isArray(data.data?.library) ? data.data.library : []
            );
            if (Array.isArray(data.data?.fieldMapOptions)) {
                setFieldOpts(data.data.fieldMapOptions);
            }
            setMetaNote(data.data?.metaNote || null);
            if (data.data?.remoteError && !quiet) {
                toast.message(`Remoto: ${data.data.remoteError}`);
            } else if (!quiet) {
                toast.success("Biblioteca de templates atualizada");
            }
        } catch {
            if (!quiet) toast.error("Erro ao carregar templates");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load(true);
    }, [load]);

    const previewItem = useMemo(
        () => items.find((i) => i.id === previewId) || null,
        [items, previewId]
    );

    const livePreview = useMemo(() => {
        const synced = syncMappingsToBody(
            draft.bodyText,
            draft.fieldMappings,
            draft.exampleRow
        );
        return draft.bodyText.replace(/\{\{(\d+)\}\}/g, (_m, n) => {
            const idx = Number(n) - 1;
            return synced.exampleRow[idx] || "N/D";
        });
    }, [draft]);

    const bodyLen = draft.bodyText.length;

    const openCreate = () => {
        setEditorMode("create");
        setEditingId(null);
        setDraft(emptyDraft());
        setEditorOpen(true);
    };

    const openEdit = (item: ManagedItem) => {
        setEditorMode("edit");
        setEditingId(item.id);
        setDraft({
            technicalName: item.technicalName,
            displayName: item.displayName,
            category: (item.category as DraftForm["category"]) || "MARKETING",
            headerText: item.headerText || "",
            bodyText: item.bodyText,
            footerText: item.footerText || "",
            fieldMappings: [...item.fieldMappings],
            exampleRow: [...item.exampleRow],
            loadsPerMessage: (item.loadsPerMessage === 2
                ? 2
                : item.loadsPerMessage === 3
                  ? 3
                  : 1) as 1 | 2 | 3,
            description: item.description || "",
        });
        setEditorOpen(true);
    };

    const onBodyChange = (bodyText: string) => {
        const synced = syncMappingsToBody(
            bodyText,
            draft.fieldMappings,
            draft.exampleRow
        );
        setDraft((d) => ({
            ...d,
            bodyText,
            fieldMappings: synced.fieldMappings,
            exampleRow: synced.exampleRow,
        }));
    };

    const saveDraft = async () => {
        setSaving(true);
        try {
            const payload = {
                ...draft,
                headerText: draft.headerText || null,
                footerText: draft.footerText || null,
                description: draft.description || null,
            };
            const res =
                editorMode === "create"
                    ? await fetch(
                          "/api/integrations/datafy/bulletin-templates",
                          {
                              method: "POST",
                              headers: {
                                  "Content-Type": "application/json",
                              },
                              body: JSON.stringify({
                                  action: "create",
                                  ...payload,
                              }),
                          }
                      )
                    : await fetch(
                          `/api/integrations/datafy/bulletin-templates/${encodeURIComponent(editingId!)}`,
                          {
                              method: "PATCH",
                              headers: {
                                  "Content-Type": "application/json",
                              },
                              body: JSON.stringify(payload),
                          }
                      );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.message || "Não foi possível salvar");
                return;
            }
            toast.success(
                editorMode === "create"
                    ? "Template criado"
                    : "Template atualizado"
            );
            setEditorOpen(false);
            void load(true);
        } catch {
            toast.error("Erro ao salvar template");
        } finally {
            setSaving(false);
        }
    };

    const duplicate = async (item: ManagedItem) => {
        try {
            const res = await fetch(
                `/api/integrations/datafy/bulletin-templates/${encodeURIComponent(item.id)}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "duplicate" }),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.message || "Falha ao duplicar");
                return;
            }
            toast.success(`Cópia criada: ${data.data?.technicalName || ""}`);
            void load(true);
        } catch {
            toast.error("Erro ao duplicar");
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        setDeleting(true);
        try {
            const res = await fetch(
                `/api/integrations/datafy/bulletin-templates/${encodeURIComponent(deleteTarget.id)}`,
                { method: "DELETE" }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.message || "Falha ao excluir");
                return;
            }
            toast.success(
                data.data?.warning ||
                    (deleteTarget.kind === "builtin"
                        ? "Modelo predefinido ocultado localmente"
                        : "Template removido da biblioteca local")
            );
            setDeleteTarget(null);
            void load(true);
        } catch {
            toast.error("Erro ao excluir");
        } finally {
            setDeleting(false);
        }
    };

    const confirmSubmit = async () => {
        if (!submitTarget) return;
        setSubmitting(submitTarget.technicalName);
        try {
            const res = await fetch(
                "/api/integrations/datafy/bulletin-templates",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        action: "submit",
                        name: submitTarget.technicalName,
                        confirmSubmit: true,
                    }),
                }
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.message || "Falha na submissão");
                return;
            }
            toast.success(
                `${submitTarget.technicalName} → ${data.data?.approvalStatus || "PENDING"}`
            );
            setSubmitTarget(null);
            void load(true);
        } catch {
            toast.error("Erro ao submeter");
        } finally {
            setSubmitting(null);
        }
    };

    return (
        <>
            <Card className="border-slate-200/80 shadow-sm overflow-hidden">
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between space-y-0">
                    <div className="min-w-0">
                        <CardTitle className="text-lg">
                            Templates de boletim (reutilizáveis)
                        </CardTitle>
                        <CardDescription>
                            Gerencie modelos locais, mapeie variáveis aos campos
                            da carga e envie para aprovação Meta via Datafy.
                            Exclusão local não remove templates na Meta.
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void load()}
                            disabled={loading}
                        >
                            {loading ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <RefreshCw className="mr-2 h-4 w-4" />
                            )}
                            Atualizar status
                        </Button>
                        {canManage && (
                            <Button
                                size="sm"
                                onClick={openCreate}
                                className="rounded-xl"
                            >
                                <Plus className="mr-2 h-4 w-4" />
                                Novo template
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    {metaNote && (
                        <p className="text-xs text-slate-600 rounded-xl border bg-slate-50 px-3 py-2">
                            {metaNote}
                        </p>
                    )}
                    {loading && items.length === 0 ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Carregando biblioteca…
                        </div>
                    ) : items.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4">
                            Nenhum template na biblioteca. Crie um modelo ou
                            restaure os predefinidos no código (se ocultados).
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {items.map((item) => {
                                const remoteStatus = (
                                    item.remoteStatus || "NÃO ENVIADO"
                                ).toUpperCase();
                                const approved = remoteStatus === "APPROVED";
                                const pending = remoteStatus === "PENDING";
                                return (
                                    <div
                                        key={item.id}
                                        className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 min-w-0"
                                    >
                                        <div className="flex items-start justify-between gap-2 min-w-0">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-sm truncate">
                                                    {item.displayName}
                                                </p>
                                                <p className="text-xs text-muted-foreground mt-0.5 font-mono truncate">
                                                    {item.technicalName}
                                                    {item.kind === "builtin"
                                                        ? " · predefinido"
                                                        : " · personalizado"}{" "}
                                                    · {item.variableCount} vars
                                                    · {item.bodyCharCount}/
                                                    {META_BODY_MAX} ·{" "}
                                                    {item.category} ·{" "}
                                                    {item.language}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-1.5 shrink-0">
                                                <span
                                                    className={cn(
                                                        "text-[11px] font-medium rounded-lg border px-2 py-1 whitespace-nowrap",
                                                        statusBadgeClass(
                                                            remoteStatus
                                                        )
                                                    )}
                                                >
                                                    {remoteStatus}
                                                </span>
                                                {canManage && (
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger
                                                            asChild
                                                        >
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-8 w-8 rounded-lg"
                                                                aria-label="Ações"
                                                            >
                                                                <MoreHorizontal className="h-4 w-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem
                                                                onClick={() =>
                                                                    openEdit(
                                                                        item
                                                                    )
                                                                }
                                                            >
                                                                <Pencil className="mr-2 h-3.5 w-3.5" />
                                                                Editar
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem
                                                                onClick={() =>
                                                                    void duplicate(
                                                                        item
                                                                    )
                                                                }
                                                            >
                                                                <Copy className="mr-2 h-3.5 w-3.5" />
                                                                Duplicar
                                                            </DropdownMenuItem>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                                className="text-red-700 focus:text-red-700"
                                                                onClick={() =>
                                                                    setDeleteTarget(
                                                                        item
                                                                    )
                                                                }
                                                            >
                                                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                                                Excluir
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                )}
                                            </div>
                                        </div>
                                        {item.remoteRejectedReason && (
                                            <p className="text-xs text-red-700">
                                                Motivo:{" "}
                                                {item.remoteRejectedReason}
                                            </p>
                                        )}
                                        <div className="flex flex-wrap gap-2">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="rounded-xl"
                                                onClick={() =>
                                                    setPreviewId(item.id)
                                                }
                                            >
                                                <Eye className="mr-1.5 h-3.5 w-3.5" />
                                                Visualizar
                                            </Button>
                                            {canManage && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    className="rounded-xl"
                                                    disabled={
                                                        !item.readyForManualSubmit ||
                                                        submitting ===
                                                            item.technicalName ||
                                                        approved ||
                                                        pending ||
                                                        !hasChannelToken
                                                    }
                                                    onClick={() =>
                                                        setSubmitTarget(item)
                                                    }
                                                >
                                                    {submitting ===
                                                    item.technicalName ? (
                                                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                                    ) : (
                                                        <Send className="mr-1.5 h-3.5 w-3.5" />
                                                    )}
                                                    Enviar para aprovação Meta
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Preview */}
            <Dialog
                open={!!previewItem}
                onOpenChange={(o) => !o && setPreviewId(null)}
            >
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {previewItem?.displayName || "Prévia"}
                        </DialogTitle>
                    </DialogHeader>
                    {previewItem && (
                        <div className="space-y-3 text-sm">
                            <p className="font-mono text-xs text-muted-foreground">
                                {previewItem.technicalName}
                            </p>
                            <pre className="whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-[13px] leading-relaxed font-sans">
                                {previewItem.previewFilled}
                            </pre>
                            <details className="text-xs">
                                <summary className="cursor-pointer text-slate-500">
                                    Corpo com variáveis
                                </summary>
                                <pre className="mt-1.5 whitespace-pre-wrap rounded-lg border p-2.5 font-mono text-[11px]">
                                    {previewItem.bodyText}
                                </pre>
                            </details>
                            <p className="text-xs text-slate-500">
                                Mapeamento:{" "}
                                {previewItem.fieldMappings
                                    .map(
                                        (k, i) =>
                                            `{{${i + 1}}}→${k}`
                                    )
                                    .join(" · ")}
                            </p>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Editor */}
            <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editorMode === "create"
                                ? "Novo template"
                                : "Editar template"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label>Nome técnico</Label>
                            <Input
                                className="font-mono text-sm"
                                value={draft.technicalName}
                                disabled={
                                    editorMode === "edit" &&
                                    items.find((i) => i.id === editingId)
                                        ?.remoteStatus === "APPROVED"
                                }
                                onChange={(e) =>
                                    setDraft((d) => ({
                                        ...d,
                                        technicalName: e.target.value
                                            .toLowerCase()
                                            .replace(/[^a-z0-9_]/g, ""),
                                    }))
                                }
                                placeholder="boletim_frete_1"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Nome de exibição</Label>
                            <Input
                                value={draft.displayName}
                                onChange={(e) =>
                                    setDraft((d) => ({
                                        ...d,
                                        displayName: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Categoria</Label>
                            <Select
                                value={draft.category}
                                onValueChange={(v) =>
                                    setDraft((d) => ({
                                        ...d,
                                        category: v as DraftForm["category"],
                                    }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="MARKETING">
                                        MARKETING
                                    </SelectItem>
                                    <SelectItem value="UTILITY">
                                        UTILITY
                                    </SelectItem>
                                    <SelectItem value="AUTHENTICATION">
                                        AUTHENTICATION
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Cargas por mensagem</Label>
                            <Select
                                value={String(draft.loadsPerMessage)}
                                onValueChange={(v) =>
                                    setDraft((d) => ({
                                        ...d,
                                        loadsPerMessage: Number(v) as 1 | 2 | 3,
                                    }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="1">1</SelectItem>
                                    <SelectItem value="2">2</SelectItem>
                                    <SelectItem value="3">3</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>Cabeçalho (opcional)</Label>
                            <Input
                                value={draft.headerText}
                                maxLength={60}
                                onChange={(e) =>
                                    setDraft((d) => ({
                                        ...d,
                                        headerText: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <div className="flex justify-between">
                                <Label>Corpo</Label>
                                <span
                                    className={cn(
                                        "text-[11px]",
                                        bodyLen > META_BODY_MAX
                                            ? "text-red-600"
                                            : "text-slate-500"
                                    )}
                                >
                                    {bodyLen}/{META_BODY_MAX}
                                </span>
                            </div>
                            <Textarea
                                className="min-h-[160px] font-mono text-xs"
                                value={draft.bodyText}
                                onChange={(e) => onBodyChange(e.target.value)}
                                placeholder={"*ATUALIZAÇÃO*\nOrigem: {{1}}\nDestino: {{2}}"}
                            />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>Rodapé (opcional)</Label>
                            <Input
                                value={draft.footerText}
                                maxLength={60}
                                onChange={(e) =>
                                    setDraft((d) => ({
                                        ...d,
                                        footerText: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>Descrição</Label>
                            <Input
                                value={draft.description}
                                onChange={(e) =>
                                    setDraft((d) => ({
                                        ...d,
                                        description: e.target.value,
                                    }))
                                }
                            />
                        </div>
                    </div>

                    {draft.fieldMappings.length > 0 && (
                        <div className="mt-3 space-y-2">
                            <Label>Variáveis → campos da carga</Label>
                            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                                {draft.fieldMappings.map((m, i) => (
                                    <div
                                        key={i}
                                        className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center"
                                    >
                                        <span className="text-xs font-mono text-slate-500 w-10">
                                            {`{{${i + 1}}}`}
                                        </span>
                                        <Select
                                            value={m}
                                            onValueChange={(v) => {
                                                const fieldMappings = [
                                                    ...draft.fieldMappings,
                                                ];
                                                fieldMappings[i] = v;
                                                setDraft((d) => ({
                                                    ...d,
                                                    fieldMappings,
                                                }));
                                            }}
                                        >
                                            <SelectTrigger className="h-8 text-xs">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {fieldOpts.map((o) => (
                                                    <SelectItem
                                                        key={o.key}
                                                        value={o.key}
                                                    >
                                                        {o.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <Input
                                            className="h-8 text-xs"
                                            value={draft.exampleRow[i] || ""}
                                            placeholder="Exemplo Meta"
                                            onChange={(e) => {
                                                const exampleRow = [
                                                    ...draft.exampleRow,
                                                ];
                                                exampleRow[i] = e.target.value;
                                                setDraft((d) => ({
                                                    ...d,
                                                    exampleRow,
                                                }));
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mt-3">
                        <Label className="text-xs text-muted-foreground">
                            Prévia em tempo real
                        </Label>
                        <pre className="mt-1.5 whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-[12px] leading-relaxed font-sans max-h-40 overflow-auto">
                            {livePreview || "—"}
                        </pre>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button
                            variant="outline"
                            onClick={() => setEditorOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            onClick={() => void saveDraft()}
                            disabled={saving}
                        >
                            {saving && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Salvar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete confirm */}
            <AlertDialog
                open={!!deleteTarget}
                onOpenChange={(o) => !o && setDeleteTarget(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Excluir da biblioteca local?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget?.kind === "builtin"
                                ? `O modelo predefinido "${deleteTarget.displayName}" será ocultado e não reaparecerá após deploy. A Meta não será alterada.`
                                : `Remover "${deleteTarget?.displayName}" da biblioteca local? Templates APPROVED/PENDING na Meta permanecem intactos.`}
                            {deleteTarget?.remoteStatus === "APPROVED" ||
                            deleteTarget?.remoteStatus === "PENDING"
                                ? " Campanhas ativas que usam este nome serão bloqueadas na exclusão."
                                : ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={deleting}>
                            Não
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={deleting}
                            onClick={(e) => {
                                e.preventDefault();
                                void confirmDelete();
                            }}
                            className="bg-red-600 hover:bg-red-700"
                        >
                            {deleting ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Sim, excluir
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Submit confirm */}
            <AlertDialog
                open={!!submitTarget}
                onOpenChange={(o) => !o && setSubmitTarget(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Enviar para aprovação Meta?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Submeter{" "}
                            <span className="font-mono">
                                {submitTarget?.technicalName}
                            </span>{" "}
                            via Datafy ({submitTarget?.category} · pt_BR). Isto
                            não dispara mensagens. Status inicial: PENDING.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Não</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                void confirmSubmit();
                            }}
                        >
                            Sim, enviar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
