"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
    CheckCircle2,
    Clock3,
    Ban,
    PauseCircle,
    Layers,
    MoreHorizontal,
    RefreshCw,
    Search,
    Plus,
    Library,
    Eye,
    AlertTriangle,
    Megaphone,
    Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

type ApprovalItem = {
    id: string;
    technicalName: string;
    displayName: string;
    category: string;
    language: string;
    wabaId: string | null;
    origin: string;
    originLabel: string;
    status: string | null;
    remoteTemplateId: string | null;
    rejectedReason: string | null;
    headerText: string | null;
    bodyText: string;
    footerText: string | null;
    variableCount: number;
    exampleRow: string[];
    fieldMappings: string[];
    inLibrary: boolean;
    lastSyncedAt: string | null;
    updatedAt: string;
    createdAt: string;
    syncError: string | null;
    canUseInCampaign: boolean;
    canImportToLibrary: boolean;
};

type Counters = {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    pausedOrDisabled: number;
};

type FieldOpt = { key: string; label: string };

function statusStyle(status: string | null) {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED")
        return "bg-emerald-500/15 text-emerald-700 border-emerald-500/30";
    if (s === "PENDING")
        return "bg-amber-500/15 text-amber-800 border-amber-500/30";
    if (s === "REJECTED")
        return "bg-red-500/15 text-red-700 border-red-500/30";
    if (s === "PAUSED")
        return "bg-orange-500/15 text-orange-800 border-orange-500/30";
    if (s === "DISABLED")
        return "bg-zinc-500/15 text-zinc-700 border-zinc-500/30";
    return "bg-muted text-muted-foreground border-border";
}

function statusLabel(status: string | null) {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED") return "Aprovado";
    if (s === "PENDING") return "Em análise";
    if (s === "REJECTED") return "Rejeitado";
    if (s === "PAUSED") return "Pausado";
    if (s === "DISABLED") return "Desabilitado";
    return status || "—";
}

function formatWhen(iso: string | null) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("pt-BR");
    } catch {
        return iso;
    }
}

