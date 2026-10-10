"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
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
    Users,
    Plus,
    RefreshCw,
    Download,
    Megaphone,
    Copy,
    Phone,
    FileText,
    CheckCircle2,
    AlertTriangle,
    Loader2,
    Contact,
} from "lucide-react";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { toast } from "sonner";
import {
    BROADCAST_IMPORT_KEY,
    DATAFY_GROUP_IMPORT_KEY,
    classifyGroupParticipants,
    formatPhoneDisplay,
    type GroupParticipantClassification,
} from "@/lib/phone-br";
import { cn } from "@/lib/utils";

interface Group {
    id: string;
    subject: string;
    jid: string;
    participants?: unknown[];
}

const PAGE_SIZE = 12;

export default function GroupsPage() {
    const {
        channels,
        sessionId: globalChannelId,
        isDatafyChannel,
        refreshChannels,
        loading: channelsLoading,
    } = useSession();
    const router = useRouter();

    const baileysSessions = useMemo(
        () => channels.filter((c) => c.provider === "baileys"),
        [channels]
    );
    const baileysConnected = useMemo(
        () =>
            baileysSessions.filter(
                (c) => (c.status || "").toUpperCase() === "CONNECTED"
            ),
        [baileysSessions]
    );

    /** Local Baileys session — independent of global Datafy channel selection */
    const [groupsSessionId, setGroupsSessionId] = useState("");
    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(false);
    const [connectionStatus, setConnectionStatus] = useState<string | null>(
        null
    );
    const [loadError, setLoadError] = useState<string | null>(null);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");
    const [searchTerm, setSearchTerm] = useState("");
    const [page, setPage] = useState(0);
    const [selectedJids, setSelectedJids] = useState<Set<string>>(new Set());

    const [extractOpen, setExtractOpen] = useState(false);
    const [extractLoading, setExtractLoading] = useState(false);
    const [extractGroup, setExtractGroup] = useState<Group | null>(null);
    const [extractStats, setExtractStats] =
        useState<GroupParticipantClassification | null>(null);
    const [actionBusy, setActionBusy] = useState<
        "copy" | "save" | "broadcast" | "crm" | "datafy" | null
    >(null);

    useEffect(() => {
        void refreshChannels();
    }, [refreshChannels]);

    useEffect(() => {
        if (groupsSessionId) return;
        const preferred =
            (!isDatafyChannel &&
                baileysSessions.find((c) => c.id === globalChannelId)) ||
            baileysConnected[0] ||
            baileysSessions[0];
        if (preferred) setGroupsSessionId(preferred.id);
    }, [
        groupsSessionId,
        isDatafyChannel,
        globalChannelId,
        baileysConnected,
        baileysSessions,
    ]);

    const fetchGroups = useCallback(
        async (sessId: string, sync = false) => {
            if (!sessId) {
                setGroups([]);
                return;
            }
            setLoading(true);
            setLoadError(null);
            try {
                const qs = sync ? "?sync=1" : "";
                const res = await fetch(`/api/groups/${sessId}${qs}`);
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setGroups([]);
                    setLoadError(
                        json.message || "Não foi possível listar os grupos"
                    );
                    setConnectionStatus(null);
                    return;
                }
                setGroups(json?.data || []);
                setConnectionStatus(json?.meta?.connectionStatus || null);
            } catch {
                setGroups([]);
                setLoadError("Falha ao buscar grupos");
                toast.error("Falha ao buscar grupos");
            } finally {
                setLoading(false);
            }
        },
        []
    );

    useEffect(() => {
        if (groupsSessionId) {
            void fetchGroups(groupsSessionId, true);
            setSelectedJids(new Set());
            setPage(0);
        } else {
            setGroups([]);
        }
    }, [groupsSessionId, fetchGroups]);

    const selectedSession = baileysSessions.find(
        (s) => s.id === groupsSessionId
    );
    const sessionConnected =
        (connectionStatus || selectedSession?.status || "").toUpperCase() ===
        "CONNECTED";

    const handleCreateGroup = async () => {
        if (!groupsSessionId || !newGroupName) return;
        if (!sessionConnected) {
            toast.error("Sessão desconectada — reconecte em Sessões / QR");
            return;
        }
        try {
            const res = await fetch(`/api/groups/${groupsSessionId}/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId: groupsSessionId,
                    subject: newGroupName,
                }),
            });
            if (res.ok) {
                toast.success("Grupo criado");
                setIsCreateOpen(false);
                setNewGroupName("");
                void fetchGroups(groupsSessionId, true);
            } else {
                toast.error("Falha ao criar grupo");
            }
        } catch {
            toast.error("Falha ao criar grupo");
        }
    };

    const loadParticipants = async (
        group: Group
    ): Promise<GroupParticipantClassification> => {
        if (!groupsSessionId) {
            return classifyGroupParticipants([]);
        }
        let participants: unknown[] = [];
        try {
            const liveRes = await fetch(
                `/api/groups/${groupsSessionId}/${encodeURIComponent(group.jid)}`
            );
            if (liveRes.ok) {
                const meta = await liveRes.json();
                participants = meta?.participants || [];
            }
        } catch {
            /* fallback */
        }
        if (!participants.length) {
            participants = group.participants || [];
        }
        return classifyGroupParticipants(participants);
    };

    const openExtractModal = async (group: Group) => {
        setExtractGroup(group);
        setExtractStats(null);
        setExtractOpen(true);
        setExtractLoading(true);
        try {
            const stats = await loadParticipants(group);
            setExtractStats(stats);
            if (stats.uniquePhoneCount === 0) {
                toast.message(
                    "Nenhum telefone acessível — participantes podem estar só com LID"
                );
            }
        } catch {
            toast.error("Falha ao extrair números do grupo");
            setExtractOpen(false);
        } finally {
            setExtractLoading(false);
        }
    };

    const extractSelectedGroups = async (): Promise<GroupParticipantClassification> => {
        const selected = groups.filter((g) => selectedJids.has(g.jid));
        if (!selected.length) {
            return classifyGroupParticipants([]);
        }
        const allParts: unknown[] = [];
        for (const g of selected) {
            let participants: unknown[] = [];
            try {
                const liveRes = await fetch(
                    `/api/groups/${groupsSessionId}/${encodeURIComponent(g.jid)}`
                );
                if (liveRes.ok) {
                    const meta = await liveRes.json();
                    participants = meta?.participants || [];
                }
            } catch {
                /* fallback */
            }
            if (!participants.length) {
                participants = g.participants || [];
            }
            allParts.push(...participants);
        }
        return classifyGroupParticipants(allParts);
    };

    const phones = extractStats?.phones || [];

    const handleCopy = async () => {
        if (!phones.length) return;
        setActionBusy("copy");
        try {
            await navigator.clipboard.writeText(phones.join("\n"));
            toast.success(`${phones.length} número(s) copiado(s)`);
        } catch {
            toast.error("Não foi possível copiar. Use Salvar arquivo.");
        } finally {
            setActionBusy(null);
        }
    };

    const handleSaveFile = () => {
        if (!phones.length || !extractGroup) return;
        setActionBusy("save");
        try {
            const slug = (extractGroup.subject || "grupo")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^\w\-]+/g, "_")
                .replace(/_+/g, "_")
                .slice(0, 40);
            const filename = `numeros_${slug || "grupo"}.txt`;
            const blob = new Blob([phones.join("\n") + "\n"], {
                type: "text/plain;charset=utf-8",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success(`Arquivo salvo: ${filename}`);
        } catch {
            toast.error("Falha ao salvar arquivo");
        } finally {
            setActionBusy(null);
        }
    };

    const savePhonesToCrm = async (list: string[]) => {
        if (!list.length) {
            toast.error("Nenhum número válido para salvar");
            return;
        }
        const res = await fetch("/api/crm/contacts/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: list.join("\n"),
                origin: "baileys",
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(json.message || "Falha ao salvar no CRM");
        }
        toast.success(
            `CRM: ${json.data?.created ?? 0} criado(s) · ${json.data?.skipped ?? 0} já existia(m). Consentimento não concedido.`
        );
    };

    const handleSaveCrm = async () => {
        setActionBusy("crm");
        try {
            await savePhonesToCrm(phones);
        } catch (e) {
            toast.error(
                e instanceof Error ? e.message : "Falha ao salvar no CRM"
            );
        } finally {
            setActionBusy(null);
        }
    };

    const handleUseInBroadcast = async () => {
        if (!phones.length || !extractGroup) return;
        setActionBusy("broadcast");
        try {
            sessionStorage.setItem(
                BROADCAST_IMPORT_KEY,
                JSON.stringify({
                    phones,
                    groupJid: extractGroup.jid,
                    subject: extractGroup.subject,
                })
            );
            toast.success(`${phones.length} número(s) prontos no Disparo Baileys`);
            setExtractOpen(false);
            router.push("/dashboard/broadcast");
        } catch {
            toast.error("Falha ao enviar números ao Disparo");
        } finally {
            setActionBusy(null);
        }
    };

    const handleUseInDatafy = async () => {
        if (!phones.length) return;
        setActionBusy("datafy");
        try {
            sessionStorage.setItem(
                DATAFY_GROUP_IMPORT_KEY,
                JSON.stringify({
                    phones,
                    sessionId: groupsSessionId,
                    groupJids: extractGroup
                        ? [extractGroup.jid]
                        : Array.from(selectedJids),
                    subject: extractGroup?.subject || "Grupos",
                })
            );
            toast.success(
                `${phones.length} número(s) prontos no disparador Datafy (Etapa 2)`
            );
            setExtractOpen(false);
            router.push("/dashboard/broadcast");
        } catch {
            toast.error("Falha ao enviar ao disparador Datafy");
        } finally {
            setActionBusy(null);
        }
    };

    const handleBulkExtract = async () => {
        if (!selectedJids.size) {
            toast.error("Selecione ao menos um grupo");
            return;
        }
        setExtractGroup({
            id: "multi",
            subject: `${selectedJids.size} grupo(s) selecionado(s)`,
            jid: "multi",
        });
        setExtractStats(null);
        setExtractOpen(true);
        setExtractLoading(true);
        try {
            const stats = await extractSelectedGroups();
            setExtractStats(stats);
        } catch {
            toast.error("Falha ao extrair participantes");
            setExtractOpen(false);
        } finally {
            setExtractLoading(false);
        }
    };

    const filteredGroups = groups.filter(
        (g) =>
            (g.subject || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
            g.jid.includes(searchTerm)
    );
    const pageCount = Math.max(1, Math.ceil(filteredGroups.length / PAGE_SIZE));
    const pageGroups = filteredGroups.slice(
        page * PAGE_SIZE,
        page * PAGE_SIZE + PAGE_SIZE
    );

    const toggleJid = (jid: string) => {
        setSelectedJids((prev) => {
            const next = new Set(prev);
            if (next.has(jid)) next.delete(jid);
            else next.add(jid);
            return next;
        });
    };

    const preview = phones.slice(0, 8);
    const selectedParticipantEstimate = groups
        .filter((g) => selectedJids.has(g.jid))
        .reduce(
            (n, g) =>
                n + (Array.isArray(g.participants) ? g.participants.length : 0),
            0
        );

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2 tracking-tight">
                            <Users className="h-5 w-5 sm:h-6 sm:w-6" /> Grupos
                            WhatsApp
                        </h1>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Sessões Baileys às quais você tem acesso — o canal
                            oficial Datafy permanece independente.
                            {isDatafyChannel ? (
                                <span className="block text-xs text-slate-500 mt-0.5">
                                    Canal oficial selecionado na barra; grupos
                                    usam a sessão Baileys abaixo.
                                </span>
                            ) : null}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 sm:flex-none rounded-xl"
                            onClick={() => {
                                void refreshChannels();
                                if (groupsSessionId) {
                                    void fetchGroups(groupsSessionId, true);
                                }
                            }}
                            disabled={loading || channelsLoading}
                        >
                            <RefreshCw
                                className={`h-4 w-4 mr-1 sm:mr-2 ${loading || channelsLoading ? "animate-spin" : ""}`}
                            />
                            Atualizar
                        </Button>
                        <Button
                            size="sm"
                            className="flex-1 sm:flex-none rounded-xl"
                            onClick={() => setIsCreateOpen(true)}
                            disabled={!groupsSessionId || !sessionConnected}
                        >
                            <Plus className="h-4 w-4 mr-1 sm:mr-2" /> Criar
                        </Button>
                    </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
                    <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                        <div className="space-y-1.5">
                            <Label>Sessão Baileys</Label>
                            <Select
                                value={groupsSessionId}
                                onValueChange={setGroupsSessionId}
                                disabled={
                                    channelsLoading || !baileysSessions.length
                                }
                            >
                                <SelectTrigger className="h-11 rounded-xl">
                                    <SelectValue placeholder="Selecione uma sessão…" />
                                </SelectTrigger>
                                <SelectContent>
                                    {baileysSessions.map((s) => (
                                        <SelectItem key={s.id} value={s.id}>
                                            {s.name} · {s.status}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <Badge
                            variant="outline"
                            className={cn(
                                "h-9 px-3 rounded-xl justify-center",
                                sessionConnected
                                    ? "border-emerald-300 text-emerald-800 bg-emerald-50"
                                    : "border-amber-300 text-amber-900 bg-amber-50"
                            )}
                        >
                            {sessionConnected
                                ? "CONNECTED"
                                : connectionStatus ||
                                  selectedSession?.status ||
                                  "—"}
                        </Badge>
                    </div>
                    {!baileysSessions.length && !channelsLoading && (
                        <p className="text-sm text-amber-900 flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            Nenhuma sessão Baileys acessível. Crie ou peça
                            compartilhamento em Sessões / QR.
                        </p>
                    )}
                    {groupsSessionId && !sessionConnected && (
                        <p className="text-sm text-amber-900 flex items-start gap-2">
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                            Sessão desconectada. Reconecte em Sessões / QR —
                            esta tela não altera a conexão.
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1">
                        {groups.length} grupo(s)
                    </span>
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1">
                        {selectedJids.size} selecionado(s)
                    </span>
                    <span className="rounded-lg bg-slate-100 px-2.5 py-1">
                        ~{selectedParticipantEstimate} participante(s) nos
                        selecionados
                    </span>
                    {selectedJids.size > 0 && (
                        <Button
                            size="sm"
                            variant="secondary"
                            className="rounded-xl h-8"
                            onClick={() => void handleBulkExtract()}
                        >
                            <Phone className="h-3.5 w-3.5 mr-1" />
                            Extrair selecionados
                        </Button>
                    )}
                </div>

                <SearchFilter
                    placeholder="Buscar grupos…"
                    onSearch={(q) => {
                        setSearchTerm(q);
                        setPage(0);
                    }}
                />

                {isCreateOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <div className="bg-white dark:bg-background p-4 sm:p-6 rounded-2xl shadow-lg w-full max-w-sm border">
                            <h2 className="text-lg sm:text-xl font-bold mb-4">
                                Criar novo grupo
                            </h2>
                            <div className="space-y-4">
                                <div>
                                    <Label>Nome do grupo</Label>
                                    <Input
                                        value={newGroupName}
                                        onChange={(e) =>
                                            setNewGroupName(e.target.value)
                                        }
                                        placeholder="Meu novo grupo"
                                        className="rounded-xl"
                                    />
                                </div>
                                <div className="flex justify-end gap-2">
                                    <Button
                                        variant="ghost"
                                        onClick={() => setIsCreateOpen(false)}
                                    >
                                        Cancelar
                                    </Button>
                                    <Button onClick={() => void handleCreateGroup()}>
                                        Criar
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {loading || channelsLoading ? (
                    <div className="flex items-center justify-center gap-2 p-10 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando grupos…
                    </div>
                ) : loadError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50/80 p-6 text-sm text-red-900">
                        {loadError}
                    </div>
                ) : filteredGroups.length === 0 ? (
                    <div className="text-center p-10 text-muted-foreground border rounded-2xl bg-slate-50">
                        {groupsSessionId
                            ? sessionConnected
                                ? "Nenhum grupo encontrado nesta sessão."
                                : "Sessão desconectada — conecte em Sessões / QR para sincronizar grupos."
                            : "Selecione uma sessão Baileys."}
                    </div>
                ) : (
                    <>
                        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                            {pageGroups.map((group) => {
                                const checked = selectedJids.has(group.jid);
                                const pCount = Array.isArray(group.participants)
                                    ? group.participants.length
                                    : 0;
                                return (
                                    <div
                                        key={group.id}
                                        className={cn(
                                            "bg-white dark:bg-background p-4 rounded-2xl shadow-sm border flex flex-col gap-3 transition-colors",
                                            checked &&
                                                "border-emerald-300 ring-1 ring-emerald-200"
                                        )}
                                    >
                                        <label className="flex items-start gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                className="mt-1"
                                                checked={checked}
                                                onChange={() =>
                                                    toggleJid(group.jid)
                                                }
                                            />
                                            <div className="min-w-0">
                                                <h3 className="font-semibold text-[15px] tracking-tight truncate">
                                                    {group.subject || "Sem nome"}
                                                </h3>
                                                <div className="text-[11px] text-muted-foreground mt-1 break-all font-mono">
                                                    {group.jid}
                                                </div>
                                                <div className="text-xs text-slate-500 mt-1">
                                                    {pCount} participante(s)
                                                </div>
                                            </div>
                                        </label>
                                        <div className="flex flex-wrap gap-2 mt-auto">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                className="rounded-xl"
                                                disabled={!groupsSessionId}
                                                onClick={() =>
                                                    void openExtractModal(group)
                                                }
                                            >
                                                <Phone className="h-3.5 w-3.5 mr-1" />
                                                Extrair
                                            </Button>
                                            <Button
                                                size="sm"
                                                className="rounded-xl"
                                                disabled={!groupsSessionId}
                                                onClick={() =>
                                                    void openExtractModal(group)
                                                }
                                            >
                                                <Megaphone className="h-3.5 w-3.5 mr-1" />
                                                Usar
                                            </Button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                        {pageCount > 1 && (
                            <div className="flex items-center justify-between gap-2 pt-1">
                                <p className="text-xs text-muted-foreground">
                                    Página {page + 1} de {pageCount}
                                </p>
                                <div className="flex gap-2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="rounded-xl"
                                        disabled={page <= 0}
                                        onClick={() =>
                                            setPage((p) => Math.max(0, p - 1))
                                        }
                                    >
                                        Anterior
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="rounded-xl"
                                        disabled={page >= pageCount - 1}
                                        onClick={() =>
                                            setPage((p) =>
                                                Math.min(pageCount - 1, p + 1)
                                            )
                                        }
                                    >
                                        Próxima
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}

                <Dialog open={extractOpen} onOpenChange={setExtractOpen}>
                    <DialogContent className="sm:max-w-lg p-0 overflow-hidden border-0 shadow-2xl">
                        <div className="relative bg-gradient-to-br from-emerald-600 via-teal-600 to-slate-900 px-6 pt-6 pb-8 text-white">
                            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_white,_transparent_55%)]" />
                            <DialogHeader className="relative space-y-2">
                                <DialogTitle className="text-xl font-semibold tracking-tight text-white">
                                    Participantes do grupo
                                </DialogTitle>
                                <DialogDescription className="text-emerald-50/90">
                                    {extractGroup?.subject || "Grupo"} — LIDs
                                    não são tratados como telefone. Consentimento
                                    de marketing não é concedido.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="relative mt-5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                                {[
                                    {
                                        n: extractLoading
                                            ? "…"
                                            : extractStats?.uniquePhoneCount ??
                                              0,
                                        l: "válidos únicos",
                                    },
                                    {
                                        n: extractLoading
                                            ? "…"
                                            : extractStats?.participantCount ??
                                              0,
                                        l: "participantes",
                                    },
                                    {
                                        n: extractLoading
                                            ? "…"
                                            : extractStats?.lidOnly ?? 0,
                                        l: "só LID",
                                    },
                                    {
                                        n: extractLoading
                                            ? "…"
                                            : (extractStats?.duplicates ?? 0) +
                                              (extractStats?.noPhone ?? 0) +
                                              (extractStats?.invalid ?? 0),
                                        l: "dup./sem nº",
                                    },
                                ].map((c) => (
                                    <div
                                        key={c.l}
                                        className="rounded-xl bg-white/10 backdrop-blur px-3 py-2.5 border border-white/15"
                                    >
                                        <div className="text-2xl font-bold leading-none">
                                            {c.n}
                                        </div>
                                        <div className="text-[10px] mt-1 text-emerald-50/80">
                                            {c.l}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="px-6 py-5 space-y-4 bg-background">
                            {extractLoading ? (
                                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    Extraindo participantes…
                                </div>
                            ) : phones.length === 0 ? (
                                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                                    Nenhum número de telefone acessível.
                                    Identificadores internos (@lid) foram
                                    ignorados.
                                </div>
                            ) : (
                                <>
                                    <div className="rounded-xl border bg-muted/30 p-3 max-h-40 overflow-y-auto font-mono text-xs space-y-1">
                                        {preview.map((phone) => (
                                            <div
                                                key={phone}
                                                className="flex items-center gap-2"
                                            >
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                                <span>
                                                    {formatPhoneDisplay(
                                                        phone
                                                    ) || phone}
                                                </span>
                                            </div>
                                        ))}
                                        {phones.length > preview.length && (
                                            <div className="text-muted-foreground pt-1">
                                                +
                                                {phones.length - preview.length}{" "}
                                                outros…
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid gap-2">
                                        <Button
                                            className="h-11 justify-start gap-3 rounded-xl"
                                            variant="outline"
                                            disabled={!!actionBusy}
                                            onClick={() => void handleCopy()}
                                        >
                                            {actionBusy === "copy" ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Copy className="h-4 w-4 text-emerald-600" />
                                            )}
                                            <div className="text-left">
                                                <div className="font-medium">
                                                    Copiar números
                                                </div>
                                                <div className="text-[11px] text-muted-foreground font-normal">
                                                    Um por linha
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            className="h-11 justify-start gap-3 rounded-xl"
                                            variant="outline"
                                            disabled={!!actionBusy}
                                            onClick={handleSaveFile}
                                        >
                                            {actionBusy === "save" ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Download className="h-4 w-4 text-sky-600" />
                                            )}
                                            <div className="text-left">
                                                <div className="font-medium">
                                                    Salvar arquivo TXT
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            className="h-11 justify-start gap-3 rounded-xl"
                                            variant="outline"
                                            disabled={!!actionBusy}
                                            onClick={() => void handleSaveCrm()}
                                        >
                                            {actionBusy === "crm" ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Contact className="h-4 w-4 text-violet-600" />
                                            )}
                                            <div className="text-left">
                                                <div className="font-medium">
                                                    Salvar contatos no CRM
                                                </div>
                                                <div className="text-[11px] text-muted-foreground font-normal">
                                                    Origem baileys · consentimento
                                                    unknown
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            className="h-11 justify-start gap-3 rounded-xl"
                                            variant="outline"
                                            disabled={!!actionBusy}
                                            onClick={() =>
                                                void handleUseInBroadcast()
                                            }
                                        >
                                            {actionBusy === "broadcast" ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Megaphone className="h-4 w-4" />
                                            )}
                                            <div className="text-left">
                                                <div className="font-medium">
                                                    Usar no Disparo Baileys
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            className="h-11 justify-start gap-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                                            disabled={!!actionBusy}
                                            onClick={() =>
                                                void handleUseInDatafy()
                                            }
                                        >
                                            {actionBusy === "datafy" ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Megaphone className="h-4 w-4" />
                                            )}
                                            <div className="text-left">
                                                <div className="font-medium">
                                                    Usar no disparador Datafy
                                                </div>
                                                <div className="text-[11px] text-emerald-50/90 font-normal">
                                                    Envio real continua pela API
                                                    oficial
                                                </div>
                                            </div>
                                        </Button>
                                    </div>

                                    <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                                        <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                        Participar de grupo ≠ consentimento de
                                        marketing. O envio oficial usa a Datafy.
                                    </p>
                                </>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
