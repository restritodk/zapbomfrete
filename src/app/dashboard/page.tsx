import { prisma } from "@/lib/prisma";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
    Plus,
    Wifi,
    WifiOff,
    Send,
    QrCode,
    ArrowRight,
    Activity,
    Zap,
    Bot,
} from "lucide-react";

import { auth } from "@/lib/auth";
import { getAccessibleSessions, canAccessChannel } from "@/lib/api-auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { isDatafyChannelId } from "@/modules/channels/ids";
import { PremiumDatafyDashboard } from "@/components/dashboard/premium-datafy-dashboard";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
    const session = await auth();
    if (!session?.user) {
        redirect("/auth/login");
    }

    const cookieStore = await cookies();
    const channelId = cookieStore.get("sessionId")?.value;
    const datafySelected =
        channelId &&
        isDatafyChannelId(channelId) &&
        (await canAccessChannel(
            session.user.id!,
            session.user.role || "OWNER",
            channelId
        ));

    if (datafySelected) {
        return <PremiumDatafyDashboard />;
    }

    const sessions = await getAccessibleSessions(
        session.user.id!,
        session.user.role || "OWNER"
    );

    const totalSessions = sessions.length;
    const connectedSessions = sessions.filter(
        (s) => s.status === "CONNECTED"
    ).length;
    const disconnectedSessions = totalSessions - connectedSessions;

    let autoReplyCount = 0;
    try {
        const sessionIds = sessions.map((s) => s.sessionId);
        if (sessionIds.length > 0) {
            autoReplyCount = await prisma.autoReply.count({
                where: { sessionId: { in: sessionIds } },
            });
        }
    } catch {
        /* ignore */
    }

    const stats = [
        {
            title: "Total de sessões",
            value: totalSessions,
            icon: QrCode,
            description: "Sessões Baileys registradas",
            color: "text-blue-600",
            bg: "bg-blue-50",
        },
        {
            title: "Conectadas",
            value: connectedSessions,
            icon: Wifi,
            description: "Online e prontas",
            color: "text-emerald-600",
            bg: "bg-emerald-50",
        },
        {
            title: "Desconectadas",
            value: disconnectedSessions,
            icon: WifiOff,
            description: "Precisam reconectar",
            color: "text-red-500",
            bg: "bg-red-50",
        },
        {
            title: "Regras de resposta automática",
            value: autoReplyCount,
            icon: Zap,
            description: "Automações ativas",
            color: "text-amber-600",
            bg: "bg-amber-50",
        },
    ];

    const quickActions = [
        {
            href: "/dashboard/sessions",
            label: "Nova sessão",
            icon: Plus,
            description: "Conectar um novo dispositivo",
        },
        {
            href: "/dashboard/chat",
            label: "Enviar mensagem",
            icon: Send,
            description: "Abrir interface de chat",
        },
        {
            href: "/dashboard/bot-settings",
            label: "Configurações do bot",
            icon: Bot,
            description: "Configurar chatbot",
        },
        {
            href: "/dashboard/system-monitor",
            label: "Monitor do sistema",
            icon: Activity,
            description: "Ver métricas do servidor",
        },
    ];

    return (
        <div className="mx-auto w-full max-w-[1400px] space-y-8 overflow-x-hidden">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0f2744]">
                        Painel
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">
                        Visão geral das sessões Baileys. Selecione o canal
                        oficial no cabeçalho para o painel Datafy.
                    </p>
                </div>
                <Link href="/dashboard/sessions">
                    <Button size="sm" className="gap-2 rounded-xl">
                        <Plus className="h-4 w-4" /> Adicionar sessão
                    </Button>
                </Link>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {stats.map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <Card
                            key={stat.title}
                            className="rounded-2xl border border-[#dbe7f3] bg-white shadow-[0_1px_4px_rgba(15,23,42,0.05)]"
                        >
                            <CardContent className="p-4 sm:p-5">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                            {stat.title}
                                        </p>
                                        <p className="text-2xl sm:text-3xl font-extrabold text-foreground">
                                            {stat.value}
                                        </p>
                                        <p className="text-xs text-muted-foreground/70">
                                            {stat.description}
                                        </p>
                                    </div>
                                    <div
                                        className={`${stat.bg} p-2.5 rounded-xl border shadow-sm`}
                                    >
                                        <Icon
                                            className={`h-5 w-5 ${stat.color}`}
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            <div>
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
                    Ações rápidas
                </h3>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                    {quickActions.map((action) => {
                        const Icon = action.icon;
                        return (
                            <Link key={action.href} href={action.href}>
                                <Card className="rounded-2xl border border-[#dbe7f3] bg-white shadow-sm hover:shadow-md transition-all duration-300 group cursor-pointer h-full">
                                    <CardContent className="p-4 flex items-center gap-3">
                                        <div className="bg-muted/50 p-2.5 rounded-xl group-hover:bg-primary transition-colors border border-border/50 shadow-sm">
                                            <Icon className="h-5 w-5 text-muted-foreground group-hover:text-primary-foreground transition-colors" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold text-foreground truncate">
                                                {action.label}
                                            </p>
                                            <p className="text-xs text-muted-foreground/80 truncate">
                                                {action.description}
                                            </p>
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        );
                    })}
                </div>
            </div>

            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-widest">
                        Sessões
                    </h3>
                    <Link
                        href="/dashboard/sessions"
                        className="text-xs text-primary hover:text-primary/80 font-medium flex items-center gap-1 transition-colors"
                    >
                        Ver todas <ArrowRight size={14} />
                    </Link>
                </div>

                {sessions.length === 0 ? (
                    <Card className="border-dashed border-2 border-slate-200 shadow-none rounded-2xl">
                        <CardContent className="py-12 text-center">
                            <div className="bg-slate-100 h-12 w-12 rounded-full flex items-center justify-center mx-auto mb-3">
                                <QrCode className="h-6 w-6 text-slate-400" />
                            </div>
                            <p className="text-sm font-medium text-slate-600 mb-1">
                                Nenhuma sessão ainda
                            </p>
                            <p className="text-xs text-slate-400 mb-4">
                                Conecte seu primeiro dispositivo WhatsApp para
                                começar
                            </p>
                            <Link href="/dashboard/sessions">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-2 rounded-xl"
                                >
                                    <Plus className="h-4 w-4" /> Criar sessão
                                </Button>
                            </Link>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {sessions.map((s) => {
                            const isConnected = s.status === "CONNECTED";
                            return (
                                <Link
                                    key={s.id}
                                    href={`/dashboard/sessions/${s.sessionId}`}
                                >
                                    <Card className="rounded-2xl border border-[#dbe7f3] bg-white shadow-sm hover:shadow-md transition-all duration-300 cursor-pointer h-full">
                                        <CardContent className="p-4">
                                            <div className="flex items-start justify-between mb-2">
                                                <div className="min-w-0 flex-1">
                                                    <p className="text-sm font-bold text-foreground truncate">
                                                        {s.name}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground font-mono truncate mt-1">
                                                        {s.sessionId}
                                                    </p>
                                                </div>
                                                <div
                                                    className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full flex-shrink-0
                                                    ${isConnected ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}
                                                `}
                                                >
                                                    <span
                                                        className={`h-1.5 w-1.5 rounded-full ${isConnected ? "bg-emerald-500" : "bg-red-400"}`}
                                                    />
                                                    {s.status}
                                                </div>
                                            </div>
                                        </CardContent>
                                    </Card>
                                </Link>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
