"use client";

import {
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
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
    Upload,
    Users,
    Contact,
    FileText,
    Trash2,
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    ChevronLeft,
    ChevronRight,
} from "lucide-react";
import { useSession } from "@/components/dashboard/session-provider";
import {
    analyzeBulletin,
    associatePartsWithTemplates,
    estimateMessageTotal,
    META_TEMPLATE_BODY_MAX,
    type BulletinAnalysis,
    type CampaignMessagePart,
} from "@/modules/datafy/campaigns/bulletin";
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
import {
    EXCLUSION_REASON_ORDER,
    skipReasonLabel,
} from "@/modules/datafy/campaigns/eligibility";
import {
    extractPhonesFromParticipants,
    formatPhoneDisplay,
    parsePhoneList,
} from "@/lib/phone-br";
import { cn } from "@/lib/utils";

type AudienceResult = {
    selected: number;
    eligibleCount: number;
    excludedCount: number;
    exclusionBreakdown?: Record<string, number>;
    simulationEligibleCount?: number;
    excludedPreview?: Array<{
        contactId: string;
        waId: string;
        fullName: string | null;
        reason: string;
    }>;
};

type RecipientSource = "import" | "crm" | "groups";
type GroupItem = {
    jid: string;
    subject?: string | null;
    participants?: unknown;
};

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

const WIZARD_STEPS = [
    { n: 1, title: "Informações e mensagem", short: "Mensagem" },
    { n: 2, title: "Seleção de destinatários", short: "Destinatários" },
    { n: 3, title: "Template e aprovação", short: "Template" },
    { n: 4, title: "Programação", short: "Programação" },
    { n: 5, title: "Revisão e confirmação", short: "Revisão" },
] as const;

