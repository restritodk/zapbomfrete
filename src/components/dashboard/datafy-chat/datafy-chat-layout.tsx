"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
    BadgeCheck,
    Check,
    CheckCheck,
    Clock3,
    Loader2,
    MessageSquare,
    RefreshCw,
    Search,
    Send,
    UserRound,
    AlertCircle,
    Hand,
    ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { io, Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useSession as useAuthSession } from "next-auth/react";
import type {
    DatafyConversationRow,
    DatafyMessageRow,
    ServiceWindow,
} from "./types";

type CrmSidebarContact = {
    id: string;
    waId: string;
    fullName: string | null;
    company: string | null;
    city: string | null;
    state: string | null;
    category: string | null;
    notes: string | null;
    consentStatus: string;
    tags: Array<{ id: string; name: string; colorHex: string }>;
};

function formatPhone(waId: string) {
    const d = waId.replace(/\D/g, "");
    if (d.startsWith("55") && d.length >= 12) {
        const rest = d.slice(2);
        const ddd = rest.slice(0, 2);
        const num = rest.slice(2);
        if (num.length === 9) {
            return `+55 (${ddd}) ${num.slice(0, 5)}-${num.slice(5)}`;
        }
        if (num.length === 8) {
            return `+55 (${ddd}) ${num.slice(0, 4)}-${num.slice(4)}`;
        }
    }
    return waId;
}

function formatTime(iso: string | null) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
        ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
        : d.toLocaleString("pt-BR", {
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
          });
}

function StatusTicks({ status }: { status: string }) {
    if (status === "failed") {
        return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    }
    if (status === "read") {
        return <CheckCheck className="h-3.5 w-3.5 text-sky-500" />;
    }
    if (status === "delivered") {
        return <CheckCheck className="h-3.5 w-3.5 text-slate-400" />;
    }
    if (status === "sent" || status === "accepted") {
        return <Check className="h-3.5 w-3.5 text-slate-400" />;
    }
    return <Clock3 className="h-3.5 w-3.5 text-slate-400" />;
}

