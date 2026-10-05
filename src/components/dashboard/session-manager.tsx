'use client';

import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from 'next/navigation';
import { toast } from "sonner";
import { Label } from '@/components/ui/label';
import { Smartphone, Plus, Settings, UserPlus, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

type Session = {
    id: string;
    name: string;
    sessionId: string;
    status: string;
    qr?: string | null;
    user?: {
        name: string | null;
        email: string;
    } | null;
};

function statusMeta(status: string) {
    const key = (status || "").toUpperCase();
    if (key === "CONNECTED") {
        return {
            label: "Conectado",
            className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
            dot: "bg-emerald-500 animate-pulse",
        };
    }
    if (key === "QR" || key === "CONNECTING" || key === "OPENING") {
        return {
            label: key === "QR" ? "Aguardando QR" : "Conectando",
            className: "bg-amber-500/10 text-amber-700 border-amber-500/25",
            dot: "bg-amber-500 animate-pulse",
        };
    }
    return {
        label: status || "Desconectado",
        className: "bg-muted text-muted-foreground border-border",
        dot: "bg-slate-400",
    };
}

export function SessionManager({ user }: { user: any }) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [newSessionName, setNewSessionName] = useState("");
    const [newSessionId, setNewSessionId] = useState("");
    const [loading, setLoading] = useState(false);
    const [socket, setSocket] = useState<Socket | null>(null);
    const router = useRouter();

    useEffect(() => {
        fetchSessions();

        const socketInstance = io({
            path: "/api/socket/io",
            addTrailingSlash: false,
        });

        socketInstance.on('connect', () => {
            console.log('Socket connected');
        });

        socketInstance.on('connection.update', (data: { sessionId: string, status: string, qr: string }) => {
            setSessions(prev => prev.map(s => {
                if (s.sessionId === data.sessionId) {
                    return { ...s, status: data.status, qr: data.qr };
                }
                return s;
            }));

            if (data.status === 'CONNECTED') {
                fetchSessions();
            }
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, []);

    const fetchSessions = () => {
        fetch('/api/sessions').then(res => res.json()).then(responseData => {
            const data = responseData?.data || [];
            if (Array.isArray(data)) setSessions(data);
        });
    }

    const createSession = async () => {
        if (!newSessionName) {
            toast.error("O nome da sessão é obrigatório");
            return;
        }

        if (newSessionId && sessions.some(s => s.sessionId === newSessionId)) {
            toast.error("O ID da sessão já existe");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    name: newSessionName,
                    sessionId: newSessionId || undefined
                })
            });
            const responseData = await res.json();
            const session = responseData?.data;

            if (!res.ok || !session) throw new Error(responseData.error || responseData.message || "Falha ao criar");

            setSessions([...sessions, session]);
            setNewSessionName("");
            setNewSessionId("");
            toast.success("Sessão criada com sucesso");
        } catch (e: any) {
            console.error(e);
            toast.error(e.message || "Falha ao criar sessão");
        } finally {
            setLoading(false);
        }
    };

    const handleManageSession = (sessionId: string) => {
        router.push(`/dashboard/sessions/${sessionId}`);
    }

    const connectedCount = sessions.filter(s => (s.status || "").toUpperCase() === "CONNECTED").length;

    return (
        <div className="w-full space-y-6">
            {/* Hero */}
            <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.07] via-background to-emerald-500/[0.05] px-5 py-6 sm:px-8 sm:py-8">
                <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-emerald-400/10 blur-3xl" />
                <div className="relative flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
                    <div className="space-y-1.5">
                        <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary/80">
                            <Smartphone className="h-3.5 w-3.5" />
                            Conexões WhatsApp
                        </div>
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Gerenciar sessões</h1>
                        <p className="text-sm text-muted-foreground max-w-xl">
                            Conecte e administre contas WhatsApp. Cada sessão pode ser compartilhada e gerenciada separadamente.
                        </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                        <div className="rounded-xl border bg-background/80 px-3.5 py-2 backdrop-blur-sm">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
                            <p className="text-lg font-semibold tabular-nums leading-none mt-0.5">{sessions.length}</p>
                        </div>
                        <div className="rounded-xl border bg-background/80 px-3.5 py-2 backdrop-blur-sm">
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Online</p>
                            <p className="text-lg font-semibold tabular-nums leading-none mt-0.5 text-emerald-600">{connectedCount}</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Create session */}
            <div className="rounded-2xl border bg-card p-5 sm:p-6 shadow-sm">
                <div className="flex items-start gap-3 mb-5">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Plus className="h-5 w-5" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold tracking-tight">Criar nova sessão</h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Adicione uma nova conta WhatsApp para gerenciar.
                        </p>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-x-4 gap-y-2 items-start">
                    <div className="space-y-2">
                        <Label htmlFor="session-name">Nome da sessão</Label>
                        <Input
                            id="session-name"
                            value={newSessionName}
                            onChange={e => setNewSessionName(e.target.value)}
                            placeholder="Ex.: Casa, Comercial, Suporte"
                            className="h-11"
                            onKeyDown={(e) => e.key === "Enter" && createSession()}
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="session-id">
                            ID personalizado{" "}
                            <span className="text-muted-foreground font-normal">(opcional)</span>
                        </Label>
                        <Input
                            id="session-id"
                            value={newSessionId}
                            onChange={e => setNewSessionId(e.target.value.replace(/[^a-zA-Z0-9-_]/g, ''))}
                            placeholder="id-unico-123"
                            className="h-11"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="invisible select-none pointer-events-none hidden lg:block">Ação</Label>
                        <Button
                            onClick={createSession}
                            disabled={loading || !newSessionName.trim()}
                            size="lg"
                            className="h-11 w-full lg:w-auto px-6 active:scale-[0.98] transition-transform"
                        >
                            {loading ? (
                                <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Criando...
                                </>
                            ) : (
                                <>
                                    <Plus className="h-4 w-4 mr-2" />
                                    Criar sessão
                                </>
                            )}
                        </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground lg:col-start-2">
                        ID: apenas letras, números e hífens.
                    </p>
                </div>
            </div>

            {/* Sessions list */}
            <div className="space-y-3">
                <div className="flex items-end justify-between gap-3 px-0.5">
                    <div>
                        <h2 className="text-base font-semibold tracking-tight">
                            Suas sessões
                        </h2>
                        <p className="text-sm text-muted-foreground">
                            Status em tempo real e ações rápidas.
                        </p>
                    </div>
                </div>

                {sessions.length === 0 ? (
                    <div className="w-full rounded-2xl border border-dashed bg-muted/20 px-6 py-16 text-center">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-5">
                            <Smartphone className="w-8 h-8 text-primary/70" />
                        </div>
                        <h3 className="text-lg font-semibold">Nenhuma sessão ainda</h3>
                        <p className="text-muted-foreground mt-1 mb-1 max-w-md mx-auto text-sm">
                            Crie sua primeira sessão acima para conectar uma conta WhatsApp e começar a usar o painel.
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {sessions.map((session) => {
                            const meta = statusMeta(session.status);
                            return (
                                <div
                                    key={session.id}
                                    className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-shadow duration-200 ease-out hover:shadow-md"
                                >
                                    <div className={`h-1 w-full ${session.status?.toUpperCase() === "CONNECTED" ? "bg-emerald-500" : "bg-border"}`} />
                                    <div className="p-5 flex flex-col gap-4 flex-1">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-start gap-3 min-w-0">
                                                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                                    <Smartphone className="h-5 w-5" />
                                                </div>
                                                <div className="min-w-0">
                                                    <h3 className="font-semibold text-base truncate">{session.name}</h3>
                                                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                                                        {session.sessionId}
                                                    </p>
                                                </div>
                                            </div>
                                            <Badge
                                                variant="outline"
                                                className={`text-[10px] font-semibold px-2 py-0.5 shrink-0 inline-flex items-center gap-1.5 border ${meta.className}`}
                                            >
                                                <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                                                {meta.label}
                                            </Badge>
                                        </div>

                                        <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Proprietário</p>
                                            {session.user ? (
                                                <div>
                                                    <p className="text-sm font-medium truncate">{session.user.name || "Sem nome"}</p>
                                                    <p className="text-[11px] text-muted-foreground truncate">{session.user.email}</p>
                                                </div>
                                            ) : (
                                                <p className="text-sm text-muted-foreground">—</p>
                                            )}
                                        </div>

                                        <div className="flex items-center gap-2 pt-1 mt-auto">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-9 flex-1 rounded-xl active:scale-[0.98] transition-transform"
                                                onClick={() => router.push(`/dashboard/sessions/access?session=${session.sessionId}`)}
                                            >
                                                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                                                Compartilhar
                                            </Button>
                                            <Button
                                                size="sm"
                                                className="h-9 flex-1 rounded-xl active:scale-[0.98] transition-transform"
                                                onClick={() => handleManageSession(session.sessionId)}
                                            >
                                                <Settings className="h-3.5 w-3.5 mr-1.5" />
                                                Gerenciar
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
