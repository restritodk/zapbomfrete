"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
    Ban,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Clock3,
    Copy,
    Eye,
    FileStack,
    FolderOpen,
    Link2,
    Loader2,
    MoreHorizontal,
    PauseCircle,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Send,
    Trash2,
    Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogDescription,
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
    buildPageMeta,
    rangeLabel,
    visiblePageNumbers,
} from "@/lib/mass-dispatch/pagination";
import { FIELD_MAP_OPTIONS } from "@/modules/datafy/campaigns/bulletin/field-map";
import { META_BODY_MAX } from "@/modules/datafy/campaigns/bulletin/template-validation";
import { getRejectionDisplay } from "@/modules/datafy/campaigns/bulletin/rejection-reason";
import {
    computeLibraryCounters,
    countComponents,
    filterLibraryRows,
    formatSaoPaulo,
    libraryDateLines,
    statusBucket,
    statusLabelPt,
    type LibraryTab,
} from "@/modules/datafy/campaigns/bulletin/library-display";
import type { GroupedVersionDto } from "@/components/dashboard/bulletin-grouped-cards";
import { BulletinTemplateEditorDialog } from "@/components/dashboard/bulletin-template-editor-dialog";
import type { TemplateEditorDraft } from "@/modules/datafy/campaigns/bulletin/template-editor-helpers";
import {
    buildCompatibleCardOptions,
    emptyCompatMessage,
} from "@/modules/datafy/campaigns/bulletin/association-compat";

type ButtonsDraft = {
    enabled: boolean;
    grantText: string;
    denyText: string;
};

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
    buttons?: {
        enabled: boolean;
        purpose?: string;
        buttons?: Array<{ text: string; payload?: string }>;
    } | null;
    fieldMappings: string[];
    exampleRow: string[];
    loadsPerMessage: number;
    variableCount: number;
    bodyCharCount: number;
    description: string;
    previewFilled: string;
    remoteStatus: string | null;
    remoteTemplateId?: string | null;
    remoteRejectedReason: string | null;
    readyForManualSubmit: boolean;
    notes: string[];
    lastSubmittedAt?: string | null;
    lastSyncedAt?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    wabaId?: string | null;
    associated?: boolean;
};

type FieldOpt = { key: string; label: string };

type DraftForm = TemplateEditorDraft;

const emptyDraft = (): DraftForm => ({
    technicalName: "",
    displayName: "",
    category: "MARKETING",
    headerText: "",
    bodyText: "",
    footerText: "",
    buttons: {
        enabled: false,
        grantText: "Sim, quero ofertas",
        denyText: "Não quero receber",
    },
    fieldMappings: ["origem", "destino", "frete"],
    exampleRow: ["Lucas do Rio Verde/MT", "Rondonópolis/MT", "R$ 280/t"],
    loadsPerMessage: 1,
    description: "",
});

function buttonsFromItem(item: ManagedItem): ButtonsDraft {
    const b = item.buttons;
    if (!b?.enabled) {
        return {
            enabled: false,
            grantText: "Sim, quero ofertas",
            denyText: "Não quero receber",
        };
    }
    return {
        enabled: true,
        grantText: b.buttons?.[0]?.text || "Sim, quero ofertas",
        denyText: b.buttons?.[1]?.text || "Não quero receber",
    };
}

