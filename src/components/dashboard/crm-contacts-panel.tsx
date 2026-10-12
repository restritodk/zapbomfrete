"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    Building2,
    ChevronLeft,
    ChevronRight,
    Download,
    Filter,
    Loader2,
    MessageSquare,
    MoreHorizontal,
    Plus,
    Search,
    ShieldCheck,
    ShieldAlert,
    Upload,
    UserRound,
    Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { formatPhoneDisplay, parsePhoneList } from "@/lib/phone-br";
import { CRM_CATEGORIES } from "@/modules/crm/constants";
import {
    contactDisplayName,
    contactInitials,
    crmConsentLabel,
    crmConsentTone,
    formatCrmDateTime,
    percentOf,
} from "@/modules/crm/crm-display";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { useSession } from "@/components/dashboard/session-provider";
import { visiblePageNumbers } from "@/lib/mass-dispatch/pagination";
import { cn } from "@/lib/utils";

type CrmRow = {
    id: string;
    waId: string;
    fullName: string | null;
    company: string | null;
    city: string | null;
    state: string | null;
    category: string | null;
    origin: string;
    active: boolean;
    consentStatus: string;
    consentSource?: string | null;
    consentAt?: string | null;
    consentPurpose?: string | null;
    notes: string | null;
    lastInteractionAt: string | null;
    updatedAt?: string | null;
    tags: Array<{ id: string; name: string; colorHex: string }>;
    conversationsCount?: number;
};

type CrmStats = {
    total: number;
    granted: number;
    unknown: number;
    companies: number;
};

type FormState = {
    waId: string;
    fullName: string;
    company: string;
    city: string;
    state: string;
    category: string;
    notes: string;
    consentStatus: string;
    tagNames: string;
};

const emptyForm: FormState = {
    waId: "",
    fullName: "",
    company: "",
    city: "",
    state: "",
    category: "",
    notes: "",
    consentStatus: "unknown",
    tagNames: "",
};

const emptyStats: CrmStats = {
    total: 0,
    granted: 0,
    unknown: 0,
    companies: 0,
};

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

function ConsentBadge({ status }: { status: string }) {
    const tone = crmConsentTone(status);
    const label = crmConsentLabel(status);
    return (
        <Badge
            className={cn(
                "rounded-full border-0 font-medium ring-1",
                tone === "granted" &&
                    "bg-emerald-50 text-emerald-700 ring-emerald-100 hover:bg-emerald-50",
                tone === "unknown" &&
                    "bg-orange-50 text-orange-700 ring-orange-100 hover:bg-orange-50",
                tone === "denied" &&
                    "bg-red-50 text-red-700 ring-red-100 hover:bg-red-50",
                tone === "revoked" &&
                    "bg-slate-100 text-slate-700 ring-slate-200 hover:bg-slate-100",
                tone === "other" &&
                    "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-50"
            )}
        >
            {label}
        </Badge>
    );
}

function ContactAvatar({ fullName }: { fullName: string | null }) {
    const initials = contactInitials(fullName);
    if (!initials) {
        return (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <UserRound className="h-4 w-4" />
            </div>
        );
    }
    return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dbeafe] text-[#1d4ed8] text-xs font-semibold tracking-wide">
            {initials}
        </div>
    );
}

