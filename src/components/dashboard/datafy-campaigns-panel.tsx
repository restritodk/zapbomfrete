"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
    ImagePlus,
    X,
    Smile,
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
import {
    BroadcastProgressModal,
    type BroadcastRecipientRow,
} from "@/components/dashboard/broadcast-progress-modal";
import { CRM_CATEGORIES } from "@/modules/crm/constants";
import { formatPhoneDisplay } from "@/lib/phone-br";
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
    templateApprovalStatus?: string | null;
    messageBody?: string | null;
    headerImageUrl?: string | null;
    dryRun: boolean;
    scheduledAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    delayMs: number;
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

type CrmLite = {
    id: string;
    waId: string;
    fullName: string | null;
    company: string | null;
    city: string | null;
    state: string | null;
    consentStatus: string;
};

type Tag = { id: string; name: string; colorHex: string };

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

const EMOJIS = ["👋", "✅", "🚚", "📦", "⭐", "🔥", "💪", "📍", "⏰", "🎉"];

function mapRecipientStatus(s: string): BroadcastRecipientRow["status"] {
    if (s === "sending") return "sending";
    if (["accepted", "sent", "delivered", "read"].includes(s)) return "sent";
    if (["failed", "unknown_after_send", "skipped"].includes(s)) return "failed";
    if (s === "cancelled") return "cancelled";
    return "waiting";
}

function recipientDetail(s: string, skip?: string | null, err?: string | null) {
    if (s === "accepted" || s === "sent") return "Aceita pela API (ainda não confirma entrega)";
    if (s === "delivered") return "Entregue no WhatsApp";
    if (s === "read") return "Lida";
    if (s === "skipped") return skip || "Excluído";
    if (s === "failed" || s === "unknown_after_send") return err || "Falha";
    if (s === "cancelled") return "Cancelado";
    if (s === "sending") return "Enviando…";
    return "Na fila";
}