export function MetaApprovalsPanel() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const focusId = searchParams.get("focus");

    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [items, setItems] = useState<ApprovalItem[]>([]);
    const [counters, setCounters] = useState<Counters>({
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        pausedOrDisabled: 0,
    });
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);
    const [q, setQ] = useState("");
    const [status, setStatus] = useState<string>("all");
    const [category, setCategory] = useState<string>("all");
    const [language, setLanguage] = useState<string>("all");
    const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
    const [wabaId, setWabaId] = useState<string | null>(null);
    const [detail, setDetail] = useState<ApprovalItem | null>(null);
    const [importTarget, setImportTarget] = useState<ApprovalItem | null>(null);
    const [fieldOpts, setFieldOpts] = useState<FieldOpt[]>([]);
    const [mappings, setMappings] = useState<string[]>([]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            params.set("page", String(page));
            params.set("pageSize", String(pageSize));
            if (q.trim()) params.set("q", q.trim());
            if (status !== "all") params.set("status", status);
            if (category !== "all") params.set("category", category);
            if (language !== "all") params.set("language", language);
            const res = await fetch(
                `/api/channels/datafy/approvals?${params.toString()}`
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.message || "Falha ao carregar");
            setItems(json.data?.items || []);
            setTotal(json.data?.total || 0);
            setCounters(
                json.data?.counters || {
                    total: 0,
                    pending: 0,
                    approved: 0,
                    rejected: 0,
                    pausedOrDisabled: 0,
                }
            );
            setLastSyncAt(json.data?.lastSyncAt || null);
            setWabaId(json.data?.wabaId || null);
            setFieldOpts(json.data?.fieldMapOptions || []);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao carregar");
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, q, status, category, language]);

    useEffect(() => {
        void load();
    }, [load]);

    useEffect(() => {
        if (!focusId || !items.length) return;
        const hit = items.find((i) => i.id === focusId);
        if (hit) setDetail(hit);
    }, [focusId, items]);

    const runSync = async (action: "sync" | "refresh") => {
        setSyncing(true);
        try {
            const res = await fetch("/api/channels/datafy/approvals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.message || "Falha na sincronização");
            toast.success(json.data?.message || "Sincronizado");
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro na sincronização");
        } finally {
            setSyncing(false);
        }
    };

    const openImport = (item: ApprovalItem) => {
        const n = Math.max(item.variableCount, 1);
        setMappings(
            Array.from({ length: n }, (_, i) => item.fieldMappings[i] || "")
        );
        setImportTarget(item);
    };

    const confirmImport = async () => {
        if (!importTarget) return;
        try {
            const res = await fetch("/api/channels/datafy/approvals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "import_to_library",
                    id: importTarget.id,
                    fieldMappings: mappings,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.message || "Falha ao importar");
            toast.success(json.data?.message || "Importado");
            setImportTarget(null);
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao importar");
        }
    };

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    const cards = useMemo(
        () => [
            {
                label: "Total",
                value: counters.total,
                icon: Layers,
                tone: "text-foreground",
            },
            {
                label: "Em análise",
                value: counters.pending,
                icon: Clock3,
                tone: "text-amber-700",
            },
            {
                label: "Aprovados",
                value: counters.approved,
                icon: CheckCircle2,
                tone: "text-emerald-700",
            },
            {
                label: "Rejeitados",
                value: counters.rejected,
                icon: Ban,
                tone: "text-red-700",
            },
            {
                label: "Pausados / desabilitados",
                value: counters.pausedOrDisabled,
                icon: PauseCircle,
                tone: "text-orange-700",
            },
        ],
        [counters]
    );

    return (
        <div className="mx-auto w-full max-w-[1400px] space-y-6 overflow-x-hidden">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                    <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                        Aprovações Meta
                    </h1>
                    <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
                        Gerencie e acompanhe os modelos de mensagens enviados
                        para análise da Meta, sincronizados pela Datafy.
                    </p>
                    {wabaId && (
                        <p className="mt-1 text-xs text-muted-foreground/80 font-mono truncate">
                            WABA {wabaId}
                            {lastSyncAt
                                ? ` · última sync ${formatWhen(lastSyncAt)}`
                                : ""}
                        </p>
                    )}
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={syncing}
                        onClick={() => void runSync("refresh")}
                    >
                        <RefreshCw
                            className={`h-4 w-4 mr-1.5 ${syncing ? "animate-spin" : ""}`}
                        />
                        Atualizar status
                    </Button>
                    <Button
                        size="sm"
                        disabled={syncing}
                        onClick={() => void runSync("sync")}
                    >
                        <RefreshCw
                            className={`h-4 w-4 mr-1.5 ${syncing ? "animate-spin" : ""}`}
                        />
                        Sincronizar com a Meta
                    </Button>
                    <Button size="sm" variant="secondary" asChild>
                        <Link href="/dashboard/boletim">
                            <Plus className="h-4 w-4 mr-1.5" />
                            Novo template
                        </Link>
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {cards.map((c) => {
                    const Icon = c.icon;
                    return (
                        <div
                            key={c.label}
                            className="rounded-xl border border-border/60 bg-card/40 px-3 py-3 sm:px-4"
                        >
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Icon className={`h-3.5 w-3.5 ${c.tone}`} />
                                {c.label}
                            </div>
                            <div className={`mt-1 text-2xl font-semibold tabular-nums ${c.tone}`}>
                                {loading ? "—" : c.value}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative w-full lg:max-w-sm">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        className="pl-9"
                        placeholder="Pesquisar por nome técnico…"
                        value={q}
                        onChange={(e) => {
                            setPage(1);
                            setQ(e.target.value);
                        }}
                    />
                </div>
                <div className="flex flex-wrap gap-2">
                    <Select
                        value={status}
                        onValueChange={(v) => {
                            setPage(1);
                            setStatus(v);
                        }}
                    >
                        <SelectTrigger className="w-[160px]">
                            <SelectValue placeholder="Status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todos status</SelectItem>
                            <SelectItem value="PENDING">Em análise</SelectItem>
                            <SelectItem value="APPROVED">Aprovados</SelectItem>
                            <SelectItem value="REJECTED">Rejeitados</SelectItem>
                            <SelectItem value="PAUSED_OR_DISABLED">
                                Pausados / desabilitados
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
                        <SelectTrigger className="w-[150px]">
                            <SelectValue placeholder="Categoria" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Categorias</SelectItem>
                            <SelectItem value="MARKETING">MARKETING</SelectItem>
                            <SelectItem value="UTILITY">UTILITY</SelectItem>
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
                        <SelectTrigger className="w-[130px]">
                            <SelectValue placeholder="Idioma" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Idiomas</SelectItem>
                            <SelectItem value="pt_BR">pt_BR</SelectItem>
                            <SelectItem value="en">en</SelectItem>
                            <SelectItem value="en_US">en_US</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="rounded-xl border border-border/60 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border/50 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                        {loading
                            ? "Carregando…"
                            : `${total} resultado${total === 1 ? "" : "s"}`}
                    </span>
                    <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
                        <Link href="/dashboard/boletim/biblioteca">
                            <Library className="h-3.5 w-3.5 mr-1" />
                            Biblioteca
                        </Link>
                    </Button>
                </div>

                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nome</TableHead>
                                <TableHead>Categoria</TableHead>
                                <TableHead>Idioma</TableHead>
                                <TableHead>Origem</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Última atualização</TableHead>
                                <TableHead className="w-12 text-right">
                                    Ações
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading &&
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {Array.from({ length: 7 }).map((__, j) => (
                                            <TableCell key={j}>
                                                <Skeleton className="h-4 w-full" />
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                            {!loading && items.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        className="py-16 text-center"
                                    >
                                        <div className="mx-auto max-w-md space-y-2">
                                            <AlertTriangle className="mx-auto h-8 w-8 text-muted-foreground/50" />
                                            <p className="font-medium">
                                                Nenhum template sincronizado
                                            </p>
                                            <p className="text-sm text-muted-foreground">
                                                Clique em{" "}
                                                <strong>Sincronizar com a Meta</strong>{" "}
                                                para importar modelos da WABA,
                                                incluindo os criados no Gerenciador
                                                do WhatsApp.
                                            </p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                            {!loading &&
                                items.map((item) => (
                                    <TableRow key={item.id}>
                                        <TableCell className="font-medium max-w-[220px]">
                                            <div className="truncate font-mono text-xs sm:text-sm">
                                                {item.technicalName}
                                            </div>
                                            {item.syncError && (
                                                <div className="text-[11px] text-red-600 truncate">
                                                    Erro de sync
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {item.category}
                                        </TableCell>
                                        <TableCell className="text-xs font-mono">
                                            {item.language}
                                        </TableCell>
                                        <TableCell className="text-xs">
                                            {item.originLabel}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant="outline"
                                                className={statusStyle(
                                                    item.status
                                                )}
                                            >
                                                {statusLabel(item.status)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                            {formatWhen(
                                                item.lastSyncedAt ||
                                                    item.updatedAt
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8"
                                                    >
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            setDetail(item)
                                                        }
                                                    >
                                                        <Eye className="h-4 w-4 mr-2" />
                                                        Visualizar detalhes
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            void runSync(
                                                                "refresh"
                                                            )
                                                        }
                                                    >
                                                        <RefreshCw className="h-4 w-4 mr-2" />
                                                        Atualizar status
                                                    </DropdownMenuItem>
                                                    {item.canImportToLibrary && (
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                openImport(item)
                                                            }
                                                        >
                                                            <Download className="h-4 w-4 mr-2" />
                                                            Importar para
                                                            biblioteca
                                                        </DropdownMenuItem>
                                                    )}
                                                    {item.canUseInCampaign && (
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                router.push(
                                                                    "/dashboard/broadcast"
                                                                )
                                                            }
                                                        >
                                                            <Megaphone className="h-4 w-4 mr-2" />
                                                            Utilizar em campanha
                                                        </DropdownMenuItem>
                                                    )}
                                                    {String(
                                                        item.status || ""
                                                    ).toUpperCase() ===
                                                        "REJECTED" && (
                                                        <>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                                onClick={() =>
                                                                    setDetail(
                                                                        item
                                                                    )
                                                                }
                                                            >
                                                                <Ban className="h-4 w-4 mr-2" />
                                                                Ver motivo da
                                                                rejeição
                                                            </DropdownMenuItem>
                                                        </>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                        </TableBody>
                    </Table>
                </div>

                <div className="flex items-center justify-between px-4 py-3 border-t border-border/50">
                    <span className="text-xs text-muted-foreground">
                        Página {page} de {totalPages}
                    </span>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                            Anterior
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page >= totalPages}
                            onClick={() =>
                                setPage((p) => Math.min(totalPages, p + 1))
                            }
                        >
                            Próxima
                        </Button>
                    </div>
                </div>
            </div>

            <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="font-mono text-base">
                            {detail?.technicalName}
                        </DialogTitle>
                        <DialogDescription>
                            Detalhes oficiais sincronizados via Datafy
                        </DialogDescription>
                    </DialogHeader>
                    {detail && (
                        <div className="space-y-4 text-sm">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <div className="text-xs text-muted-foreground">
                                        ID oficial
                                    </div>
                                    <div className="font-mono text-xs break-all">
                                        {detail.remoteTemplateId || "—"}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-muted-foreground">
                                        WABA
                                    </div>
                                    <div className="font-mono text-xs break-all">
                                        {detail.wabaId || "—"}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-muted-foreground">
                                        Categoria / Idioma
                                    </div>
                                    <div>
                                        {detail.category} · {detail.language}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-muted-foreground">
                                        Status
                                    </div>
                                    <Badge
                                        variant="outline"
                                        className={statusStyle(detail.status)}
                                    >
                                        {statusLabel(detail.status)}
                                    </Badge>
                                </div>
                            </div>
                            {detail.rejectedReason && (
                                <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                                    <div className="text-xs font-medium text-red-700 mb-1">
                                        Motivo da rejeição
                                    </div>
                                    <p className="text-sm whitespace-pre-wrap">
                                        {detail.rejectedReason}
                                    </p>
                                </div>
                            )}
                            {detail.headerText && (
                                <div>
                                    <div className="text-xs text-muted-foreground mb-1">
                                        HEADER
                                    </div>
                                    <pre className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs">
                                        {detail.headerText}
                                    </pre>
                                </div>
                            )}
                            <div>
                                <div className="text-xs text-muted-foreground mb-1">
                                    BODY ({detail.variableCount} variáveis)
                                </div>
                                <pre className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs">
                                    {detail.bodyText}
                                </pre>
                            </div>
                            {detail.footerText && (
                                <div>
                                    <div className="text-xs text-muted-foreground mb-1">
                                        FOOTER
                                    </div>
                                    <pre className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-xs">
                                        {detail.footerText}
                                    </pre>
                                </div>
                            )}
                            {detail.exampleRow?.length > 0 && (
                                <div>
                                    <div className="text-xs text-muted-foreground mb-1">
                                        Exemplos
                                    </div>
                                    <ol className="list-decimal pl-5 text-xs space-y-0.5">
                                        {detail.exampleRow.map((ex, i) => (
                                            <li key={i}>{ex}</li>
                                        ))}
                                    </ol>
                                </div>
                            )}
                            <div className="text-xs text-muted-foreground">
                                Criado {formatWhen(detail.createdAt)} · Atualizado{" "}
                                {formatWhen(detail.updatedAt)} · Sync{" "}
                                {formatWhen(detail.lastSyncedAt)}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog
                open={!!importTarget}
                onOpenChange={(o) => !o && setImportTarget(null)}
            >
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Importar para biblioteca</DialogTitle>
                        <DialogDescription>
                            Mapeie as variáveis do template para os campos de
                            carga do boletim.
                        </DialogDescription>
                    </DialogHeader>
                    {importTarget && (
                        <div className="space-y-3">
                            <p className="text-xs font-mono text-muted-foreground">
                                {importTarget.technicalName} ·{" "}
                                {importTarget.variableCount} variáveis
                            </p>
                            {mappings.map((m, i) => (
                                <div key={i} className="space-y-1">
                                    <label className="text-xs text-muted-foreground">
                                        {"{{" + (i + 1) + "}}"}
                                    </label>
                                    <Select
                                        value={m || undefined}
                                        onValueChange={(v) => {
                                            const next = [...mappings];
                                            next[i] = v;
                                            setMappings(next);
                                        }}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Campo…" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {fieldOpts.map((f) => (
                                                <SelectItem
                                                    key={f.key}
                                                    value={f.key}
                                                >
                                                    {f.label}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ))}
                            <Button
                                className="w-full"
                                onClick={() => void confirmImport()}
                                disabled={mappings.some((x) => !x)}
                            >
                                Confirmar importação
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
