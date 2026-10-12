"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSession as useAuthSession } from "next-auth/react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    Cell,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import {
    ArrowDownLeft,
    ArrowRight,
    CalendarRange,
    FolderOpen,
    Headphones,
    LayoutDashboard,
    Loader2,
    MailOpen,
    MessageCircle,
    MessagesSquare,
    Megaphone,
    Radio,
    Send,
    UserRound,
    Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampaignStatusBadge } from "@/components/dashboard/mass-dispatch/status-badge";
import {
    canLaunchDatafyCampaigns,
    canManageBulletinTemplates,
} from "@/modules/datafy/campaigns/access";
import { formatPhoneDisplay } from "@/lib/phone-br";
import { cn } from "@/lib/utils";

type Period = "today" | "7d" | "30d" | "custom";

type DashboardPayload = {
    period: Period;
    from: string;
    to: string;
    checkedAt: string;
    live: {
        conversations: number;
        unreadConversations: number;
        assignedOpen: number;
        messagesInbound: number;
        messagesOutbound: number;
        channelState: string;
        channelStateLabel: string;
    };
    periodMessages: { inbound: number; outbound: number };
    activity: Array<{
        date: string;
        label: string;
        inbound: number;
        outbound: number;
    }>;
    conversationStatus: {
        total: number;
        labels: Array<{
            key: string;
            label: string;
            count: number;
            color: string;
        }>;
    };
    recentContacts: Array<{
        id: string;
        waId: string;
        displayName: string;
        hasName: boolean;
        preview: string | null;
        lastMessageAt: string | null;
        direction: string | null;
        unreadCount: number;
    }>;
    recentCampaigns: Array<{
        id: string;
        name: string;
        status: string;
        recipients: number;
        sent: number;
        delivered: number;
        deliveryPct: number | null;
        date: string | null;
    }>;
    channel: {
        name: string;
        provider: string;
        healthy: boolean;
        channelState: string;
        displayPhoneNumber: string | null;
        lastVerifiedAt: string | null;
        lastError: string | null;
        organizationKey: string;
        connectionQuality: string;
    };
    statusBar: {
        level: "ok" | "warn" | "error";
        title: string;
        description: string;
        checkedAt: string;
    };
};

const CAMPAIGN_LABELS: Record<string, string> = {
    draft: "Rascunho",
    scheduled: "Agendada",
    preparing: "Em andamento",
    running: "Em andamento",
    paused: "Pausada",
    completed: "Concluída",
    completed_with_errors: "Falha parcial",
    cancelled: "Cancelada",
    failed: "Falhou",
};

const PERIODS: Array<{ id: Period; label: string }> = [
    { id: "today", label: "Hoje" },
    { id: "7d", label: "Últimos 7 dias" },
    { id: "30d", label: "Últimos 30 dias" },
    { id: "custom", label: "Personalizado" },
];

const premiumCard =
    "rounded-2xl border border-[#dbe7f3] bg-white shadow-[0_1px_4px_rgba(15,23,42,0.05)]";

function formatDt(iso: string | null | undefined) {
    if (!iso) return "—";
    try {
        return new Date(iso).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    } catch {
        return iso;
    }
}

function initials(name: string) {
    const p = name.trim().split(/\s+/).filter(Boolean);
    if (!p.length || name === "Contato sem nome") return "";
    if (p.length === 1) return p[0].slice(0, 2).toUpperCase();
    return `${p[0][0]}${p[p.length - 1][0]}`.toUpperCase();
}

