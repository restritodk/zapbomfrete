"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    Download,
    Loader2,
    MoreHorizontal,
    Plus,
    Search,
    Upload,
    MessageSquare,
    Filter,
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
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { useSession } from "@/components/dashboard/session-provider";
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
    tags: Array<{ id: string; name: string; colorHex: string }>;
    conversationsCount?: number;
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

export function CrmContactsPanel() {
    const router = useRouter();
    const { setChannelId } = useSession();
    const fileRef = useRef<HTMLInputElement>(null);

    const [rows, setRows] = useState<CrmRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [meta, setMeta] = useState({ total: 0, totalPages: 1 });
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
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: String(page),
                limit: "20",
                active: activeFilter,
            });
            if (search.trim()) params.set("search", search.trim());
            if (category !== "all") params.set("category", category);
            if (consentStatus !== "all") params.set("consentStatus", consentStatus);
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
        } catch {
            toast.error("Erro ao carregar contatos CRM");
        } finally {
            setLoading(false);
        }
    }, [page, search, category, consentStatus, activeFilter, city, stateUf]);

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
                editingId ? `/api/crm/contacts/${editingId}` : "/api/crm/contacts",
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
                    (duplicates ? ` · ${duplicates} duplicados no arquivo` : "")
            );
            void load();
        } catch {
            toast.error("Erro ao importar arquivo");
        } finally {
            if (fileRef.current) fileRef.current.value = "";
        }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                        CRM Bom Frete
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        Diretório compartilhado integrado ao Chat oficial Datafy.
                        Consentimento comercial nunca é marcado automaticamente na
                        importação.
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        className="rounded-xl"
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
                        className="rounded-xl"
                        onClick={() => fileRef.current?.click()}
                    >
                        <Upload className="h-4 w-4 mr-1.5" />
                        Importar TXT/CSV
                    </Button>
                    <Button variant="outline" className="rounded-xl" asChild>
                        <a href="/api/crm/contacts/export">
                            <Download className="h-4 w-4 mr-1.5" />
                            Exportar
                        </a>
                    </Button>
                    <Button className="rounded-xl" onClick={openCreate}>
                        <Plus className="h-4 w-4 mr-1.5" />
                        Novo contato
                    </Button>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        className="pl-9 rounded-xl"
                        placeholder="Buscar nome, telefone, empresa…"
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
                    <SelectTrigger className="w-full sm:w-[180px] rounded-xl">
                        <SelectValue placeholder="Categoria" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas categorias</SelectItem>
                        {CRM_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>
                                {c}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {showFilters && (
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 rounded-2xl border bg-muted/20 p-4">
                    <div className="space-y-1.5">
                        <Label>Cidade</Label>
                        <Input
                            value={city}
                            onChange={(e) => {
                                setCity(e.target.value);
                                setPage(1);
                            }}
                            className="rounded-xl"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>UF</Label>
                        <Input
                            value={stateUf}
                            maxLength={2}
                            onChange={(e) => {
                                setStateUf(e.target.value.toUpperCase());
                                setPage(1);
                            }}
                            className="rounded-xl"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Consentimento</Label>
                        <Select
                            value={consentStatus}
                            onValueChange={(v) => {
                                setConsentStatus(v);
                                setPage(1);
                            }}
                        >
                            <SelectTrigger className="rounded-xl">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todos</SelectItem>
                                <SelectItem value="unknown">Desconhecido</SelectItem>
                                <SelectItem value="granted">Autorizado</SelectItem>
                                <SelectItem value="denied">Negado</SelectItem>
                                <SelectItem value="opted_out">Opt-out</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-1.5">
                        <Label>Situação</Label>
                        <Select
                            value={activeFilter}
                            onValueChange={(v) => {
                                setActiveFilter(v);
                                setPage(1);
                            }}
                        >
                            <SelectTrigger className="rounded-xl">
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

            <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Contato</TableHead>
                                <TableHead className="hidden md:table-cell">
                                    Empresa
                                </TableHead>
                                <TableHead className="hidden lg:table-cell">
                                    Local
                                </TableHead>
                                <TableHead className="hidden sm:table-cell">
                                    Categoria
                                </TableHead>
                                <TableHead className="hidden xl:table-cell">
                                    Consentimento
                                </TableHead>
                                <TableHead className="w-[60px]">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-28 text-center">
                                        <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                                        Carregando…
                                    </TableCell>
                                </TableRow>
                            ) : rows.length === 0 ? (
                                <TableRow>
                                    <TableCell
                                        colSpan={6}
                                        className="h-28 text-center text-muted-foreground"
                                    >
                                        Nenhum contato no CRM. Cadastre ou importe
                                        TXT/CSV (mesmo formato do Disparo).
                                    </TableCell>
                                </TableRow>
                            ) : (
                                rows.map((row) => (
                                    <TableRow
                                        key={row.id}
                                        className={cn(!row.active && "opacity-60")}
                                    >
                                        <TableCell>
                                            <div className="min-w-0">
                                                <p className="font-medium truncate">
                                                    {row.fullName || "Sem nome"}
                                                </p>
                                                <p className="text-xs font-mono text-muted-foreground">
                                                    {formatPhoneDisplay(row.waId) ||
                                                        row.waId}
                                                </p>
                                                <div className="mt-1 flex flex-wrap gap-1">
                                                    {row.tags.map((t) => (
                                                        <Badge
                                                            key={t.id}
                                                            variant="outline"
                                                            className="text-[10px]"
                                                            style={{
                                                                borderColor: t.colorHex,
                                                            }}
                                                        >
                                                            {t.name}
                                                        </Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="hidden md:table-cell text-sm">
                                            {row.company || "—"}
                                        </TableCell>
                                        <TableCell className="hidden lg:table-cell text-sm">
                                            {[row.city, row.state]
                                                .filter(Boolean)
                                                .join(" / ") || "—"}
                                        </TableCell>
                                        <TableCell className="hidden sm:table-cell">
                                            {row.category ? (
                                                <Badge variant="secondary">
                                                    {row.category}
                                                </Badge>
                                            ) : (
                                                "—"
                                            )}
                                        </TableCell>
                                        <TableCell className="hidden xl:table-cell text-xs capitalize">
                                            {row.consentStatus.replace("_", " ")}
                                        </TableCell>
                                        <TableCell>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        size="icon"
                                                        variant="ghost"
                                                        className="h-8 w-8"
                                                    >
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            void openView(row.id)
                                                        }
                                                    >
                                                        Visualizar
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() => openEdit(row)}
                                                    >
                                                        Editar
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            void openConversation(row)
                                                        }
                                                    >
                                                        <MessageSquare className="h-3.5 w-3.5 mr-2" />
                                                        Abrir conversa
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            void toggleActive(row)
                                                        }
                                                    >
                                                        {row.active
                                                            ? "Desativar"
                                                            : "Reativar"}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="text-red-600"
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
                <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
                    <span className="text-muted-foreground">
                        {meta.total} contato(s)
                    </span>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => p - 1)}
                        >
                            Anterior
                        </Button>
                        <span className="self-center text-muted-foreground">
                            {page}/{meta.totalPages}
                        </span>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={page >= meta.totalPages}
                            onClick={() => setPage((p) => p + 1)}
                        >
                            Próxima
                        </Button>
                    </div>
                </div>
            </div>

            <p className="text-xs text-muted-foreground">
                A importação TXT/CSV do{" "}
                <Link href="/dashboard/broadcast" className="underline">
                    Disparo em massa
                </Link>{" "}
                permanece inalterada. O botão acima usa o mesmo formato de arquivo
                para popular o CRM (sem marcar consentimento).
            </p>

            {/* Create / Edit */}
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {editingId ? "Editar contato" : "Novo contato"}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3 py-2">
                        <div className="space-y-1.5">
                            <Label>WhatsApp *</Label>
                            <Input
                                value={form.waId}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, waId: e.target.value }))
                                }
                                placeholder="5511999998888"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Nome completo</Label>
                            <Input
                                value={form.fullName}
                                onChange={(e) =>
                                    setForm((f) => ({
                                        ...f,
                                        fullName: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
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
                                    <SelectTrigger>
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
                        </div>
                        <div className="grid grid-cols-2 gap-3">
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
                                />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Consentimento comercial</Label>
                            <Select
                                value={form.consentStatus}
                                onValueChange={(v) =>
                                    setForm((f) => ({ ...f, consentStatus: v }))
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="unknown">Desconhecido</SelectItem>
                                    <SelectItem value="granted">Autorizado</SelectItem>
                                    <SelectItem value="denied">Negado</SelectItem>
                                    <SelectItem value="opted_out">Opt-out</SelectItem>
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
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label>Observações</Label>
                            <Textarea
                                value={form.notes}
                                onChange={(e) =>
                                    setForm((f) => ({ ...f, notes: e.target.value }))
                                }
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalOpen(false)}>
                            Cancelar
                        </Button>
                        <Button disabled={saving || !form.waId.trim()} onClick={() => void save()}>
                            {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Salvar"
                            )}
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
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Detalhes do contato</DialogTitle>
                    </DialogHeader>
                    {viewData ? (
                        <div className="space-y-3 text-sm">
                            <p className="font-semibold text-base">
                                {viewData.contact.fullName || "Sem nome"}
                            </p>
                            <p className="font-mono text-xs text-muted-foreground">
                                {formatPhoneDisplay(viewData.contact.waId) ||
                                    viewData.contact.waId}
                            </p>
                            <p>Empresa: {viewData.contact.company || "—"}</p>
                            <p>
                                Local:{" "}
                                {[viewData.contact.city, viewData.contact.state]
                                    .filter(Boolean)
                                    .join(" / ") || "—"}
                            </p>
                            <p>Categoria: {viewData.contact.category || "—"}</p>
                            <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 space-y-1">
                                <p className="font-medium">
                                    Consentimento WhatsApp
                                </p>
                                <p>
                                    Status:{" "}
                                    {viewData.contact.consentStatus.replace(
                                        "_",
                                        " "
                                    )}
                                </p>
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
                                        ? new Date(
                                              viewData.contact.consentAt
                                          ).toLocaleString("pt-BR")
                                        : "—"}
                                </p>
                                <Link
                                    href={`/dashboard/contatos/consentimentos`}
                                    className="text-xs text-primary underline-offset-2 hover:underline"
                                >
                                    Abrir painel de consentimentos / histórico
                                </Link>
                            </div>
                            <p className="whitespace-pre-wrap">
                                Observações: {viewData.contact.notes || "—"}
                            </p>
                            <div>
                                <p className="font-medium mb-1">
                                    Conversas Datafy
                                </p>
                                {viewData.conversations.length === 0 ? (
                                    <p className="text-muted-foreground text-xs">
                                        Nenhuma conversa vinculada ainda.
                                    </p>
                                ) : (
                                    <ul className="space-y-2">
                                        {viewData.conversations.map((c) => (
                                            <li
                                                key={c.id}
                                                className="rounded-lg border px-3 py-2 text-xs"
                                            >
                                                <p className="truncate">
                                                    {c.lastMessagePreview || "—"}
                                                </p>
                                                <p className="text-muted-foreground mt-0.5">
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
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Excluir contato?</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Se houver conversas Datafy vinculadas, o contato será apenas
                        desativado para preservar o histórico.
                    </p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteId(null)}>
                            Cancelar
                        </Button>
                        <Button variant="destructive" onClick={() => void confirmDelete()}>
                            Confirmar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
