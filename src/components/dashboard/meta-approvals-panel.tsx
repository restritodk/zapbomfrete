"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    ShieldCheck,
    ChevronLeft,
    ChevronRight,
    Loader2,
} from "lucide-react";
import {
    rangeLabel,
    visiblePageNumbers,
    buildPageMeta,
} from "@/lib/mass-dispatch/pagination";
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
        return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 border-0";
    if (s === "PENDING")
        return "bg-orange-50 text-orange-700 ring-1 ring-orange-100 border-0";
    if (s === "REJECTED")
        return "bg-red-50 text-red-700 ring-1 ring-red-100 border-0";
    if (s === "PAUSED")
        return "bg-amber-50 text-amber-800 ring-1 ring-amber-100 border-0";
    if (s === "DISABLED")
        return "bg-slate-100 text-slate-600 ring-1 ring-slate-200 border-0";
    return "bg-slate-100 text-slate-600 ring-1 ring-slate-200 border-0";
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
    const [refreshing, setRefreshing] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const hasLoadedOnceRef = useRef(false);
    const loadInFlightRef = useRef(false);
    const [loadError, setLoadError] = useState<string | null>(null);
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
    const [pageSize, setPageSize] = useState(10);
    const [qInput, setQInput] = useState("");
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
    const [importing, setImporting] = useState(false);

    const friendlyClientMessage = (raw: string | undefined, fallback: string) => {
        const msg = String(raw || "").trim();
        if (!msg) return fallback;
        if (
            /prisma|postgres|42501|permission denied|ECONNREFUSED|P1001|P2021|stack|SELECT |FROM "/i.test(
                msg
            )
        ) {
            return fallback;
        }
        return msg;
    };

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

    const load = useCallback(
        async (opts?: { silent?: boolean }) => {
            const silent = Boolean(opts?.silent) && hasLoadedOnceRef.current;
            if (loadInFlightRef.current) return;
            loadInFlightRef.current = true;
            if (!silent) setLoading(true);
            else setRefreshing(true);
            if (!silent) setLoadError(null);
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
                if (!res.ok) {
                    throw new Error(
                        friendlyClientMessage(
                            json.message,
                            "Não foi possível carregar os templates. Verifique a conexão e tente novamente."
                        )
                    );
                }
                setItems(json.data?.items || []);
                const nextTotal = json.data?.total || 0;
                setTotal(nextTotal);
                const meta = buildPageMeta(nextTotal, page, pageSize);
                if (meta.page !== page) setPage(meta.page);
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
                setLoadError(null);
                hasLoadedOnceRef.current = true;
                setHasLoadedOnce(true);
            } catch (e) {
                const msg =
                    e instanceof Error
                        ? e.message
                        : "Não foi possível carregar os templates. Tente novamente.";
                setLoadError(msg);
                if (!hasLoadedOnceRef.current) {
                    setItems([]);
                    setTotal(0);
                }
                if (!silent) toast.error(msg);
            } finally {
                setLoading(false);
                setRefreshing(false);
                loadInFlightRef.current = false;
            }
        },
        [page, pageSize, q, status, category, language]
    );

    useEffect(() => {
        void load({ silent: false });
    }, [load]);

    useEffect(() => {
        if (!focusId || !items.length) return;
        const hit = items.find((i) => i.id === focusId);
        if (hit) setDetail(hit);
    }, [focusId, items]);

    const runSync = async (action: "sync" | "refresh") => {
        if (syncing) return;
        setSyncing(true);
        try {
            const res = await fetch("/api/channels/datafy/approvals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(
                    friendlyClientMessage(
                        json.message,
                        "Não foi possível sincronizar os templates. Verifique a conexão com o serviço e tente novamente."
                    )
                );
            }
            toast.success(json.data?.message || "Sincronizado");
            setLoadError(null);
            await load({ silent: true });
        } catch (e) {
            const msg =
                e instanceof Error
                    ? e.message
                    : "Não foi possível sincronizar os templates. Tente novamente.";
            setLoadError(msg);
            toast.error(msg);
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
        if (!importTarget || importing) return;
        setImporting(true);
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
            await load({ silent: true });
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao importar");
        } finally {
            setImporting(false);
        }
    };

    const listMeta = useMemo(
        () => buildPageMeta(total, page, pageSize),
        [total, page, pageSize]
    );
    const pageNums = visiblePageNumbers(listMeta.page, listMeta.totalPages, 3);
    const showInitialSkeleton = loading && !hasLoadedOnce;

    const cards = useMemo(
        () => [
            {
                label: "Total de templates",
                value: counters.total,
                icon: Layers,
                accent: "text-[#1d4ed8]",
                iconBg: "bg-blue-50 text-blue-600",
            },
            {
                label: "Em análise",
                value: counters.pending,
                icon: Clock3,
                accent: "text-orange-700",
                iconBg: "bg-orange-50 text-orange-600",
            },
            {
                label: "Aprovados",
                value: counters.approved,
                icon: CheckCircle2,
                accent: "text-emerald-700",
                iconBg: "bg-emerald-50 text-emerald-600",
            },
            {
                label: "Rejeitados",
                value: counters.rejected,
                icon: Ban,
                accent: "text-red-700",
                iconBg: "bg-red-50 text-red-600",
            },
            {
                label: "Pausados / desabilitados",
                value: counters.pausedOrDisabled,
                icon: PauseCircle,
                accent: "text-slate-600",
                iconBg: "bg-slate-100 text-slate-600",
            },
        ],
        [counters]
    );

    const premiumCard =
        "rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_4px_rgba(15,23,42,0.06)]";
    const premiumBtn =
        "rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.55)]";
    const premiumBtnOutline =
        "rounded-xl border-slate-200 bg-white text-[#0f2744] hover:bg-slate-50";

    return (
        <div className="mx-auto w-full max-w-[1400px] space-y-5 overflow-x-hidden">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#2563eb] text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)]">
                        <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0f2744]">
                            Aprovações Meta
                        </h1>
                        <p className="text-slate-500 text-sm mt-1 max-w-2xl">
                            Acompanhe templates oficiais enviados para análise
                            da Meta, sincronizados pela Datafy.
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-400">
                            {wabaId ? (
                                <span className="font-mono truncate">
                                    WABA {wabaId}
                                </span>
                            ) : (
                                <span>WABA não identificada</span>
                            )}
                            <span>
                                Última sincronização:{" "}
                                {formatWhen(lastSyncAt)}
                            </span>
                            {(syncing || refreshing) && (
                                <span className="inline-flex items-center gap-1.5 text-[#2563eb]">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Sincronizando…
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={syncing}
                        onClick={() => void runSync("refresh")}
                        className={premiumBtnOutline}
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
                        className={premiumBtn}
                    >
                        <RefreshCw
                            className={`h-4 w-4 mr-1.5 ${syncing ? "animate-spin" : ""}`}
                        />
                        Sincronizar com a Meta
                    </Button>
                    <Button size="sm" className={premiumBtn} asChild>
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
                            <p className="mt-0.5 text-[12px] font-medium text-slate-500 leading-snug">
                                {c.label}
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
                            placeholder="Pesquisar templates pelo nome..."
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
                            <SelectTrigger className="w-[170px] h-10 rounded-xl border-slate-200">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos os status</SelectItem>
                                <SelectItem value="APPROVED">Aprovados</SelectItem>
                                <SelectItem value="PENDING">Em análise</SelectItem>
                                <SelectItem value="REJECTED">Rejeitados</SelectItem>
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
                            <SelectTrigger className="w-[150px] h-10 rounded-xl border-slate-200">
                                <SelectValue placeholder="Categoria" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas categorias</SelectItem>
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
                            <SelectTrigger className="w-[130px] h-10 rounded-xl border-slate-200">
                                <SelectValue placeholder="Idioma" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos idiomas</SelectItem>
                                <SelectItem value="pt_BR">pt_BR</SelectItem>
                                <SelectItem value="en">en</SelectItem>
                                <SelectItem value="en_US">en_US</SelectItem>
                            </SelectContent>
                        </Select>
                        <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="h-10 rounded-xl text-slate-600"
                        >
                            <Link href="/dashboard/boletim/biblioteca">
                                <Library className="h-3.5 w-3.5 mr-1" />
                                Biblioteca
                            </Link>
                        </Button>
                    </div>
                </div>

                {loadError && items.length > 0 && (
                    <div className="mx-4 sm:mx-5 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {loadError}
                    </div>
                )}

                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="border-slate-100 hover:bg-transparent bg-[#eef4fb]">
                                <TableHead className="text-[#3b5b7c] font-semibold">
                                    Nome
                                </TableHead>
                                <TableHead className="text-[#3b5b7c] font-semibold">
                                    Categoria
                                </TableHead>
                                <TableHead className="text-[#3b5b7c] font-semibold">
                                    Idioma
                                </TableHead>
                                <TableHead className="text-[#3b5b7c] font-semibold hidden sm:table-cell">
                                    Origem
                                </TableHead>
                                <TableHead className="text-[#3b5b7c] font-semibold">
                                    Status
                                </TableHead>
                                <TableHead className="text-[#3b5b7c] font-semibold hidden md:table-cell">
                                    Última atualização
                                </TableHead>
                                <TableHead className="text-[#3b5b7c] font-semibold w-12 text-right">
                                    Ações
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {showInitialSkeleton &&
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {Array.from({ length: 7 }).map((__, j) => (
                                            <TableCell key={j}>
                                                <Skeleton className="h-4 w-full" />
                                            </TableCell>
                                        ))}
                                    </TableRow>
                                ))}
                            {!showInitialSkeleton && loadError && items.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        className="py-16 text-center"
                                    >
                                        <div className="mx-auto max-w-md space-y-3">
                                            <AlertTriangle className="mx-auto h-8 w-8 text-amber-600" />
                                            <p className="font-medium text-[#0f2744]">
                                                Não foi possível carregar os
                                                templates
                                            </p>
                                            <p className="text-sm text-slate-500">
                                                {loadError}
                                            </p>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                disabled={loading || syncing}
                                                className={premiumBtnOutline}
                                                onClick={() =>
                                                    void load({ silent: false })
                                                }
                                            >
                                                <RefreshCw className="h-4 w-4 mr-1.5" />
                                                Tentar novamente
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                            {!showInitialSkeleton &&
                                !loadError &&
                                items.length === 0 && (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        className="py-16 text-center"
                                    >
                                        <div className="mx-auto max-w-md space-y-2">
                                            <AlertTriangle className="mx-auto h-8 w-8 text-slate-300" />
                                            <p className="font-medium text-[#0f2744]">
                                                {q ||
                                                status !== "all" ||
                                                category !== "all" ||
                                                language !== "all"
                                                    ? "Nenhum template encontrado com os filtros atuais"
                                                    : "Nenhum template sincronizado"}
                                            </p>
                                            <p className="text-sm text-slate-500">
                                                Clique em{" "}
                                                <strong>Sincronizar com a Meta</strong>{" "}
                                                para importar modelos da WABA.
                                            </p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                            {!showInitialSkeleton &&
                                items.map((item) => (
                                    <TableRow
                                        key={item.id}
                                        className="border-slate-100 hover:bg-slate-50/80 transition-colors"
                                    >
                                        <TableCell className="font-medium max-w-[240px]">
                                            <div className="truncate font-mono text-xs sm:text-sm text-[#0f2744]">
                                                {item.technicalName}
                                            </div>
                                            {item.syncError && (
                                                <div className="text-[11px] text-red-600 truncate">
                                                    Erro de sync
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-600">
                                            {item.category}
                                        </TableCell>
                                        <TableCell className="text-xs font-mono text-slate-600">
                                            {item.language}
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-600 hidden sm:table-cell">
                                            {item.originLabel}
                                        </TableCell>
                                        <TableCell>
                                            <Badge
                                                variant="outline"
                                                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyle(
                                                    item.status
                                                )}`}
                                            >
                                                {statusLabel(item.status)}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-xs text-slate-500 whitespace-nowrap hidden md:table-cell">
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
                                                        className="h-8 w-8 text-slate-500"
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

                <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between px-4 sm:px-5 py-3.5 border-t border-slate-100 bg-slate-50/40">
                    <p className="text-xs text-slate-500 font-medium">
                        {rangeLabel({
                            ...listMeta,
                            total,
                        }).replace("campanhas", "templates")}
                        {" · "}
                        Página {listMeta.page} de {listMeta.totalPages}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 justify-between sm:justify-end">
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-lg border-slate-200"
                                disabled={listMeta.page <= 1}
                                onClick={() =>
                                    setPage((p) => Math.max(1, p - 1))
                                }
                                aria-label="Página anterior"
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
                                    size="icon"
                                    className={`h-8 w-8 rounded-lg text-xs ${
                                        n === listMeta.page
                                            ? "bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
                                            : "border-slate-200"
                                    }`}
                                    onClick={() => setPage(n)}
                                >
                                    {n}
                                </Button>
                            ))}
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-8 w-8 rounded-lg border-slate-200"
                                disabled={
                                    listMeta.page >= listMeta.totalPages
                                }
                                onClick={() =>
                                    setPage((p) =>
                                        Math.min(listMeta.totalPages, p + 1)
                                    )
                                }
                                aria-label="Próxima página"
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                        <Select
                            value={String(pageSize)}
                            onValueChange={(v) => {
                                setPage(1);
                                setPageSize(Number(v));
                            }}
                        >
                            <SelectTrigger className="w-[130px] h-8 rounded-lg border-slate-200 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="10">10 por página</SelectItem>
                                <SelectItem value="20">20 por página</SelectItem>
                                <SelectItem value="50">50 por página</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
                <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl border-slate-200">
                    <DialogHeader>
                        <DialogTitle className="font-mono text-base text-[#0f2744]">
                            {detail?.technicalName}
                        </DialogTitle>
                        <DialogDescription className="text-slate-500">
                            Detalhes oficiais sincronizados via Datafy — componentes
                            exatamente como aprovados pela Meta.
                        </DialogDescription>
                    </DialogHeader>
                    {detail && (
                        <div className="space-y-4 text-sm">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <div className="text-xs text-slate-400">
                                        ID oficial
                                    </div>
                                    <div className="font-mono text-xs break-all text-[#0f2744]">
                                        {detail.remoteTemplateId || "—"}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-400">
                                        WABA
                                    </div>
                                    <div className="font-mono text-xs break-all text-[#0f2744]">
                                        {detail.wabaId || "—"}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-400">
                                        Categoria / Idioma
                                    </div>
                                    <div className="text-[#0f2744]">
                                        {detail.category} · {detail.language}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-slate-400">
                                        Status
                                    </div>
                                    <Badge
                                        variant="outline"
                                        className={`rounded-full ${statusStyle(detail.status)}`}
                                    >
                                        {statusLabel(detail.status)}
                                    </Badge>
                                </div>
                            </div>
                            {detail.rejectedReason && (
                                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                                    <div className="text-xs font-medium text-red-700 mb-1">
                                        Motivo da rejeição
                                    </div>
                                    <p className="text-sm whitespace-pre-wrap text-red-900">
                                        {detail.rejectedReason}
                                    </p>
                                </div>
                            )}
                            {detail.headerText && (
                                <div>
                                    <div className="text-xs text-slate-400 mb-1">
                                        HEADER
                                    </div>
                                    <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-[#eef4fb]/40 p-3 text-xs text-[#0f2744]">
                                        {detail.headerText}
                                    </pre>
                                </div>
                            )}
                            <div>
                                <div className="text-xs text-slate-400 mb-1">
                                    BODY ({detail.variableCount} variáveis)
                                </div>
                                <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-[#eef4fb]/40 p-3 text-xs text-[#0f2744]">
                                    {detail.bodyText}
                                </pre>
                            </div>
                            {detail.footerText && (
                                <div>
                                    <div className="text-xs text-slate-400 mb-1">
                                        FOOTER
                                    </div>
                                    <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-[#eef4fb]/40 p-3 text-xs text-[#0f2744]">
                                        {detail.footerText}
                                    </pre>
                                </div>
                            )}
                            {detail.exampleRow?.length > 0 && (
                                <div>
                                    <div className="text-xs text-slate-400 mb-1">
                                        Exemplos
                                    </div>
                                    <ol className="list-decimal pl-5 text-xs space-y-0.5 text-slate-600">
                                        {detail.exampleRow.map((ex, i) => (
                                            <li key={i}>{ex}</li>
                                        ))}
                                    </ol>
                                </div>
                            )}
                            <div className="text-xs text-slate-400">
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
                <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border-slate-200">
                    <DialogHeader>
                        <DialogTitle className="text-[#0f2744]">
                            Importar para biblioteca
                        </DialogTitle>
                        <DialogDescription className="text-slate-500">
                            Mapeie as variáveis do template para os campos de
                            carga do boletim.
                        </DialogDescription>
                    </DialogHeader>
                    {importTarget && (
                        <div className="space-y-3">
                            <p className="text-xs font-mono text-slate-500">
                                {importTarget.technicalName} ·{" "}
                                {importTarget.variableCount} variáveis
                            </p>
                            {mappings.map((m, i) => (
                                <div key={i} className="space-y-1">
                                    <label className="text-xs text-slate-500">
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
                                        <SelectTrigger className="rounded-xl border-slate-200">
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
                                className={`w-full ${premiumBtn}`}
                                onClick={() => void confirmImport()}
                                disabled={
                                    importing || mappings.some((x) => !x)
                                }
                            >
                                {importing ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : null}
                                Confirmar importação
                            </Button>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