export function DatafyCampaignsPanel() {
    const [stats, setStats] = useState<Stats | null>(null);
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState("all");
    const [wizardOpen, setWizardOpen] = useState(false);
    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);

    // Wizard state
    const [name, setName] = useState("");
    const [purpose, setPurpose] = useState("marketing");
    const [messageBody, setMessageBody] = useState(
        "Olá, {{fullName}}! Tudo bem? Aqui é a equipe Bom Frete."
    );
    const [contentMode, setContentMode] = useState<"existing" | "custom">(
        "existing"
    );
    const [templates, setTemplates] = useState<Template[]>([]);
    const [templateKey, setTemplateKey] = useState("");
    const [bodyVars, setBodyVars] = useState<string[]>(["fullName"]);
    const [headerImageUrl, setHeaderImageUrl] = useState<string | null>(null);
    const [headerImageHandle, setHeaderImageHandle] = useState<string | null>(
        null
    );
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const imageInputRef = useRef<HTMLInputElement>(null);

    const [audienceMode, setAudienceMode] = useState<"all" | "manual">("all");
    const [showGeoFilters, setShowGeoFilters] = useState(false);
    const [category, setCategory] = useState<string>("all");
    const [tagId, setTagId] = useState<string>("all");
    const [city, setCity] = useState("");
    const [stateUf, setStateUf] = useState("");
    const [company, setCompany] = useState("");
    const [contactSearch, setContactSearch] = useState("");
    const [crmRows, setCrmRows] = useState<CrmLite[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [tags, setTags] = useState<Tag[]>([]);
    const [requireConsent, setRequireConsent] = useState(true);
    const [audience, setAudience] = useState<{
        selected: number;
        eligibleCount: number;
        excludedCount: number;
    } | null>(null);

    const [execMode, setExecMode] = useState<"now" | "schedule">("now");
    const [scheduledAt, setScheduledAt] = useState("");
    const [dryRun, setDryRun] = useState(true);
    const [delayMs, setDelayMs] = useState(1200);
    const [submittedTemplate, setSubmittedTemplate] = useState<{
        templateName: string;
        approvalStatus: string;
        bodyTokens: string[];
    } | null>(null);

    // Progress animation (reuses Baileys BroadcastProgressModal)
    const [progressOpen, setProgressOpen] = useState(false);
    const [progressCampaignId, setProgressCampaignId] = useState<string | null>(
        null
    );
    const [progressName, setProgressName] = useState("");
    const [progressPhase, setProgressPhase] = useState<
        "running" | "completed" | "cancelled"
    >("running");
    const [progressRows, setProgressRows] = useState<BroadcastRecipientRow[]>(
        []
    );
    const [progressStartedAt, setProgressStartedAt] = useState<string | null>(
        null
    );
    const [progressCompletedAt, setProgressCompletedAt] = useState<
        string | null
    >(null);
    const [progressCounters, setProgressCounters] = useState<{
        accepted: number;
        delivered: number;
        read: number;
        failed: number;
        dryRun?: boolean;
    } | null>(null);
    const [cancelling, setCancelling] = useState(false);

    const selectedTemplate = templates.find(
        (t) => `${t.name}::${t.language}` === templateKey
    );

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: "40" });
            if (statusFilter !== "all") params.set("status", statusFilter);
            const [sRes, cRes] = await Promise.all([
                fetch("/api/channels/datafy/campaigns/stats"),
                fetch(`/api/channels/datafy/campaigns?${params}`),
            ]);
            const sJson = await sRes.json().catch(() => ({}));
            const cJson = await cRes.json().catch(() => ({}));
            if (sRes.ok) setStats(sJson.data?.stats || null);
            if (cRes.ok) setCampaigns(cJson.data?.campaigns || []);
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

    const pollProgress = useCallback(async (id: string) => {
        const [cRes, rRes] = await Promise.all([
            fetch(`/api/channels/datafy/campaigns/${id}`),
            fetch(
                `/api/channels/datafy/campaigns/${id}/recipients?limit=200`
            ),
        ]);
        const cJson = await cRes.json().catch(() => ({}));
        const rJson = await rRes.json().catch(() => ({}));
        if (!cRes.ok) return;
        const camp = cJson.data?.campaign as Campaign;
        const recipients = (rJson.data?.recipients || []) as Array<{
            id: string;
            waId: string;
            fullName: string | null;
            status: string;
            skipReason: string | null;
            lastError: string | null;
            acceptedAt: string | null;
            deliveredAt: string | null;
            failedAt: string | null;
        }>;

        setProgressName(camp.name);
        setProgressStartedAt(camp.startedAt);
        setProgressCompletedAt(camp.completedAt);
        setProgressCounters({
            accepted: camp.totals.accepted,
            delivered: camp.totals.delivered,
            read: camp.totals.read,
            failed: camp.totals.failed,
            dryRun: camp.dryRun,
        });
        setProgressRows(
            recipients
                .filter((r) => r.status !== "skipped")
                .map((r) => ({
                    id: r.id,
                    jid: r.waId,
                    display:
                        r.fullName ||
                        formatPhoneDisplay(r.waId) ||
                        r.waId,
                    status: mapRecipientStatus(r.status),
                    at:
                        r.deliveredAt ||
                        r.acceptedAt ||
                        r.failedAt ||
                        null,
                    detail: recipientDetail(
                        r.status,
                        r.skipReason,
                        r.lastError
                    ),
                }))
        );

        if (["completed", "completed_with_errors"].includes(camp.status)) {
            setProgressPhase("completed");
        } else if (camp.status === "cancelled") {
            setProgressPhase("cancelled");
        } else if (
            ["running", "preparing", "paused"].includes(camp.status)
        ) {
            setProgressPhase("running");
        }
    }, []);

    useEffect(() => {
        if (!progressOpen || !progressCampaignId) return;
        void pollProgress(progressCampaignId);
        const t = setInterval(
            () => void pollProgress(progressCampaignId),
            2500
        );
        return () => clearInterval(t);
    }, [progressOpen, progressCampaignId, pollProgress]);

    const loadTemplates = async () => {
        const res = await fetch(
            "/api/integrations/datafy/templates?status=APPROVED&limit=80"
        );
        const json = await res.json().catch(() => ({}));
        if (res.ok) setTemplates(json.data?.data || json.data || []);
    };

    const loadCrmAndTags = async () => {
        const [cRes, tRes] = await Promise.all([
            fetch("/api/crm/contacts?limit=100&active=true"),
            fetch("/api/crm/tags"),
        ]);
        const cJson = await cRes.json().catch(() => ({}));
        const tJson = await tRes.json().catch(() => ({}));
        if (cRes.ok) setCrmRows(cJson.data?.contacts || []);
        if (tRes.ok) setTags(tJson.data?.tags || []);
    };

    const segmentFilter = useMemo(() => {
        if (audienceMode === "manual" && selectedIds.size) {
            return { contactIds: Array.from(selectedIds) };
        }
        return {
            selectAllEligible: true,
            category: category === "all" ? null : category,
            tagIds: tagId === "all" ? undefined : [tagId],
            city: showGeoFilters && city ? city : null,
            state: showGeoFilters && stateUf ? stateUf : null,
            company: showGeoFilters && company ? company : null,
            search: contactSearch || null,
        };
    }, [
        audienceMode,
        selectedIds,
        category,
        tagId,
        showGeoFilters,
        city,
        stateUf,
        company,
        contactSearch,
    ]);

    const previewAudience = async () => {
        const res = await fetch("/api/channels/datafy/campaigns/preview", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                purpose,
                requireConsent,
                segmentFilter,
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
        setPurpose("marketing");
        setMessageBody(
            "Olá, {{fullName}}! Tudo bem? Aqui é a equipe Bom Frete."
        );
        setContentMode("existing");
        setTemplateKey("");
        setBodyVars(["fullName"]);
        setHeaderImageUrl(null);
        setHeaderImageHandle(null);
        setImagePreview(null);
        setAudienceMode("all");
        setShowGeoFilters(false);
        setCategory("all");
        setTagId("all");
        setCity("");
        setStateUf("");
        setCompany("");
        setContactSearch("");
        setSelectedIds(new Set());
        setAudience(null);
        setExecMode("now");
        setScheduledAt("");
        setDryRun(true);
        setSubmittedTemplate(null);
        setWizardOpen(true);
        void loadTemplates();
        void loadCrmAndTags();
    };

    const insertToken = (token: string) => {
        setMessageBody((prev) => `${prev}{{${token}}}`);
    };

    const insertEmoji = (e: string) => {
        setMessageBody((prev) => `${prev}${e}`);
    };

    const onPickImage = async (file: File | null) => {
        if (!file) return;
        setUploadingImage(true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const res = await fetch("/api/channels/datafy/campaigns/media", {
                method: "POST",
                body: fd,
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha no upload");
                return;
            }
            setHeaderImageUrl(json.data.url);
            setHeaderImageHandle(json.data.handle || null);
            setImagePreview(json.data.url);
            if (!json.data.handle) {
                toast.message(
                    "Imagem salva. Handle Meta indisponível no ambiente local — no envio usaremos o link público."
                );
            } else {
                toast.success("Imagem anexada");
            }
        } catch {
            toast.error("Erro ao enviar imagem");
        } finally {
            setUploadingImage(false);
            if (imageInputRef.current) imageInputRef.current.value = "";
        }
    };

    const submitCustomTemplate = async (): Promise<{
        templateName: string;
        approvalStatus: string;
        bodyTokens: string[];
    } | null> => {
        if (!messageBody.trim()) {
            toast.error("Escreva o texto da mensagem");
            return null;
        }
        setSaving(true);
        try {
            const res = await fetch(
                "/api/channels/datafy/campaigns/submit-template",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: name || `campanha_${Date.now()}`,
                        language: "pt_BR",
                        category:
                            purpose === "utility" ? "UTILITY" : "MARKETING",
                        bodyText: messageBody,
                        headerImageHandle: headerImageHandle,
                    }),
                }
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha ao submeter template");
                return null;
            }
            const payload = {
                templateName: json.data.templateName as string,
                approvalStatus: String(json.data.approvalStatus || "PENDING"),
                bodyTokens: (json.data.bodyTokens || []) as string[],
            };
            setSubmittedTemplate(payload);
            setBodyVars(payload.bodyTokens.length ? payload.bodyTokens : []);
            toast.success(
                "Mensagem enviada para aprovação da Meta. Envio real só após APPROVED."
            );
            return payload;
        } catch {
            toast.error("Erro ao submeter template");
            return null;
        } finally {
            setSaving(false);
        }
    };

    const openProgress = (id: string, campaignName: string) => {
        setProgressCampaignId(id);
        setProgressName(campaignName);
        setProgressPhase("running");
        setProgressRows([]);
        setProgressStartedAt(new Date().toISOString());
        setProgressCompletedAt(null);
        setProgressCounters(null);
        setProgressOpen(true);
    };

    const createCampaign = async () => {
        if (!name.trim()) {
            toast.error("Informe o nome");
            return;
        }
        if (!audience || audience.eligibleCount <= 0) {
            toast.error("Calcule a audiência com destinatários elegíveis");
            return;
        }

        let templateName = selectedTemplate?.name || null;
        let templateLanguage = selectedTemplate?.language || "pt_BR";
        let templateCategory = selectedTemplate?.category || null;
        let templateApprovalStatus = selectedTemplate?.status || "APPROVED";
        let contentSource = "existing_template";
        let vars = bodyVars;

        if (contentMode === "custom") {
            const custom =
                submittedTemplate || (await submitCustomTemplate());
            if (!custom?.templateName) {
                toast.error(
                    "Submeta o template personalizado antes de continuar"
                );
                return;
            }
            templateName = custom.templateName;
            templateLanguage = "pt_BR";
            templateCategory =
                purpose === "utility" ? "UTILITY" : "MARKETING";
            templateApprovalStatus = custom.approvalStatus || "PENDING";
            contentSource = "custom_submitted";
            vars = custom.bodyTokens.length ? custom.bodyTokens : bodyVars;
        } else if (
            !selectedTemplate ||
            selectedTemplate.status !== "APPROVED"
        ) {
            toast.error("Selecione um template APPROVED");
            return;
        }

        if (
            execMode === "now" &&
            !dryRun &&
            templateApprovalStatus !== "APPROVED"
        ) {
            toast.error(
                "Envio real bloqueado: template ainda não aprovado. Use simulação ou agende após aprovação."
            );
            return;
        }

        if (execMode === "schedule" && !scheduledAt) {
            toast.error("Informe data e horário");
            return;
        }

        setSaving(true);
        try {
            const res = await fetch("/api/channels/datafy/campaigns", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: name.trim(),
                    purpose,
                    templateName,
                    templateLanguage,
                    templateCategory,
                    templateComponents: selectedTemplate?.components || null,
                    templateApprovalStatus,
                    contentSource,
                    messageBody,
                    headerImageUrl,
                    headerImageHandle,
                    variableMapping: { body: vars },
                    segmentFilter,
                    scheduledAt:
                        execMode === "schedule" ? scheduledAt : null,
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
            const camp = json.data.campaign as Campaign;
            setWizardOpen(false);

            if (execMode === "schedule") {
                toast.success(
                    `Campanha agendada para ${new Date(scheduledAt).toLocaleString("pt-BR")}`
                );
                void load();
                return;
            }

            // Disparar agora — confirmação implícita na etapa 5 + start
            const startRes = await fetch(
                `/api/channels/datafy/campaigns/${camp.id}/start`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ confirm: true, dryRun }),
                }
            );
            const startJson = await startRes.json().catch(() => ({}));
            if (!startRes.ok) {
                toast.error(startJson.message || "Falha ao iniciar");
                void load();
                return;
            }
            toast.success(
                dryRun ? "Simulação iniciada" : "Campanha iniciada"
            );
            openProgress(camp.id, camp.name);
            void load();
        } catch {
            toast.error("Erro ao criar campanha");
        } finally {
            setSaving(false);
        }
    };

    const action = async (id: string, path: string, label: string) => {
        const res = await fetch(`/api/channels/datafy/campaigns/${id}/${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(path === "start" ? { confirm: true } : {}),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(json.message || `Falha: ${label}`);
            return;
        }
        toast.success(label);
        if (path === "start") {
            const camp = json.data?.campaign as Campaign;
            openProgress(id, camp?.name || "Campanha");
        }
        void load();
    };

    const finalButtonLabel = dryRun
        ? "Executar simulação"
        : execMode === "schedule"
          ? "Salvar agendamento"
          : "Disparar agora";

    const previewText = useMemo(() => {
        return messageBody
            .replace(/\{\{fullName\}\}/gi, "Maria Silva")
            .replace(/\{\{company\}\}/gi, "Transportadora Exemplo")
            .replace(/\{\{city\}\}/gi, "Curitiba")
            .replace(/\{\{state\}\}/gi, "PR")
            .replace(/\{\{waId\}\}/gi, "5541999999999")
            .replace(/\{\{category\}\}/gi, "Motorista");
    }, [messageBody]);

    const filteredCrm = crmRows.filter((c) => {
        if (!contactSearch.trim()) return true;
        const q = contactSearch.toLowerCase();
        return (
            (c.fullName || "").toLowerCase().includes(q) ||
            c.waId.includes(q.replace(/\D/g, ""))
        );
    });

    return (
        <div className="space-y-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h3 className="text-xl font-bold tracking-tight">
                        Campanhas Oficiais Datafy
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        Crie o texto, anexe imagem se quiser e selecione
                        contatos de qualquer região do Brasil. Envios usam
                        templates aprovados pela Meta.
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
                                    c.totals.cancelled;
                                const pct = c.totals.eligible
                                    ? Math.min(
                                          100,
                                          Math.round(
                                              (done / Math.max(1, c.totals.eligible)) *
                                                  100
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
                                                            width: `${
                                                                ["completed", "completed_with_errors"].includes(
                                                                    c.status
                                                                )
                                                                    ? 100
                                                                    : pct
                                                            }%`,
                                                        }}
                                                    />
                                                </div>
                                                <p className="text-[10px] text-muted-foreground mt-1">
                                                    {c.totals.accepted} aceitas ·{" "}
                                                    {c.totals.delivered}{" "}
                                                    entregues · {c.totals.failed}{" "}
                                                    falhas
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
                                                    {["running", "preparing", "paused"].includes(
                                                        c.status
                                                    ) && (
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                openProgress(
                                                                    c.id,
                                                                    c.name
                                                                )
                                                            }
                                                        >
                                                            Ver animação / progresso
                                                        </DropdownMenuItem>
                                                    )}
                                                    {["draft", "scheduled", "paused"].includes(
                                                        c.status
                                                    ) && (
                                                        <DropdownMenuItem
                                                            onClick={() =>
                                                                void action(
                                                                    c.id,
                                                                    "start",
                                                                    "Iniciada"
                                                                )
                                                            }
                                                        >
                                                            <Play className="h-3.5 w-3.5 mr-2" />
                                                            Disparar agora
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
                <DialogContent className="w-[min(920px,calc(100%-1rem))] max-w-none max-h-[92vh] overflow-y-auto rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>
                            Nova campanha · Etapa {step}/5
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex gap-1 mb-3">
                        {[1, 2, 3, 4, 5].map((n) => (
                            <div
                                key={n}
                                className={cn(
                                    "h-1.5 flex-1 rounded-full",
                                    n <= step ? "bg-emerald-600" : "bg-muted"
                                )}
                            />
                        ))}
                    </div>

                    {step === 1 && (
                        <div className="grid gap-4 lg:grid-cols-2">
                            <div className="space-y-3">
                                <div className="space-y-1.5">
                                    <Label>Nome da campanha *</Label>
                                    <Input
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                        placeholder="Ex.: Aviso fretes Sul"
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
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1.5">
                                    <Label>Mensagem *</Label>
                                    <Textarea
                                        value={messageBody}
                                        onChange={(e) =>
                                            setMessageBody(e.target.value)
                                        }
                                        className="min-h-[180px] text-base leading-relaxed"
                                        placeholder="Escreva sua mensagem…"
                                    />
                                    <div className="flex flex-wrap gap-1.5">
                                        {[
                                            "fullName",
                                            "company",
                                            "city",
                                            "state",
                                        ].map((t) => (
                                            <Button
                                                key={t}
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-7 text-xs"
                                                onClick={() => insertToken(t)}
                                            >
                                                {`{{${t}}}`}
                                            </Button>
                                        ))}
                                        <span className="inline-flex items-center gap-1 ml-1 text-muted-foreground">
                                            <Smile className="h-3.5 w-3.5" />
                                            {EMOJIS.map((e) => (
                                                <button
                                                    key={e}
                                                    type="button"
                                                    className="hover:scale-110 transition"
                                                    onClick={() =>
                                                        insertEmoji(e)
                                                    }
                                                >
                                                    {e}
                                                </button>
                                            ))}
                                        </span>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label>Imagem opcional (cabeçalho)</Label>
                                    <input
                                        ref={imageInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        className="hidden"
                                        onChange={(e) =>
                                            void onPickImage(
                                                e.target.files?.[0] || null
                                            )
                                        }
                                    />
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="rounded-xl"
                                            disabled={uploadingImage}
                                            onClick={() =>
                                                imageInputRef.current?.click()
                                            }
                                        >
                                            {uploadingImage ? (
                                                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                            ) : (
                                                <ImagePlus className="h-4 w-4 mr-1.5" />
                                            )}
                                            {imagePreview
                                                ? "Trocar imagem"
                                                : "Anexar imagem"}
                                        </Button>
                                        {imagePreview && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                onClick={() => {
                                                    setImagePreview(null);
                                                    setHeaderImageUrl(null);
                                                    setHeaderImageHandle(null);
                                                }}
                                            >
                                                <X className="h-4 w-4 mr-1" />
                                                Remover
                                            </Button>
                                        )}
                                    </div>
                                    {imagePreview && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={imagePreview}
                                            alt="Prévia"
                                            className="mt-2 max-h-40 rounded-xl border object-cover"
                                        />
                                    )}
                                    <p className="text-[11px] text-muted-foreground">
                                        JPEG/PNG/WebP até 5 MB. Campanhas só com
                                        texto também são válidas.
                                    </p>
                                </div>
                            </div>
                            <div className="rounded-2xl bg-[#0b141a] p-4 text-white min-h-[280px]">
                                <p className="text-[11px] uppercase tracking-wider text-white/50 mb-3">
                                    Prévia WhatsApp
                                </p>
                                <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-[#005c4b] px-3 py-2 text-sm shadow">
                                    {imagePreview && (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                            src={imagePreview}
                                            alt=""
                                            className="mb-2 w-full rounded-lg object-cover max-h-36"
                                        />
                                    )}
                                    <p className="whitespace-pre-wrap leading-relaxed">
                                        {previewText}
                                    </p>
                                    <p className="text-[10px] text-white/60 text-right mt-1">
                                        12:00
                                    </p>
                                </div>
                                <p className="mt-4 text-xs text-white/50 leading-relaxed">
                                    No WhatsApp oficial, campanhas iniciadas pela
                                    empresa usam templates aprovados pela Meta.
                                    Se você criar um texto novo, ele será
                                    submetido para aprovação antes do envio real.
                                </p>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant={
                                        audienceMode === "all"
                                            ? "default"
                                            : "outline"
                                    }
                                    className="rounded-xl"
                                    onClick={() => setAudienceMode("all")}
                                >
                                    Todos elegíveis (Brasil)
                                </Button>
                                <Button
                                    type="button"
                                    variant={
                                        audienceMode === "manual"
                                            ? "default"
                                            : "outline"
                                    }
                                    className="rounded-xl"
                                    onClick={() => setAudienceMode("manual")}
                                >
                                    Seleção manual
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="rounded-xl"
                                    onClick={() =>
                                        setShowGeoFilters((v) => !v)
                                    }
                                >
                                    Filtros opcionais
                                </Button>
                            </div>

                            <div className="grid sm:grid-cols-2 gap-3">
                                <div className="space-y-1.5">
                                    <Label>Categoria (opcional)</Label>
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
                                    <Label>Etiqueta (opcional)</Label>
                                    <Select
                                        value={tagId}
                                        onValueChange={setTagId}
                                    >
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">
                                                Todas
                                            </SelectItem>
                                            {tags.map((t) => (
                                                <SelectItem
                                                    key={t.id}
                                                    value={t.id}
                                                >
                                                    {t.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {showGeoFilters && (
                                <div className="grid sm:grid-cols-3 gap-3 rounded-xl border bg-muted/20 p-3">
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
                                        <Label>Empresa</Label>
                                        <Input
                                            value={company}
                                            onChange={(e) =>
                                                setCompany(e.target.value)
                                            }
                                        />
                                    </div>
                                    <p className="sm:col-span-3 text-[11px] text-muted-foreground">
                                        Filtros geográficos são opcionais —
                                        contatos de vários estados podem entrar
                                        na mesma campanha.
                                    </p>
                                </div>
                            )}

                            {audienceMode === "manual" && (
                                <div className="space-y-2">
                                    <Input
                                        placeholder="Buscar nome ou telefone…"
                                        value={contactSearch}
                                        onChange={(e) =>
                                            setContactSearch(e.target.value)
                                        }
                                    />
                                    <div className="max-h-48 overflow-y-auto rounded-xl border divide-y">
                                        {filteredCrm.map((c) => {
                                            const checked = selectedIds.has(
                                                c.id
                                            );
                                            return (
                                                <label
                                                    key={c.id}
                                                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 cursor-pointer"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={checked}
                                                        onChange={() => {
                                                            setSelectedIds(
                                                                (prev) => {
                                                                    const next =
                                                                        new Set(
                                                                            prev
                                                                        );
                                                                    if (
                                                                        next.has(
                                                                            c.id
                                                                        )
                                                                    )
                                                                        next.delete(
                                                                            c.id
                                                                        );
                                                                    else
                                                                        next.add(
                                                                            c.id
                                                                        );
                                                                    return next;
                                                                }
                                                            );
                                                        }}
                                                    />
                                                    <span className="flex-1 truncate">
                                                        {c.fullName ||
                                                            "Sem nome"}
                                                        <span className="text-muted-foreground text-xs ml-2">
                                                            {formatPhoneDisplay(
                                                                c.waId
                                                            ) || c.waId}
                                                            {c.state
                                                                ? ` · ${c.state}`
                                                                : ""}
                                                        </span>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {selectedIds.size} selecionado(s)
                                    </p>
                                </div>
                            )}

                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={requireConsent}
                                    onChange={(e) =>
                                        setRequireConsent(e.target.checked)
                                    }
                                />
                                Exigir consentimento (recomendado para marketing)
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
                                        Excluídos (consentimento/duplicados):{" "}
                                        <strong className="text-amber-700">
                                            {audience.excludedCount}
                                        </strong>
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-4">
                            <div className="flex gap-2">
                                <Button
                                    type="button"
                                    variant={
                                        contentMode === "existing"
                                            ? "default"
                                            : "outline"
                                    }
                                    className="rounded-xl"
                                    onClick={() => setContentMode("existing")}
                                >
                                    Usar template aprovado
                                </Button>
                                <Button
                                    type="button"
                                    variant={
                                        contentMode === "custom"
                                            ? "default"
                                            : "outline"
                                    }
                                    className="rounded-xl"
                                    onClick={() => setContentMode("custom")}
                                >
                                    Submeter texto como template
                                </Button>
                            </div>

                            {contentMode === "existing" ? (
                                <div className="space-y-3">
                                    <Label>Template APPROVED *</Label>
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
                                    <div className="space-y-1.5">
                                        <Label>
                                            Variáveis do body (tokens CRM)
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
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm">
                                    <p>
                                        Seu texto da etapa 1 será enviado à Meta
                                        como template{" "}
                                        <strong>
                                            {purpose === "utility"
                                                ? "UTILITY"
                                                : "MARKETING"}
                                        </strong>
                                        . Enquanto estiver{" "}
                                        <strong>PENDING</strong>, só a simulação
                                        pode rodar; o envio real exige{" "}
                                        <strong>APPROVED</strong>.
                                    </p>
                                    {headerImageUrl && !headerImageHandle && (
                                        <p className="text-amber-900">
                                            Imagem sem handle Meta — a criação do
                                            template com HEADER IMAGE pode falhar
                                            até a URL ser pública na internet.
                                        </p>
                                    )}
                                    <Button
                                        type="button"
                                        disabled={saving}
                                        onClick={() =>
                                            void submitCustomTemplate()
                                        }
                                    >
                                        {saving ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            "Enviar para aprovação da Meta"
                                        )}
                                    </Button>
                                    {submittedTemplate && (
                                        <p className="text-emerald-800">
                                            Template{" "}
                                            <code>
                                                {submittedTemplate.templateName}
                                            </code>{" "}
                                            · status{" "}
                                            {submittedTemplate.approvalStatus}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {step === 4 && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant={
                                        execMode === "now"
                                            ? "default"
                                            : "outline"
                                    }
                                    className="rounded-xl"
                                    onClick={() => setExecMode("now")}
                                >
                                    Disparar agora
                                </Button>
                                <Button
                                    type="button"
                                    variant={
                                        execMode === "schedule"
                                            ? "default"
                                            : "outline"
                                    }
                                    className="rounded-xl"
                                    onClick={() => setExecMode("schedule")}
                                >
                                    Agendar
                                </Button>
                            </div>
                            {execMode === "schedule" && (
                                <div className="space-y-1.5">
                                    <Label>Data e horário</Label>
                                    <Input
                                        type="datetime-local"
                                        value={scheduledAt}
                                        onChange={(e) =>
                                            setScheduledAt(e.target.value)
                                        }
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Agendamento não abre a animação de
                                        disparo — o worker processa no horário.
                                    </p>
                                </div>
                            )}
                            <div className="space-y-1.5">
                                <Label>Intervalo entre envios (ms)</Label>
                                <Input
                                    type="number"
                                    value={delayMs}
                                    onChange={(e) =>
                                        setDelayMs(
                                            Number(e.target.value) || 1200
                                        )
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
                        <div className="space-y-3 text-sm rounded-2xl border p-4">
                            <p className="text-lg font-semibold">
                                {name || "—"}
                            </p>
                            <p>Finalidade: {purpose}</p>
                            <p>
                                Conteúdo:{" "}
                                {contentMode === "existing"
                                    ? `Template ${selectedTemplate?.name || "—"} (${selectedTemplate?.language || ""})`
                                    : `Personalizado → ${submittedTemplate?.templateName || "(submeter na etapa 3)"}`}
                            </p>
                            <div className="rounded-xl bg-[#0b141a] p-3 text-white max-w-sm">
                                {imagePreview && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={imagePreview}
                                        alt=""
                                        className="mb-2 w-full rounded-lg max-h-28 object-cover"
                                    />
                                )}
                                <p className="whitespace-pre-wrap text-sm">
                                    {previewText}
                                </p>
                            </div>
                            <p>
                                Elegíveis:{" "}
                                <strong>{audience?.eligibleCount ?? 0}</strong> ·
                                Excluídos:{" "}
                                <strong>{audience?.excludedCount ?? 0}</strong>
                            </p>
                            <p>
                                Execução:{" "}
                                {execMode === "schedule"
                                    ? `Agendada (${scheduledAt || "—"})`
                                    : "Imediata — com animação de disparo"}
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
                            {!dryRun &&
                                contentMode === "custom" &&
                                submittedTemplate?.approvalStatus !==
                                    "APPROVED" && (
                                    <p className="text-red-700">
                                        Aviso: template ainda não APPROVED —
                                        o início real será bloqueado.
                                    </p>
                                )}
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
                            <Button
                                onClick={() => {
                                    if (
                                        step === 2 &&
                                        (!audience ||
                                            audience.eligibleCount <= 0)
                                    ) {
                                        toast.error(
                                            "Calcule a audiência com elegíveis antes de continuar"
                                        );
                                        return;
                                    }
                                    setStep((s) => s + 1);
                                }}
                            >
                                Próximo
                            </Button>
                        ) : (
                            <Button
                                disabled={saving}
                                onClick={() => void createCampaign()}
                                className={cn(
                                    !dryRun &&
                                        execMode === "now" &&
                                        "bg-emerald-600 hover:bg-emerald-700"
                                )}
                            >
                                {saving ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    finalButtonLabel
                                )}
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <BroadcastProgressModal
                open={progressOpen}
                onOpenChange={setProgressOpen}
                phase={progressPhase}
                recipients={progressRows}
                startedAt={progressStartedAt}
                completedAt={progressCompletedAt}
                delayMs={delayMs}
                allowDismissWhileRunning
                subtitle={progressName}
                datafyCounters={progressCounters}
                cancelling={cancelling}
                onCancelBroadcast={
                    progressCampaignId
                        ? async () => {
                              setCancelling(true);
                              try {
                                  await action(
                                      progressCampaignId,
                                      "cancel",
                                      "Cancelada"
                                  );
                                  setProgressPhase("cancelled");
                              } finally {
                                  setCancelling(false);
                              }
                          }
                        : undefined
                }
                onViewHistory={() => {
                    setProgressOpen(false);
                    setStatusFilter("all");
                    void load();
                }}
            />
        </div>
    );
}
