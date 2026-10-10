"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
    Loader2,
    Plus,
    RefreshCw,
    MoreHorizontal,
    Play,
    Pause,
    Ban,
    Copy,
    Download,
    FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CRM_CATEGORIES } from "@/modules/crm/constants";
import { cn } from "@/lib/utils";

type Stats = {
    created: number;
    scheduled: number;
    running: number;
    paused: number;
    completed: number;
    totalEligible: number;
    totalAccepted: number;
    totalDelivered: number;
    totalRead: number;
    totalFailed: number;
    totalExcluded: number;
};

type Campaign = {
    id: string;
    name: string;
    status: string;
    purpose: string;
    templateName: string | null;
    templateLanguage: string | null;
    dryRun: boolean;
    scheduledAt: string | null;
    totals: {
        selected: number;
        eligible: number;
        excluded: number;
        accepted: number;
        delivered: number;
        read: number;
        failed: number;
        skipped: number;
        cancelled: number;
        queued: number;
    };
    createdAt: string;
};

type Template = {
    id: string;
    name: string;
    language: string;
    status: string;
    category?: string;
    components?: unknown[];
};

const STATUS_LABEL: Record<string, string> = {
    draft: "Rascunho",
    scheduled: "Agendada",
    preparing: "Preparando",
    running: "Em execução",
    paused: "Pausada",
    completed: "Concluída",
    completed_with_errors: "Concluída c/ falhas",
    cancelled: "Cancelada",
    failed: "Falha",
};

