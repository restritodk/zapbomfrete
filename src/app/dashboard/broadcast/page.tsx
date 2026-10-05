"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    RefreshCw,
    Send,
    CheckCircle2,
    XCircle,
    Radio,
    Clock,
    AlertTriangle,
    History,
    Eye,
    Calendar,
    Upload,
    Users,
    Wand2,
    ImagePlus,
    FileText,
    X,
    Paperclip,
} from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { useSocket } from "@/components/chat/socket-context";
import {
    BROADCAST_IMPORT_KEY,
    extractPhonesFromParticipants,
    parsePhoneList,
    toWhatsAppJid,
} from "@/lib/phone-br";

interface BroadcastProgress {
    broadcastId: string;
    status: "running" | "completed";
    total: number;
    sent: number;
    failed: number;
    current?: string | null;
    progress?: number;
    errors?: { jid: string; error: string }[];
    startedAt?: string;
    completedAt?: string;
}

interface BroadcastLog {
    id: string;
    sessionId: string;
    message: string;
    total: number;
    sent: number;
    failed: number;
    status: string;
    delay: number;
    startedAt: string;
    completedAt: string | null;
    _count?: { recipients: number };
    recipients?: BroadcastRecipient[];
}

interface BroadcastRecipient {
    id: string;
    jid: string;
    status: string;
    error: string | null;
    sentAt: string | null;
}

interface GroupItem {
    id: string;
    subject: string;
    jid: string;
    participants?: unknown[];
}

interface BroadcastAttachment {
    id: string;
    file: File;
    previewUrl: string | null;
    kind: "image" | "document";
}

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

function classifyAttachment(file: File): "image" | "document" | null {
    const mt = (file.type || "").toLowerCase();
    const name = file.name.toLowerCase();
    if (mt.startsWith("image/") || /\.(jpe?g|png|gif|webp|bmp)$/i.test(name)) return "image";
    if (mt === "application/pdf" || name.endsWith(".pdf")) return "document";
    return null;
}