export function PremiumDatafyDashboard() {
    const { data: auth } = useAuthSession();
    const role = (auth?.user as { role?: string } | undefined)?.role || "";

    const [period, setPeriod] = useState<Period>("7d");
    const [customFrom, setCustomFrom] = useState("");
    const [customTo, setCustomTo] = useState("");
    const [data, setData] = useState<DashboardPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const hasLoaded = useRef(false);

    const canCampaign = canLaunchDatafyCampaigns(role);
    const canTemplates = canManageBulletinTemplates(role);
    const canCrmShortcut =
        role === "OWNER" || role === "SUPERADMIN" || role === "STAFF";

    const load = useCallback(
        async (silent: boolean) => {
            abortRef.current?.abort();
            const ac = new AbortController();
            abortRef.current = ac;
            if (!hasLoaded.current) setLoading(true);
            else if (silent) setRefreshing(true);

            try {
                const params = new URLSearchParams({ period });
                if (period === "custom") {
                    if (customFrom) params.set("from", new Date(customFrom).toISOString());
                    if (customTo) {
                        const t = new Date(customTo);
                        t.setHours(23, 59, 59, 999);
                        params.set("to", t.toISOString());
                    }
                }
                const res = await fetch(
                    `/api/channels/datafy/dashboard?${params}`,
                    { signal: ac.signal, cache: "no-store" }
                );
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setError(json.message || "Falha ao carregar painel");
                    return;
                }
                setData(json.data as DashboardPayload);
                setError(null);
                hasLoaded.current = true;
            } catch (e) {
                if ((e as { name?: string })?.name === "AbortError") return;
                if (!hasLoaded.current) {
                    setError("Erro ao carregar painel");
                }
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [period, customFrom, customTo]
    );

    useEffect(() => {
        void load(false);
        const id = setInterval(() => void load(true), 35_000);
        return () => {
            clearInterval(id);
            abortRef.current?.abort();
        };
    }, [load]);

    const donutData = useMemo(() => {
        const labels = data?.conversationStatus.labels || [];
        const total = labels.reduce((s, l) => s + l.count, 0);
        if (total === 0) {
            return [
                {
                    key: "empty",
                    label: "Sem conversas",
                    count: 1,
                    color: "#e2e8f0",
                },
            ];
        }
        return labels;
    }, [data]);

    const shortcuts = [
        {
            href: "/dashboard/chat",
            label: "Abrir chat oficial",
            icon: MessageCircle,
            tone: "bg-emerald-50 text-emerald-700 ring-emerald-100",
            show: true,
        },
        {
            href: "/dashboard/broadcast",
            label: "Nova campanha",
            icon: Megaphone,
            tone: "bg-blue-50 text-blue-700 ring-blue-100",
            show: canCampaign,
        },
        {
            href: "/dashboard/contacts",
            label: "Contatos",
            icon: Users,
            tone: "bg-sky-50 text-sky-700 ring-sky-100",
            show: canCrmShortcut,
        },
        {
            href: "/dashboard/boletim/biblioteca",
            label: "Biblioteca de templates",
            icon: FolderOpen,
            tone: "bg-violet-50 text-violet-700 ring-violet-100",
            show: canTemplates,
        },
    ].filter((s) => s.show);

    if (loading && !data) {
        return (
            <div className="flex items-center justify-center py-24 text-slate-500">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Carregando painel…
            </div>
        );
    }

    if (error && !data) {
        return (
            <div className={cn(premiumCard, "p-8 text-center text-sm text-red-600")}>
                {error}
            </div>
        );
    }

    if (!data) return null;

    const live = data.live;
    const channelActive = data.channel.channelState === "active";

    const kpiCards = [
        {
            label: "Estado do canal",
            value: live.channelStateLabel,
            desc: "Conectado via Datafy",
            icon: MessagesSquare,
            iconBg: "bg-emerald-50 text-emerald-600",
            valueClass: channelActive ? "text-emerald-600" : "text-amber-600",
            liveDot: channelActive,
        },
        {
            label: "Conversas",
            value: String(live.conversations),
            desc: "Registradas no canal oficial",
            icon: MessageCircle,
            iconBg: "bg-blue-50 text-blue-600",
            valueClass: "text-[#0f2744]",
        },
        {
            label: "Não lidas",
            value: String(live.unreadConversations),
            desc: "Mensagens aguardando leitura",
            icon: MailOpen,
            iconBg: "bg-orange-50 text-orange-600",
            valueClass: "text-[#0f2744]",
        },
        {
            label: "Atendimentos",
            value: String(live.assignedOpen),
            desc: "Conversas atribuídas abertas",
            icon: Headphones,
            iconBg: "bg-violet-50 text-violet-600",
            valueClass: "text-[#0f2744]",
        },
        {
            label: "Recebidas",
            value: String(data.periodMessages.inbound),
            desc: "Mensagens inbound no período",
            icon: ArrowDownLeft,
            iconBg: "bg-sky-50 text-sky-600",
            valueClass: "text-[#0f2744]",
        },
        {
            label: "Enviadas",
            value: String(data.periodMessages.outbound),
            desc: "Mensagens outbound no período",
            icon: Send,
            iconBg: "bg-blue-50 text-blue-600",
            valueClass: "text-[#0f2744]",
        },
    ];

    const statusTotal = data.conversationStatus.total || 0;

    return (
        <div className="mx-auto w-full max-w-[1400px] space-y-5 overflow-x-hidden pb-2">
            {/* Header */}
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#2563eb] text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)]">
                        <LayoutDashboard className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0f2744]">
                            Painel · Canal oficial
                        </h1>
                        <p className="text-sm text-[#2563eb]/90 font-medium mt-0.5">
                            Visão geral da operação do WhatsApp Oficial (Datafy).
                        </p>
                        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
                            Acompanhe em tempo real o atendimento, campanhas e
                            desempenho do seu canal.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col gap-2 shrink-0">
                    <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                        {PERIODS.map((p) => (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => setPeriod(p.id)}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs sm:text-sm font-medium transition-colors",
                                    period === p.id
                                        ? "bg-[#2563eb] text-white shadow-sm"
                                        : "text-slate-600 hover:bg-slate-50"
                                )}
                            >
                                {p.id === "custom" && (
                                    <CalendarRange className="h-3.5 w-3.5" />
                                )}
                                {p.label}
                            </button>
                        ))}
                        {refreshing && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400 mx-1" />
                        )}
                    </div>
                    {period === "custom" && (
                        <div className="flex flex-wrap items-center gap-2">
                            <Input
                                type="date"
                                value={customFrom}
                                onChange={(e) => setCustomFrom(e.target.value)}
                                className="h-9 w-[150px] rounded-xl"
                            />
                            <span className="text-xs text-slate-400">até</span>
                            <Input
                                type="date"
                                value={customTo}
                                onChange={(e) => setCustomTo(e.target.value)}
                                className="h-9 w-[150px] rounded-xl"
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {kpiCards.map((card) => {
                    const Icon = card.icon;
                    return (
                        <div
                            key={card.label}
                            className={cn(
                                premiumCard,
                                "p-4 transition-shadow hover:shadow-md"
                            )}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                        {card.label}
                                    </p>
                                    <p
                                        className={cn(
                                            "mt-1.5 text-2xl font-bold tracking-tight tabular-nums flex items-center gap-1.5",
                                            card.valueClass
                                        )}
                                    >
                                        {card.liveDot && (
                                            <span className="relative flex h-2 w-2">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                            </span>
                                        )}
                                        {card.value}
                                    </p>
                                    <p className="mt-1 text-[11px] text-slate-400 leading-snug">
                                        {card.desc}
                                    </p>
                                </div>
                                <div
                                    className={cn(
                                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                                        card.iconBg
                                    )}
                                >
                                    <Icon className="h-4 w-4" />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Charts + shortcuts */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <div className={cn(premiumCard, "xl:col-span-5 p-4 sm:p-5")}>
                    <div className="mb-4">
                        <h2 className="text-base font-semibold text-[#0f2744]">
                            Atividade de mensagens
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Mensagens enviadas e recebidas no período
                            selecionado.
                        </p>
                    </div>
                    <div className="h-[240px] w-full min-w-0">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data.activity}>
                                <defs>
                                    <linearGradient
                                        id="outGrad"
                                        x1="0"
                                        y1="0"
                                        x2="0"
                                        y2="1"
                                    >
                                        <stop
                                            offset="5%"
                                            stopColor="#2563eb"
                                            stopOpacity={0.25}
                                        />
                                        <stop
                                            offset="95%"
                                            stopColor="#2563eb"
                                            stopOpacity={0}
                                        />
                                    </linearGradient>
                                    <linearGradient
                                        id="inGrad"
                                        x1="0"
                                        y1="0"
                                        x2="0"
                                        y2="1"
                                    >
                                        <stop
                                            offset="5%"
                                            stopColor="#10b981"
                                            stopOpacity={0.25}
                                        />
                                        <stop
                                            offset="95%"
                                            stopColor="#10b981"
                                            stopOpacity={0}
                                        />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid
                                    strokeDasharray="3 3"
                                    stroke="#e2e8f0"
                                    vertical={false}
                                />
                                <XAxis
                                    dataKey="label"
                                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                                    axisLine={false}
                                    tickLine={false}
                                />
                                <YAxis
                                    allowDecimals={false}
                                    tick={{ fontSize: 11, fill: "#94a3b8" }}
                                    axisLine={false}
                                    tickLine={false}
                                    width={28}
                                />
                                <Tooltip
                                    contentStyle={{
                                        borderRadius: 12,
                                        border: "1px solid #e2e8f0",
                                        fontSize: 12,
                                    }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="outbound"
                                    name="Enviadas"
                                    stroke="#2563eb"
                                    fill="url(#outGrad)"
                                    strokeWidth={2}
                                    isAnimationActive={false}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="inbound"
                                    name="Recebidas"
                                    stroke="#10b981"
                                    fill="url(#inGrad)"
                                    strokeWidth={2}
                                    isAnimationActive={false}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-[#2563eb]" />
                            Enviadas
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full bg-emerald-500" />
                            Recebidas
                        </span>
                    </div>
                </div>

                <div className={cn(premiumCard, "xl:col-span-4 p-4 sm:p-5")}>
                    <div className="mb-4">
                        <h2 className="text-base font-semibold text-[#0f2744]">
                            Status das conversas
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Distribuição atual das conversas no canal.
                        </p>
                    </div>
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                        <div className="relative h-[180px] w-[180px] shrink-0">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={donutData}
                                        dataKey="count"
                                        nameKey="label"
                                        innerRadius={58}
                                        outerRadius={80}
                                        paddingAngle={2}
                                        isAnimationActive={false}
                                    >
                                        {donutData.map((entry) => (
                                            <Cell
                                                key={entry.key}
                                                fill={
                                                    entry.count > 0
                                                        ? entry.color
                                                        : "#e2e8f0"
                                                }
                                            />
                                        ))}
                                    </Pie>
                                    <Tooltip />
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                                <p className="text-2xl font-bold text-[#0f2744] tabular-nums">
                                    {statusTotal}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                    Conversas
                                </p>
                            </div>
                        </div>
                        <ul className="flex-1 w-full space-y-2.5 min-w-0">
                            {data.conversationStatus.labels.map((item) => {
                                const pct =
                                    statusTotal > 0
                                        ? (
                                              (item.count / statusTotal) *
                                              100
                                          ).toFixed(1)
                                        : "0.0";
                                return (
                                    <li
                                        key={item.key}
                                        className="flex items-center justify-between gap-2 text-sm"
                                    >
                                        <span className="flex items-center gap-2 min-w-0">
                                            <span
                                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                                style={{
                                                    background: item.color,
                                                }}
                                            />
                                            <span className="text-slate-600 truncate">
                                                {item.label}
                                            </span>
                                        </span>
                                        <span className="text-slate-500 tabular-nums shrink-0 text-xs">
                                            {item.count}{" "}
                                            <span className="text-slate-400">
                                                ({pct}%)
                                            </span>
                                        </span>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>

                <div className={cn(premiumCard, "xl:col-span-3 p-4 sm:p-5")}>
                    <div className="mb-4">
                        <h2 className="text-base font-semibold text-[#0f2744]">
                            Atalhos rápidos
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Ações mais utilizadas no dia a dia.
                        </p>
                    </div>
                    <div className="space-y-2">
                        {shortcuts.map((s) => {
                            const Icon = s.icon;
                            return (
                                <Link
                                    key={s.href + s.label}
                                    href={s.href}
                                    className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 hover:bg-white hover:shadow-sm transition-all group"
                                >
                                    <div
                                        className={cn(
                                            "flex h-9 w-9 items-center justify-center rounded-xl ring-1",
                                            s.tone
                                        )}
                                    >
                                        <Icon className="h-4 w-4" />
                                    </div>
                                    <span className="text-sm font-medium text-[#0f2744] flex-1">
                                        {s.label}
                                    </span>
                                    <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-[#2563eb]" />
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Bottom row */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
                <div className={cn(premiumCard, "xl:col-span-5 overflow-hidden")}>
                    <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-slate-100">
                        <div>
                            <h2 className="text-base font-semibold text-[#0f2744]">
                                Campanhas recentes
                            </h2>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Últimos disparos realizados.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl shrink-0"
                            asChild
                        >
                            <Link href="/dashboard/broadcast">Ver todas</Link>
                        </Button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="bg-[#eff6ff] text-left text-[11px] uppercase tracking-wide text-[#1e3a5f]">
                                    <th className="px-4 py-2.5 font-semibold">
                                        Nome
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold">
                                        Status
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold hidden sm:table-cell">
                                        Dest.
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold hidden md:table-cell">
                                        Env.
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold">
                                        Entregues
                                    </th>
                                    <th className="px-3 py-2.5 font-semibold hidden lg:table-cell">
                                        Data
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentCampaigns.length === 0 ? (
                                    <tr>
                                        <td
                                            colSpan={6}
                                            className="px-4 py-10 text-center text-slate-400 text-sm"
                                        >
                                            Nenhuma campanha ainda.
                                        </td>
                                    </tr>
                                ) : (
                                    data.recentCampaigns.map((c) => (
                                        <tr
                                            key={c.id}
                                            className="border-t border-slate-100 hover:bg-slate-50/70"
                                        >
                                            <td className="px-4 py-3 font-medium text-[#0f2744] max-w-[160px] truncate">
                                                {c.name}
                                            </td>
                                            <td className="px-3 py-3">
                                                <CampaignStatusBadge
                                                    status={c.status}
                                                    label={
                                                        CAMPAIGN_LABELS[
                                                            c.status
                                                        ] || c.status
                                                    }
                                                />
                                            </td>
                                            <td className="px-3 py-3 tabular-nums text-slate-600 hidden sm:table-cell">
                                                {c.recipients}
                                            </td>
                                            <td className="px-3 py-3 tabular-nums text-slate-600 hidden md:table-cell">
                                                {c.sent}
                                            </td>
                                            <td className="px-3 py-3 tabular-nums text-slate-600">
                                                {c.deliveryPct != null
                                                    ? `${c.deliveryPct}%`
                                                    : "—"}
                                            </td>
                                            <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap hidden lg:table-cell">
                                                {formatDt(c.date)}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className={cn(premiumCard, "xl:col-span-4 overflow-hidden")}>
                    <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-4 border-b border-slate-100">
                        <div>
                            <h2 className="text-base font-semibold text-[#0f2744]">
                                Últimos contatos
                            </h2>
                            <p className="text-xs text-slate-400 mt-0.5">
                                Contatos mais recentes no canal.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-xl shrink-0"
                            asChild
                        >
                            <Link href="/dashboard/contacts">Ver todos</Link>
                        </Button>
                    </div>
                    <ul className="divide-y divide-slate-100">
                        {data.recentContacts.length === 0 ? (
                            <li className="px-5 py-10 text-center text-sm text-slate-400">
                                Nenhuma conversa recente.
                            </li>
                        ) : (
                            data.recentContacts.map((c) => {
                                const ini = initials(c.displayName);
                                return (
                                    <li
                                        key={c.id}
                                        className="flex items-start gap-3 px-4 sm:px-5 py-3 hover:bg-slate-50/70"
                                    >
                                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 text-xs font-semibold">
                                            {ini || (
                                                <UserRound className="h-4 w-4" />
                                            )}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-sm font-medium text-[#0f2744] truncate">
                                                    {c.displayName}
                                                </p>
                                                <span
                                                    className={cn(
                                                        "text-[10px] font-semibold uppercase shrink-0",
                                                        c.direction ===
                                                            "inbound"
                                                            ? "text-emerald-600"
                                                            : "text-blue-600"
                                                    )}
                                                >
                                                    {c.direction === "inbound"
                                                        ? "Recebida"
                                                        : c.direction ===
                                                            "outbound"
                                                          ? "Enviada"
                                                          : "—"}
                                                </span>
                                            </div>
                                            <p className="text-[11px] font-mono text-slate-400">
                                                {formatPhoneDisplay(c.waId) ||
                                                    c.waId}
                                            </p>
                                            <p className="text-xs text-slate-500 truncate mt-0.5">
                                                {c.preview || "Sem prévia"}
                                            </p>
                                            <p className="text-[10px] text-slate-400 mt-0.5">
                                                {formatDt(c.lastMessageAt)}
                                            </p>
                                        </div>
                                    </li>
                                );
                            })
                        )}
                    </ul>
                </div>

                <div className={cn(premiumCard, "xl:col-span-3 p-4 sm:p-5 flex flex-col")}>
                    <div className="flex items-start justify-between gap-2 mb-4">
                        <div>
                            <h2 className="text-base font-semibold text-[#0f2744]">
                                Informações do canal
                            </h2>
                        </div>
                        <span
                            className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                                data.channel.healthy
                                    ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                                    : "bg-amber-50 text-amber-800 ring-amber-100"
                            )}
                        >
                            <Radio className="h-3 w-3" />
                            {data.channel.healthy
                                ? "Conectado"
                                : live.channelStateLabel}
                        </span>
                    </div>
                    <dl className="space-y-3 text-sm flex-1">
                        <div>
                            <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                                Nome
                            </dt>
                            <dd className="font-medium text-[#0f2744]">
                                {data.channel.name}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                                Provedor
                            </dt>
                            <dd className="text-slate-700">
                                {data.channel.provider}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                                Última sincronização
                            </dt>
                            <dd className="text-slate-700 text-xs">
                                {formatDt(data.channel.lastVerifiedAt)}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                                Qualidade da conexão
                            </dt>
                            <dd className="text-slate-700">
                                {data.channel.connectionQuality}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                                Número associado
                            </dt>
                            <dd className="text-slate-700 font-mono text-xs">
                                {data.channel.displayPhoneNumber || "—"}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-[11px] uppercase tracking-wide text-slate-400">
                                Organização
                            </dt>
                            <dd className="text-slate-700">
                                {data.channel.organizationKey}
                            </dd>
                        </div>
                    </dl>
                    <Button
                        className="mt-4 w-full rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8]"
                        asChild
                    >
                        <Link href="/dashboard/settings/integrations/datafy">
                            Ver detalhamento do canal
                        </Link>
                    </Button>
                </div>
            </div>

            {/* Status bar */}
            <div
                className={cn(
                    "rounded-2xl border px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3",
                    data.statusBar.level === "ok" &&
                        "border-emerald-100 bg-emerald-50/70",
                    data.statusBar.level === "warn" &&
                        "border-amber-100 bg-amber-50/70",
                    data.statusBar.level === "error" &&
                        "border-red-100 bg-red-50/70"
                )}
            >
                <div className="flex items-start gap-3 min-w-0">
                    <div
                        className={cn(
                            "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                            data.statusBar.level === "ok" &&
                                "bg-emerald-100 text-emerald-700",
                            data.statusBar.level === "warn" &&
                                "bg-amber-100 text-amber-800",
                            data.statusBar.level === "error" &&
                                "bg-red-100 text-red-700"
                        )}
                    >
                        <Radio className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0f2744]">
                            {data.statusBar.title}
                        </p>
                        <p className="text-xs text-slate-600 mt-0.5">
                            {data.statusBar.description}
                        </p>
                    </div>
                </div>
                <p className="text-xs text-slate-500 shrink-0 sm:text-right">
                    Última verificação: {formatDt(data.statusBar.checkedAt)}
                </p>
            </div>
        </div>
    );
}
