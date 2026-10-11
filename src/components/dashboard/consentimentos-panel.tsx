"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
    History,
    Loader2,
    MessageSquare,
    MoreHorizontal,
    Search,
    ShieldCheck,
    User,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPhoneDisplay } from "@/lib/phone-br";
import { DATAFY_OFFICIAL_CHANNEL_ID } from "@/modules/channels/ids";
import { useSession } from "@/components/dashboard/session-provider";
import { cn } from "@/lib/utils";

type Stats = {
    total: number;
    granted: number;
    denied: number;
    optedOut: number;
    unknown: number;
    notGranted: number;
};

type Row = {
    id: string;
    waId: string;
    fullName: string | null;
    company: string | null;
    consentStatus: string;
    consentStatusLabel: string;
    consentSource: string | null;
    consentSourceLabel: string;
    consentAt: string | null;
    channelLabel: string;
    consentEvidence: string | null;
};

type HistoryItem = {
    id: string;
    decision: string;
    resultingStatusLabel: string;
    sourceLabel: string;
    evidenceText: string | null;
    decidedAt: string;
    appliedToContact: boolean;
};

function statusBadge(status: string) {
    switch (status) {
        case "granted":
            return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
        case "denied":
            return "bg-amber-500/15 text-amber-800 dark:text-amber-200";
        case "opted_out":
            return "bg-rose-500/15 text-rose-700 dark:text-rose-300";
        default:
            return "bg-muted text-muted-foreground";
    }
}

function formatDt(iso: string | null) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("pt-BR");
    } catch {
        return iso;
    }
}