function WhatsAppMessagePreview({
    previewText,
    imagePreview,
    compact,
    partLabel,
    partIndex,
    partCount,
    onPrevPart,
    onNextPart,
    warnings,
}: {
    previewText: string;
    imagePreview: string | null;
    compact?: boolean;
    partLabel?: string | null;
    partIndex?: number;
    partCount?: number;
    onPrevPart?: () => void;
    onNextPart?: () => void;
    warnings?: string[];
}) {
    const multi = (partCount || 0) > 1;
    return (
        <div
            className={cn(
                "flex flex-col rounded-[18px] border border-slate-200/80 overflow-hidden",
                "bg-gradient-to-b from-slate-50 to-[#e8eef2]",
                compact ? "min-h-[200px]" : "min-h-[280px] h-full"
            )}
        >
            <div className="shrink-0 flex items-center gap-2.5 px-3.5 py-2.5 bg-[#075e54] text-white">
                <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center text-xs font-semibold">
                    BF
                </div>
                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold truncate leading-tight">
                        Bom Frete
                    </p>
                    <p className="text-[10px] text-white/70 leading-tight truncate">
                        {partLabel || "WhatsApp Business · prévia"}
                    </p>
                </div>
            </div>
            {multi && (
                <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 bg-white/80 border-b border-slate-200/80">
                    <button
                        type="button"
                        className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-30"
                        disabled={!onPrevPart || (partIndex || 0) <= 0}
                        onClick={onPrevPart}
                        aria-label="Parte anterior"
                    >
                        <ChevronLeft className="h-4 w-4" />
                    </button>
                    <span className="text-xs font-medium text-slate-600 tabular-nums">
                        Parte {(partIndex || 0) + 1} de {partCount}
                    </span>
                    <button
                        type="button"
                        className="rounded-lg p-1.5 hover:bg-slate-100 disabled:opacity-30"
                        disabled={
                            !onNextPart ||
                            (partIndex || 0) >= (partCount || 1) - 1
                        }
                        onClick={onNextPart}
                        aria-label="Próxima parte"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                </div>
            )}
            <div
                className={cn(
                    "flex-1 overflow-y-auto p-3 sm:p-4",
                    "bg-[#e5ddd5]"
                )}
            >
                <div className="max-w-[92%] rounded-xl rounded-tl-sm bg-white shadow-sm overflow-hidden">
                    {imagePreview && (partIndex || 0) === 0 && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                            src={imagePreview}
                            alt=""
                            className="w-full max-h-40 object-cover"
                        />
                    )}
                    <div className="px-3 py-2">
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-800">
                            {previewText || (
                                <span className="text-slate-400 italic">
                                    Sua mensagem aparecerá aqui…
                                </span>
                            )}
                        </p>
                        <p className="text-[10px] text-slate-400 text-right mt-1.5 tabular-nums">
                            12:00
                        </p>
                    </div>
                </div>
                {warnings?.length ? (
                    <ul className="mt-3 space-y-1 text-[10px] text-amber-800">
                        {warnings.slice(0, 4).map((w) => (
                            <li key={w}>⚠ {w}</li>
                        ))}
                    </ul>
                ) : (
                    <p className="mt-3 text-[10px] leading-relaxed text-slate-600/90 px-0.5">
                        Prévia ilustrativa. Envio oficial exige template
                        aprovado pela Meta (limite {META_TEMPLATE_BODY_MAX}{" "}
                        caracteres por parte).
                    </p>
                )}
            </div>
        </div>
    );
}

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
    const { channels } = useSession();
    const baileysConnected = useMemo(
        () =>
            channels.filter(
                (c) =>
                    c.provider === "baileys" &&
                    (c.status || "").toUpperCase() === "CONNECTED"
            ),
        [channels]
    );

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
    /** message = texto comum (Fase 5) · bulletin = boletim de cargas (Fase 6) */
    const [contentKind, setContentKind] = useState<"message" | "bulletin">(
        "message"
    );
    const [bulletinParts, setBulletinParts] = useState<CampaignMessagePart[]>(
        []
    );
    const [bulletinAnalysis, setBulletinAnalysis] =
        useState<BulletinAnalysis | null>(null);
    const [previewPartIndex, setPreviewPartIndex] = useState(0);
    const [submittingPartIndex, setSubmittingPartIndex] = useState<
        number | null
    >(null);
    const deferredBulletinText = useDeferredValue(messageBody);
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
    const [imageFileName, setImageFileName] = useState<string | null>(null);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);
    const imageInputRef = useRef<HTMLInputElement>(null);

    const [recipientSource, setRecipientSource] =
        useState<RecipientSource>("crm");
    const [crmPickMode, setCrmPickMode] = useState<"all" | "manual">("all");
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
    const [audience, setAudience] = useState<AudienceResult | null>(null);
    const [audienceCalculating, setAudienceCalculating] = useState(false);
    const [audienceError, setAudienceError] = useState<string | null>(null);
    const [showExclusionDetails, setShowExclusionDetails] = useState(false);
    /** Continuar com 0 aptos reais — só simulação (dryRun forçado) */
    const [simulationOnlyAudience, setSimulationOnlyAudience] =
        useState(false);

    // Import (TXT/CSV) — same parsePhoneList as Disparo Baileys
    const [importText, setImportText] = useState("");
    const [importPhones, setImportPhones] = useState<string[]>([]);
    const [importStats, setImportStats] = useState<{
        valid: number;
        invalid: number;
        duplicates: number;
    } | null>(null);
    const importFileRef = useRef<HTMLInputElement>(null);

    // Groups via Baileys only (Datafy has no groups API)
    const [groupSessionId, setGroupSessionId] = useState("");
    const [groups, setGroups] = useState<GroupItem[]>([]);
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [selectedGroupJid, setSelectedGroupJid] = useState("");
    const [importingGroup, setImportingGroup] = useState(false);
    const [groupPhones, setGroupPhones] = useState<string[]>([]);

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

    const activePhones =
        recipientSource === "import"
            ? importPhones
            : recipientSource === "groups"
              ? groupPhones
              : [];

    const segmentFilter = useMemo(() => {
        if (recipientSource === "import" || recipientSource === "groups") {
            return {
                source: recipientSource,
                phones: activePhones,
            };
        }
        if (crmPickMode === "manual" && selectedIds.size) {
            return {
                source: "crm" as const,
                contactIds: Array.from(selectedIds),
            };
        }
        return {
            source: "crm" as const,
            selectAllEligible: true,
            category: category === "all" ? null : category,
            tagIds: tagId === "all" ? undefined : [tagId],
            city: showGeoFilters && city ? city : null,
            state: showGeoFilters && stateUf ? stateUf : null,
            company: showGeoFilters && company ? company : null,
            search: contactSearch || null,
        };
    }, [
        recipientSource,
        activePhones,
        crmPickMode,
        selectedIds,
        category,
        tagId,
        showGeoFilters,
        city,
        stateUf,
        company,
        contactSearch,
    ]);

    const applyParsedPhones = (
        phones: string[],
        invalid: string[],
        duplicates: number,
        mode: "replace" | "merge" = "replace"
    ) => {
        setImportPhones((prev) => {
            if (mode === "replace") return phones;
            const seen = new Set(prev);
            const next = [...prev];
            for (const p of phones) {
                if (!seen.has(p)) {
                    seen.add(p);
                    next.push(p);
                }
            }
            return next;
        });
        setImportStats({
            valid: phones.length,
            invalid: invalid.length,
            duplicates,
        });
        invalidateAudience();
    };

    const handleImportFile = async (file: File) => {
        try {
            const text = await file.text();
            const { phones, invalid, duplicates } = parsePhoneList(text);
            setImportText(phones.join("\n"));
            if (!phones.length) {
                setImportStats({
                    valid: 0,
                    invalid: invalid.length,
                    duplicates,
                });
                toast.error("Arquivo sem números válidos do Brasil");
                return;
            }
            applyParsedPhones(phones, invalid, duplicates, "merge");
            toast.success(
                `Importados ${phones.length} número(s)` +
                    (invalid.length ? ` · ${invalid.length} inválido(s)` : "") +
                    (duplicates ? ` · ${duplicates} repetido(s)` : "")
            );
        } catch {
            toast.error("Falha ao ler o arquivo");
        } finally {
            if (importFileRef.current) importFileRef.current.value = "";
        }
    };

    const handleNormalizeImport = () => {
        const { phones, invalid, duplicates } = parsePhoneList(importText);
        setImportText(phones.join("\n"));
        applyParsedPhones(phones, invalid, duplicates, "replace");
        if (!phones.length) {
            toast.error("Nenhum número válido encontrado");
            return;
        }
        toast.success(
            `${phones.length} válido(s)` +
                (invalid.length ? ` · ${invalid.length} inválido(s)` : "") +
                (duplicates ? ` · ${duplicates} repetido(s)` : "")
        );
    };

    const fetchGroups = useCallback(async (sid: string) => {
        if (!sid) {
            setGroups([]);
            return;
        }
        setGroupsLoading(true);
        try {
            const res = await fetch(`/api/groups/${sid}`);
            if (res.ok) {
                const data = await res.json();
                setGroups(data?.data || []);
            } else {
                setGroups([]);
                toast.error("Não foi possível listar grupos desta sessão");
            }
        } catch {
            setGroups([]);
            toast.error("Falha ao carregar grupos");
        } finally {
            setGroupsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (recipientSource !== "groups") return;
        if (!groupSessionId && baileysConnected[0]) {
            setGroupSessionId(baileysConnected[0].id);
        }
    }, [recipientSource, baileysConnected, groupSessionId]);

    useEffect(() => {
        if (recipientSource === "groups" && groupSessionId) {
            void fetchGroups(groupSessionId);
        }
    }, [recipientSource, groupSessionId, fetchGroups]);

    const handleImportGroup = async () => {
        if (!groupSessionId || !selectedGroupJid) {
            toast.error("Selecione sessão Baileys e um grupo");
            return;
        }
        setImportingGroup(true);
        try {
            let participants: unknown[] = [];
            try {
                const liveRes = await fetch(
                    `/api/groups/${groupSessionId}/${encodeURIComponent(selectedGroupJid)}`
                );
                if (liveRes.ok) {
                    const meta = await liveRes.json();
                    participants = meta?.participants || [];
                }
            } catch {
                /* fallback */
            }
            if (!participants.length) {
                const group = groups.find((g) => g.jid === selectedGroupJid);
                participants = (group?.participants as unknown[]) || [];
            }
            const phones = extractPhonesFromParticipants(participants);
            if (!phones.length) {
                toast.error(
                    "Nenhum telefone extraível neste grupo (pode haver só LIDs)"
                );
                return;
            }
            setGroupPhones((prev) => {
                const seen = new Set(prev);
                const next = [...prev];
                for (const p of phones) {
                    if (!seen.has(p)) {
                        seen.add(p);
                        next.push(p);
                    }
                }
                return next;
            });
            invalidateAudience();
            toast.success(
                `${phones.length} número(s) do grupo. Participação em grupo não é consentimento de marketing.`
            );
        } catch {
            toast.error("Falha ao extrair números do grupo");
        } finally {
            setImportingGroup(false);
        }
    };

    const removePhone = (phone: string) => {
        if (recipientSource === "import") {
            setImportPhones((prev) => prev.filter((p) => p !== phone));
            setImportText((prev) =>
                prev
                    .split("\n")
                    .filter((l) => l.trim() !== phone)
                    .join("\n")
            );
        } else {
            setGroupPhones((prev) => prev.filter((p) => p !== phone));
        }
        invalidateAudience();
    };

    const invalidateAudience = () => {
        setAudience(null);
        setAudienceError(null);
        setSimulationOnlyAudience(false);
        setShowExclusionDetails(false);
    };

    const previewAudience = async () => {
        let filter = segmentFilter;
        if (recipientSource === "import" && importText.trim()) {
            const { phones, invalid, duplicates } = parsePhoneList(importText);
            setImportText(phones.join("\n"));
            applyParsedPhones(phones, invalid, duplicates, "replace");
            filter = { source: "import", phones };
        }
        if (
            (filter.source === "import" || filter.source === "groups") &&
            !(filter.phones?.length)
        ) {
            setAudienceError("Adicione números válidos antes de calcular");
            toast.error("Adicione números válidos antes de calcular");
            return;
        }
        if (
            recipientSource === "crm" &&
            crmPickMode === "manual" &&
            !selectedIds.size
        ) {
            setAudienceError("Selecione ao menos um contato do CRM");
            toast.error("Selecione ao menos um contato do CRM");
            return;
        }
        const consent = purpose === "marketing" ? true : requireConsent;
        if (purpose === "marketing" && !requireConsent) {
            setRequireConsent(true);
        }
        setAudienceCalculating(true);
        setAudienceError(null);
        setSimulationOnlyAudience(false);
        try {
            const res = await fetch("/api/channels/datafy/campaigns/preview", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    purpose,
                    requireConsent: consent,
                    segmentFilter: filter,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                const msg = json.message || "Erro ao calcular audiência";
                setAudience(null);
                setAudienceError(msg);
                toast.error(msg);
                return;
            }
            setAudience(json.data as AudienceResult);
            setShowExclusionDetails(
                (json.data.excludedCount || 0) > 0
            );
            if (json.data.eligibleCount > 0) {
                toast.success(
                    `Cálculo concluído: ${json.data.eligibleCount} aptos · ${json.data.excludedCount} excluídos`
                );
            } else {
                toast.message(
                    `Cálculo concluído: nenhum apto · ${json.data.excludedCount} excluídos. Verifique consentimentos no CRM.`
                );
            }
        } catch {
            setAudience(null);
            setAudienceError("Erro ao calcular audiência");
            toast.error("Erro ao calcular audiência");
        } finally {
            setAudienceCalculating(false);
        }
    };

    const handleStep2Next = () => {
        if (audienceCalculating) {
            toast.error("Aguarde o cálculo da audiência");
            return;
        }
        if (audienceError && !audience) {
            toast.error(audienceError);
            return;
        }
        if (!audience) {
            toast.error("Calcule a audiência antes de continuar");
            return;
        }
        if (audience.eligibleCount > 0) {
            setSimulationOnlyAudience(false);
            setStep((s) => s + 1);
            return;
        }
        if (
            simulationOnlyAudience &&
            (audience.simulationEligibleCount || 0) > 0
        ) {
            setDryRun(true);
            setStep((s) => s + 1);
            return;
        }
        toast.error(
            "Nenhum destinatário está autorizado para esta campanha. Verifique os consentimentos no CRM."
        );
    };

    const continueAsSimulation = () => {
        if (!audience || (audience.simulationEligibleCount || 0) <= 0) {
            toast.error(
                "Não há números válidos sequer para simulação (verifique opt-out e telefones inválidos)."
            );
            return;
        }
        setSimulationOnlyAudience(true);
        setDryRun(true);
        setStep((s) => s + 1);
        toast.message(
            "Continuando só em simulação — nenhum envio real e consentimento não é concedido."
        );
    };

    const openWizard = () => {
        setStep(1);
        setName("");
        setPurpose("marketing");
        setMessageBody(
            "Olá, {{fullName}}! Tudo bem? Aqui é a equipe Bom Frete."
        );
        setContentKind("message");
        setBulletinParts([]);
        setBulletinAnalysis(null);
        setPreviewPartIndex(0);
        setContentMode("existing");
        setTemplateKey("");
        setBodyVars(["fullName"]);
        setHeaderImageUrl(null);
        setHeaderImageHandle(null);
        setImagePreview(null);
        setImageFileName(null);
        setMobilePreviewOpen(false);
        setRecipientSource("crm");
        setCrmPickMode("all");
        setShowGeoFilters(false);
        setCategory("all");
        setTagId("all");
        setCity("");
        setStateUf("");
        setCompany("");
        setContactSearch("");
        setSelectedIds(new Set());
        setAudience(null);
        setAudienceError(null);
        setAudienceCalculating(false);
        setShowExclusionDetails(false);
        setSimulationOnlyAudience(false);
        setImportText("");
        setImportPhones([]);
        setImportStats(null);
        setGroupSessionId("");
        setGroups([]);
        setSelectedGroupJid("");
        setGroupPhones([]);
        setRequireConsent(true);
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
            setImageFileName(file.name);
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

    const clearCampaignImage = () => {
        setImagePreview(null);
        setHeaderImageUrl(null);
        setHeaderImageHandle(null);
        setImageFileName(null);
    };

    const currentStepMeta =
        WIZARD_STEPS.find((s) => s.n === step) || WIZARD_STEPS[0];

    const submitBulletinPart = async (partIndex: number) => {
        const part = bulletinParts[partIndex];
        if (!part?.bodyText) {
            toast.error("Parte vazia");
            return;
        }
        if (part.bodyText.length > META_TEMPLATE_BODY_MAX) {
            toast.error(
                `Parte excede ${META_TEMPLATE_BODY_MAX} caracteres — revise antes de submeter`
            );
            return;
        }
        setSubmittingPartIndex(partIndex);
        try {
            const res = await fetch(
                "/api/channels/datafy/campaigns/submit-template",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: `${name || "boletim"}_p${partIndex + 1}_${Date.now().toString(36)}`,
                        language: "pt_BR",
                        category:
                            purpose === "utility" ? "UTILITY" : "MARKETING",
                        bodyText: part.bodyText,
                        headerImageHandle:
                            partIndex === 0 ? headerImageHandle : null,
                    }),
                }
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha ao submeter parte");
                return;
            }
            setBulletinParts((prev) =>
                prev.map((p, i) =>
                    i === partIndex
                        ? {
                              ...p,
                              templateName: json.data.templateName,
                              templateLanguage: "pt_BR",
                              templateCategory:
                                  purpose === "utility"
                                      ? "UTILITY"
                                      : "MARKETING",
                              templateApprovalStatus: String(
                                  json.data.approvalStatus || "PENDING"
                              ),
                              variableMapping: { body: [] },
                              readyForRealSend: false,
                              blockReason:
                                  "Aguardando aprovação Meta (PENDING)",
                          }
                        : p
                )
            );
            toast.success(
                `Parte ${partIndex + 1} enviada para aprovação (${json.data.approvalStatus})`
            );
        } catch {
            toast.error("Erro ao submeter parte");
        } finally {
            setSubmittingPartIndex(null);
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
        if (!audience) {
            toast.error("Calcule a audiência antes de continuar");
            return;
        }
        const simOk =
            simulationOnlyAudience &&
            dryRun &&
            (audience.simulationEligibleCount || 0) > 0;
        if (audience.eligibleCount <= 0 && !simOk) {
            toast.error(
                "Nenhum destinatário está autorizado para esta campanha. Verifique os consentimentos no CRM."
            );
            return;
        }
        if (!dryRun && audience.eligibleCount <= 0) {
            toast.error(
                "Envio real bloqueado: nenhum destinatário com consentimento válido."
            );
            return;
        }

        let templateName = selectedTemplate?.name || null;
        let templateLanguage = selectedTemplate?.language || "pt_BR";
        let templateCategory = selectedTemplate?.category || null;
        let templateApprovalStatus = selectedTemplate?.status || "APPROVED";
        let contentSource = "existing_template";
        let vars = bodyVars;

        if (contentKind === "bulletin") {
            if (!bulletinParts.length) {
                toast.error("Analise o boletim com ao menos uma carga/parte");
                return;
            }
            const first = bulletinParts[0];
            templateName = first.templateName || `boletim_${Date.now()}`;
            templateLanguage = first.templateLanguage || "pt_BR";
            templateCategory =
                first.templateCategory ||
                (purpose === "utility" ? "UTILITY" : "MARKETING");
            templateApprovalStatus =
                first.templateApprovalStatus || "PENDING";
            contentSource = "bulletin_parts";
            vars = [];
            if (
                !dryRun &&
                !simulationOnlyAudience &&
                bulletinParts.some((p) => !p.readyForRealSend)
            ) {
                toast.error(
                    "Envio real bloqueado: associe/aprove templates de todas as partes (ou use simulação)."
                );
                return;
            }
        } else if (contentMode === "custom") {
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

        let finalFilter = segmentFilter;
        if (recipientSource === "import") {
            const parsed = parsePhoneList(importText || importPhones.join("\n"));
            finalFilter = { source: "import", phones: parsed.phones };
        } else if (recipientSource === "groups") {
            finalFilter = { source: "groups", phones: groupPhones };
        }
        const consentForced =
            purpose === "marketing" ? true : requireConsent;
        const effectiveDryRun = simulationOnlyAudience ? true : dryRun;
        const partN =
            contentKind === "bulletin"
                ? Math.max(1, bulletinParts.length)
                : 1;
        const msgTotal = estimateMessageTotal(
            audience.eligibleCount > 0
                ? audience.eligibleCount
                : audience.simulationEligibleCount || 0,
            partN
        );

        if (execMode === "now") {
            const ok = window.confirm(
                effectiveDryRun
                    ? `Simulação: ${audience.eligibleCount || audience.simulationEligibleCount || 0} destinatário(s) × ${partN} parte(s) ≈ ${msgTotal} mensagens (sem envio real). Continuar?`
                    : `Envio real: ${audience.eligibleCount} destinatário(s) × ${partN} parte(s) = ${msgTotal} mensagens previstas.\n\nAceite pela API ≠ entrega. Continuar?`
            );
            if (!ok) return;
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
                    contentKind,
                    messageBody,
                    messageParts:
                        contentKind === "bulletin" ? bulletinParts : null,
                    bulletinMeta:
                        contentKind === "bulletin" && bulletinAnalysis
                            ? {
                                  title: bulletinAnalysis.title,
                                  loadCount: bulletinAnalysis.loadCount,
                                  partCount: bulletinAnalysis.partCount,
                                  warnings: bulletinAnalysis.warnings,
                              }
                            : null,
                    headerImageUrl,
                    headerImageHandle,
                    variableMapping: { body: vars },
                    segmentFilter: finalFilter,
                    scheduledAt:
                        execMode === "schedule" ? scheduledAt : null,
                    dryRun: effectiveDryRun,
                    requireConsent: consentForced,
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

    // Re-analyze bulletin as the user types (deferred)
    useEffect(() => {
        if (contentKind !== "bulletin") {
            setBulletinAnalysis(null);
            setBulletinParts([]);
            return;
        }
        const analysis = analyzeBulletin(deferredBulletinText);
        setBulletinAnalysis(analysis);
        setBulletinParts((prev) => {
            const merged = analysis.parts.map((p, i) => {
                const old = prev.find((x) => x.index === i);
                return {
                    ...p,
                    templateName: old?.templateName,
                    templateLanguage: old?.templateLanguage || "pt_BR",
                    templateCategory: old?.templateCategory,
                    templateApprovalStatus: old?.templateApprovalStatus,
                    templateComponents: old?.templateComponents,
                    variableMapping: old?.variableMapping || { body: [] },
                    readyForRealSend: old?.readyForRealSend,
                    blockReason: old?.blockReason || p.blockReason,
                };
            });
            return associatePartsWithTemplates(
                merged,
                templates.map((t) => ({
                    name: t.name,
                    language: t.language,
                    status: t.status,
                    category: t.category,
                    components: t.components,
                })),
                { purpose }
            );
        });
        setPreviewPartIndex((idx) =>
            Math.min(idx, Math.max(0, analysis.partCount - 1))
        );
    }, [contentKind, deferredBulletinText, templates, purpose]);

    const activePreviewText = useMemo(() => {
        if (contentKind === "bulletin" && bulletinParts.length) {
            return (
                bulletinParts[previewPartIndex]?.bodyText ||
                bulletinParts[0]?.bodyText ||
                ""
            );
        }
        return messageBody
            .replace(/\{\{fullName\}\}/gi, "Maria Silva")
            .replace(/\{\{company\}\}/gi, "Transportadora Exemplo")
            .replace(/\{\{city\}\}/gi, "Curitiba")
            .replace(/\{\{state\}\}/gi, "PR")
            .replace(/\{\{waId\}\}/gi, "5541999999999")
            .replace(/\{\{category\}\}/gi, "Motorista");
    }, [
        contentKind,
        bulletinParts,
        previewPartIndex,
        messageBody,
    ]);

    const previewText = activePreviewText;

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
                <DialogContent
                    showCloseButton={false}
                    className={cn(
                        "flex flex-col gap-0 overflow-hidden p-0",
                        "!flex !flex-col",
                        "w-[min(1150px,calc(100vw-48px))] max-w-[1200px] sm:max-w-[1200px]",
                        "max-sm:w-[calc(100vw-16px)] max-sm:h-[min(96vh,920px)]",
                        "h-[min(90vh,860px)] max-h-[90vh]",
                        "rounded-[20px] max-sm:rounded-[16px] border border-slate-200/90 bg-[#f7f9fc]",
                        "shadow-[0_24px_64px_-16px_rgba(15,23,42,0.28)]"
                    )}
                >
                    <div className="relative shrink-0 border-b border-slate-200/80 bg-white px-5 sm:px-6 pt-5 pb-4 pr-12">
                        <button
                            type="button"
                            onClick={() => setWizardOpen(false)}
                            className="absolute top-4 right-4 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                            aria-label="Fechar"
                        >
                            <X className="h-4 w-4" />
                        </button>
                        <DialogHeader className="space-y-1 text-left">
                            <DialogTitle className="text-xl font-semibold tracking-tight text-slate-900">
                                Nova campanha
                            </DialogTitle>
                            <p className="text-sm text-slate-500">
                                {currentStepMeta.title}
                                <span className="mx-1.5 text-slate-300">·</span>
                                Etapa {step} de 5
                            </p>
                        </DialogHeader>
                        <div className="mt-4 flex items-center gap-2">
                            {WIZARD_STEPS.map((s) => (
                                <div
                                    key={s.n}
                                    className="flex-1 min-w-0"
                                    title={s.title}
                                >
                                    <div
                                        className={cn(
                                            "h-1.5 rounded-full transition-colors duration-300",
                                            s.n < step
                                                ? "bg-primary"
                                                : s.n === step
                                                  ? "bg-primary/80"
                                                  : "bg-slate-200"
                                        )}
                                    />
                                    <p
                                        className={cn(
                                            "mt-1.5 hidden sm:block text-[10px] truncate",
                                            s.n === step
                                                ? "font-medium text-primary"
                                                : "text-slate-400"
                                        )}
                                    >
                                        {s.short}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="flex min-h-0 flex-1">
                        <div className="min-h-0 min-w-0 flex-1 basis-[60%] overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
                    {step === 1 && (
                        <div className="space-y-5 max-w-3xl">
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="space-y-1.5 sm:col-span-2">
                                    <Label className="text-slate-700">
                                        Nome da campanha *
                                    </Label>
                                    <Input
                                        value={name}
                                        onChange={(e) =>
                                            setName(e.target.value)
                                        }
                                        placeholder="Ex.: Aviso fretes Sul"
                                        className="h-11 rounded-xl bg-white border-slate-200 focus-visible:ring-primary/30"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label className="text-slate-700">
                                        Finalidade
                                    </Label>
                                    <Select
                                        value={purpose}
                                        onValueChange={setPurpose}
                                    >
                                        <SelectTrigger className="h-11 rounded-xl bg-white border-slate-200">
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
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={
                                        contentKind === "message"
                                            ? "default"
                                            : "outline"
                                    }
                                    className="rounded-xl"
                                    onClick={() => {
                                        setContentKind("message");
                                        setContentMode("existing");
                                    }}
                                >
                                    Mensagem comum
                                </Button>
                                <Button
                                    type="button"
                                    size="sm"
                                    variant={
                                        contentKind === "bulletin"
                                            ? "default"
                                            : "outline"
                                    }
                                    className="rounded-xl"
                                    onClick={() => {
                                        setContentKind("bulletin");
                                        setContentMode("custom");
                                        setPurpose("utility");
                                        if (
                                            messageBody.startsWith("Olá, {{")
                                        ) {
                                            setMessageBody("");
                                        }
                                    }}
                                >
                                    Boletim de cargas
                                </Button>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                    <Label className="text-slate-700">
                                        {contentKind === "bulletin"
                                            ? "Boletim completo *"
                                            : "Mensagem *"}
                                    </Label>
                                    <span className="text-[11px] tabular-nums text-slate-400">
                                        {messageBody.length} caracteres
                                        {contentKind === "bulletin" &&
                                        bulletinAnalysis
                                            ? ` · ${bulletinAnalysis.loadCount} carga(s) · ${bulletinAnalysis.partCount} parte(s)`
                                            : ""}
                                    </span>
                                </div>
                                <Textarea
                                    value={messageBody}
                                    onChange={(e) =>
                                        setMessageBody(e.target.value)
                                    }
                                    className={cn(
                                        "resize-y text-[15px] leading-relaxed rounded-xl bg-white border-slate-200 focus-visible:ring-primary/30 shadow-sm whitespace-pre-wrap",
                                        contentKind === "bulletin"
                                            ? "min-h-[280px] font-sans"
                                            : "min-h-[200px]"
                                    )}
                                    placeholder={
                                        contentKind === "bulletin"
                                            ? "Cole aqui o boletim completo (título, separadores, cargas, links e emojis)…"
                                            : "Escreva a mensagem da campanha…"
                                    }
                                />
                                {contentKind === "bulletin" &&
                                    bulletinAnalysis && (
                                        <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5 text-xs text-slate-600 space-y-1">
                                            <p>
                                                <strong>
                                                    {bulletinAnalysis.title}
                                                </strong>{" "}
                                                — divisão automática respeita
                                                cargas completas (limite Meta{" "}
                                                {META_TEMPLATE_BODY_MAX}{" "}
                                                chars/parte).
                                            </p>
                                            {bulletinAnalysis.warnings
                                                .slice(0, 3)
                                                .map((w) => (
                                                    <p
                                                        key={w}
                                                        className="text-amber-800"
                                                    >
                                                        ⚠ {w}
                                                    </p>
                                                ))}
                                        </div>
                                    )}
                                {contentKind === "message" && (
                                    <div className="rounded-xl border border-slate-200/80 bg-white/80 p-3 space-y-2.5">
                                        <div>
                                            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1.5">
                                                Variáveis
                                            </p>
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
                                                        className="h-7 rounded-lg text-xs border-slate-200 bg-slate-50/80 hover:bg-primary/5 hover:border-primary/30"
                                                        onClick={() =>
                                                            insertToken(t)
                                                        }
                                                    >
                                                        {`{{${t}}}`}
                                                    </Button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 mb-1.5 inline-flex items-center gap-1">
                                                <Smile className="h-3 w-3" />
                                                Emojis
                                            </p>
                                            <div className="flex flex-wrap gap-0.5">
                                                {EMOJIS.map((e) => (
                                                    <button
                                                        key={e}
                                                        type="button"
                                                        className="h-8 w-8 rounded-lg text-base transition-colors hover:bg-slate-100 active:scale-95"
                                                        onClick={() =>
                                                            insertEmoji(e)
                                                        }
                                                    >
                                                        {e}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                {contentKind === "bulletin" && (
                                    <div className="flex flex-wrap gap-0.5">
                                        {EMOJIS.map((e) => (
                                            <button
                                                key={e}
                                                type="button"
                                                className="h-8 w-8 rounded-lg text-base transition-colors hover:bg-slate-100"
                                                onClick={() => insertEmoji(e)}
                                            >
                                                {e}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <Label className="text-slate-700">
                                    Imagem opcional
                                </Label>
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
                                {!imagePreview ? (
                                    <button
                                        type="button"
                                        disabled={uploadingImage}
                                        onClick={() =>
                                            imageInputRef.current?.click()
                                        }
                                        className={cn(
                                            "flex w-full items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white/70 px-4 py-3.5 text-left transition-colors",
                                            "hover:border-primary/40 hover:bg-primary/[0.03]",
                                            "disabled:opacity-60"
                                        )}
                                    >
                                        {uploadingImage ? (
                                            <Loader2 className="h-5 w-5 animate-spin text-primary shrink-0" />
                                        ) : (
                                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                                                <ImagePlus className="h-5 w-5" />
                                            </div>
                                        )}
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-slate-700">
                                                Adicionar imagem de cabeçalho
                                            </p>
                                            <p className="text-[11px] text-slate-400 mt-0.5">
                                                JPEG, PNG ou WebP · até 5 MB ·
                                                opcional
                                            </p>
                                        </div>
                                    </button>
                                ) : (
                                    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={imagePreview}
                                            alt=""
                                            className="h-12 w-12 rounded-lg object-cover border border-slate-100 shrink-0"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium text-slate-700 truncate">
                                                {imageFileName ||
                                                    "Imagem anexada"}
                                            </p>
                                            <p className="text-[11px] text-slate-400">
                                                Visível na prévia ao lado
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 gap-1">
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="rounded-lg h-8"
                                                disabled={uploadingImage}
                                                onClick={() =>
                                                    imageInputRef.current?.click()
                                                }
                                            >
                                                Substituir
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="rounded-lg h-8 text-slate-500"
                                                onClick={clearCampaignImage}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-5 max-w-3xl">
                            <div>
                                <p className="text-sm font-medium text-slate-800">
                                    Fonte dos destinatários
                                </p>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Contatos de qualquer região do Brasil.
                                    Importação e grupos não autorizam marketing
                                    sozinhos — a Datafy exige consentimento
                                    válido.
                                </p>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-3">
                                {(
                                    [
                                        {
                                            id: "import" as const,
                                            title: "Importar números",
                                            desc: "TXT/CSV — mesma lógica do Disparo",
                                            icon: FileText,
                                        },
                                        {
                                            id: "crm" as const,
                                            title: "Contatos do CRM",
                                            desc: "Seleção individual ou em lote",
                                            icon: Contact,
                                        },
                                        {
                                            id: "groups" as const,
                                            title: "Grupos WhatsApp",
                                            desc: "Via sessão Baileys conectada",
                                            icon: Users,
                                        },
                                    ] as const
                                ).map((opt) => {
                                    const Icon = opt.icon;
                                    const active = recipientSource === opt.id;
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => {
                                                setRecipientSource(opt.id);
                                                invalidateAudience();
                                            }}
                                            className={cn(
                                                "rounded-2xl border p-4 text-left transition-all",
                                                active
                                                    ? "border-emerald-600 bg-emerald-50/80 shadow-sm ring-1 ring-emerald-600/20"
                                                    : "hover:border-foreground/20 hover:bg-muted/30"
                                            )}
                                        >
                                            <Icon
                                                className={cn(
                                                    "h-5 w-5 mb-2",
                                                    active
                                                        ? "text-emerald-700"
                                                        : "text-muted-foreground"
                                                )}
                                            />
                                            <p className="text-sm font-semibold">
                                                {opt.title}
                                            </p>
                                            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                                                {opt.desc}
                                            </p>
                                        </button>
                                    );
                                })}
                            </div>

                            {recipientSource === "import" && (
                                <div className="space-y-3 rounded-2xl border bg-muted/15 p-4">
                                    <div className="flex flex-wrap gap-2">
                                        <input
                                            ref={importFileRef}
                                            type="file"
                                            accept=".txt,.csv,text/plain,text/csv"
                                            className="hidden"
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) void handleImportFile(f);
                                            }}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="rounded-xl"
                                            onClick={() =>
                                                importFileRef.current?.click()
                                            }
                                        >
                                            <Upload className="h-4 w-4 mr-2" />
                                            Importar TXT/CSV
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="sm"
                                            className="rounded-xl"
                                            onClick={handleNormalizeImport}
                                        >
                                            Normalizar e deduplicar
                                        </Button>
                                    </div>
                                    <Textarea
                                        rows={5}
                                        placeholder={
                                            "Cole números (qualquer DDD do Brasil)\nEx.: 45991253256\n11999998888"
                                        }
                                        value={importText}
                                        onChange={(e) => {
                                            setImportText(e.target.value);
                                            invalidateAudience();
                                        }}
                                        className="font-mono text-xs rounded-xl"
                                    />
                                    {importStats && (
                                        <div className="flex flex-wrap gap-3 text-xs">
                                            <span className="text-emerald-700 font-medium">
                                                {importStats.valid} válido(s)
                                            </span>
                                            <span className="text-amber-700">
                                                {importStats.invalid} inválido(s)
                                            </span>
                                            <span className="text-muted-foreground">
                                                {importStats.duplicates}{" "}
                                                repetido(s)
                                            </span>
                                            <span className="text-foreground">
                                                Lista atual: {importPhones.length}
                                            </span>
                                        </div>
                                    )}
                                    <p className="text-[11px] text-muted-foreground flex gap-1.5 items-start">
                                        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-amber-600" />
                                        Importar números não concede
                                        autorização comercial. Marketing exige
                                        consentimento no CRM (Datafy).
                                    </p>
                                </div>
                            )}

                            {recipientSource === "crm" && (
                                <div className="space-y-3 rounded-2xl border bg-muted/15 p-4">
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={
                                                crmPickMode === "all"
                                                    ? "default"
                                                    : "outline"
                                            }
                                            className="rounded-xl"
                                            onClick={() => {
                                                setCrmPickMode("all");
                                                invalidateAudience();
                                            }}
                                        >
                                            Todos elegíveis
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant={
                                                crmPickMode === "manual"
                                                    ? "default"
                                                    : "outline"
                                            }
                                            className="rounded-xl"
                                            onClick={() => {
                                                setCrmPickMode("manual");
                                                invalidateAudience();
                                            }}
                                        >
                                            Seleção manual / lote
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
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
                                            <Label>Categoria</Label>
                                            <Select
                                                value={category}
                                                onValueChange={(v) => {
                                                    setCategory(v);
                                                    invalidateAudience();
                                                }}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="all">
                                                        Todas
                                                    </SelectItem>
                                                    {CRM_CATEGORIES.map(
                                                        (c) => (
                                                            <SelectItem
                                                                key={c}
                                                                value={c}
                                                            >
                                                                {c}
                                                            </SelectItem>
                                                        )
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>Etiqueta</Label>
                                            <Select
                                                value={tagId}
                                                onValueChange={(v) => {
                                                    setTagId(v);
                                                    invalidateAudience();
                                                }}
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
                                        <div className="grid sm:grid-cols-3 gap-3 rounded-xl border bg-background/60 p-3">
                                            <div className="space-y-1.5">
                                                <Label>Cidade</Label>
                                                <Input
                                                    value={city}
                                                    onChange={(e) => {
                                                        setCity(
                                                            e.target.value
                                                        );
                                                        invalidateAudience();
                                                    }}
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label>UF</Label>
                                                <Input
                                                    value={stateUf}
                                                    maxLength={2}
                                                    onChange={(e) => {
                                                        setStateUf(
                                                            e.target.value.toUpperCase()
                                                        );
                                                        invalidateAudience();
                                                    }}
                                                />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label>Empresa</Label>
                                                <Input
                                                    value={company}
                                                    onChange={(e) => {
                                                        setCompany(
                                                            e.target.value
                                                        );
                                                        invalidateAudience();
                                                    }}
                                                />
                                            </div>
                                            <p className="sm:col-span-3 text-[11px] text-muted-foreground">
                                                Filtros geográficos são
                                                opcionais — vários estados na
                                                mesma campanha.
                                            </p>
                                        </div>
                                    )}

                                    {crmPickMode === "manual" && (
                                        <div className="space-y-2">
                                            <div className="flex gap-2">
                                                <Input
                                                    placeholder="Buscar nome ou telefone…"
                                                    value={contactSearch}
                                                    onChange={(e) =>
                                                        setContactSearch(
                                                            e.target.value
                                                        )
                                                    }
                                                />
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="shrink-0 rounded-xl"
                                                    onClick={() => {
                                                        setSelectedIds(
                                                            new Set(
                                                                filteredCrm.map(
                                                                    (c) => c.id
                                                                )
                                                            )
                                                        );
                                                        invalidateAudience();
                                                    }}
                                                >
                                                    Marcar visíveis
                                                </Button>
                                            </div>
                                            <div className="max-h-48 overflow-y-auto rounded-xl border divide-y bg-background">
                                                {filteredCrm.map((c) => {
                                                    const checked =
                                                        selectedIds.has(c.id);
                                                    return (
                                                        <label
                                                            key={c.id}
                                                            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 cursor-pointer"
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                checked={
                                                                    checked
                                                                }
                                                                onChange={() => {
                                                                    setSelectedIds(
                                                                        (
                                                                            prev
                                                                        ) => {
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
                                                                    setAudience(
                                                                        null
                                                                    );
                                                                }}
                                                            />
                                                            <span className="flex-1 truncate">
                                                                {c.fullName ||
                                                                    "Sem nome"}
                                                                <span className="text-muted-foreground text-xs ml-2">
                                                                    {formatPhoneDisplay(
                                                                        c.waId
                                                                    ) ||
                                                                        c.waId}
                                                                    {c.state
                                                                        ? ` · ${c.state}`
                                                                        : ""}
                                                                    {c.consentStatus ===
                                                                    "granted"
                                                                        ? " · ok"
                                                                        : ""}
                                                                </span>
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                {selectedIds.size}{" "}
                                                selecionado(s)
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {recipientSource === "groups" && (
                                <div className="space-y-3 rounded-2xl border bg-muted/15 p-4">
                                    <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-3 py-2.5 text-[12px] text-amber-950 leading-relaxed">
                                        <p className="font-medium flex items-center gap-1.5">
                                            <AlertTriangle className="h-3.5 w-3.5" />
                                            Limitação da API Datafy / WhatsApp
                                            Business Platform
                                        </p>
                                        <p className="mt-1">
                                            A Datafy e a Cloud API oficial não
                                            oferecem endpoint para listar
                                            grupos ou participantes. Esta
                                            opção usa apenas a sessão{" "}
                                            <strong>Baileys</strong> já
                                            conectada — isolada do canal
                                            oficial. Números de grupo não são
                                            consentimento de marketing e não
                                            são copiados automaticamente para
                                            campanhas.
                                        </p>
                                    </div>

                                    {!baileysConnected.length ? (
                                        <p className="text-sm text-muted-foreground">
                                            Nenhuma sessão Baileys CONNECTED.
                                            Conecte uma sessão no menu Sessões
                                            para visualizar grupos.
                                        </p>
                                    ) : (
                                        <>
                                            <div className="grid sm:grid-cols-2 gap-3">
                                                <div className="space-y-1.5">
                                                    <Label>
                                                        Sessão Baileys
                                                    </Label>
                                                    <Select
                                                        value={groupSessionId}
                                                        onValueChange={(
                                                            v
                                                        ) => {
                                                            setGroupSessionId(
                                                                v
                                                            );
                                                            setSelectedGroupJid(
                                                                ""
                                                            );
                                                            setGroupPhones(
                                                                []
                                                            );
                                                            invalidateAudience();
                                                        }}
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Selecione" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {baileysConnected.map(
                                                                (s) => (
                                                                    <SelectItem
                                                                        key={
                                                                            s.id
                                                                        }
                                                                        value={
                                                                            s.id
                                                                        }
                                                                    >
                                                                        {s.name}{" "}
                                                                        (
                                                                        {s.status}
                                                                        )
                                                                    </SelectItem>
                                                                )
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-1.5">
                                                    <Label>Grupo</Label>
                                                    <div className="flex gap-2">
                                                        <Select
                                                            value={
                                                                selectedGroupJid
                                                            }
                                                            onValueChange={
                                                                setSelectedGroupJid
                                                            }
                                                        >
                                                            <SelectTrigger className="flex-1">
                                                                <SelectValue
                                                                    placeholder={
                                                                        groupsLoading
                                                                            ? "Carregando…"
                                                                            : "Selecione um grupo"
                                                                    }
                                                                />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {groups.map(
                                                                    (g) => (
                                                                        <SelectItem
                                                                            key={
                                                                                g.jid
                                                                            }
                                                                            value={
                                                                                g.jid
                                                                            }
                                                                        >
                                                                            {g.subject ||
                                                                                g.jid}{" "}
                                                                            (
                                                                            {Array.isArray(
                                                                                g.participants
                                                                            )
                                                                                ? g
                                                                                      .participants
                                                                                      .length
                                                                                : 0}
                                                                            )
                                                                        </SelectItem>
                                                                    )
                                                                )}
                                                            </SelectContent>
                                                        </Select>
                                                        <Button
                                                            type="button"
                                                            variant="secondary"
                                                            size="icon"
                                                            className="shrink-0 rounded-xl"
                                                            title="Atualizar grupos"
                                                            onClick={() =>
                                                                groupSessionId &&
                                                                void fetchGroups(
                                                                    groupSessionId
                                                                )
                                                            }
                                                        >
                                                            <RefreshCw
                                                                className={cn(
                                                                    "h-4 w-4",
                                                                    groupsLoading &&
                                                                        "animate-spin"
                                                                )}
                                                            />
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                className="rounded-xl"
                                                disabled={
                                                    !selectedGroupJid ||
                                                    importingGroup
                                                }
                                                onClick={() =>
                                                    void handleImportGroup()
                                                }
                                            >
                                                {importingGroup ? (
                                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                                ) : (
                                                    <Users className="h-4 w-4 mr-2" />
                                                )}
                                                Extrair participantes
                                            </Button>
                                        </>
                                    )}
                                </div>
                            )}

                            {(recipientSource === "import" ||
                                recipientSource === "groups") &&
                                activePhones.length > 0 && (
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-sm font-medium">
                                                Revisar números (
                                                {activePhones.length})
                                            </p>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="text-destructive"
                                                onClick={() => {
                                                    if (
                                                        recipientSource ===
                                                        "import"
                                                    ) {
                                                        setImportPhones([]);
                                                        setImportText("");
                                                        setImportStats(null);
                                                    } else {
                                                        setGroupPhones([]);
                                                    }
                                                    invalidateAudience();
                                                }}
                                            >
                                                Limpar lista
                                            </Button>
                                        </div>
                                        <div className="max-h-40 overflow-y-auto rounded-xl border divide-y">
                                            {activePhones
                                                .slice(0, 200)
                                                .map((p) => (
                                                    <div
                                                        key={p}
                                                        className="flex items-center justify-between px-3 py-1.5 text-sm font-mono"
                                                    >
                                                        <span>
                                                            {formatPhoneDisplay(
                                                                p
                                                            ) || p}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            className="text-muted-foreground hover:text-destructive p-1"
                                                            onClick={() =>
                                                                removePhone(p)
                                                            }
                                                            aria-label="Remover"
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                ))}
                                        </div>
                                        {activePhones.length > 200 && (
                                            <p className="text-[11px] text-muted-foreground">
                                                Mostrando 200 de{" "}
                                                {activePhones.length}. Todos
                                                entram no cálculo de elegíveis.
                                            </p>
                                        )}
                                    </div>
                                )}

                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    checked={requireConsent}
                                    disabled={purpose === "marketing"}
                                    onChange={(e) => {
                                        setRequireConsent(e.target.checked);
                                        invalidateAudience();
                                    }}
                                />
                                Exigir consentimento válido (obrigatório para
                                marketing pela Datafy)
                            </label>

                            <div className="flex flex-wrap items-center gap-3">
                                <Button
                                    variant="outline"
                                    className="rounded-xl"
                                    disabled={audienceCalculating}
                                    onClick={() => void previewAudience()}
                                >
                                    {audienceCalculating ? (
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    ) : null}
                                    {audience
                                        ? "Recalcular audiência"
                                        : "Calcular elegíveis"}
                                </Button>
                            </div>

                            {audienceError && !audience && (
                                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                                    {audienceError}
                                </div>
                            )}

                            {audience && (
                                <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 ring-1 ring-emerald-200/80">
                                            Cálculo concluído
                                        </span>
                                        {audience.eligibleCount <= 0 && (
                                            <span className="inline-flex items-center rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200/80">
                                                Nenhum autorizado
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex flex-wrap gap-4 text-sm">
                                        <span>
                                            Selecionados:{" "}
                                            <strong>{audience.selected}</strong>
                                        </span>
                                        <span>
                                            Aptos (autorizados):{" "}
                                            <strong className="text-emerald-700">
                                                {audience.eligibleCount}
                                            </strong>
                                        </span>
                                        <span>
                                            Excluídos:{" "}
                                            <strong className="text-amber-700">
                                                {audience.excludedCount}
                                            </strong>
                                        </span>
                                        {(audience.simulationEligibleCount ||
                                            0) > audience.eligibleCount && (
                                            <span className="text-slate-500 text-xs self-center">
                                                {audience.simulationEligibleCount}{" "}
                                                válidos p/ simulação (sem
                                                consentimento)
                                            </span>
                                        )}
                                    </div>

                                    {audience.exclusionBreakdown &&
                                        audience.excludedCount > 0 && (
                                            <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                                                <p className="text-xs font-semibold text-slate-600 mb-2">
                                                    Motivos das exclusões
                                                </p>
                                                <ul className="space-y-1 text-sm text-slate-700">
                                                    {EXCLUSION_REASON_ORDER.filter(
                                                        (r) =>
                                                            (audience
                                                                .exclusionBreakdown?.[
                                                                r
                                                            ] || 0) > 0
                                                    ).map((r) => (
                                                        <li
                                                            key={r}
                                                            className="flex justify-between gap-3"
                                                        >
                                                            <span>
                                                                {skipReasonLabel(
                                                                    r
                                                                )}
                                                            </span>
                                                            <strong className="tabular-nums">
                                                                {
                                                                    audience
                                                                        .exclusionBreakdown![
                                                                        r
                                                                    ]
                                                                }
                                                            </strong>
                                                        </li>
                                                    ))}
                                                    {Object.entries(
                                                        audience.exclusionBreakdown
                                                    )
                                                        .filter(
                                                            ([k]) =>
                                                                !(
                                                                    EXCLUSION_REASON_ORDER as readonly string[]
                                                                ).includes(k)
                                                        )
                                                        .map(([k, n]) => (
                                                            <li
                                                                key={k}
                                                                className="flex justify-between gap-3"
                                                            >
                                                                <span>
                                                                    {skipReasonLabel(
                                                                        k
                                                                    )}
                                                                </span>
                                                                <strong className="tabular-nums">
                                                                    {n}
                                                                </strong>
                                                            </li>
                                                        ))}
                                                </ul>
                                                <button
                                                    type="button"
                                                    className="mt-2 text-xs font-medium text-primary hover:underline"
                                                    onClick={() =>
                                                        setShowExclusionDetails(
                                                            (v) => !v
                                                        )
                                                    }
                                                >
                                                    {showExclusionDetails
                                                        ? "Ocultar detalhes"
                                                        : "Ver detalhes dos excluídos"}
                                                </button>
                                                {showExclusionDetails &&
                                                    audience.excludedPreview
                                                        ?.length ? (
                                                    <div className="mt-2 max-h-36 overflow-y-auto rounded-lg border bg-white divide-y text-xs font-mono">
                                                        {audience.excludedPreview
                                                            .slice(0, 80)
                                                            .map((e, i) => (
                                                                <div
                                                                    key={`${e.waId}-${i}`}
                                                                    className="flex justify-between gap-2 px-2 py-1.5"
                                                                >
                                                                    <span className="truncate">
                                                                        {formatPhoneDisplay(
                                                                            e.waId
                                                                        ) ||
                                                                            e.waId}
                                                                        {e.fullName
                                                                            ? ` · ${e.fullName}`
                                                                            : ""}
                                                                    </span>
                                                                    <span className="text-amber-800 shrink-0 font-sans">
                                                                        {skipReasonLabel(
                                                                            e.reason
                                                                        )}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                        )}

                                    {audience.eligibleCount <= 0 && (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50/90 px-3.5 py-3 text-sm text-amber-950 space-y-2">
                                            <p>
                                                Nenhum destinatário está
                                                autorizado para esta campanha.
                                                Verifique os consentimentos no
                                                CRM.
                                            </p>
                                            {(audience.simulationEligibleCount ||
                                                0) > 0 && (
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    className="rounded-xl border-amber-300 bg-white"
                                                    onClick={
                                                        continueAsSimulation
                                                    }
                                                >
                                                    Continuar só em simulação (
                                                    {
                                                        audience.simulationEligibleCount
                                                    }{" "}
                                                    números)
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-4 max-w-3xl">
                            {contentKind === "bulletin" ? (
                                <div className="space-y-3">
                                    <p className="text-sm text-slate-600">
                                        Cada parte do boletim precisa de um
                                        template Meta APPROVED com o corpo
                                        correspondente. Não usamos uma única
                                        variável para contornar a aprovação.
                                        Envio real só com todas as partes
                                        prontas; simulação pode seguir sem
                                        APPROVED.
                                    </p>
                                    {bulletinParts.map((p) => (
                                        <div
                                            key={p.index}
                                            className="rounded-xl border bg-white p-3 space-y-2"
                                        >
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <p className="text-sm font-medium">
                                                    {p.label}{" "}
                                                    <span className="text-slate-400 font-normal">
                                                        ({p.charCount} chars)
                                                    </span>
                                                </p>
                                                <Badge
                                                    variant="outline"
                                                    className={
                                                        p.readyForRealSend
                                                            ? "border-emerald-300 text-emerald-800"
                                                            : "border-amber-300 text-amber-900"
                                                    }
                                                >
                                                    {p.readyForRealSend
                                                        ? "Pronto"
                                                        : p.templateApprovalStatus ||
                                                          "Sem template"}
                                                </Badge>
                                            </div>
                                            {p.blockReason && (
                                                <p className="text-xs text-amber-800">
                                                    {p.blockReason}
                                                </p>
                                            )}
                                            {p.templateName && (
                                                <p className="text-xs text-slate-500 font-mono">
                                                    {p.templateName}
                                                </p>
                                            )}
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="rounded-xl"
                                                disabled={
                                                    submittingPartIndex ===
                                                        p.index ||
                                                    p.charCount >
                                                        META_TEMPLATE_BODY_MAX
                                                }
                                                onClick={() =>
                                                    void submitBulletinPart(
                                                        p.index
                                                    )
                                                }
                                            >
                                                {submittingPartIndex ===
                                                p.index ? (
                                                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                                                ) : null}
                                                Enviar parte para aprovação Meta
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <>
                            <div className="flex flex-wrap gap-2">
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
                                </>
                            )}
                        </div>
                    )}

                    {step === 4 && (
                        <div className="space-y-4 max-w-3xl">
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
                                    checked={
                                        simulationOnlyAudience
                                            ? true
                                            : dryRun
                                    }
                                    disabled={simulationOnlyAudience}
                                    onChange={(e) =>
                                        setDryRun(e.target.checked)
                                    }
                                />
                                <span>
                                    <FlaskConical className="inline h-3.5 w-3.5 mr-1" />
                                    Modo simulação — não envia mensagens reais
                                    {simulationOnlyAudience
                                        ? " (obrigatório nesta audiência)"
                                        : ""}
                                </span>
                            </label>
                        </div>
                    )}

                    {step === 5 && (
                        <div className="space-y-4 max-w-3xl">
                            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3 text-sm">
                                <p className="text-lg font-semibold text-slate-900 tracking-tight">
                                    {name || "—"}
                                </p>
                                <div className="grid gap-2 sm:grid-cols-2 text-slate-600">
                                    <p>
                                        <span className="text-slate-400 text-xs uppercase tracking-wide block mb-0.5">
                                            Finalidade
                                        </span>
                                        {purpose}
                                    </p>
                                    <p>
                                        <span className="text-slate-400 text-xs uppercase tracking-wide block mb-0.5">
                                            Destinatários
                                        </span>
                                        {audience?.eligibleCount ?? 0} aptos ·{" "}
                                        {audience?.excludedCount ?? 0} excluídos
                                    </p>
                                    <p className="sm:col-span-2">
                                        <span className="text-slate-400 text-xs uppercase tracking-wide block mb-0.5">
                                            Conteúdo
                                        </span>
                                        {contentKind === "bulletin"
                                            ? `Boletim · ${bulletinAnalysis?.loadCount ?? 0} carga(s) · ${bulletinParts.length} parte(s) · ${estimateMessageTotal(audience?.eligibleCount ?? 0, bulletinParts.length || 1)} msgs previstas`
                                            : contentMode === "existing"
                                              ? `Template ${selectedTemplate?.name || "—"} (${selectedTemplate?.language || ""})`
                                              : `Personalizado → ${submittedTemplate?.templateName || "(submeter na etapa 3)"}`}
                                    </p>
                                    {contentKind === "bulletin" && (
                                        <p className="sm:col-span-2">
                                            <span className="text-slate-400 text-xs uppercase tracking-wide block mb-0.5">
                                                Templates / aprovação
                                            </span>
                                            {bulletinParts
                                                .map(
                                                    (p) =>
                                                        `P${p.index + 1}: ${p.templateApprovalStatus || "—"}`
                                                )
                                                .join(" · ")}
                                        </p>
                                    )}
                                    <p className="sm:col-span-2">
                                        <span className="text-slate-400 text-xs uppercase tracking-wide block mb-0.5">
                                            Execução
                                        </span>
                                        {execMode === "schedule"
                                            ? `Agendada (${scheduledAt || "—"}) — sem animação de disparo`
                                            : "Imediata — com animação de disparo"}
                                    </p>
                                </div>
                                <div
                                    className={cn(
                                        "rounded-xl px-3.5 py-2.5 text-sm font-medium",
                                        dryRun
                                            ? "bg-amber-50 text-amber-900 border border-amber-200/80"
                                            : "bg-red-50 text-red-800 border border-red-200/80"
                                    )}
                                >
                                    {dryRun
                                        ? "SIMULAÇÃO — nenhum envio real"
                                        : "ENVIO REAL via API Datafy"}
                                </div>
                                {!dryRun &&
                                    contentMode === "custom" &&
                                    submittedTemplate?.approvalStatus !==
                                        "APPROVED" && (
                                        <p className="text-red-700 text-sm">
                                            Aviso: template ainda não APPROVED —
                                            o início real será bloqueado.
                                        </p>
                                    )}
                            </div>
                        </div>
                    )}

                            {/* Prévia no mobile / tablet */}
                            <div className="lg:hidden mt-6 border-t border-slate-200/80 pt-4">
                                <button
                                    type="button"
                                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700"
                                    onClick={() =>
                                        setMobilePreviewOpen((v) => !v)
                                    }
                                >
                                    Prévia da mensagem
                                    {mobilePreviewOpen ? (
                                        <ChevronUp className="h-4 w-4 text-slate-400" />
                                    ) : (
                                        <ChevronDown className="h-4 w-4 text-slate-400" />
                                    )}
                                </button>
                                {mobilePreviewOpen && (
                                    <div className="mt-3">
                                        <WhatsAppMessagePreview
                                            previewText={previewText}
                                            imagePreview={imagePreview}
                                            compact
                                            partLabel={
                                                bulletinParts[
                                                    previewPartIndex
                                                ]?.label
                                            }
                                            partIndex={previewPartIndex}
                                            partCount={
                                                contentKind === "bulletin"
                                                    ? bulletinParts.length
                                                    : 1
                                            }
                                            onPrevPart={() =>
                                                setPreviewPartIndex((i) =>
                                                    Math.max(0, i - 1)
                                                )
                                            }
                                            onNextPart={() =>
                                                setPreviewPartIndex((i) =>
                                                    Math.min(
                                                        bulletinParts.length -
                                                            1,
                                                        i + 1
                                                    )
                                                )
                                            }
                                            warnings={
                                                bulletinAnalysis?.warnings
                                            }
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        <aside className="hidden lg:flex w-[min(40%,420px)] shrink-0 flex-col border-l border-slate-200/80 bg-white/60 p-5 overflow-y-auto overscroll-contain">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">
                                Prévia da mensagem
                            </p>
                            <WhatsAppMessagePreview
                                previewText={previewText}
                                imagePreview={imagePreview}
                                partLabel={
                                    bulletinParts[previewPartIndex]?.label
                                }
                                partIndex={previewPartIndex}
                                partCount={
                                    contentKind === "bulletin"
                                        ? bulletinParts.length
                                        : 1
                                }
                                onPrevPart={() =>
                                    setPreviewPartIndex((i) =>
                                        Math.max(0, i - 1)
                                    )
                                }
                                onNextPart={() =>
                                    setPreviewPartIndex((i) =>
                                        Math.min(
                                            bulletinParts.length - 1,
                                            i + 1
                                        )
                                    )
                                }
                                warnings={bulletinAnalysis?.warnings}
                            />
                        </aside>
                    </div>

                    <DialogFooter className="shrink-0 gap-2 border-t border-slate-200/80 bg-white px-5 sm:px-6 py-3.5 sm:justify-between flex-row items-center">
                        <p className="hidden sm:block text-xs text-slate-400">
                            Etapa {step} de 5 · {currentStepMeta.short}
                        </p>
                        <div className="flex flex-1 sm:flex-initial justify-end gap-2">
                            {step > 1 && (
                                <Button
                                    variant="outline"
                                    className="rounded-xl"
                                    onClick={() => setStep((s) => s - 1)}
                                >
                                    Voltar
                                </Button>
                            )}
                            {step < 5 ? (
                                <Button
                                    className="rounded-xl min-w-[110px]"
                                    onClick={() => {
                                        if (step === 2) {
                                            handleStep2Next();
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
                                        "rounded-xl min-w-[140px]",
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
                        </div>
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