export function DatafyCampaignsPanel() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("all");
    const [wizardOpen, setWizardOpen] = useState(false);
    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [pendingStartId, setPendingStartId] = useState<string | null>(null);

    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [purpose, setPurpose] = useState("marketing");
    const [category, setCategory] = useState<string>("all");
    const [city, setCity] = useState("");
    const [stateUf, setStateUf] = useState("");
    const [company, setCompany] = useState("");
    const [requireConsent, setRequireConsent] = useState(true);
    const [audience, setAudience] = useState<{
        selected: number;
        eligibleCount: number;
        excludedCount: number;
    } | null>(null);
    const [templates, setTemplates] = useState<Template[]>([]);
    const [templateKey, setTemplateKey] = useState("");
    const [bodyVars, setBodyVars] = useState<string[]>(["fullName"]);
    const [scheduledAt, setScheduledAt] = useState("");
    const [dryRun, setDryRun] = useState(true);
    const [delayMs, setDelayMs] = useState(1200);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: "30" });
            if (statusFilter !== "all") params.set("status", statusFilter);
            const [sRes, cRes] = await Promise.all([
                fetch("/api/channels/datafy/campaigns/stats"),
                fetch(`/api/channels/datafy/campaigns?${params}`),
            ]);
            const sJson = await sRes.json().catch(() => ({}));
            const cJson = await cRes.json().catch(() => ({}));
            if (sRes.ok) setStats(sJson.data?.stats || null);
            if (cRes.ok) setCampaigns(cJson.data?.campaigns || []);
            else toast.error(cJson.message || "Falha ao carregar campanhas");
        } catch {
            toast.error("Erro ao carregar campanhas");
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => {
        void load();
        const t = setInterval(() => void load(), 8000);
        return () => clearInterval(t);
    }, [load]);

    const loadTemplates = async () => {
        const res = await fetch(
            "/api/integrations/datafy/templates?status=APPROVED&limit=50"
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(json.message || "Falha ao carregar templates");
            return;
        }
        setTemplates(json.data?.data || json.data || []);
    };

    const previewAudience = async () => {
        const res = await fetch("/api/channels/datafy/campaigns/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                purpose,
                requireConsent,
                segmentFilter: {
                    category: category === "all" ? null : category,
                    city: city || null,
                    state: stateUf || null,
                    company: company || null,
                },
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(json.message || "Falha na prévia");
            return;
        }
        setAudience(json.data);
        toast.success(
            `${json.data.eligibleCount} elegíveis · ${json.data.excludedCount} excluídos`
        );
    };

    const openWizard = () => {
        setStep(1);
        setName("");
        setDescription("");
        setPurpose("marketing");
        setCategory("all");
        setCity("");
        setStateUf("");
        setCompany("");
        setAudience(null);
        setTemplateKey("");
        setBodyVars(["fullName"]);
        setScheduledAt("");
        setDryRun(true);
        setWizardOpen(true);
        void loadTemplates();
    };

    const selectedTemplate = templates.find(
        (t) => `${t.name}::${t.language}` === templateKey
    );

    const createAndMaybeStart = async (startNow: boolean) => {
        if (!name.trim()) {
            toast.error("Informe o nome da campanha");
            return;
        }
        if (!selectedTemplate) {
            toast.error("Selecione um template APPROVED");
            return;
        }
        if (!audience || audience.eligibleCount <= 0) {
            toast.error("Calcule a audiência com destinatários elegíveis");
            return;
        }
        setSaving(true);
        try {
            const res = await fetch("/api/channels/datafy/campaigns", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    description: description || null,
                    purpose,
                    templateName: selectedTemplate.name,
                    templateLanguage: selectedTemplate.language,
                    templateCategory: selectedTemplate.category || null,
                    templateComponents: selectedTemplate.components || null,
                    variableMapping: { body: bodyVars },
                    segmentFilter: {
                        category: category === "all" ? null : category,
                        city: city || null,
                        state: stateUf || null,
                        company: company || null,
                    },
                    scheduledAt: scheduledAt || null,
                    dryRun,
                    requireConsent,
                    delayMs,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha ao criar");
                return;
            }
            const id = json.data?.campaign?.id as string;
            toast.success(
                dryRun
                    ? "Campanha criada (modo simulação)"
                    : "Campanha criada"
            );
            setWizardOpen(false);
            if (startNow && !scheduledAt) {
                setPendingStartId(id);
                setConfirmOpen(true);
            } else {
                void load();
            }
        } catch {
            toast.error("Erro ao criar campanha");
        } finally {
            setSaving(false);
        }
    };

    const confirmStart = async () => {
        if (!pendingStartId) return;
        setSaving(true);
        try {
            const res = await fetch(
                `/api/channels/datafy/campaigns/${pendingStartId}/start`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ confirm: true }),
                }
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha ao iniciar");
                return;
            }
            toast.success(
                json.data?.campaign?.dryRun
                    ? "Simulação iniciada — nenhum envio real"
                    : "Campanha iniciada"
            );
            setConfirmOpen(false);
            setPendingStartId(null);
            void load();
        } catch {
            toast.error("Erro ao iniciar");
        } finally {
            setSaving(false);
        }
    };

    const action = async (id: string, path: string, label: string) => {
        const res = await fetch(`/api/channels/datafy/campaigns/${id}/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
                path === "start" ? { confirm: true } : {}
            ),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(json.message || `Falha: ${label}`);
            return;
        }
        toast.success(label);
        void load();
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h3 className="text-xl font-bold tracking-tight">
                        Campanhas Oficiais Datafy
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Templates aprovados pela Meta · CRM com consentimento ·
                        fila persistente. Importação TXT/CSV do Baileys permanece
                        na aba WhatsApp conectado.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => void load()}
                    >
                        <RefreshCw className="h-4 w-4 mr-1.5" />
                        Atualizar
                    </Button>
                    <Button className="rounded-xl" onClick={openWizard}>
                        <Plus className="h-4 w-4 mr-1.5" />
                        Nova campanha
                    </Button>
                </div>
            </div>

            {stats && (
                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
                    {[
                        ["Criadas", stats.created],
                        ["Agendadas", stats.scheduled],
                        ["Em andamento", stats.running],
                        ["Concluídas", stats.completed],
                        ["Elegíveis", stats.totalEligible],
                        ["Aceitas", stats.totalAccepted],
                        ["Entregues", stats.totalDelivered],
                        ["Falhas", stats.totalFailed],
                    ].map(([label, value]) => (
                        <div
                            key={String(label)}
                            className="rounded-2xl border bg-card px-3 py-3 shadow-sm"
                        >
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                {label}
                            </p>
                            <p className="text-xl font-semibold mt-1">{value}</p>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-[200px] rounded-xl">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos os status</SelectItem>
                        {Object.entries(STATUS_LABEL).map(([k, v]) => (
                            <SelectItem key={k} value={k}>
                                {v}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Campanha</TableHead>
                            <TableHead className="hidden md:table-cell">
                                Template
                            </TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="hidden lg:table-cell">
                                Progresso
                            </TableHead>
                            <TableHead className="w-[60px]">Ações</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center">
                                    <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                                    Carregando…
                                </TableCell>
                            </TableRow>
                        ) : campaigns.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    colSpan={5}
                                    className="h-24 text-center text-muted-foreground"
                                >
                                    Nenhuma campanha oficial ainda.
                                </TableCell>
                            </TableRow>
                        ) : (
                            campaigns.map((c) => {
                                const done =
                                    c.totals.accepted +
                                    c.totals.failed +
                                    c.totals.skipped +
                                    c.totals.cancelled;
                                const pct = c.totals.eligible
                                    ? Math.min(
                                          100,
                                          Math.round(
                                              (done / c.totals.eligible) * 100
                                          )
                                      )
                                    : 0;
                                return (
                                    <TableRow key={c.id}>
                                        <TableCell>
                                            <p className="font-medium">{c.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {c.totals.eligible} elegíveis
                                                {c.dryRun ? " · simulação" : ""}
                                            </p>
                                        </TableCell>
                                        <TableCell className="hidden md:table-cell text-sm">
                                            {c.templateName || "—"}
                                            {c.templateLanguage
                                                ? ` (${c.templateLanguage})`
                                                : ""}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary">
                                                {STATUS_LABEL[c.status] ||
                                                    c.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="hidden lg:table-cell">
                                            <div className="w-36">
                                                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                                    <div
                                                        className="h-full bg-emerald-600 transition-all"
                                                        style={{
                                                            width: `${pct}%`,
                                                        }}
                                                    />
                                                </div>
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    {c.totals.accepted} aceitas ·{" "}
                                                    {c.totals.failed} falhas
                                                </p>
                                            </div>
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
                                                    {["draft", "scheduled", "paused"].includes(
                                                        c.status
                                                    ) && (
                                                        <DropdownMenuItem
                                                            onClick={() => {
                                                                setPendingStartId(
                                                                    c.id
                                                                );
                                                                setConfirmOpen(
                                                                    true
                                                                );
                                                            }}
                                                        >
                                                            <Play className="h-3.5 w-3.5 mr-2" />
                                                            Iniciar
                                                        </DropdownMenuItem>
                                                    )}
                                                    {["running", "preparing"].includes(
                                                        c.status
                                                    ) && (
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                void action(
                                                                    c.id,
                                                                    "pause",
                                                                    "Pausada"
                                                                )
                                                            }
                                                        >
                                                            <Pause className="h-3.5 w-3.5 mr-2" />
                                                            Pausar
                                                        </DropdownMenuItem>
                                                    )}
                                                    {c.status === "paused" && (
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                void action(
                                                                    c.id,
                                                                    "resume",
                                                                    "Retomada"
                                                                )
                                                            }
                                                        >
                                                            Retomar
                                                        </DropdownMenuItem>
                                                    )}
                                                    {!["completed", "completed_with_errors", "cancelled"].includes(
                                                        c.status
                                                    ) && (
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                void action(
                                                                    c.id,
                                                                    "cancel",
                                                                    "Cancelada"
                                                                )
                                                            }
                                                        >
                                                            <Ban className="h-3.5 w-3.5 mr-2" />
                                                            Cancelar
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onClick={() =>
                                                            void action(
                                                                c.id,
                                                                "duplicate",
                                                                "Duplicada"
                                                            )
                                                        }
                                                    >
                                                        <Copy className="h-3.5 w-3.5 mr-2" />
                                                        Duplicar
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem asChild>
                                                        <a
                                                            href={`/api/channels/datafy/campaigns/${c.id}/export`}
                                                        >
                                                            <Download className="h-3.5 w-3.5 mr-2" />
                                                            Exportar CSV
                                                        </a>
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Wizard */}
            <Dialog open={wizardOpen} onOpenChange={setWizardOpen}>
                <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            Nova campanha · Etapa {step}/5
                        </DialogTitle>
                    </DialogHeader>

                    <div className="flex gap-1 mb-2">
                        {[1, 2, 3, 4, 5].map((n) => (
                            <div
                                key={n}
                                className={cn(
                                    "h-1 flex-1 rounded-full",
                                    n <= step ? "bg-emerald-600" : "bg-muted"
                                )}
                            />
                        ))}
                    </div>

                    {step === 1 && (
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label>Nome *</Label>
                                <Input
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Descrição</Label>
                                <Textarea
                                    value={description}
                                    onChange={(e) =>
                                        setDescription(e.target.value)
                                    }
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Finalidade</Label>
                                <Select
                                    value={purpose}
                                    onValueChange={setPurpose}
                                >
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="marketing">
                                            Marketing
                                        </SelectItem>
                                        <SelectItem value="utility">
                                            Utilidade
                                        </SelectItem>
                                        <SelectItem value="transactional">
                                            Transacional
                                        </SelectItem>
                                        <SelectItem value="other">
                                            Outros
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Canal: WhatsApp Oficial Datafy (compartilhado).
                            </p>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Categoria CRM</Label>
                                    <Select
                                        value={category}
                                        onValueChange={setCategory}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">
                                                Todas
                                            </SelectItem>
                                            {CRM_CATEGORIES.map((c) => (
                                                <SelectItem key={c} value={c}>
                                                    {c}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>UF</Label>
                                    <Input
                                        value={stateUf}
                                        maxLength={2}
                                        onChange={(e) =>
                                            setStateUf(
                                                e.target.value.toUpperCase()
                                            )
                                        }
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Cidade</Label>
                                    <Input
                                        value={city}
                                        onChange={(e) =>
                                            setCity(e.target.value)
                                        }
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Empresa</Label>
                                    <Input
                                        value={company}
                                        onChange={(e) =>
                                            setCompany(e.target.value)
                                        }
                                    />
                                </div>
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={requireConsent}
                                    onChange={(e) =>
                                        setRequireConsent(e.target.checked)
                                    }
                                />
                                Exigir consentimento (obrigatório p/ marketing)
                            </label>
                            <Button
                                variant="outline"
                                onClick={() => void previewAudience()}
                            >
                                Calcular elegíveis
                            </Button>
                            {audience && (
                                <div className="rounded-xl border bg-muted/30 p-3 text-sm">
                                    <p>
                                        Selecionados:{" "}
                                        <strong>{audience.selected}</strong>
                                    </p>
                                    <p>
                                        Elegíveis:{" "}
                                        <strong className="text-emerald-700">
                                            {audience.eligibleCount}
                                        </strong>
                                    </p>
                                    <p>
                                        Excluídos:{" "}
                                        <strong className="text-amber-700">
                                            {audience.excludedCount}
                                        </strong>
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label>Template aprovado *</Label>
                                <Select
                                    value={templateKey}
                                    onValueChange={setTemplateKey}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {templates.map((t) => (
                                            <SelectItem
                                                key={`${t.name}-${t.language}`}
                                                value={`${t.name}::${t.language}`}
                                            >
                                                {t.name} · {t.language}
                                                {t.category
                                                    ? ` · ${t.category}`
                                                    : ""}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>
                                    Variáveis do body (tokens CRM, vírgula)
                                </Label>
                                <Input
                                    value={bodyVars.join(",")}
                                    onChange={(e) =>
                                        setBodyVars(
                                            e.target.value
                                                .split(",")
                                                .map((s) => s.trim())
                                                .filter(Boolean)
                                        )
                                    }
                                    placeholder="fullName, company"
                                />
                                <p className="text-[11px] text-muted-foreground">
                                    Tokens: fullName, company, city, state, waId,
                                    category — ou texto literal.
                                </p>
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label>Agendar (opcional)</Label>
                                <Input
                                    type="datetime-local"
                                    value={scheduledAt}
                                    onChange={(e) =>
                                        setScheduledAt(e.target.value)
                                    }
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Intervalo entre envios (ms)</Label>
                                <Input
                                    type="number"
                                    value={delayMs}
                                    onChange={(e) =>
                                        setDelayMs(Number(e.target.value) || 1200)
                                    }
                                />
                            </div>
                            <label className="flex items-center gap-2 text-sm rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                                <input
                                    type="checkbox"
                                    checked={dryRun}
                                    onChange={(e) =>
                                        setDryRun(e.target.checked)
                                    }
                                />
                                <span>
                                    <FlaskConical className="inline h-3.5 w-3.5 mr-1" />
                                    Modo simulação — não envia mensagens reais
                                </span>
                            </label>
                        </div>
                    )}

                    {step === 5 && (
                        <div className="space-y-2 text-sm rounded-xl border p-4">
                            <p>
                                <strong>{name || "—"}</strong>
                            </p>
                            <p>Finalidade: {purpose}</p>
                            <p>
                                Template:{" "}
                                {selectedTemplate
                                    ? `${selectedTemplate.name} (${selectedTemplate.language})`
                                    : "—"}
                            </p>
                            <p>
                                Elegíveis: {audience?.eligibleCount ?? 0} ·
                                Excluídos: {audience?.excludedCount ?? 0}
                            </p>
                            <p>
                                Execução:{" "}
                                {scheduledAt
                                    ? `Agendada (${scheduledAt})`
                                    : "Após confirmação"}
                            </p>
                            <p
                                className={
                                    dryRun
                                        ? "text-amber-800 font-medium"
                                        : "text-red-700 font-medium"
                                }
                            >
                                {dryRun
                                    ? "SIMULAÇÃO — nenhum envio real"
                                    : "ENVIO REAL via API Datafy"}
                            </p>
                        </div>
                    )}

                    <DialogFooter className="gap-2">
                        {step > 1 && (
                            <Button
                                variant="outline"
                                onClick={() => setStep((s) => s - 1)}
                            >
                                Voltar
                            </Button>
                        )}
                        {step < 5 ? (
                            <Button onClick={() => setStep((s) => s + 1)}>
                                Próximo
                            </Button>
                        ) : (
                            <Button
                                disabled={saving}
                                onClick={() =>
                                    void createAndMaybeStart(!scheduledAt)
                                }
                            >
                                {saving ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : scheduledAt ? (
                                    "Salvar agendada"
                                ) : (
                                    "Criar e confirmar"
                                )}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirmar início da campanha?</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-muted-foreground">
                        Esta ação enfileira os envios. STAFF não pode iniciar —
                        somente OWNER/SUPERADMIN. Use simulação para testes.
                    </p>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setConfirmOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            disabled={saving}
                            onClick={() => void confirmStart()}
                        >
                            {saving ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Confirmar início"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