export function DatafyChatLayout({
    displayPhoneNumber,
}: {
    displayPhoneNumber?: string | null;
}) {
    const { data: auth } = useAuthSession();
    const userId = auth?.user?.id;
    const searchParams = useSearchParams();
    const deepLinkWaId = searchParams.get("waId")?.replace(/\D/g, "") || null;

    const [conversations, setConversations] = useState<DatafyConversationRow[]>(
        []
    );
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [messages, setMessages] = useState<DatafyMessageRow[]>([]);
    const [windowInfo, setWindowInfo] = useState<ServiceWindow | null>(null);
    const [search, setSearch] = useState("");
    const [draft, setDraft] = useState("");
    const [templateName, setTemplateName] = useState("");
    const [loadingList, setLoadingList] = useState(true);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const [sending, setSending] = useState(false);
    const [crmContact, setCrmContact] = useState<CrmSidebarContact | null>(
        null
    );
    const [crmLoading, setCrmLoading] = useState(false);
    const [templates, setTemplates] = useState<
        Array<{ name: string; language: string; status: string }>
    >([]);
    const bottomRef = useRef<HTMLDivElement>(null);
    const socketRef = useRef<Socket | null>(null);
    const sendingLock = useRef(false);
    const deepLinkApplied = useRef(false);

    const selected = useMemo(
        () => conversations.find((c) => c.id === selectedId) || null,
        [conversations, selectedId]
    );

    const loadConversations = useCallback(async (q?: string) => {
        setLoadingList(true);
        try {
            const params = new URLSearchParams();
            if (q?.trim()) params.set("search", q.trim());
            const res = await fetch(
                `/api/channels/datafy/conversations?${params}`
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha ao carregar conversas");
                return;
            }
            setConversations(json.data?.conversations || []);
        } catch {
            toast.error("Erro ao carregar conversas");
        } finally {
            setLoadingList(false);
        }
    }, []);

    const loadMessages = useCallback(async (id: string) => {
        setLoadingMsgs(true);
        try {
            const [msgRes, convRes] = await Promise.all([
                fetch(`/api/channels/datafy/conversations/${id}/messages`),
                fetch(`/api/channels/datafy/conversations/${id}`),
            ]);
            const msgJson = await msgRes.json().catch(() => ({}));
            const convJson = await convRes.json().catch(() => ({}));
            if (!msgRes.ok) {
                toast.error(msgJson.message || "Falha ao carregar mensagens");
                return;
            }
            setMessages(msgJson.data?.messages || []);
            if (convRes.ok) {
                setWindowInfo(convJson.data?.window || null);
                const conv = convJson.data?.conversation;
                if (conv) {
                    setConversations((prev) => {
                        const idx = prev.findIndex((c) => c.id === conv.id);
                        if (idx === -1) return [conv, ...prev];
                        const next = [...prev];
                        next[idx] = conv;
                        return next;
                    });
                }
            }
            await fetch(`/api/channels/datafy/conversations/${id}/read`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ markProviderRead: true }),
            }).catch(() => null);
        } catch {
            toast.error("Erro ao carregar mensagens");
        } finally {
            setLoadingMsgs(false);
        }
    }, []);

    useEffect(() => {
        void loadConversations(deepLinkWaId || undefined);
    }, [loadConversations, deepLinkWaId]);

    useEffect(() => {
        if (!deepLinkWaId || deepLinkApplied.current || !conversations.length) {
            return;
        }
        const match = conversations.find(
            (c) => c.waId.replace(/\D/g, "") === deepLinkWaId
        );
        if (match) {
            setSelectedId(match.id);
            deepLinkApplied.current = true;
        }
    }, [conversations, deepLinkWaId]);

    useEffect(() => {
        if (selectedId) void loadMessages(selectedId);
    }, [selectedId, loadMessages]);

    useEffect(() => {
        if (!selectedId) {
            setCrmContact(null);
            return;
        }
        let cancelled = false;
        setCrmLoading(true);
        void (async () => {
            try {
                const res = await fetch(
                    `/api/channels/datafy/conversations/${selectedId}/crm`
                );
                const json = await res.json().catch(() => ({}));
                if (cancelled) return;
                if (res.ok) {
                    setCrmContact(json.data?.contact || null);
                } else {
                    setCrmContact(null);
                }
            } catch {
                if (!cancelled) setCrmContact(null);
            } finally {
                if (!cancelled) setCrmLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [selectedId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages.length, selectedId]);

    useEffect(() => {
        const socket = io({
            path: "/api/socket/io",
            addTrailingSlash: false,
        });
        socketRef.current = socket;
        socket.on("connect", () => {
            socket.emit("join-datafy-channel");
        });

        socket.on("datafy.message", (payload: { message?: DatafyMessageRow }) => {
            const m = payload?.message;
            if (!m) return;
            setMessages((prev) => {
                if (m.conversationId !== selectedId) return prev;
                if (prev.some((x) => x.id === m.id || (m.wamid && x.wamid === m.wamid))) {
                    return prev.map((x) =>
                        x.id === m.id || (m.wamid && x.wamid === m.wamid) ? m : x
                    );
                }
                return [...prev, m];
            });
        });

        socket.on(
            "datafy.conversation",
            (payload: { conversation?: DatafyConversationRow }) => {
                const c = payload?.conversation;
                if (!c) return;
                setConversations((prev) => {
                    const rest = prev.filter((x) => x.id !== c.id);
                    return [c, ...rest].sort((a, b) => {
                        const ta = a.lastMessageAt
                            ? new Date(a.lastMessageAt).getTime()
                            : 0;
                        const tb = b.lastMessageAt
                            ? new Date(b.lastMessageAt).getTime()
                            : 0;
                        return tb - ta;
                    });
                });
            }
        );

        socket.on(
            "datafy.status",
            (payload: { message?: DatafyMessageRow }) => {
                const m = payload?.message;
                if (!m) return;
                setMessages((prev) =>
                    prev.map((x) => (x.id === m.id ? { ...x, ...m } : x))
                );
            }
        );

        return () => {
            socket.disconnect();
            socketRef.current = null;
        };
    }, [selectedId]);

    const loadTemplates = async () => {
        try {
            const res = await fetch(
                "/api/integrations/datafy/templates?status=APPROVED"
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                // OWNER may get 403 — that's expected; templates via SUPERADMIN later
                return;
            }
            const rows = Array.isArray(json.data?.data) ? json.data.data : [];
            setTemplates(
                rows.map((t: { name: string; language: string; status: string }) => ({
                    name: t.name,
                    language: t.language,
                    status: t.status,
                }))
            );
        } catch {
            /* ignore */
        }
    };

    useEffect(() => {
        void loadTemplates();
    }, []);

    const sendText = async () => {
        if (!selectedId || !draft.trim() || sendingLock.current) return;
        sendingLock.current = true;
        setSending(true);
        const clientMessageId = `cli_${crypto.randomUUID()}`;
        const text = draft.trim();
        setDraft("");
        try {
            const res = await fetch(
                `/api/channels/datafy/conversations/${selectedId}/messages`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        kind: "text",
                        text,
                        clientMessageId,
                    }),
                }
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha ao enviar");
                setDraft(text);
                return;
            }
            const message = json.data?.message as DatafyMessageRow | undefined;
            if (message) {
                setMessages((prev) =>
                    prev.some((m) => m.id === message.id)
                        ? prev
                        : [...prev, message]
                );
            }
        } catch {
            toast.error("Erro de rede ao enviar");
            setDraft(text);
        } finally {
            setSending(false);
            sendingLock.current = false;
        }
    };

    const sendTemplate = async () => {
        if (!selectedId || !templateName.trim() || sendingLock.current) return;
        sendingLock.current = true;
        setSending(true);
        try {
            const picked =
                templates.find((t) => t.name === templateName.trim()) || null;
            const res = await fetch(
                `/api/channels/datafy/conversations/${selectedId}/messages`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        kind: "template",
                        templateName: templateName.trim(),
                        languageCode: picked?.language || "pt_BR",
                        clientMessageId: `cli_${crypto.randomUUID()}`,
                    }),
                }
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha ao enviar template");
                return;
            }
            const message = json.data?.message as DatafyMessageRow | undefined;
            if (message) {
                setMessages((prev) =>
                    prev.some((m) => m.id === message.id)
                        ? prev
                        : [...prev, message]
                );
            }
            toast.success("Template enviado");
        } catch {
            toast.error("Erro ao enviar template");
        } finally {
            setSending(false);
            sendingLock.current = false;
        }
    };

    const claim = async () => {
        if (!selectedId) return;
        const res = await fetch(
            `/api/channels/datafy/conversations/${selectedId}/claim`,
            { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(json.message || "Não foi possível assumir");
            return;
        }
        toast.success("Atendimento assumido");
        if (json.data?.conversation) {
            setConversations((prev) =>
                prev.map((c) =>
                    c.id === json.data.conversation.id
                        ? json.data.conversation
                        : c
                )
            );
        }
    };

    const windowOpen = windowInfo?.open ?? false;

    return (
        <div className="flex h-[calc(100vh-6.5rem)] sm:h-[calc(100vh-6rem)] overflow-hidden rounded-2xl border bg-card shadow-sm">
            {/* Conversations */}
            <aside className="flex w-full max-w-[320px] flex-col border-r bg-slate-50/40 md:max-w-[340px]">
                <div className="border-b px-4 py-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 flex items-center gap-1">
                                <BadgeCheck className="h-3.5 w-3.5" />
                                Oficial · Datafy
                            </p>
                            <p className="truncate text-sm font-semibold">
                                Bom Frete — WhatsApp Oficial
                            </p>
                            <p className="truncate text-xs text-muted-foreground font-mono">
                                {displayPhoneNumber
                                    ? formatPhone(
                                          displayPhoneNumber.replace(/\D/g, "")
                                      ) || displayPhoneNumber
                                    : "Número sob consulta"}
                            </p>
                        </div>
                        <Button
                            size="icon"
                            variant="ghost"
                            className="shrink-0"
                            onClick={() => void loadConversations(search)}
                        >
                            <RefreshCw
                                className={cn(
                                    "h-4 w-4",
                                    loadingList && "animate-spin"
                                )}
                            />
                        </Button>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            className="pl-9 h-9 rounded-xl"
                            placeholder="Buscar nome ou telefone"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter")
                                    void loadConversations(search);
                            }}
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {loadingList && conversations.length === 0 ? (
                        <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Carregando…
                        </div>
                    ) : conversations.length === 0 ? (
                        <div className="px-6 py-16 text-center text-sm text-muted-foreground">
                            <MessageSquare className="mx-auto mb-3 h-8 w-8 opacity-40" />
                            Nenhuma conversa ainda. Mensagens recebidas pelo
                            webhook aparecerão aqui automaticamente.
                        </div>
                    ) : (
                        conversations.map((c) => {
                            const active = c.id === selectedId;
                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => setSelectedId(c.id)}
                                    className={cn(
                                        "w-full border-b px-4 py-3 text-left transition-colors",
                                        active
                                            ? "bg-emerald-50/80"
                                            : "hover:bg-muted/50"
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className="truncate font-medium text-sm">
                                                {c.contactName ||
                                                    formatPhone(c.waId)}
                                            </p>
                                            <p className="truncate text-[11px] text-muted-foreground font-mono">
                                                {formatPhone(c.waId)}
                                            </p>
                                        </div>
                                        <span className="shrink-0 text-[10px] text-muted-foreground">
                                            {formatTime(c.lastMessageAt)}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex items-center justify-between gap-2">
                                        <p className="truncate text-xs text-muted-foreground">
                                            {c.lastMessagePreview || "—"}
                                        </p>
                                        {c.unreadCount > 0 && (
                                            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[10px] font-semibold text-white">
                                                {c.unreadCount > 99
                                                    ? "99+"
                                                    : c.unreadCount}
                                            </span>
                                        )}
                                    </div>
                                    {c.assignedTo && (
                                        <p className="mt-1 text-[10px] text-emerald-800/80">
                                            Atendente:{" "}
                                            {c.assignedTo.name ||
                                                c.assignedTo.email}
                                        </p>
                                    )}
                                </button>
                            );
                        })
                    )}
                </div>
            </aside>

            {/* Thread */}
            <section className="flex min-w-0 flex-1 flex-col">
                {!selected ? (
                    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground">
                        <MessageSquare className="mb-3 h-10 w-10 opacity-40" />
                        <p className="font-medium text-foreground">
                            Selecione uma conversa
                        </p>
                        <p className="mt-1 max-w-sm text-sm">
                            Atendimento compartilhado do número oficial Bom
                            Frete via Datafy API.
                        </p>
                    </div>
                ) : (
                    <>
                        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                            <div className="min-w-0">
                                <h2 className="truncate text-base font-semibold">
                                    {selected.contactName ||
                                        formatPhone(selected.waId)}
                                </h2>
                                <p className="text-xs text-muted-foreground font-mono">
                                    {formatPhone(selected.waId)}
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <span
                                    className={cn(
                                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                                        windowOpen
                                            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                            : "border-amber-200 bg-amber-50 text-amber-900"
                                    )}
                                >
                                    {windowOpen
                                        ? "Janela 24h aberta"
                                        : "Janela 24h fechada — use template"}
                                </span>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="rounded-xl"
                                    onClick={() => void claim()}
                                    disabled={selected.assignedToId === userId}
                                >
                                    <Hand className="mr-1.5 h-3.5 w-3.5" />
                                    {selected.assignedToId === userId
                                        ? "Com você"
                                        : "Assumir"}
                                </Button>
                            </div>
                        </header>

                        <div className="flex-1 space-y-2 overflow-y-auto bg-gradient-to-b from-slate-50/40 to-background px-4 py-4">
                            {loadingMsgs ? (
                                <div className="flex justify-center py-10 text-sm text-muted-foreground">
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Carregando histórico…
                                </div>
                            ) : messages.length === 0 ? (
                                <p className="py-10 text-center text-sm text-muted-foreground">
                                    Sem mensagens nesta conversa.
                                </p>
                            ) : (
                                messages.map((m) => {
                                    const outbound = m.direction === "outbound";
                                    return (
                                        <div
                                            key={m.id}
                                            className={cn(
                                                "flex",
                                                outbound
                                                    ? "justify-end"
                                                    : "justify-start"
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm",
                                                    outbound
                                                        ? "rounded-br-md bg-emerald-600 text-white"
                                                        : "rounded-bl-md border bg-white text-foreground"
                                                )}
                                            >
                                                {m.type !== "text" &&
                                                    m.type !== "template" && (
                                                        <p
                                                            className={cn(
                                                                "mb-1 text-[10px] uppercase tracking-wide",
                                                                outbound
                                                                    ? "text-emerald-100"
                                                                    : "text-muted-foreground"
                                                            )}
                                                        >
                                                            {m.type}
                                                            {m.mediaId
                                                                ? " · mídia"
                                                                : ""}
                                                        </p>
                                                    )}
                                                <p className="whitespace-pre-wrap break-words">
                                                    {m.body || m.caption || "—"}
                                                </p>
                                                {m.errorMessage && (
                                                    <p className="mt-1 text-[11px] text-red-200">
                                                        {m.errorMessage}
                                                    </p>
                                                )}
                                                <div
                                                    className={cn(
                                                        "mt-1 flex items-center justify-end gap-1 text-[10px]",
                                                        outbound
                                                            ? "text-emerald-100"
                                                            : "text-muted-foreground"
                                                    )}
                                                >
                                                    <span>
                                                        {formatTime(
                                                            m.providerTimestamp ||
                                                                m.createdAt
                                                        )}
                                                    </span>
                                                    {outbound && (
                                                        <StatusTicks
                                                            status={m.status}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                            <div ref={bottomRef} />
                        </div>

                        <footer className="border-t bg-background px-4 py-3 space-y-2">
                            {windowOpen ? (
                                <div className="flex items-end gap-2">
                                    <Textarea
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        placeholder="Digite a mensagem…"
                                        className="min-h-[44px] max-h-32 resize-none rounded-xl"
                                        onKeyDown={(e) => {
                                            if (
                                                e.key === "Enter" &&
                                                !e.shiftKey
                                            ) {
                                                e.preventDefault();
                                                void sendText();
                                            }
                                        }}
                                    />
                                    <Button
                                        className="h-11 rounded-xl px-4"
                                        disabled={
                                            sending || !draft.trim()
                                        }
                                        onClick={() => void sendText()}
                                    >
                                        {sending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Send className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            ) : (
                                <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                                    <p className="text-xs text-amber-900">
                                        Fora da janela de 24 horas. Envie um
                                        template aprovado pela Meta para
                                        retomar.
                                    </p>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <Input
                                            list="datafy-templates"
                                            value={templateName}
                                            onChange={(e) =>
                                                setTemplateName(e.target.value)
                                            }
                                            placeholder="Nome do template (ex.: aviso_horario)"
                                            className="rounded-xl bg-white"
                                        />
                                        <datalist id="datafy-templates">
                                            {templates.map((t) => (
                                                <option
                                                    key={`${t.name}-${t.language}`}
                                                    value={t.name}
                                                />
                                            ))}
                                        </datalist>
                                        <Button
                                            className="rounded-xl"
                                            disabled={
                                                sending || !templateName.trim()
                                            }
                                            onClick={() => void sendTemplate()}
                                        >
                                            Enviar template
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </footer>
                    </>
                )}
            </section>

            {/* Contact / CRM panel */}
            <aside className="hidden w-[280px] flex-col border-l bg-slate-50/30 lg:flex">
                <div className="border-b px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Contato CRM
                    </p>
                </div>
                {selected ? (
                    <div className="space-y-4 px-4 py-4 text-sm overflow-y-auto">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                            <UserRound className="h-6 w-6" />
                        </div>
                        <div>
                            <p className="font-semibold">
                                {crmContact?.fullName ||
                                    selected.contactName ||
                                    "Sem nome"}
                            </p>
                            <p className="font-mono text-xs text-muted-foreground">
                                {formatPhone(selected.waId)}
                            </p>
                        </div>
                        {crmLoading ? (
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Carregando CRM…
                            </p>
                        ) : crmContact ? (
                            <div className="space-y-2 rounded-xl border bg-white p-3 text-xs">
                                <p>
                                    <span className="text-muted-foreground">
                                        Empresa:
                                    </span>{" "}
                                    {crmContact.company || "—"}
                                </p>
                                <p>
                                    <span className="text-muted-foreground">
                                        Local:
                                    </span>{" "}
                                    {[crmContact.city, crmContact.state]
                                        .filter(Boolean)
                                        .join(" / ") || "—"}
                                </p>
                                <p>
                                    <span className="text-muted-foreground">
                                        Categoria:
                                    </span>{" "}
                                    {crmContact.category || "—"}
                                </p>
                                <p>
                                    <span className="text-muted-foreground">
                                        Consentimento:
                                    </span>{" "}
                                    {crmContact.consentStatus.replace("_", " ")}
                                </p>
                                {crmContact.tags.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-1">
                                        {crmContact.tags.map((t) => (
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
                                )}
                                {crmContact.notes && (
                                    <p className="pt-1 whitespace-pre-wrap text-muted-foreground">
                                        {crmContact.notes}
                                    </p>
                                )}
                                <Button
                                    asChild
                                    size="sm"
                                    variant="outline"
                                    className="mt-2 w-full rounded-xl"
                                >
                                    <Link
                                        href="/dashboard/contacts"
                                    >
                                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                        Abrir no CRM
                                    </Link>
                                </Button>
                            </div>
                        ) : (
                            <p className="text-xs text-muted-foreground rounded-xl border bg-white p-3">
                                Contato ainda não vinculado ao CRM. Será
                                criado automaticamente na próxima mensagem
                                inbound.
                            </p>
                        )}
                        <div className="space-y-2 rounded-xl border bg-white p-3 text-xs">
                            <p>
                                <span className="text-muted-foreground">
                                    Canal:
                                </span>{" "}
                                Datafy oficial
                            </p>
                            <p>
                                <span className="text-muted-foreground">
                                    Última interação:
                                </span>{" "}
                                {formatTime(selected.lastMessageAt) || "—"}
                            </p>
                            <p>
                                <span className="text-muted-foreground">
                                    Situação:
                                </span>{" "}
                                {selected.status}
                            </p>
                            <p>
                                <span className="text-muted-foreground">
                                    Atendente:
                                </span>{" "}
                                {selected.assignedTo?.name ||
                                    selected.assignedTo?.email ||
                                    "Não atribuído"}
                            </p>
                            <p>
                                <span className="text-muted-foreground">
                                    Janela:
                                </span>{" "}
                                {windowOpen ? "Aberta" : "Fechada"}
                            </p>
                        </div>
                    </div>
                ) : (
                    <p className="px-4 py-8 text-xs text-muted-foreground">
                        Selecione uma conversa para ver os detalhes.
                    </p>
                )}
            </aside>
        </div>
    );
}