function buttonsPayload(d: ButtonsDraft) {
    if (!d.enabled) return { enabled: false, purpose: "consent_offers", buttons: [] };
    return {
        enabled: true,
        purpose: "consent_offers",
        buttons: [
            {
                type: "QUICK_REPLY",
                text: d.grantText.trim() || "Sim, quero ofertas",
                payload: "consent_grant_offers",
            },
            {
                type: "QUICK_REPLY",
                text: d.denyText.trim() || "Não quero receber",
                payload: "consent_deny_offers",
            },
        ],
    };
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

function statusBadgeClass(status: string | null) {
    const b = statusBucket(status);
    if (b === "approved")
        return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 border-0";
    if (b === "pending")
        return "bg-orange-50 text-orange-700 ring-1 ring-orange-100 border-0";
    if (b === "rejected")
        return "bg-red-50 text-red-700 ring-1 ring-red-100 border-0";
    if (b === "paused")
        return "bg-amber-50 text-amber-800 ring-1 ring-amber-100 border-0";
    if (b === "disabled")
        return "bg-slate-100 text-slate-600 ring-1 ring-slate-200 border-0";
    return "bg-slate-100 text-slate-600 ring-1 ring-slate-200 border-0";
}

type Props = {
    canManage: boolean;
    hasChannelToken: boolean;
    /** When false, hides the page-level hero (settings embed). Default true. */
    showPageChrome?: boolean;
    /** Show approved-unassociated section. Default true. */
    showOrphans?: boolean;
};

export function BulletinTemplateManager({
    canManage,
    hasChannelToken,
    showPageChrome = true,
    showOrphans = true,
}: Props) {
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [items, setItems] = useState<ManagedItem[]>([]);
    const [fieldOpts, setFieldOpts] = useState<FieldOpt[]>(FIELD_MAP_OPTIONS);
    const [metaNote, setMetaNote] = useState<string | null>(null);
    const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
    const [remoteError, setRemoteError] = useState<string | null>(null);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const hasLoadedOnceRef = useRef(false);
    const loadInFlightRef = useRef(false);

    const [qInput, setQInput] = useState("");
    const [q, setQ] = useState("");
    const [tab, setTab] = useState<LibraryTab>("all");
    const [status, setStatus] = useState("all");
    const [category, setCategory] = useState("all");
    const [language, setLanguage] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    const [editorOpen, setEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<DraftForm>(emptyDraft());
    const [saving, setSaving] = useState(false);
    const [submitting, setSubmitting] = useState<string | null>(null);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const [detailTab, setDetailTab] = useState<
        "overview" | "content" | "vars" | "history"
    >("overview");
    const [deleteTarget, setDeleteTarget] = useState<ManagedItem | null>(null);
    const [deleting, setDeleting] = useState(false);
    const [submitTarget, setSubmitTarget] = useState<ManagedItem | null>(null);

    const [associateTarget, setAssociateTarget] = useState<ManagedItem | null>(
        null
    );
    const [associateVersions, setAssociateVersions] = useState<
        GroupedVersionDto[]
    >([]);
    const [associateCardId, setAssociateCardId] = useState("");
    const [associating, setAssociating] = useState(false);
    const [creatingCompat, setCreatingCompat] = useState(false);
    const [loadingVersions, setLoadingVersions] = useState(false);
    const [associateLoadError, setAssociateLoadError] = useState<string | null>(
        null
    );

    const load = useCallback(async (opts?: { silent?: boolean; toastOk?: boolean }) => {
        const silent = Boolean(opts?.silent) && hasLoadedOnceRef.current;
        if (loadInFlightRef.current) return;
        loadInFlightRef.current = true;
        if (!silent) setLoading(true);
        else setRefreshing(true);
        try {
            const res = await fetch(
                "/api/integrations/datafy/bulletin-templates"
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (!silent) toast.error(data.message || "Falha ao carregar");
                return;
            }
            setItems(
                Array.isArray(data.data?.library) ? data.data.library : []
            );
            if (Array.isArray(data.data?.fieldMapOptions)) {
                setFieldOpts(data.data.fieldMapOptions);
            }
            setMetaNote(data.data?.metaNote || null);
            setLastSyncAt(data.data?.lastSyncAt || null);
            setRemoteError(data.data?.remoteError || null);
            hasLoadedOnceRef.current = true;
            setHasLoadedOnce(true);
            if (data.data?.remoteError && opts?.toastOk !== false && !silent) {
                toast.message(`Remoto: ${data.data.remoteError}`);
            } else if (opts?.toastOk) {
                toast.success("Biblioteca de templates atualizada");
            }
        } catch {
            if (!silent) toast.error("Erro ao carregar templates");
        } finally {
            setLoading(false);
            setRefreshing(false);
            loadInFlightRef.current = false;
        }
    }, []);

    useEffect(() => {
        void load({ silent: true });
    }, [load]);

    useEffect(() => {
        const t = setTimeout(() => {
            const next = qInput.trim();
            setQ((prev) => {
                if (prev !== next) setPage(1);
                return next;
            });
        }, 350);
        return () => clearTimeout(t);
    }, [qInput]);

    const counters = useMemo(() => computeLibraryCounters(items), [items]);

    const filtered = useMemo(
        () =>
            filterLibraryRows(items, {
                q,
                tab,
                status,
                category,
                language,
            }) as ManagedItem[],
        [items, q, tab, status, category, language]
    );

    const listMeta = useMemo(
        () => buildPageMeta(filtered.length, page, pageSize),
        [filtered.length, page, pageSize]
    );

    useEffect(() => {
        if (listMeta.page !== page) setPage(listMeta.page);
    }, [listMeta.page, page]);

    const pageRows = useMemo(() => {
        const start = (listMeta.page - 1) * listMeta.limit;
        return filtered.slice(start, start + listMeta.limit);
    }, [filtered, listMeta.page, listMeta.limit]);

    const pageNums = visiblePageNumbers(listMeta.page, listMeta.totalPages, 3);
    const unassociated = useMemo(
        () =>
            items.filter(
                (i) =>
                    statusBucket(i.remoteStatus) === "approved" && !i.associated
            ),
        [items]
    );

    const previewItem = useMemo(
        () => items.find((i) => i.id === previewId) || null,
        [items, previewId]
    );

    const showInitialSkeleton = loading && !hasLoadedOnce;
    const syncOk = !remoteError && Boolean(lastSyncAt || hasLoadedOnce);

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
            buttons: buttonsFromItem(item),
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
                buttons: buttonsPayload(draft.buttons),
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
            void load({ silent: true });
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
            void load({ silent: true });
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
            void load({ silent: true });
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
            void load({ silent: true });
        } catch {
            toast.error("Erro ao submeter");
        } finally {
            setSubmitting(null);
        }
    };

    const openAssociate = async (item: ManagedItem) => {
        setAssociateTarget(item);
        setAssociateCardId("");
        setAssociateLoadError(null);
        setLoadingVersions(true);
        try {
            const vRes = await fetch(
                "/api/channels/datafy/bulletins/grouped?history=1"
            );
            const vJson = await vRes.json().catch(() => ({}));
            if (!vRes.ok) throw new Error(vJson.message || "Falha versões");
            setAssociateVersions([
                ...(vJson.data.current || []),
                ...(vJson.data.history || []),
            ]);
        } catch (e) {
            const msg =
                e instanceof Error ? e.message : "Erro ao carregar cards";
            setAssociateLoadError(msg);
            toast.error(msg);
        } finally {
            setLoadingVersions(false);
        }
    };

    const compatibleCardOptions = useMemo(() => {
        if (!associateTarget) return [];
        return buildCompatibleCardOptions(associateVersions, {
            templateLoadsPerMessage: associateTarget.loadsPerMessage,
            templateLanguage: associateTarget.language || "pt_BR",
            excludeAlreadyLinked: true,
        });
    }, [associateTarget, associateVersions]);

    useEffect(() => {
        if (
            associateCardId &&
            !compatibleCardOptions.some((c) => c.value === associateCardId)
        ) {
            setAssociateCardId("");
        }
    }, [associateCardId, compatibleCardOptions]);

    const associateEmptyReason = useMemo(() => {
        if (!associateTarget || loadingVersions) return null;
        if (compatibleCardOptions.length) return null;
        const totalCards = associateVersions.reduce(
            (n, v) => n + (v.cards?.length || 0),
            0
        );
        return emptyCompatMessage({
            templateLoadsPerMessage: associateTarget.loadsPerMessage,
            templateLanguage: associateTarget.language || "pt_BR",
            totalCards,
            totalVersions: associateVersions.length,
        });
    }, [
        associateTarget,
        associateVersions,
        compatibleCardOptions.length,
        loadingVersions,
    ]);

    const confirmAssociate = async () => {
        if (!associateTarget || !associateCardId) {
            toast.error("Escolha o card do boletim/versão");
            return;
        }
        if (associating) return;
        setAssociating(true);
        try {
            const res = await fetch("/api/channels/datafy/bulletins/grouped", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "associate",
                    cardId: associateCardId,
                    managedTemplateId: associateTarget.id,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.message || "Falha na associação");
            toast.success("Template associado ao card (sem reenvio Meta)");
            setAssociateTarget(null);
            setAssociateCardId("");
            void load({ silent: true });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro");
        } finally {
            setAssociating(false);
        }
    };

    const createCompatibleCard = async () => {
        if (!associateTarget || creatingCompat) return;
        setCreatingCompat(true);
        try {
            const res = await fetch("/api/channels/datafy/bulletins/grouped", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "create_from_orphans",
                    title:
                        associateTarget.displayName ||
                        associateTarget.technicalName,
                    managedTemplateIds: [associateTarget.id],
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(
                    json.message ||
                        "Não foi possível criar um card compatível"
                );
            }
            toast.success(
                "Card compatível criado e associado (sem reenvio Meta)"
            );
            setAssociateTarget(null);
            setAssociateCardId("");
            void load({ silent: true });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro");
        } finally {
            setCreatingCompat(false);
        }
    };

    const premiumCard =
        "rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_4px_rgba(15,23,42,0.06)]";
    const premiumBtn =
        "rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.55)]";
    const premiumBtnOutline =
        "rounded-xl border-slate-200 bg-white text-[#0f2744] hover:bg-slate-50";

    const tabs: Array<{ id: LibraryTab; label: string; count: number }> = [
        { id: "all", label: "Todos os templates", count: counters.total },
        { id: "local", label: "Modelos locais", count: counters.local },
        {
            id: "approved",
            label: "Aprovados na Meta",
            count: counters.approved,
        },
        { id: "pending", label: "Em análise", count: counters.pending },
        { id: "rejected", label: "Rejeitados", count: counters.rejected },
        { id: "not_sent", label: "Não enviados", count: counters.notSent },
        {
            id: "unassociated",
            label: "Não associados",
            count: counters.unassociatedApproved,
        },
    ];

    const indicatorCards = [
        {
            label: "Total de templates",
            value: counters.total,
            desc: "Modelos locais e oficiais",
            icon: FileStack,
            iconBg: "bg-blue-50 text-blue-600",
            accent: "text-[#1d4ed8]",
        },
        {
            label: "Aprovados na Meta",
            value: counters.approved,
            desc: "Disponíveis para uso",
            icon: CheckCircle2,
            iconBg: "bg-emerald-50 text-emerald-600",
            accent: "text-emerald-700",
        },
        {
            label: "Em análise",
            value: counters.pending,
            desc: "Aguardando aprovação",
            icon: Clock3,
            iconBg: "bg-orange-50 text-orange-600",
            accent: "text-orange-700",
        },
        {
            label: "Rejeitados",
            value: counters.rejected,
            desc: "Requer ajustes",
            icon: Ban,
            iconBg: "bg-red-50 text-red-600",
            accent: "text-red-700",
        },
        {
            label: "Não enviados",
            value: counters.notSent,
            desc: "Criados no sistema",
            icon: PauseCircle,
            iconBg: "bg-slate-100 text-slate-600",
            accent: "text-slate-700",
        },
        {
            label: "Aprovados não associados",
            value: counters.unassociatedApproved,
            desc: "Precisam de vínculo",
            icon: Link2,
            iconBg: "bg-blue-50 text-blue-600",
            accent: "text-[#1d4ed8]",
        },
    ];

    const openPreview = (item: ManagedItem) => {
        setDetailTab("overview");
        setPreviewId(item.id);
    };

    const associationBadge = (item: ManagedItem) => {
        const bucket = statusBucket(item.remoteStatus);
        if (bucket === "not_sent" || bucket === "other") {
            return (
                <span className="text-slate-400 text-sm tabular-nums">—</span>
            );
        }
        if (item.associated) {
            return (
                <Badge className="rounded-full bg-blue-50 text-blue-700 hover:bg-blue-50 border-0 ring-1 ring-blue-100 font-medium gap-1">
                    <Link2 className="h-3 w-3" />
                    Associado
                </Badge>
            );
        }
        if (bucket === "approved") {
            return (
                <Badge className="rounded-full bg-orange-50 text-orange-700 hover:bg-orange-50 border-0 ring-1 ring-orange-100 font-medium gap-1">
                    <Unlink className="h-3 w-3" />
                    Não associado
                </Badge>
            );
        }
        return (
            <span className="text-slate-400 text-sm tabular-nums">—</span>
        );
    };

    const rowActions = (item: ManagedItem) => {
        const remoteStatus = statusBucket(item.remoteStatus);
        const approved = remoteStatus === "approved";
        const pending = remoteStatus === "pending";
        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
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
                    <DropdownMenuItem onClick={() => openPreview(item)}>
                        <Eye className="mr-2 h-3.5 w-3.5" />
                        Visualizar
                    </DropdownMenuItem>
                    {canManage && (
                        <DropdownMenuItem onClick={() => openEdit(item)}>
                            <Pencil className="mr-2 h-3.5 w-3.5" />
                            Editar
                        </DropdownMenuItem>
                    )}
                    {canManage && (
                        <DropdownMenuItem onClick={() => void duplicate(item)}>
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            Duplicar
                        </DropdownMenuItem>
                    )}
                    {canManage && approved && !item.associated && (
                            <DropdownMenuItem
                                onClick={() => void openAssociate(item)}
                            >
                                <Link2 className="mr-2 h-3.5 w-3.5" />
                                Associar
                            </DropdownMenuItem>
                        )}
                    {canManage &&
                        item.readyForManualSubmit &&
                        !approved &&
                        !pending &&
                        hasChannelToken && (
                            <DropdownMenuItem
                                onClick={() => setSubmitTarget(item)}
                            >
                                <Send className="mr-2 h-3.5 w-3.5" />
                                Enviar para aprovação
                            </DropdownMenuItem>
                        )}
                    {canManage && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                                className="text-red-700 focus:text-red-700"
                                onClick={() => setDeleteTarget(item)}
                            >
                                <Trash2 className="mr-2 h-3.5 w-3.5" />
                                Excluir localmente
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        );
    };

    return (
        <>
            <div className="mx-auto w-full max-w-[1400px] space-y-5 overflow-x-hidden">
                {showPageChrome && (
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex items-start gap-3 min-w-0">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#2563eb] text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)]">
                                <FolderOpen className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0f2744]">
                                    Biblioteca de templates
                                </h1>
                                <p className="text-slate-500 text-sm mt-1 max-w-2xl">
                                    Gerencie, visualize e associe seus modelos
                                    de mensagens do WhatsApp.
                                </p>
                                <p className="text-[12px] text-slate-400 mt-1 max-w-2xl">
                                    Templates oficiais aprovados pela Meta
                                    sincronizados via Datafy e modelos locais
                                    criados no sistema.
                                </p>
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <div
                                className={cn(
                                    "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1",
                                    syncOk
                                        ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                                        : "bg-amber-50 text-amber-800 ring-amber-100"
                                )}
                            >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>
                                    {syncOk
                                        ? "Meta sincronizada"
                                        : "Sync com avisos"}
                                </span>
                                <span className="text-[11px] opacity-80 font-normal">
                                    Última sync:{" "}
                                    {formatSaoPaulo(lastSyncAt) || "—"}
                                </span>
                            </div>
                            <Button
                                variant="outline"
                                size="icon"
                                className={cn("h-9 w-9", premiumBtnOutline)}
                                disabled={loading || refreshing}
                                onClick={() =>
                                    void load({ silent: true, toastOk: true })
                                }
                                aria-label="Atualizar"
                            >
                                <RefreshCw
                                    className={cn(
                                        "h-4 w-4",
                                        (loading || refreshing) &&
                                            "animate-spin"
                                    )}
                                />
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={loading || refreshing}
                                onClick={() =>
                                    void load({ silent: false, toastOk: true })
                                }
                                className={premiumBtnOutline}
                            >
                                <RefreshCw
                                    className={cn(
                                        "h-4 w-4 mr-1.5",
                                        (loading || refreshing) &&
                                            "animate-spin"
                                    )}
                                />
                                Atualizar status
                            </Button>
                            {canManage && (
                                <Button
                                    size="sm"
                                    onClick={openCreate}
                                    className={premiumBtn}
                                >
                                    <Plus className="h-4 w-4 mr-1.5" />
                                    Novo template
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                {!showPageChrome && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h2 className="text-lg font-semibold text-[#0f2744]">
                                Templates de boletim
                            </h2>
                            <p className="text-xs text-slate-500">
                                Biblioteca local mapeada para compose e disparo
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={loading || refreshing}
                                onClick={() =>
                                    void load({ silent: true, toastOk: true })
                                }
                                className={premiumBtnOutline}
                            >
                                <RefreshCw
                                    className={cn(
                                        "h-4 w-4 mr-1.5",
                                        (loading || refreshing) &&
                                            "animate-spin"
                                    )}
                                />
                                Atualizar status
                            </Button>
                            {canManage && (
                                <Button
                                    size="sm"
                                    onClick={openCreate}
                                    className={premiumBtn}
                                >
                                    <Plus className="h-4 w-4 mr-1.5" />
                                    Novo template
                                </Button>
                            )}
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                    {indicatorCards.map((c) => {
                        const Icon = c.icon;
                        return (
                            <div
                                key={c.label}
                                className={`${premiumCard} px-3.5 py-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_rgba(15,23,42,0.18)] motion-reduce:transform-none`}
                            >
                                <div
                                    className={`flex h-9 w-9 items-center justify-center rounded-xl ${c.iconBg}`}
                                >
                                    <Icon className="h-4 w-4" />
                                </div>
                                <p
                                    className={`mt-3 text-2xl font-semibold tracking-tight tabular-nums ${c.accent}`}
                                >
                                    {showInitialSkeleton ? "—" : c.value}
                                </p>
                                <p className="mt-0.5 text-[12px] font-medium text-slate-700 leading-snug">
                                    {c.label}
                                </p>
                                <p className="text-[11px] text-slate-400 mt-0.5">
                                    {c.desc}
                                </p>
                            </div>
                        );
                    })}
                </div>

                <div className={`${premiumCard} overflow-hidden`}>
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center justify-between px-4 sm:px-5 pt-4 pb-3">
                        <div className="relative w-full xl:max-w-md">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <Input
                                className="pl-9 h-10 rounded-xl border-slate-200 bg-slate-50/60"
                                placeholder="Pesquisar por nome, categoria ou idioma..."
                                value={qInput}
                                onChange={(e) => setQInput(e.target.value)}
                            />
                        </div>
                        <div className="flex flex-wrap gap-2 items-center">
                            <Select
                                value={status}
                                onValueChange={(v) => {
                                    setPage(1);
                                    setStatus(v);
                                }}
                            >
                                <SelectTrigger className="w-[160px] h-10 rounded-xl border-slate-200">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">
                                        Todos os status
                                    </SelectItem>
                                    <SelectItem value="APPROVED">
                                        Aprovados
                                    </SelectItem>
                                    <SelectItem value="PENDING">
                                        Em análise
                                    </SelectItem>
                                    <SelectItem value="REJECTED">
                                        Rejeitados
                                    </SelectItem>
                                    <SelectItem value="NOT_SENT">
                                        Não enviados
                                    </SelectItem>
                                    <SelectItem value="PAUSED_OR_DISABLED">
                                        Pausados/desabilitados
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                            <Select
                                value={category}
                                onValueChange={(v) => {
                                    setPage(1);
                                    setCategory(v);
                                }}
                            >
                                <SelectTrigger className="w-[160px] h-10 rounded-xl border-slate-200">
                                    <SelectValue placeholder="Categoria" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">
                                        Todas as categorias
                                    </SelectItem>
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
                            <Select
                                value={language}
                                onValueChange={(v) => {
                                    setPage(1);
                                    setLanguage(v);
                                }}
                            >
                                <SelectTrigger className="w-[140px] h-10 rounded-xl border-slate-200">
                                    <SelectValue placeholder="Idioma" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">
                                        Todos os idiomas
                                    </SelectItem>
                                    <SelectItem value="pt_BR">pt_BR</SelectItem>
                                    <SelectItem value="en">en</SelectItem>
                                    <SelectItem value="en_US">en_US</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="px-4 sm:px-5 pb-3 overflow-x-auto">
                        <div className="flex gap-1.5 min-w-max">
                            {tabs.map((t) => (
                                <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => {
                                        setTab(t.id);
                                        setPage(1);
                                    }}
                                    className={cn(
                                        "rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors whitespace-nowrap",
                                        tab === t.id
                                            ? "bg-[#2563eb] text-white shadow-sm"
                                            : "bg-slate-100 text-slate-600 hover:bg-slate-200/80"
                                    )}
                                >
                                    {t.label} ({t.count})
                                </button>
                            ))}
                        </div>
                    </div>

                    {remoteError && items.length > 0 && (
                        <div className="mx-4 sm:mx-5 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                            Aviso remoto: {remoteError}
                        </div>
                    )}

                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow className="border-slate-100 hover:bg-transparent bg-[#eef4fb]">
                                    <TableHead className="w-10 text-[#3b5b7c] font-semibold">
                                        #
                                    </TableHead>
                                    <TableHead className="text-[#3b5b7c] font-semibold">
                                        Template
                                    </TableHead>
                                    <TableHead className="text-[#3b5b7c] font-semibold">
                                        Categoria
                                    </TableHead>
                                    <TableHead className="text-[#3b5b7c] font-semibold">
                                        Idioma
                                    </TableHead>
                                    <TableHead className="text-[#3b5b7c] font-semibold">
                                        Status Meta
                                    </TableHead>
                                    <TableHead className="text-[#3b5b7c] font-semibold">
                                        Associação
                                    </TableHead>
                                    <TableHead className="text-[#3b5b7c] font-semibold min-w-[160px]">
                                        Datas
                                    </TableHead>
                                    <TableHead className="text-[#3b5b7c] font-semibold text-right">
                                        Ações
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {showInitialSkeleton ? (
                                    <TableRow>
                                        <TableCell
                                            colSpan={8}
                                            className="py-10 text-center text-sm text-slate-500"
                                        >
                                            <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                                            Carregando biblioteca…
                                        </TableCell>
                                    </TableRow>
                                ) : pageRows.length === 0 ? (
                                    <TableRow>
                                        <TableCell
                                            colSpan={8}
                                            className="py-10 text-center text-sm text-slate-500"
                                        >
                                            Nenhum template encontrado com os
                                            filtros atuais.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    pageRows.map((item, idx) => {
                                        const n =
                                            (listMeta.page - 1) *
                                                listMeta.limit +
                                            idx +
                                            1;
                                        const dates = libraryDateLines(item);
                                        const rejection = getRejectionDisplay(
                                            item.remoteStatus,
                                            item.remoteRejectedReason
                                        );
                                        return (
                                            <TableRow
                                                key={item.id}
                                                className="border-slate-100 hover:bg-slate-50/80"
                                            >
                                                <TableCell className="text-slate-400 text-sm tabular-nums">
                                                    {n}
                                                </TableCell>
                                                <TableCell className="min-w-[200px]">
                                                    <button
                                                        type="button"
                                                        className="text-left group"
                                                        onClick={() =>
                                                            openPreview(item)
                                                        }
                                                    >
                                                        <p className="font-semibold text-sm text-[#0f2744] font-mono group-hover:text-[#2563eb] transition-colors">
                                                            {item.technicalName}
                                                        </p>
                                                        <p className="text-[11px] text-slate-400 mt-0.5">
                                                            {item.remoteTemplateId
                                                                ? `ID ${item.remoteTemplateId}`
                                                                : item.kind ===
                                                                    "builtin"
                                                                  ? "Modelo local · predefinido"
                                                                  : "Modelo local · personalizado"}
                                                        </p>
                                                    </button>
                                                    {rejection.show &&
                                                        rejection.message && (
                                                            <p className="text-[11px] text-red-600 mt-1 max-w-[240px]">
                                                                Motivo:{" "}
                                                                {
                                                                    rejection.message
                                                                }
                                                            </p>
                                                        )}
                                                </TableCell>
                                                <TableCell className="text-sm text-slate-600">
                                                    {item.category}
                                                </TableCell>
                                                <TableCell className="text-sm font-mono text-slate-600">
                                                    {item.language || "pt_BR"}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge
                                                        className={cn(
                                                            "rounded-full font-medium",
                                                            statusBadgeClass(
                                                                item.remoteStatus
                                                            )
                                                        )}
                                                    >
                                                        {statusLabelPt(
                                                            item.remoteStatus
                                                        )}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell>
                                                    {associationBadge(item)}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="space-y-0.5 text-[11px] text-slate-500 leading-snug">
                                                        {dates.length === 0 ? (
                                                            <span>—</span>
                                                        ) : (
                                                            dates.map((d) => (
                                                                <p key={d.label}>
                                                                    <span className="text-slate-400">
                                                                        {
                                                                            d.label
                                                                        }
                                                                        :{" "}
                                                                    </span>
                                                                    {d.value}
                                                                </p>
                                                            ))
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {rowActions(item)}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-5 py-3 border-t border-slate-100">
                        <p className="text-xs text-slate-500">
                            {rangeLabel({
                                ...listMeta,
                                total: filtered.length,
                            }).replace(/campanhas/g, "templates")}
                            {refreshing ? (
                                <span className="ml-2 inline-flex items-center gap-1 text-[#2563eb]">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Atualizando…
                                </span>
                            ) : null}
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg"
                                disabled={listMeta.page <= 1}
                                onClick={() =>
                                    setPage((p) => Math.max(1, p - 1))
                                }
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            {pageNums.map((n) => (
                                <Button
                                    key={n}
                                    variant={
                                        n === listMeta.page
                                            ? "default"
                                            : "outline"
                                    }
                                    size="sm"
                                    className={cn(
                                        "h-8 w-8 rounded-lg p-0",
                                        n === listMeta.page && premiumBtn
                                    )}
                                    onClick={() => setPage(n)}
                                >
                                    {n}
                                </Button>
                            ))}
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-lg"
                                disabled={
                                    listMeta.page >= listMeta.totalPages
                                }
                                onClick={() =>
                                    setPage((p) =>
                                        Math.min(listMeta.totalPages, p + 1)
                                    )
                                }
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Select
                                value={String(pageSize)}
                                onValueChange={(v) => {
                                    setPageSize(Number(v));
                                    setPage(1);
                                }}
                            >
                                <SelectTrigger className="w-[120px] h-8 rounded-lg text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="10">
                                        10 por página
                                    </SelectItem>
                                    <SelectItem value="20">
                                        20 por página
                                    </SelectItem>
                                    <SelectItem value="50">
                                        50 por página
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                {showOrphans && canManage && (
                    <div className={`${premiumCard} p-4 sm:p-5 space-y-4`}>
                        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                            <div className="flex items-start gap-3">
                                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                                    <Link2 className="h-4 w-4" />
                                </div>
                                <div>
                                    <h2 className="text-base font-semibold text-[#0f2744]">
                                        Templates aprovados não associados (
                                        {unassociated.length})
                                    </h2>
                                    <p className="text-sm text-slate-500 mt-0.5 max-w-xl">
                                        Templates oficiais aprovados que ainda
                                        não estão vinculados a um card de
                                        boletim/versão.
                                    </p>
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className={premiumBtnOutline}
                                asChild
                            >
                                <Link href="/dashboard/boletim">
                                    Ir para associações
                                </Link>
                            </Button>
                        </div>
                        {unassociated.length === 0 ? (
                            <p className="text-sm text-slate-500">
                                Nenhum template órfão — todos os APPROVED já
                                estão ligados a algum card, ou ainda não há
                                registros.
                            </p>
                        ) : (
                            <div className="grid gap-3 md:grid-cols-2">
                                {unassociated.map((o) => {
                                    const comps = countComponents(o);
                                    return (
                                        <div
                                            key={o.id}
                                            className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0">
                                                    <p className="font-semibold font-mono text-sm text-[#0f2744] truncate">
                                                        {o.technicalName}
                                                    </p>
                                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                                        {o.remoteTemplateId
                                                            ? `ID ${o.remoteTemplateId}`
                                                            : o.id}{" "}
                                                        · {o.category} ·{" "}
                                                        {o.language || "pt_BR"}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Badge className="rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-0 ring-1 ring-emerald-100">
                                                        Aprovado
                                                    </Badge>
                                                    {rowActions(o)}
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                                                <span>
                                                    Aprovado: Data de aprovação
                                                    indisponível
                                                </span>
                                                <span>
                                                    {comps} componente
                                                    {comps === 1 ? "" : "s"} ·{" "}
                                                    {o.bodyCharCount}/
                                                    {META_BODY_MAX} caracteres ·{" "}
                                                    {o.variableCount} var
                                                    {o.variableCount === 1
                                                        ? ""
                                                        : "s"}
                                                </span>
                                            </div>
                                            <Button
                                                size="sm"
                                                className={premiumBtn}
                                                onClick={() =>
                                                    void openAssociate(o)
                                                }
                                            >
                                                <Link2 className="h-3.5 w-3.5 mr-1.5" />
                                                Associar template
                                            </Button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {metaNote && !showPageChrome ? (
                    <p className="text-xs text-slate-500">{metaNote}</p>
                ) : null}
            </div>

            {/* Detail modal */}
            <Dialog
                open={!!previewItem}
                onOpenChange={(o) => !o && setPreviewId(null)}
            >
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="font-mono text-base">
                            {previewItem?.technicalName || "Detalhes"}
                        </DialogTitle>
                        <DialogDescription>
                            {previewItem?.displayName}
                        </DialogDescription>
                    </DialogHeader>
                    {previewItem && (
                        <div className="space-y-4">
                            {statusBucket(previewItem.remoteStatus) ===
                                "approved" && (
                                <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 px-3 py-1 text-xs font-medium">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Aprovado pela Meta
                                </div>
                            )}
                            {(() => {
                                const rejection = getRejectionDisplay(
                                    previewItem.remoteStatus,
                                    previewItem.remoteRejectedReason
                                );
                                if (!rejection.show || !rejection.message)
                                    return null;
                                return (
                                    <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800 flex gap-2">
                                        <Ban className="h-4 w-4 shrink-0 mt-0.5" />
                                        <div>
                                            <p className="font-medium text-xs uppercase tracking-wide">
                                                Motivo da rejeição
                                            </p>
                                            <p className="mt-0.5">
                                                {rejection.message}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })()}

                            <div className="flex flex-wrap gap-1.5 border-b border-slate-100 pb-2">
                                {(
                                    [
                                        ["overview", "Visão geral"],
                                        ["content", "Conteúdo"],
                                        ["vars", "Variáveis"],
                                        ["history", "Histórico"],
                                    ] as const
                                ).map(([id, label]) => (
                                    <button
                                        key={id}
                                        type="button"
                                        onClick={() => setDetailTab(id)}
                                        className={cn(
                                            "rounded-lg px-3 py-1.5 text-xs font-medium",
                                            detailTab === id
                                                ? "bg-[#2563eb] text-white"
                                                : "bg-slate-100 text-slate-600"
                                        )}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            {detailTab === "overview" && (
                                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <dt className="text-[11px] text-slate-400">
                                            Nome técnico
                                        </dt>
                                        <dd className="font-mono font-medium">
                                            {previewItem.technicalName}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-[11px] text-slate-400">
                                            ID oficial
                                        </dt>
                                        <dd className="font-mono">
                                            {previewItem.remoteTemplateId ||
                                                "—"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-[11px] text-slate-400">
                                            WABA
                                        </dt>
                                        <dd className="font-mono">
                                            {previewItem.wabaId || "—"}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-[11px] text-slate-400">
                                            Categoria
                                        </dt>
                                        <dd>{previewItem.category}</dd>
                                    </div>
                                    <div>
                                        <dt className="text-[11px] text-slate-400">
                                            Idioma
                                        </dt>
                                        <dd className="font-mono">
                                            {previewItem.language}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-[11px] text-slate-400">
                                            Status
                                        </dt>
                                        <dd>
                                            <Badge
                                                className={cn(
                                                    "rounded-full",
                                                    statusBadgeClass(
                                                        previewItem.remoteStatus
                                                    )
                                                )}
                                            >
                                                {statusLabelPt(
                                                    previewItem.remoteStatus
                                                )}
                                            </Badge>
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-[11px] text-slate-400">
                                            Associação
                                        </dt>
                                        <dd className="mt-1">
                                            {associationBadge(previewItem)}
                                        </dd>
                                    </div>
                                    <div className="sm:col-span-2">
                                        <dt className="text-[11px] text-slate-400 mb-1">
                                            Datas
                                        </dt>
                                        <dd className="space-y-0.5 text-xs text-slate-600">
                                            {libraryDateLines(previewItem).map(
                                                (d) => (
                                                    <p key={d.label}>
                                                        {d.label}: {d.value}
                                                    </p>
                                                )
                                            )}
                                            {previewItem.lastSyncedAt && (
                                                <p>
                                                    Última sincronização:{" "}
                                                    {formatSaoPaulo(
                                                        previewItem.lastSyncedAt
                                                    )}
                                                </p>
                                            )}
                                        </dd>
                                    </div>
                                </dl>
                            )}

                            {detailTab === "content" && (
                                <div className="space-y-3 text-sm">
                                    {previewItem.headerText ? (
                                        <div>
                                            <p className="text-[11px] text-slate-400 mb-1">
                                                Header
                                            </p>
                                            <pre className="whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-[13px]">
                                                {previewItem.headerText}
                                            </pre>
                                        </div>
                                    ) : null}
                                    <div>
                                        <p className="text-[11px] text-slate-400 mb-1">
                                            Body
                                        </p>
                                        <pre className="whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-[13px] font-mono">
                                            {previewItem.bodyText}
                                        </pre>
                                    </div>
                                    {previewItem.footerText ? (
                                        <div>
                                            <p className="text-[11px] text-slate-400 mb-1">
                                                Footer
                                            </p>
                                            <pre className="whitespace-pre-wrap rounded-xl border bg-slate-50 p-3 text-[13px]">
                                                {previewItem.footerText}
                                            </pre>
                                        </div>
                                    ) : null}
                                    {previewItem.buttons?.enabled &&
                                    previewItem.buttons.buttons?.length ? (
                                        <div>
                                            <p className="text-[11px] text-slate-400 mb-1">
                                                Botões oficiais
                                            </p>
                                            <div className="flex flex-wrap gap-2">
                                                {previewItem.buttons.buttons.map(
                                                    (b, i) => (
                                                        <span
                                                            key={i}
                                                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium"
                                                        >
                                                            {b.text}
                                                        </span>
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    ) : null}
                                    <div>
                                        <p className="text-[11px] text-slate-400 mb-1">
                                            Prévia
                                        </p>
                                        <pre className="whitespace-pre-wrap rounded-xl border bg-white p-3 text-[13px] leading-relaxed">
                                            {previewItem.previewFilled}
                                        </pre>
                                    </div>
                                </div>
                            )}

                            {detailTab === "vars" && (
                                <div className="space-y-2 text-sm">
                                    <p>
                                        {previewItem.variableCount} parâmetro
                                        {previewItem.variableCount === 1
                                            ? ""
                                            : "s"}
                                    </p>
                                    <ul className="space-y-1.5">
                                        {previewItem.fieldMappings.map(
                                            (k, i) => (
                                                <li
                                                    key={i}
                                                    className="flex items-center gap-2 text-xs rounded-lg border px-2.5 py-2"
                                                >
                                                    <span className="font-mono text-slate-500">
                                                        {`{{${i + 1}}}`}
                                                    </span>
                                                    <span className="font-medium">
                                                        {k}
                                                    </span>
                                                    <span className="text-slate-400 ml-auto">
                                                        ex:{" "}
                                                        {previewItem.exampleRow[
                                                            i
                                                        ] || "—"}
                                                    </span>
                                                </li>
                                            )
                                        )}
                                    </ul>
                                </div>
                            )}

                            {detailTab === "history" && (
                                <ul className="space-y-2 text-sm text-slate-600">
                                    {previewItem.createdAt && (
                                        <li>
                                            Criação:{" "}
                                            {formatSaoPaulo(
                                                previewItem.createdAt
                                            )}
                                        </li>
                                    )}
                                    {previewItem.lastSubmittedAt && (
                                        <li>
                                            Envio para aprovação:{" "}
                                            {formatSaoPaulo(
                                                previewItem.lastSubmittedAt
                                            )}
                                        </li>
                                    )}
                                    <li>
                                        Status atual:{" "}
                                        {statusLabelPt(
                                            previewItem.remoteStatus
                                        )}
                                    </li>
                                    {statusBucket(previewItem.remoteStatus) ===
                                        "approved" && (
                                        <li>
                                            Aprovação: data oficial
                                            indisponível (Meta/Datafy não
                                            forneceu timestamp de aprovação)
                                        </li>
                                    )}
                                    {previewItem.lastSyncedAt && (
                                        <li>
                                            Última sincronização:{" "}
                                            {formatSaoPaulo(
                                                previewItem.lastSyncedAt
                                            )}
                                        </li>
                                    )}
                                    {!previewItem.createdAt &&
                                        !previewItem.lastSubmittedAt &&
                                        !previewItem.lastSyncedAt && (
                                            <li className="text-slate-400">
                                                Nenhum evento histórico
                                                registrado para este modelo.
                                            </li>
                                        )}
                                </ul>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Associate modal */}
            <Dialog
                open={!!associateTarget}
                onOpenChange={(o) => {
                    if (!o && !associating && !creatingCompat) {
                        setAssociateTarget(null);
                        setAssociateCardId("");
                    }
                }}
            >
                <DialogContent className="max-w-xl rounded-2xl border-slate-200/80 p-0 gap-0 overflow-hidden">
                    <div className="px-5 pt-5 pb-3 border-b border-slate-100">
                        <DialogHeader className="space-y-1.5">
                            <DialogTitle className="text-[#0f2744] flex items-center gap-2">
                                <Link2 className="h-5 w-5 text-[#2563eb]" />
                                Associar template
                            </DialogTitle>
                            <DialogDescription>
                                Vincule o template oficial a um card de
                                boletim/versão com a mesma quantidade de cargas.
                                Não reenvia à Meta.
                            </DialogDescription>
                        </DialogHeader>
                        {associateTarget && (
                            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-sm space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono font-semibold text-[#0f2744]">
                                        {associateTarget.technicalName}
                                    </span>
                                    <Badge className="rounded-full bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-0 ring-1 ring-emerald-100">
                                        Aprovado
                                    </Badge>
                                </div>
                                <p className="text-[11px] text-slate-500">
                                    {associateTarget.category} ·{" "}
                                    {associateTarget.language || "pt_BR"} ·{" "}
                                    {associateTarget.loadsPerMessage} carga
                                    {associateTarget.loadsPerMessage === 1
                                        ? ""
                                        : "s"}
                                    /msg · {associateTarget.variableCount}{" "}
                                    variável
                                    {associateTarget.variableCount === 1
                                        ? ""
                                        : "eis"}
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="px-5 py-4 space-y-3">
                        {loadingVersions ? (
                            <p className="text-sm text-slate-500 inline-flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Carregando cards compatíveis…
                            </p>
                        ) : null}

                        {associateLoadError ? (
                            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                                {associateLoadError}
                            </div>
                        ) : null}

                        {!loadingVersions &&
                        !associateLoadError &&
                        associateEmptyReason ? (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950 space-y-3">
                                <p>{associateEmptyReason}</p>
                                <Button
                                    type="button"
                                    size="sm"
                                    className={premiumBtn}
                                    disabled={creatingCompat}
                                    onClick={() => void createCompatibleCard()}
                                >
                                    {creatingCompat ? (
                                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                                    )}
                                    Criar card compatível
                                </Button>
                                <p className="text-[11px] text-amber-800/80">
                                    Cria uma versão de boletim com um card já
                                    vinculado a este template APPROVED. Sem
                                    reenvio à Meta.
                                </p>
                            </div>
                        ) : null}

                        {!loadingVersions &&
                        !associateLoadError &&
                        compatibleCardOptions.length > 0 ? (
                            <div className="space-y-2">
                                <Label className="text-[#0f2744]">
                                    Card do boletim/versão
                                </Label>
                                <Select
                                    value={
                                        associateCardId || undefined
                                    }
                                    onValueChange={setAssociateCardId}
                                >
                                    <SelectTrigger className="bg-white h-11 rounded-xl border-slate-200">
                                        <SelectValue placeholder="Selecione o card compatível" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {compatibleCardOptions.map((c) => (
                                            <SelectItem
                                                key={c.value}
                                                value={c.value}
                                            >
                                                {c.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-[11px] text-slate-400">
                                    {compatibleCardOptions.length} card
                                    {compatibleCardOptions.length === 1
                                        ? ""
                                        : "s"}{" "}
                                    compatível
                                    {compatibleCardOptions.length === 1
                                        ? ""
                                        : "is"}{" "}
                                    · mesma quantidade de cargas e idioma
                                </p>
                            </div>
                        ) : null}
                    </div>

                    <div className="px-5 py-3.5 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 bg-white">
                        <Button
                            variant="outline"
                            className={premiumBtnOutline}
                            disabled={associating || creatingCompat}
                            onClick={() => {
                                setAssociateTarget(null);
                                setAssociateCardId("");
                            }}
                        >
                            Cancelar
                        </Button>
                        <Button
                            className={premiumBtn}
                            disabled={
                                associating ||
                                creatingCompat ||
                                !associateCardId ||
                                loadingVersions
                            }
                            onClick={() => void confirmAssociate()}
                        >
                            {associating && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Confirmar associação
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            <BulletinTemplateEditorDialog
                open={editorOpen}
                mode={editorMode}
                draft={draft}
                setDraft={setDraft}
                fieldOpts={fieldOpts}
                saving={saving}
                technicalNameLocked={
                    editorMode === "edit" &&
                    items.find((i) => i.id === editingId)?.remoteStatus ===
                        "APPROVED"
                }
                onBodyChange={onBodyChange}
                onSave={() => void saveDraft()}
                onClose={() => setEditorOpen(false)}
            />

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