export function ConsentimentosPanel() {
    const { setChannelId } = useSession();
    const [tab, setTab] = useState<"granted" | "not_granted">("granted");
    const [statusFilter, setStatusFilter] = useState<string>("all");
    const [sourceFilter, setSourceFilter] = useState<string>("all");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<Stats | null>(null);
    const [items, setItems] = useState<Row[]>([]);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [selected, setSelected] = useState<Row | null>(null);
    const [manualOpen, setManualOpen] = useState(false);
    const [manualDecision, setManualDecision] = useState<
        "GRANTED" | "DENIED" | "REVOKED"
    >("GRANTED");
    const [manualEvidence, setManualEvidence] = useState("");
    const [savingManual, setSavingManual] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const sp = new URLSearchParams({
                tab,
                page: String(page),
                pageSize: "10",
            });
            if (search.trim()) sp.set("search", search.trim());
            if (tab === "not_granted" && statusFilter !== "all") {
                sp.set("status", statusFilter);
            }
            if (sourceFilter !== "all") sp.set("source", sourceFilter);
            const res = await fetch(`/api/crm/consents?${sp}`);
            const json = await res.json();
            if (!res.ok || !json.status) {
                throw new Error(json.message || "Falha ao carregar");
            }
            setStats(json.data.stats);
            setItems(json.data.items || []);
            setTotalPages(json.data.totalPages || 1);
            setTotal(json.data.total || 0);
        } catch (e) {
            toast.error(
                e instanceof Error ? e.message : "Erro ao carregar consentimentos"
            );
        } finally {
            setLoading(false);
        }
    }, [tab, page, search, statusFilter, sourceFilter]);

    useEffect(() => {
        void load();
    }, [load]);

    async function openHistory(row: Row) {
        setSelected(row);
        setHistoryOpen(true);
        setHistoryLoading(true);
        try {
            const res = await fetch(`/api/crm/consents/${row.id}`);
            const json = await res.json();
            if (!res.ok || !json.status) throw new Error(json.message);
            setHistory(json.data.history || []);
        } catch (e) {
            toast.error(
                e instanceof Error ? e.message : "Falha ao carregar histórico"
            );
        } finally {
            setHistoryLoading(false);
        }
    }

    async function saveManual() {
        if (!selected) return;
        setSavingManual(true);
        try {
            const res = await fetch(`/api/crm/consents/${selected.id}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    decision: manualDecision,
                    evidenceText: manualEvidence,
                }),
            });
            const json = await res.json();
            if (!res.ok || !json.status) {
                throw new Error(json.message || "Falha ao registrar");
            }
            toast.success("Consentimento registrado com evidência");
            setManualOpen(false);
            setManualEvidence("");
            setHistoryOpen(false);
            await load();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao salvar");
        } finally {
            setSavingManual(false);
        }
    }

    return (
        <div className="space-y-6">
            <header className="space-y-1">
                <div className="flex items-center gap-2">
                    <ShieldCheck className="h-6 w-6 text-primary" />
                    <h1 className="text-2xl font-semibold tracking-tight">
                        Consentimentos
                    </h1>
                </div>
                <p className="text-sm text-muted-foreground max-w-2xl">
                    Gerencie as autorizações para recebimento de ofertas e
                    comunicações pelo WhatsApp.
                </p>
            </header>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                    { label: "Total de contatos", value: stats?.total },
                    { label: "Consentimento concedido", value: stats?.granted },
                    {
                        label: "Recusado ou revogado",
                        value:
                            stats != null
                                ? stats.denied + stats.optedOut
                                : undefined,
                    },
                    {
                        label: "Aguardando / sem registro",
                        value: stats?.unknown,
                    },
                ].map((card) => (
                    <div
                        key={card.label}
                        className="rounded-xl border border-border/60 bg-gradient-to-b from-background to-muted/20 px-4 py-3"
                    >
                        <p className="text-xs text-muted-foreground">
                            {card.label}
                        </p>
                        {loading && stats == null ? (
                            <Skeleton className="mt-2 h-7 w-16" />
                        ) : (
                            <p className="mt-1 text-2xl font-semibold tabular-nums">
                                {card.value ?? 0}
                            </p>
                        )}
                    </div>
                ))}
            </div>

            <Tabs
                value={tab}
                onValueChange={(v) => {
                    setTab(v as "granted" | "not_granted");
                    setPage(1);
                }}
            >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                    <TabsList>
                        <TabsTrigger value="granted">Concedido</TabsTrigger>
                        <TabsTrigger value="not_granted">
                            Não concedido
                        </TabsTrigger>
                    </TabsList>
                    <div className="flex flex-wrap gap-2">
                        <div className="relative min-w-[200px] flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                className="pl-8"
                                placeholder="Nome ou WhatsApp"
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    setPage(1);
                                }}
                            />
                        </div>
                        {tab === "not_granted" && (
                            <Select
                                value={statusFilter}
                                onValueChange={(v) => {
                                    setStatusFilter(v);
                                    setPage(1);
                                }}
                            >
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">
                                        Todos (não concedidos)
                                    </SelectItem>
                                    <SelectItem value="denied">
                                        Recusado
                                    </SelectItem>
                                    <SelectItem value="opted_out">
                                        Revogado
                                    </SelectItem>
                                    <SelectItem value="unknown">
                                        Sem resposta / nunca solicitado
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                        <Select
                            value={sourceFilter}
                            onValueChange={(v) => {
                                setSourceFilter(v);
                                setPage(1);
                            }}
                        >
                            <SelectTrigger className="w-[200px]">
                                <SelectValue placeholder="Origem" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas origens</SelectItem>
                                <SelectItem value="interactive_button">
                                    Botão interativo
                                </SelectItem>
                                <SelectItem value="keyword_opt_out">
                                    Resposta escrita
                                </SelectItem>
                                <SelectItem value="manual_evidence">
                                    Manual com evidência
                                </SelectItem>
                                <SelectItem value="manual">Manual CRM</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <TabsContent value={tab} className="mt-4 space-y-3">
                    <div className="rounded-xl border border-border/60 overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>WhatsApp</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Última decisão</TableHead>
                                    <TableHead>Origem</TableHead>
                                    <TableHead>Canal</TableHead>
                                    <TableHead className="w-12" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    Array.from({ length: 5 }).map((_, i) => (
                                        <TableRow key={i}>
                                            {Array.from({ length: 7 }).map(
                                                (__, j) => (
                                                    <TableCell key={j}>
                                                        <Skeleton className="h-4 w-full" />
                                                    </TableCell>
                                                )
                                            )}
                                        </TableRow>
                                    ))
                                ) : items.length === 0 ? (
                                    <TableRow>
                                        <TableCell
                                            colSpan={7}
                                            className="py-12 text-center text-muted-foreground"
                                        >
                                            Nenhum contato nesta categoria.
                                            {tab === "granted"
                                                ? " Consentimentos chegarão pelos botões do WhatsApp ou registro com evidência."
                                                : " Contatos sem concessão válida aparecem aqui (recusa ≠ ausência)."}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    items.map((row) => (
                                        <TableRow key={row.id}>
                                            <TableCell className="font-medium">
                                                {row.fullName ||
                                                    row.company ||
                                                    "—"}
                                            </TableCell>
                                            <TableCell className="tabular-nums">
                                                {formatPhoneDisplay(row.waId)}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant="secondary"
                                                    className={cn(
                                                        "font-normal",
                                                        statusBadge(
                                                            row.consentStatus
                                                        )
                                                    )}
                                                >
                                                    {row.consentStatusLabel}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {formatDt(row.consentAt)}
                                            </TableCell>
                                            <TableCell className="text-sm">
                                                {row.consentSourceLabel}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {row.channelLabel}
                                            </TableCell>
                                            <TableCell>
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
                                                        <DropdownMenuItem asChild>
                                                            <Link
                                                                href={`/dashboard/contacts?focus=${row.id}`}
                                                            >
                                                                <User className="mr-2 h-4 w-4" />
                                                                Visualizar contato
                                                            </Link>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                void openHistory(
                                                                    row
                                                                )
                                                            }
                                                        >
                                                            <History className="mr-2 h-4 w-4" />
                                                            Ver histórico
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                setChannelId(
                                                                    DATAFY_OFFICIAL_CHANNEL_ID
                                                                );
                                                                window.location.href = `/dashboard/inbox?waId=${encodeURIComponent(row.waId)}`;
                                                            }}
                                                        >
                                                            <MessageSquare className="mr-2 h-4 w-4" />
                                                            Abrir conversa
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                setSelected(row);
                                                                setManualOpen(
                                                                    true
                                                                );
                                                            }}
                                                        >
                                                            Registrar com
                                                            evidência…
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

                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                        <span>
                            {total} registro(s) · página {page} de {totalPages}
                        </span>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page <= 1 || loading}
                                onClick={() => setPage((p) => p - 1)}
                            >
                                Anterior
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                disabled={page >= totalPages || loading}
                                onClick={() => setPage((p) => p + 1)}
                            >
                                Próxima
                            </Button>
                        </div>
                    </div>
                </TabsContent>
            </Tabs>

            <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Histórico de consentimento</DialogTitle>
                    </DialogHeader>
                    {selected && (
                        <p className="text-sm text-muted-foreground">
                            {selected.fullName || formatPhoneDisplay(selected.waId)}{" "}
                            · {selected.consentStatusLabel}
                        </p>
                    )}
                    {historyLoading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                    ) : history.length === 0 ? (
                        <p className="py-6 text-sm text-muted-foreground">
                            Nenhuma decisão registrada ainda.
                        </p>
                    ) : (
                        <ul className="max-h-80 space-y-3 overflow-y-auto pr-1">
                            {history.map((h) => (
                                <li
                                    key={h.id}
                                    className="rounded-lg border border-border/50 px-3 py-2 text-sm"
                                >
                                    <div className="flex justify-between gap-2">
                                        <span className="font-medium">
                                            {h.decision}
                                        </span>
                                        <span className="text-xs text-muted-foreground">
                                            {formatDt(h.decidedAt)}
                                        </span>
                                    </div>
                                    <p className="text-muted-foreground">
                                        {h.sourceLabel}
                                        {!h.appliedToContact
                                            ? " · evento antigo (não alterou status)"
                                            : ""}
                                    </p>
                                    {h.evidenceText && (
                                        <p className="mt-1 text-xs">
                                            Evidência: {h.evidenceText}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </DialogContent>
            </Dialog>

            <Dialog open={manualOpen} onOpenChange={setManualOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            Registrar consentimento com evidência
                        </DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Somente com comprovação válida (contrato, formulário,
                        gravação). Não use para conceder sem autorização.
                    </p>
                    <div className="space-y-3">
                        <div className="space-y-1.5">
                            <Label>Decisão</Label>
                            <Select
                                value={manualDecision}
                                onValueChange={(v) =>
                                    setManualDecision(
                                        v as "GRANTED" | "DENIED" | "REVOKED"
                                    )
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="GRANTED">
                                        Concedido
                                    </SelectItem>
                                    <SelectItem value="DENIED">
                                        Recusado
                                    </SelectItem>
                                    <SelectItem value="REVOKED">
                                        Revogado
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Evidência</Label>
                            <Textarea
                                rows={4}
                                value={manualEvidence}
                                onChange={(e) =>
                                    setManualEvidence(e.target.value)
                                }
                                placeholder="Descreva a origem e o comprovante (mín. 10 caracteres)"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setManualOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            disabled={
                                savingManual || manualEvidence.trim().length < 10
                            }
                            onClick={() => void saveManual()}
                        >
                            {savingManual && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Registrar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