export function CrmContactsPanel() {
    const router = useRouter();
    const { setChannelId } = useSession();
    const fileRef = useRef<HTMLInputElement>(null);
    const hasLoadedOnce = useRef(false);

    const [rows, setRows] = useState<CrmRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState<number>(10);
    const [meta, setMeta] = useState({ total: 0, totalPages: 1 });
    const [stats, setStats] = useState<CrmStats>(emptyStats);
    const [search, setSearch] = useState("");
    const [category, setCategory] = useState<string>("all");
    const [consentStatus, setConsentStatus] = useState<string>("all");
    const [activeFilter, setActiveFilter] = useState<string>("true");
    const [city, setCity] = useState("");
    const [stateUf, setStateUf] = useState("");
    const [showFilters, setShowFilters] = useState(false);

    const [modalOpen, setModalOpen] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [deleteId, setDeleteId] = useState<string | null>(null);
    const [importOpen, setImportOpen] = useState(false);
    const [viewId, setViewId] = useState<string | null>(null);
    const [viewData, setViewData] = useState<{
        contact: CrmRow;
        conversations: Array<{
            id: string;
            lastMessageAt: string | null;
            lastMessagePreview: string | null;
            status: string;
            assignedTo: { name: string | null; email: string } | null;
        }>;
    } | null>(null);

    const load = useCallback(async () => {
        if (hasLoadedOnce.current) {
            setRefreshing(true);
        } else {
            setLoading(true);
        }
        try {
            const params = new URLSearchParams({
                page: String(page),
                limit: String(pageSize),
                active: activeFilter,
            });
            if (search.trim()) params.set("search", search.trim());
            if (category !== "all") params.set("category", category);
            if (consentStatus !== "all") {
                params.set("consentStatus", consentStatus);
            }
            if (city.trim()) params.set("city", city.trim());
            if (stateUf.trim()) params.set("state", stateUf.trim());

            const res = await fetch(`/api/crm/contacts?${params}`);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha ao carregar CRM");
                setRows([]);
                return;
            }
            setRows(json.data?.contacts || []);
            setMeta(json.data?.meta || { total: 0, totalPages: 1 });
            if (json.data?.stats) {
                setStats(json.data.stats as CrmStats);
            }
            hasLoadedOnce.current = true;
        } catch {
            toast.error("Erro ao carregar contatos CRM");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [
        page,
        pageSize,
        search,
        category,
        consentStatus,
        activeFilter,
        city,
        stateUf,
    ]);

    useEffect(() => {
        const t = setTimeout(() => void load(), 300);
        return () => clearTimeout(t);
    }, [load]);

    const openCreate = () => {
        setEditingId(null);
        setForm(emptyForm);
        setModalOpen(true);
    };

    const openEdit = (row: CrmRow) => {
        setEditingId(row.id);
        setForm({
            waId: row.waId,
            fullName: row.fullName || "",
            company: row.company || "",
            city: row.city || "",
            state: row.state || "",
            category: row.category || "",
            notes: row.notes || "",
            consentStatus: row.consentStatus || "unknown",
            tagNames: row.tags.map((t) => t.name).join(", "),
        });
        setModalOpen(true);
    };

    const save = async () => {
        setSaving(true);
        try {
            const payload = {
                waId: form.waId,
                fullName: form.fullName || null,
                company: form.company || null,
                city: form.city || null,
                state: form.state || null,
                category: form.category || null,
                notes: form.notes || null,
                consentStatus: form.consentStatus,
                tagNames: form.tagNames
                    .split(/[,;]+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
            };
            const res = await fetch(
                editingId
                    ? `/api/crm/contacts/${editingId}`
                    : "/api/crm/contacts",
                {
                    method: editingId ? "PUT" : "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                }
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha ao salvar");
                return;
            }
            toast.success(editingId ? "Contato atualizado" : "Contato criado");
            setModalOpen(false);
            void load();
        } catch {
            toast.error("Erro ao salvar");
        } finally {
            setSaving(false);
        }
    };

    const toggleActive = async (row: CrmRow) => {
        const res = await fetch(`/api/crm/contacts/${row.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: !row.active }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(json.message || "Falha");
            return;
        }
        toast.success(row.active ? "Contato desativado" : "Contato reativado");
        void load();
    };

    const confirmDelete = async () => {
        if (!deleteId) return;
        const res = await fetch(`/api/crm/contacts/${deleteId}`, {
            method: "DELETE",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(json.message || "Falha ao excluir");
            return;
        }
        toast.success(
            json.data?.deactivated
                ? "Contato desativado (possui histórico)"
                : "Contato excluído"
        );
        setDeleteId(null);
        void load();
    };

    const openConversation = async (row: CrmRow) => {
        setChannelId(DATAFY_OFFICIAL_CHANNEL_ID);
        const q = encodeURIComponent(row.waId);
        router.push(`/dashboard/chat?waId=${q}`);
        toast.message("Abrindo Chat oficial Datafy…");
    };

    const openView = async (id: string) => {
        setViewId(id);
        const res = await fetch(`/api/crm/contacts/${id}`);
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(json.message || "Falha ao carregar");
            return;
        }
        setViewData(json.data);
    };

    /** Same TXT/CSV accept + parsePhoneList as Disparo — does not change Disparo UI. */
    const handleFileImport = async (file: File) => {
        try {
            const text = await file.text();
            const { phones, invalid, duplicates } = parsePhoneList(text);
            if (!phones.length) {
                toast.error(
                    invalid.length
                        ? `${invalid.length} linha(s) inválida(s)`
                        : "Nenhum telefone válido"
                );
                return;
            }
            const res = await fetch("/api/crm/contacts/import", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha na importação");
                return;
            }
            toast.success(
                `CRM: ${json.data?.created || 0} criados, ${json.data?.skipped || 0} ignorados` +
                    (duplicates
                        ? ` · ${duplicates} duplicados no arquivo`
                        : "")
            );
            setImportOpen(false);
            void load();
        } catch {
            toast.error("Erro ao importar arquivo");
        } finally {
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    const premiumCard =
        "rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_4px_rgba(15,23,42,0.06)]";
    const premiumBtnOutline =
        "rounded-xl border-slate-200 bg-white text-[#0f2744] hover:bg-slate-50";
    const premiumBtnSuccess =
        "rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-[0_6px_16px_-6px_rgba(16,185,129,0.55)]";

    const rangeStart =
        meta.total === 0 ? 0 : (page - 1) * pageSize + 1;
    const rangeEnd = Math.min(page * pageSize, meta.total);
    const pageNumbers = visiblePageNumbers(page, meta.totalPages, 5);

    const kpiCards = [
        {
            label: "Total de contatos",
            value: stats.total,
            desc: "Contatos ativos no CRM",
            icon: Users,
            iconBg: "bg-blue-50 text-blue-600",
            accent: "text-[#1d4ed8]",
        },
        {
            label: "Com consentimento",
            value: stats.granted,
            desc: `${percentOf(stats.granted, stats.total)} do total`,
            icon: ShieldCheck,
            iconBg: "bg-emerald-50 text-emerald-600",
            accent: "text-emerald-700",
        },
        {
            label: "Sem consentimento definido",
            value: stats.unknown,
            desc: `${percentOf(stats.unknown, stats.total)} do total`,
            icon: ShieldAlert,
            iconBg: "bg-orange-50 text-orange-600",
            accent: "text-orange-700",
        },
        {
            label: "Empresas cadastradas",
            value: stats.companies,
            desc: "Empresas distintas",
            icon: Building2,
            iconBg: "bg-sky-50 text-sky-600",
            accent: "text-sky-700",
        },
    ];

    return (
        <div className="mx-auto w-full max-w-[1400px] space-y-5 overflow-x-hidden">
            {/* Header */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#2563eb] text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)]">
                        <Users className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0f2744]">
                            CRM Bom Frete
                        </h1>
                        <p className="text-slate-500 text-sm mt-1 max-w-2xl">
                            Diretório compartilhado integrado ao Chat oficial
                            Datafy. Consentimento comercial nunca é marcado
                            automaticamente na importação.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                        variant="outline"
                        className={cn(premiumBtnOutline, showFilters && "ring-1 ring-[#2563eb]/30")}
                        onClick={() => setShowFilters((v) => !v)}
                    >
                        <Filter className="h-4 w-4 mr-1.5" />
                        Filtros
                    </Button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".txt,.csv,text/plain,text/csv"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleFileImport(f);
                        }}
                    />
                    <Button
                        variant="outline"
                        className={premiumBtnOutline}
                        onClick={() => setImportOpen(true)}
                    >
                        <Upload className="h-4 w-4 mr-1.5" />
                        Importar TXT/CSV
                    </Button>
                    <Button variant="outline" className={premiumBtnOutline} asChild>
                        <a href="/api/crm/contacts/export">
                            <Download className="h-4 w-4 mr-1.5" />
                            Exportar
                        </a>
                    </Button>
                    <Button className={premiumBtnSuccess} onClick={openCreate}>
                        <Plus className="h-4 w-4 mr-1.5" />
                        Novo contato
                    </Button>
                </div>
            </div>

            {/* KPI cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {kpiCards.map((card) => {
                    const Icon = card.icon;
                    return (
                        <div
                            key={card.label}
                            className={cn(premiumCard, "p-4 sm:p-5")}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-sm text-slate-500 font-medium">
                                        {card.label}
                                    </p>
                                    <p
                                        className={cn(
                                            "mt-1 text-3xl font-bold tabular-nums tracking-tight",
                                            card.accent
                                        )}
                                    >
                                        {card.value}
                                    </p>
                                    <p className="mt-1 text-xs text-slate-400">
                                        {card.desc}
                                    </p>
                                </div>
                                <div
                                    className={cn(
                                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                                        card.iconBg
                                    )}
                                >
                                    <Icon className="h-5 w-5" />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Search + quick filters */}
            <div className={cn(premiumCard, "p-3 sm:p-4")}>
                <div className="flex flex-col lg:flex-row gap-2 lg:items-center">
                    <div className="relative flex-1 min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            className="pl-9 h-11 rounded-xl border-slate-200 bg-white"
                            placeholder="Buscar nome, telefone, empresa..."
                            value={search}
                            onChange={(e) => {
                                setSearch(e.target.value);
                                setPage(1);
                            }}
                        />
                    </div>
                    <Select
                        value={category}
                        onValueChange={(v) => {
                            setCategory(v);
                            setPage(1);
                        }}
                    >
                        <SelectTrigger className="w-full lg:w-[200px] h-11 rounded-xl border-slate-200 bg-white">
                            <SelectValue placeholder="Categoria" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas as categorias</SelectItem>
                            {CRM_CATEGORIES.map((c) => (
                                <SelectItem key={c} value={c}>
                                    {c}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        value={consentStatus}
                        onValueChange={(v) => {
                            setConsentStatus(v);
                            setPage(1);
                        }}
                    >
                        <SelectTrigger className="w-full lg:w-[220px] h-11 rounded-xl border-slate-200 bg-white">
                            <SelectValue placeholder="Consentimento" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">
                                Todos os consentimentos
                            </SelectItem>
                            <SelectItem value="unknown">Não informado</SelectItem>
                            <SelectItem value="granted">Concedido</SelectItem>
                            <SelectItem value="denied">Recusado</SelectItem>
                            <SelectItem value="opted_out">Revogado</SelectItem>
                        </SelectContent>
                    </Select>
                    {refreshing && (
                        <Loader2 className="hidden lg:block h-4 w-4 animate-spin text-slate-400 shrink-0" />
                    )}
                </div>

                {showFilters && (
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:p-4">
                        <div className="space-y-1.5">
                            <Label className="text-slate-600">Cidade</Label>
                            <Input
                                value={city}
                                onChange={(e) => {
                                    setCity(e.target.value);
                                    setPage(1);
                                }}
                                className="rounded-xl bg-white border-slate-200"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-slate-600">UF</Label>
                            <Input
                                value={stateUf}
                                maxLength={2}
                                onChange={(e) => {
                                    setStateUf(e.target.value.toUpperCase());
                                    setPage(1);
                                }}
                                className="rounded-xl bg-white border-slate-200"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label className="text-slate-600">Situação</Label>
                            <Select
                                value={activeFilter}
                                onValueChange={(v) => {
                                    setActiveFilter(v);
                                    setPage(1);
                                }}
                            >
                                <SelectTrigger className="rounded-xl bg-white border-slate-200">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="true">Ativos</SelectItem>
                                    <SelectItem value="false">Inativos</SelectItem>
                                    <SelectItem value="all">Todos</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                )}
            </div>

            {/* Table */}
            <div className={cn(premiumCard, "overflow-hidden")}>
                <div className="flex flex-col gap-1 border-b border-slate-100 px-4 sm:px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-[#0f2744]">
                            Contatos ({meta.total})
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Listagem paginada do CRM com filtros combinados.
                        </p>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-[#eff6ff] hover:bg-[#eff6ff] border-slate-100">
                                <TableHead className="text-[#1e3a5f] font-semibold min-w-[220px]">
                                    Contato
                                </TableHead>
                                <TableHead className="hidden md:table-cell text-[#1e3a5f] font-semibold">
                                    Empresa
                                </TableHead>
                                <TableHead className="hidden lg:table-cell text-[#1e3a5f] font-semibold">
                                    Local
                                </TableHead>
                                <TableHead className="hidden sm:table-cell text-[#1e3a5f] font-semibold">
                                    Categoria
                                </TableHead>
                                <TableHead className="text-[#1e3a5f] font-semibold">
                                    Consentimento
                                </TableHead>
                                <TableHead className="hidden xl:table-cell text-[#1e3a5f] font-semibold">
                                    Última atualização
                                </TableHead>
                                <TableHead className="w-[60px] text-[#1e3a5f] font-semibold text-right">
                                    Ações
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        className="h-32 text-center text-slate-500"
                                    >
                                        <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                                        Carregando…
                                    </TableCell>
                                </TableRow>
                            ) : rows.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={7}
                                        className="h-32 text-center text-slate-500"
                                    >
                                        Nenhum contato no CRM. Cadastre ou
                                        importe TXT/CSV (mesmo formato do
                                        Disparo).
                                    </TableCell>
                                </TableRow>
                            ) : (
                                rows.map((row) => (
                                    <TableRow
                                        key={row.id}
                                        className={cn(
                                            "border-slate-100 transition-colors hover:bg-slate-50/80",
                                            !row.active && "opacity-60"
                                        )}
                                    >
                                        <TableCell className="py-3.5">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <ContactAvatar
                                                    fullName={row.fullName}
                                                />
                                                <div className="min-w-0">
                                                    <p className="font-medium text-[#0f2744] truncate">
                                                        {contactDisplayName(
                                                            row.fullName
                                                        )}
                                                    </p>
                                                    <p className="text-xs font-mono text-slate-500">
                                                        {formatPhoneDisplay(
                                                            row.waId
                                                        ) || row.waId}
                                                    </p>
                                                    {row.tags.length > 0 && (
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                            {row.tags.map(
                                                                (t) => (
                                                                    <Badge
                                                                        key={
                                                                            t.id
                                                                        }
                                                                        variant="outline"
                                                                        className="text-[10px] rounded-full"
                                                                        style={{
                                                                            borderColor:
                                                                                t.colorHex,
                                                                        }}
                                                                    >
                                                                        {t.name}
                                                                    </Badge>
                                                                )
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="hidden md:table-cell text-sm text-slate-600">
                                            {row.company || "—"}
                                        </TableCell>
                                        <TableCell className="hidden lg:table-cell text-sm text-slate-600">
                                            {[row.city, row.state]
                                                .filter(Boolean)
                                                .join(" / ") || "—"}
                                        </TableCell>
                                        <TableCell className="hidden sm:table-cell">
                                            {row.category ? (
                                                <Badge
                                                    variant="secondary"
                                                    className="rounded-full bg-slate-100 text-slate-700 hover:bg-slate-100"
                                                >
                                                    {row.category}
                                                </Badge>
                                            ) : (
                                                <span className="text-slate-400">
                                                    —
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <ConsentBadge
                                                status={row.consentStatus}
                                            />
                                        </TableCell>
                                        <TableCell className="hidden xl:table-cell text-xs text-slate-500 whitespace-nowrap">
                                            {formatCrmDateTime(
                                                row.updatedAt ||
                                                    row.lastInteractionAt
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-8 w-8 rounded-lg"
                                                        aria-label="Ações"
                                                    >
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            void openView(
                                                                row.id
                                                            )
                                                        }
                                                    >
                                                        Visualizar
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            openEdit(row)
                                                        }
                                                    >
                                                        Editar
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            void openConversation(
                                                                row
                                                            )
                                                        }
                                                    >
                                                        <MessageSquare className="h-3.5 w-3.5 mr-2" />
                                                        Abrir conversa
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            void toggleActive(
                                                                row
                                                            )
                                                        }
                                                    >
                                                        {row.active
                                                            ? "Desativar"
                                                            : "Reativar"}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="text-red-600 focus:text-red-600"
                                                        onClick={() =>
                                                            setDeleteId(row.id)
                                                        }
                                                    >
                                                        Excluir
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 px-4 sm:px-5 py-3.5">
                    <p className="text-sm text-slate-500">
                        {meta.total === 0
                            ? "Exibindo 0 de 0 contatos"
                            : `Exibindo ${rangeStart} a ${rangeEnd} de ${meta.total} contatos`}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-1.5">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0 rounded-lg border-slate-200"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            aria-label="Página anterior"
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        {pageNumbers[0] > 1 && (
                            <>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 min-w-8 rounded-lg border-slate-200"
                                    onClick={() => setPage(1)}
                                >
                                    1
                                </Button>
                                {pageNumbers[0] > 2 && (
                                    <span className="px-1 text-slate-400">
                                        …
                                    </span>
                                )}
                            </>
                        )}
                        {pageNumbers.map((n) => (
                            <Button
                                key={n}
                                variant={n === page ? "default" : "outline"}
                                size="sm"
                                className={cn(
                                    "h-8 min-w-8 rounded-lg",
                                    n === page
                                        ? "bg-[#2563eb] hover:bg-[#1d4ed8] text-white border-transparent"
                                        : "border-slate-200"
                                )}
                                onClick={() => setPage(n)}
                            >
                                {n}
                            </Button>
                        ))}
                        {pageNumbers[pageNumbers.length - 1] <
                            meta.totalPages && (
                            <>
                                {pageNumbers[pageNumbers.length - 1] <
                                    meta.totalPages - 1 && (
                                    <span className="px-1 text-slate-400">
                                        …
                                    </span>
                                )}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 min-w-8 rounded-lg border-slate-200"
                                    onClick={() => setPage(meta.totalPages)}
                                >
                                    {meta.totalPages}
                                </Button>
                            </>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 w-8 p-0 rounded-lg border-slate-200"
                            disabled={page >= meta.totalPages}
                            onClick={() =>
                                setPage((p) =>
                                    Math.min(meta.totalPages, p + 1)
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
                            setPageSize(Number(v));
                            setPage(1);
                        }}
                    >
                        <SelectTrigger className="w-full sm:w-[140px] h-9 rounded-xl border-slate-200 bg-white">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PAGE_SIZE_OPTIONS.map((n) => (
                                <SelectItem key={n} value={String(n)}>
                                    {n} por página
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <p className="text-xs text-slate-400">
                A importação TXT/CSV do{" "}
                <Link
                    href="/dashboard/broadcast"
                    className="underline underline-offset-2 text-slate-500 hover:text-[#2563eb]"
                >
                    Disparo em massa
                </Link>{" "}
                permanece inalterada. O botão acima usa o mesmo formato de
                arquivo para popular o CRM (sem marcar consentimento).
            </p>

            {/* Create / Edit */}
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent
                    size="wide"
                    className="max-h-[90vh] overflow-y-auto rounded-2xl border-slate-200/80"
                >
                    <DialogHeader>
                        <DialogTitle className="text-[#0f2744]">
                            {editingId ? "Editar contato" : "Novo contato"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-2 sm:grid-cols-2">
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>WhatsApp *</Label>
                            <Input
                                value={form.waId}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        waId: e.target.value,
                                    }))
                                }
                                placeholder="5511999998888"
                                className="rounded-xl h-11"
                            />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>Nome completo</Label>
                            <Input
                                value={form.fullName}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        fullName: e.target.value,
                                    }))
                                }
                                className="rounded-xl h-11"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Empresa</Label>
                            <Input
                                value={form.company}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        company: e.target.value,
                                    }))
                                }
                                className="rounded-xl h-11"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Categoria</Label>
                            <Select
                                value={form.category || "none"}
                                onValueChange={(v) =>
                                    setForm((f) => ({
                                        ...f,
                                        category: v === "none" ? "" : v,
                                    }))
                                }
                            >
                                <SelectTrigger className="rounded-xl h-11">
                                    <SelectValue placeholder="—" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">—</SelectItem>
                                    {CRM_CATEGORIES.map((c) => (
                                        <SelectItem key={c} value={c}>
                                            {c}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Cidade</Label>
                            <Input
                                value={form.city}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        city: e.target.value,
                                    }))
                                }
                                className="rounded-xl h-11"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>UF</Label>
                            <Input
                                value={form.state}
                                maxLength={2}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        state: e.target.value.toUpperCase(),
                                    }))
                                }
                                className="rounded-xl h-11"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Consentimento comercial</Label>
                            <Select
                                value={form.consentStatus}
                                onValueChange={(v) =>
                                    setForm((f) => ({
                                        ...f,
                                        consentStatus: v,
                                    }))
                                }
                            >
                                <SelectTrigger className="rounded-xl h-11">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="unknown">
                                        Não informado
                                    </SelectItem>
                                    <SelectItem value="granted">
                                        Concedido
                                    </SelectItem>
                                    <SelectItem value="denied">
                                        Recusado
                                    </SelectItem>
                                    <SelectItem value="opted_out">
                                        Revogado
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Etiquetas (vírgula)</Label>
                            <Input
                                value={form.tagNames}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        tagNames: e.target.value,
                                    }))
                                }
                                placeholder="VIP, Frota Sul"
                                className="rounded-xl h-11"
                            />
                        </div>
                        <div className="space-y-1.5 sm:col-span-2">
                            <Label>Observações</Label>
                            <Textarea
                                value={form.notes}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        notes: e.target.value,
                                    }))
                                }
                                className="rounded-xl min-h-[100px]"
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => setModalOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            className="rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8]"
                            disabled={saving || !form.waId.trim()}
                            onClick={() => void save()}
                        >
                            {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Salvar"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Import modal */}
            <Dialog open={importOpen} onOpenChange={setImportOpen}>
                <DialogContent className="sm:max-w-lg rounded-2xl border-slate-200/80">
                    <DialogHeader>
                        <DialogTitle className="text-[#0f2744]">
                            Importar TXT/CSV
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm text-slate-600">
                        <p>
                            Use o mesmo formato do Disparo em massa: um telefone
                            por linha (com ou sem DDI 55). Contatos duplicados
                            são ignorados.
                        </p>
                        <p className="rounded-xl border border-amber-100 bg-amber-50/80 px-3 py-2 text-amber-900 text-xs">
                            A importação <strong>não</strong> marca
                            consentimento comercial. Novos contatos ficam como
                            &quot;Não informado&quot;.
                        </p>
                        <Button
                            className="w-full rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8]"
                            onClick={() => fileRef.current?.click()}
                        >
                            <Upload className="h-4 w-4 mr-1.5" />
                            Selecionar arquivo
                        </Button>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => setImportOpen(false)}
                        >
                            Fechar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* View */}
            <Dialog
                open={Boolean(viewId)}
                onOpenChange={(o) => {
                    if (!o) {
                        setViewId(null);
                        setViewData(null);
                    }
                }}
            >
                <DialogContent
                    size="wide"
                    className="max-h-[90vh] overflow-y-auto rounded-2xl border-slate-200/80"
                >
                    <DialogHeader>
                        <DialogTitle className="text-[#0f2744]">
                            Detalhes do contato
                        </DialogTitle>
                    </DialogHeader>
                    {viewData ? (
                        <div className="space-y-4 text-sm">
                            <div className="flex items-center gap-3">
                                <ContactAvatar
                                    fullName={viewData.contact.fullName}
                                />
                                <div>
                                    <p className="font-semibold text-base text-[#0f2744]">
                                        {contactDisplayName(
                                            viewData.contact.fullName
                                        )}
                                    </p>
                                    <p className="font-mono text-xs text-slate-500">
                                        {formatPhoneDisplay(
                                            viewData.contact.waId
                                        ) || viewData.contact.waId}
                                    </p>
                                </div>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                <p>
                                    Empresa:{" "}
                                    {viewData.contact.company || "—"}
                                </p>
                                <p>
                                    Local:{" "}
                                    {[
                                        viewData.contact.city,
                                        viewData.contact.state,
                                    ]
                                        .filter(Boolean)
                                        .join(" / ") || "—"}
                                </p>
                                <p>
                                    Categoria:{" "}
                                    {viewData.contact.category || "—"}
                                </p>
                            </div>
                            <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 space-y-1.5">
                                <p className="font-medium text-[#0f2744]">
                                    Consentimento WhatsApp
                                </p>
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-500">
                                        Status:
                                    </span>
                                    <ConsentBadge
                                        status={viewData.contact.consentStatus}
                                    />
                                </div>
                                <p>
                                    Finalidade:{" "}
                                    {viewData.contact.consentPurpose ||
                                        "marketing_offers"}
                                </p>
                                <p>
                                    Origem:{" "}
                                    {viewData.contact.consentSource || "—"}
                                </p>
                                <p>
                                    Última atualização:{" "}
                                    {viewData.contact.consentAt
                                        ? formatCrmDateTime(
                                              viewData.contact.consentAt
                                          )
                                        : "—"}
                                </p>
                                <Link
                                    href="/dashboard/contatos/consentimentos"
                                    className="inline-block text-xs text-[#2563eb] underline-offset-2 hover:underline"
                                >
                                    Abrir painel de consentimentos / histórico
                                </Link>
                            </div>
                            <p className="whitespace-pre-wrap text-slate-600">
                                Observações: {viewData.contact.notes || "—"}
                            </p>
                            <div>
                                <p className="font-medium mb-1 text-[#0f2744]">
                                    Conversas Datafy
                                </p>
                                {viewData.conversations.length === 0 ? (
                                    <p className="text-slate-500 text-xs">
                                        Nenhuma conversa vinculada ainda.
                                    </p>
                                ) : (
                                    <ul className="space-y-2">
                                        {viewData.conversations.map((c) => (
                                            <li
                                                key={c.id}
                                                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs"
                                            >
                                                <p className="truncate">
                                                    {c.lastMessagePreview ||
                                                        "—"}
                                                </p>
                                                <p className="text-slate-500 mt-0.5">
                                                    {c.status}
                                                    {c.assignedTo
                                                        ? ` · ${c.assignedTo.name || c.assignedTo.email}`
                                                        : ""}
                                                </p>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="py-8 text-center">
                            <Loader2 className="inline h-4 w-4 animate-spin" />
                        </div>
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete confirm */}
            <Dialog
                open={Boolean(deleteId)}
                onOpenChange={(o) => !o && setDeleteId(null)}
            >
                <DialogContent className="sm:max-w-md rounded-2xl border-slate-200/80">
                    <DialogHeader>
                        <DialogTitle className="text-[#0f2744]">
                            Excluir contato?
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-slate-500">
                        Se houver conversas Datafy vinculadas, o contato será
                        apenas desativado para preservar o histórico.
                    </p>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => setDeleteId(null)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            className="rounded-xl"
                            onClick={() => void confirmDelete()}
                        >
                            Confirmar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