export default function BroadcastPage() {
    const { sessionId } = useSession();
    const [contacts, setContacts] = useState("");
    const [message, setMessage] = useState("");
    const [delay, setDelay] = useState([2000]);
    const [loading, setLoading] = useState(false);
    const [broadcastProgress, setBroadcastProgress] = useState<BroadcastProgress | null>(null);
    const [activeTab, setActiveTab] = useState<"new" | "history">("new");

    const [history, setHistory] = useState<BroadcastLog[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [selectedLog, setSelectedLog] = useState<BroadcastLog | null>(null);
    const [detailOpen, setDetailOpen] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);

    const [groups, setGroups] = useState<GroupItem[]>([]);
    const [selectedGroupJid, setSelectedGroupJid] = useState<string>("");
    const [groupsLoading, setGroupsLoading] = useState(false);
    const [importingGroup, setImportingGroup] = useState(false);
    const [stats, setStats] = useState({ valid: 0, invalid: 0, duplicates: 0 });
    const [attachments, setAttachments] = useState<BroadcastAttachment[]>([]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const mediaInputRef = useRef<HTMLInputElement>(null);
    const attachmentsRef = useRef<BroadcastAttachment[]>([]);
    attachmentsRef.current = attachments;
    const { getSocket, joinSession } = useSocket();

    // Revoke object URLs on unmount
    useEffect(() => {
        return () => {
            attachmentsRef.current.forEach((a) => {
                if (a.previewUrl) URL.revokeObjectURL(a.previewUrl);
            });
        };
    }, []);

    const applyPhones = useCallback((phones: string[], mode: "replace" | "merge" = "replace") => {
        const unique = Array.from(new Set(phones.filter(Boolean)));
        setContacts((prev) => {
            if (mode === "merge" && prev.trim()) {
                const existing = parsePhoneList(prev).phones;
                return Array.from(new Set([...existing, ...unique])).join("\n");
            }
            return unique.join("\n");
        });
        setStats({ valid: unique.length, invalid: 0, duplicates: 0 });
    }, []);

    // Load numbers imported from Groups page
    useEffect(() => {
        try {
            const raw = sessionStorage.getItem(BROADCAST_IMPORT_KEY);
            if (!raw) return;
            sessionStorage.removeItem(BROADCAST_IMPORT_KEY);
            const parsed = JSON.parse(raw);
            const phones: string[] = Array.isArray(parsed?.phones) ? parsed.phones : [];
            if (phones.length > 0) {
                applyPhones(phones, "replace");
                toast.success(`${phones.length} número(s) importado(s) do grupo.`);
            }
        } catch {
            // ignore
        }
    }, [applyPhones]);

    useEffect(() => {
        const socket = getSocket();
        if (!socket || !sessionId) return;

        const onConnect = () => joinSession(sessionId);
        if (socket.connected) joinSession(sessionId);
        socket.on("connect", onConnect);

        const handler = (data: BroadcastProgress) => {
            setBroadcastProgress(data);
            if (data.status === "completed") {
                setLoading(false);
                fetchHistory();
                if (data.failed === 0) {
                    toast.success(`Disparo concluído! ${data.sent} enviado(s).`);
                } else {
                    toast.warning(`Disparo concluído. ${data.sent} enviado(s), ${data.failed} falha(s).`);
                }
            }
        };

        socket.on("broadcast.progress", handler);
        return () => {
            socket.off("connect", onConnect);
            socket.off("broadcast.progress", handler);
        };
    }, [sessionId, getSocket, joinSession]);

    const fetchHistory = useCallback(async () => {
        if (!sessionId) return;
        setHistoryLoading(true);
        try {
            const res = await fetch(`/api/messages/${sessionId}/broadcast/history?limit=20`);
            if (res.ok) {
                const data = await res.json();
                setHistory(data.data || []);
            }
        } catch (e) {
            console.error("Failed to fetch broadcast history", e);
        } finally {
            setHistoryLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        if (activeTab === "history" && sessionId) {
            fetchHistory();
        }
    }, [activeTab, sessionId, fetchHistory]);

    const fetchGroups = useCallback(async () => {
        if (!sessionId) return;
        setGroupsLoading(true);
        try {
            const res = await fetch(`/api/groups/${sessionId}`);
            if (res.ok) {
                const data = await res.json();
                setGroups(data?.data || []);
            }
        } catch {
            toast.error("Falha ao carregar grupos");
        } finally {
            setGroupsLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        if (sessionId) fetchGroups();
        else setGroups([]);
    }, [sessionId, fetchGroups]);

    const openDetail = async (log: BroadcastLog) => {
        setSelectedLog(log);
        setDetailOpen(true);
        setDetailLoading(true);
        try {
            const res = await fetch(`/api/messages/${sessionId}/broadcast/history/${log.id}`);
            if (res.ok) {
                const data = await res.json();
                setSelectedLog(data.data);
            }
        } catch (e) {
            console.error("Failed to fetch broadcast detail", e);
        } finally {
            setDetailLoading(false);
        }
    };

    const handleNormalize = () => {
        const { phones, invalid, duplicates } = parsePhoneList(contacts);
        setContacts(phones.join("\n"));
        setStats({ valid: phones.length, invalid: invalid.length, duplicates });
        if (phones.length === 0) {
            toast.error("Nenhum número válido encontrado");
            return;
        }
        toast.success(
            `Normalizado: ${phones.length} válido(s)` +
                (invalid.length ? `, ${invalid.length} inválido(s)` : "") +
                (duplicates ? `, ${duplicates} duplicado(s)` : "")
        );
    };

    const handleImportGroup = async () => {
        if (!sessionId || !selectedGroupJid) {
            return toast.error("Selecione um grupo");
        }
        setImportingGroup(true);
        try {
            let participants: unknown[] = [];

            // Prefer live metadata
            try {
                const liveRes = await fetch(
                    `/api/groups/${sessionId}/${encodeURIComponent(selectedGroupJid)}`
                );
                if (liveRes.ok) {
                    const meta = await liveRes.json();
                    participants = meta?.participants || [];
                }
            } catch {
                // fallback below
            }

            if (!participants.length) {
                const group = groups.find((g) => g.jid === selectedGroupJid);
                participants = (group?.participants as unknown[]) || [];
            }

            const phones = extractPhonesFromParticipants(participants);
            if (phones.length === 0) {
                toast.error("Nenhum número de telefone encontrado neste grupo (pode haver apenas LIDs)");
                return;
            }
            applyPhones(phones, "merge");
            toast.success(`${phones.length} número(s) extraído(s) do grupo (DDI 55 aplicado).`);
        } catch {
            toast.error("Falha ao extrair números do grupo");
        } finally {
            setImportingGroup(false);
        }
    };

    const handleFileImport = async (file: File) => {
        try {
            const text = await file.text();
            const { phones, invalid, duplicates } = parsePhoneList(text);
            if (phones.length === 0) {
                toast.error("Arquivo sem números válidos");
                setStats({ valid: 0, invalid: invalid.length, duplicates });
                return;
            }
            applyPhones(phones, "merge");
            setStats({ valid: phones.length, invalid: invalid.length, duplicates });
            toast.success(
                `Importados ${phones.length} número(s)` +
                    (invalid.length ? ` (${invalid.length} inválido(s))` : "") +
                    (duplicates ? ` (${duplicates} duplicado(s))` : "")
            );
        } catch {
            toast.error("Falha ao ler o arquivo");
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const handleAddAttachments = (files: FileList | File[]) => {
        const incoming = Array.from(files);
        if (incoming.length === 0) return;

        setAttachments((prev) => {
            const room = MAX_ATTACHMENTS - prev.length;
            if (room <= 0) {
                toast.error(`Máximo de ${MAX_ATTACHMENTS} anexos`);
                return prev;
            }

            const next = [...prev];
            for (const file of incoming.slice(0, room)) {
                if (file.size > MAX_FILE_BYTES) {
                    toast.error(`${file.name}: máximo 16MB`);
                    continue;
                }
                const kind = classifyAttachment(file);
                if (!kind) {
                    toast.error(`${file.name}: use imagem ou PDF`);
                    continue;
                }
                next.push({
                    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    file,
                    previewUrl: kind === "image" ? URL.createObjectURL(file) : null,
                    kind,
                });
            }
            if (incoming.length > room) {
                toast.warning(`Apenas ${room} arquivo(s) adicionados (máx. ${MAX_ATTACHMENTS})`);
            }
            return next;
        });

        if (mediaInputRef.current) mediaInputRef.current.value = "";
    };

    const removeAttachment = (id: string) => {
        setAttachments((prev) => {
            const target = prev.find((a) => a.id === id);
            if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
            return prev.filter((a) => a.id !== id);
        });
    };

    const handleSend = async () => {
        if (!sessionId) return toast.error("Nenhuma sessão ativa");
        if (!message.trim() && attachments.length === 0) {
            return toast.error("Digite uma mensagem ou anexe imagens/PDF");
        }
        setLoading(true);
        setBroadcastProgress(null);

        try {
            const { phones } = parsePhoneList(contacts);
            const recipients = phones.map((p) => toWhatsAppJid(p)).filter(Boolean);

            if (recipients.length === 0) {
                toast.error("Nenhum destinatário válido");
                setLoading(false);
                return;
            }

            // Reflect normalized list in UI
            setContacts(phones.join("\n"));

            const formData = new FormData();
            formData.append("message", message);
            formData.append("delay", String(delay[0]));
            formData.append("recipients", JSON.stringify(recipients));
            for (const att of attachments) {
                formData.append("files", att.file, att.file.name);
            }

            const res = await fetch(`/api/messages/${sessionId}/broadcast`, {
                method: "POST",
                body: formData,
            });

            const data = await res.json();

            if (res.ok) {
                const attInfo = attachments.length
                    ? ` com ${attachments.length} anexo(s)`
                    : "";
                toast.info(`Disparo iniciado para ${recipients.length} destinatário(s)${attInfo}...`);
            } else {
                toast.error(data.message || "Falha ao iniciar o disparo");
                setLoading(false);
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao enviar disparo");
            setLoading(false);
        }
    };

    const recipientCount = parsePhoneList(contacts).phones.length;
    const formatJid = (jid: string) => {
        if (!jid) return "-";
        return jid.replace("@s.whatsapp.net", "").replace("@g.us", " (Grupo)");
    };

    const formatTime = (ts: string) => {
        const d = new Date(ts);
        return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    };

    const statusLabel = (status: string) => {
        if (status === "sent") return "enviado";
        if (status === "failed") return "falhou";
        if (status === "pending") return "pendente";
        if (status === "running") return "em andamento";
        if (status === "completed") return "concluído";
        return status;
    };

    const tabs = [
        { id: "new" as const, label: "Novo disparo", icon: Send },
        { id: "history" as const, label: "Histórico", icon: History },
    ];

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div>
                    <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Disparo em massa</h2>
                    <p className="text-muted-foreground text-sm mt-1">
                        Envie mensagens para vários números. Números sem DDI recebem +55 automaticamente.
                    </p>
                </div>

                <div className="flex gap-1 bg-muted/50 p-1 rounded-lg w-fit">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all ${
                                activeTab === tab.id
                                    ? "bg-background shadow-sm text-foreground"
                                    : "text-muted-foreground hover:text-foreground"
                            }`}
                        >
                            <tab.icon className="h-4 w-4" />
                            {tab.label}
                        </button>
                    ))}
                </div>

                {activeTab === "new" && (
                    <>
                        <div className="grid gap-4 sm:gap-6 grid-cols-1 md:grid-cols-2">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Destinatários</CardTitle>
                                    <CardDescription>
                                        Cole números, importe arquivo ou extraia de um grupo. Ex.: 45991253256 → 5545991253256
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Importar do grupo</Label>
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            <Select value={selectedGroupJid} onValueChange={setSelectedGroupJid}>
                                                <SelectTrigger className="flex-1">
                                                    <SelectValue placeholder={groupsLoading ? "Carregando grupos..." : "Selecione um grupo"} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {groups.map((g) => (
                                                        <SelectItem key={g.jid} value={g.jid}>
                                                            {g.subject || g.jid} ({Array.isArray(g.participants) ? g.participants.length : 0})
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                onClick={handleImportGroup}
                                                disabled={!selectedGroupJid || importingGroup || loading}
                                            >
                                                {importingGroup ? (
                                                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                                ) : (
                                                    <Users className="h-4 w-4 mr-2" />
                                                )}
                                                Extrair
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-2">
                                        <input
                                            ref={fileInputRef}
                                            type="file"
                                            accept=".txt,.csv,text/plain,text/csv"
                                            className="hidden"
                                            onChange={(e) => {
                                                const f = e.target.files?.[0];
                                                if (f) handleFileImport(f);
                                            }}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={loading}
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            <Upload className="h-4 w-4 mr-2" />
                                            Importar TXT/CSV
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            disabled={loading || !contacts.trim()}
                                            onClick={handleNormalize}
                                        >
                                            <Wand2 className="h-4 w-4 mr-2" />
                                            Normalizar (+55)
                                        </Button>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Números (um por linha ou separados por vírgula)</Label>
                                        <Textarea
                                            placeholder={"45991253256\n45991464910\n+55 45 99125-3256"}
                                            className="min-h-[200px] font-mono text-sm"
                                            value={contacts}
                                            onChange={(e) => setContacts(e.target.value)}
                                            disabled={loading}
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            {recipientCount} número(s) válido(s)
                                            {stats.invalid > 0 ? ` · ${stats.invalid} inválido(s)` : ""}
                                            {stats.duplicates > 0 ? ` · ${stats.duplicates} duplicado(s)` : ""}
                                        </p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle>Conteúdo da mensagem</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Mensagem</Label>
                                        <Textarea
                                            placeholder="Digite sua mensagem aqui..."
                                            className="min-h-[150px]"
                                            value={message}
                                            onChange={(e) => setMessage(e.target.value)}
                                            disabled={loading}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <Label className="flex items-center gap-1.5">
                                                <Paperclip className="h-3.5 w-3.5" />
                                                Anexos
                                            </Label>
                                            <span className="text-xs text-muted-foreground">
                                                {attachments.length}/{MAX_ATTACHMENTS} · imagens ou PDF
                                            </span>
                                        </div>

                                        <input
                                            ref={mediaInputRef}
                                            type="file"
                                            accept="image/*,.pdf,application/pdf"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => {
                                                if (e.target.files) handleAddAttachments(e.target.files);
                                            }}
                                        />

                                        {attachments.length > 0 && (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                                {attachments.map((att) => (
                                                    <div
                                                        key={att.id}
                                                        className="relative group rounded-lg border bg-muted/30 overflow-hidden aspect-square sm:aspect-[4/3]"
                                                    >
                                                        {att.kind === "image" && att.previewUrl ? (
                                                            // eslint-disable-next-line @next/next/no-img-element
                                                            <img
                                                                src={att.previewUrl}
                                                                alt={att.file.name}
                                                                className="h-full w-full object-cover"
                                                            />
                                                        ) : (
                                                            <div className="h-full w-full flex flex-col items-center justify-center gap-1 p-2">
                                                                <FileText className="h-8 w-8 text-red-500" />
                                                                <span className="text-[10px] text-center truncate w-full px-1">
                                                                    {att.file.name}
                                                                </span>
                                                            </div>
                                                        )}
                                                        <button
                                                            type="button"
                                                            disabled={loading}
                                                            onClick={() => removeAttachment(att.id)}
                                                            className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-background/90 border shadow flex items-center justify-center opacity-90 hover:opacity-100"
                                                            title="Remover"
                                                        >
                                                            <X className="h-3.5 w-3.5" />
                                                        </button>
                                                        <div className="absolute bottom-0 inset-x-0 bg-black/50 text-white text-[10px] px-1.5 py-0.5 truncate">
                                                            {att.file.name}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="w-full"
                                            disabled={loading || attachments.length >= MAX_ATTACHMENTS}
                                            onClick={() => mediaInputRef.current?.click()}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                if (e.dataTransfer.files?.length) {
                                                    handleAddAttachments(e.dataTransfer.files);
                                                }
                                            }}
                                        >
                                            <ImagePlus className="h-4 w-4 mr-2" />
                                            {attachments.length >= MAX_ATTACHMENTS
                                                ? "Limite de 5 anexos atingido"
                                                : "Adicionar imagens ou PDF"}
                                        </Button>
                                        <p className="text-xs text-muted-foreground">
                                            Até 5 arquivos. A mensagem vai como legenda do primeiro anexo.
                                        </p>
                                    </div>

                                    <div className="space-y-4 pt-2">
                                        <div className="space-y-2">
                                            <Label>Intervalo: {(delay[0] / 1000).toFixed(1)}s</Label>
                                            <Slider
                                                defaultValue={[2000]}
                                                min={1000}
                                                max={15000}
                                                step={500}
                                                value={delay}
                                                onValueChange={setDelay}
                                                disabled={loading}
                                            />
                                            <p className="text-xs text-muted-foreground">
                                                Intervalo entre mensagens (+ aleatório) para reduzir risco de banimento.
                                            </p>
                                        </div>

                                        <Button
                                            className="w-full"
                                            onClick={handleSend}
                                            disabled={
                                                loading ||
                                                !sessionId ||
                                                recipientCount === 0 ||
                                                (!message.trim() && attachments.length === 0)
                                            }
                                        >
                                            {loading ? (
                                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <Send className="mr-2 h-4 w-4" />
                                            )}
                                            {loading
                                                ? "Enviando..."
                                                : attachments.length > 0
                                                  ? `Iniciar disparo (${attachments.length} anexo${attachments.length > 1 ? "s" : ""})`
                                                  : "Iniciar disparo"}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>

                        {broadcastProgress && (
                            <Card
                                className={`border-2 transition-colors ${
                                    broadcastProgress.status === "completed"
                                        ? broadcastProgress.failed === 0
                                            ? "border-green-500/30 bg-green-50/30 dark:bg-green-950/10"
                                            : "border-yellow-500/30 bg-yellow-50/30 dark:bg-yellow-950/10"
                                        : "border-blue-500/30 bg-blue-50/30 dark:bg-blue-950/10"
                                }`}
                            >
                                <CardHeader className="pb-3">
                                    <CardTitle className="flex items-center gap-2 text-lg">
                                        {broadcastProgress.status === "running" ? (
                                            <>
                                                <Radio className="h-5 w-5 text-blue-500 animate-pulse" />
                                                <span>Disparo em andamento</span>
                                            </>
                                        ) : broadcastProgress.failed === 0 ? (
                                            <>
                                                <CheckCircle2 className="h-5 w-5 text-green-500" />
                                                <span>Disparo concluído</span>
                                            </>
                                        ) : (
                                            <>
                                                <AlertTriangle className="h-5 w-5 text-yellow-500" />
                                                <span>Disparo concluído com erros</span>
                                            </>
                                        )}
                                    </CardTitle>
                                    <CardDescription>ID: {broadcastProgress.broadcastId}</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-muted-foreground">Progresso</span>
                                            <span className="font-mono font-medium">
                                                {broadcastProgress.sent + broadcastProgress.failed} / {broadcastProgress.total} (
                                                {broadcastProgress.progress || 0}%)
                                            </span>
                                        </div>
                                        <Progress value={broadcastProgress.progress || 0} className="h-3" />
                                    </div>

                                    <div className="grid grid-cols-3 gap-3">
                                        <div className="bg-background rounded-lg p-3 text-center border">
                                            <div className="text-2xl font-bold text-green-600">{broadcastProgress.sent}</div>
                                            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                                <CheckCircle2 className="h-3 w-3" /> Enviados
                                            </div>
                                        </div>
                                        <div className="bg-background rounded-lg p-3 text-center border">
                                            <div className="text-2xl font-bold text-red-500">{broadcastProgress.failed}</div>
                                            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                                <XCircle className="h-3 w-3" /> Falhas
                                            </div>
                                        </div>
                                        <div className="bg-background rounded-lg p-3 text-center border">
                                            <div className="text-2xl font-bold text-muted-foreground">
                                                {broadcastProgress.total - broadcastProgress.sent - broadcastProgress.failed}
                                            </div>
                                            <div className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                                                <Clock className="h-3 w-3" /> Pendentes
                                            </div>
                                        </div>
                                    </div>

                                    {broadcastProgress.status === "running" && broadcastProgress.current && (
                                        <div className="flex items-center gap-2 text-sm px-3 py-2 bg-muted/50 rounded-lg">
                                            <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-500" />
                                            <span className="text-muted-foreground">Enviando para:</span>
                                            <span className="font-mono font-medium">{formatJid(broadcastProgress.current)}</span>
                                        </div>
                                    )}

                                    {broadcastProgress.status === "completed" &&
                                        broadcastProgress.errors &&
                                        broadcastProgress.errors.length > 0 && (
                                            <div className="space-y-2">
                                                <h4 className="text-sm font-semibold text-red-600 flex items-center gap-1.5">
                                                    <XCircle className="h-4 w-4" /> Falhas ({broadcastProgress.errors.length})
                                                </h4>
                                                <div className="max-h-40 overflow-y-auto bg-red-50 dark:bg-red-950/30 rounded-lg p-2 space-y-1">
                                                    {broadcastProgress.errors.map((err, i) => (
                                                        <div
                                                            key={i}
                                                            className="flex justify-between items-center text-xs py-1 px-2 bg-background/60 rounded"
                                                        >
                                                            <span className="font-mono">{formatJid(err.jid)}</span>
                                                            <span className="text-red-500 truncate ml-2 max-w-[200px]">{err.error}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                </CardContent>
                            </Card>
                        )}
                    </>
                )}

                {activeTab === "history" && (
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <History className="h-5 w-5" />
                                Histórico de disparos
                            </CardTitle>
                            <CardDescription>Histórico permanente dos disparos enviados.</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {historyLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                                </div>
                            ) : history.length === 0 ? (
                                <div className="text-center py-8 text-muted-foreground">
                                    <p className="text-sm">Nenhum disparo ainda.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {history.map((log) => (
                                        <div
                                            key={log.id}
                                            className="flex items-center gap-4 p-3 rounded-lg border hover:bg-muted/30 transition-colors"
                                        >
                                            <div className="shrink-0">
                                                {log.status === "completed" ? (
                                                    log.failed === 0 ? (
                                                        <CheckCircle2 className="h-8 w-8 text-green-500" />
                                                    ) : (
                                                        <AlertTriangle className="h-8 w-8 text-yellow-500" />
                                                    )
                                                ) : (
                                                    <Radio className="h-8 w-8 text-blue-500 animate-pulse" />
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium truncate">{log.message}</p>
                                                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                                                    <span className="flex items-center gap-1">
                                                        <CheckCircle2 className="h-3 w-3 text-green-500" /> {log.sent}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <XCircle className="h-3 w-3 text-red-500" /> {log.failed}
                                                    </span>
                                                    <span className="flex items-center gap-1">
                                                        <Calendar className="h-3 w-3" /> {formatTime(log.startedAt)}
                                                    </span>
                                                </div>
                                            </div>

                                            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => openDetail(log)}>
                                                <Eye className="h-4 w-4 mr-1" /> Detalhes
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                {selectedLog?.status === "completed" ? (
                                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                                ) : (
                                    <Radio className="h-5 w-5 text-blue-500 animate-pulse" />
                                )}
                                Detalhes do disparo
                            </DialogTitle>
                        </DialogHeader>

                        {detailLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : selectedLog ? (
                            <div className="flex flex-col gap-4 overflow-hidden min-h-0">
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                                        <div className="text-xl font-bold text-green-600">{selectedLog.sent}</div>
                                        <div className="text-xs text-muted-foreground">Enviados</div>
                                    </div>
                                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                                        <div className="text-xl font-bold text-red-500">{selectedLog.failed}</div>
                                        <div className="text-xs text-muted-foreground">Falhas</div>
                                    </div>
                                    <div className="bg-muted/30 rounded-lg p-3 text-center">
                                        <div className="text-xl font-bold">{selectedLog.total}</div>
                                        <div className="text-xs text-muted-foreground">Total</div>
                                    </div>
                                </div>

                                <div className="bg-muted/30 rounded-lg p-3">
                                    <p className="text-xs text-muted-foreground mb-1">Mensagem:</p>
                                    <p className="text-sm whitespace-pre-wrap break-words">{selectedLog.message}</p>
                                </div>

                                <div className="flex gap-4 text-xs text-muted-foreground">
                                    <span>Início: {formatTime(selectedLog.startedAt)}</span>
                                    {selectedLog.completedAt && <span>Fim: {formatTime(selectedLog.completedAt)}</span>}
                                </div>

                                {selectedLog.recipients && selectedLog.recipients.length > 0 && (
                                    <div className="flex-1 overflow-y-auto min-h-0">
                                        <h4 className="text-sm font-semibold mb-2">
                                            Destinatários ({selectedLog.recipients.length})
                                        </h4>
                                        <div className="space-y-1">
                                            {selectedLog.recipients.map((r) => (
                                                <div
                                                    key={r.id}
                                                    className={`flex items-center justify-between gap-2 text-xs py-1.5 px-2 rounded ${
                                                        r.status === "sent"
                                                            ? "bg-green-500/5"
                                                            : r.status === "failed"
                                                              ? "bg-red-500/5"
                                                              : "bg-muted/30"
                                                    }`}
                                                >
                                                    <span className="font-mono truncate">{formatJid(r.jid)}</span>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        <span
                                                            className={`px-1.5 py-0.5 rounded font-medium ${
                                                                r.status === "sent"
                                                                    ? "text-green-600 bg-green-500/10"
                                                                    : r.status === "failed"
                                                                      ? "text-red-500 bg-red-500/10"
                                                                      : "text-muted-foreground bg-muted/50"
                                                            }`}
                                                        >
                                                            {statusLabel(r.status)}
                                                        </span>
                                                        {r.error && (
                                                            <span className="text-red-500 max-w-[200px] truncate" title={r.error}>
                                                                {r.error}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
