"use client";

import type { LucideIcon } from "lucide-react";
import {
    Ban,
    CalendarClock,
    CheckCircle2,
    Megaphone,
    Package,
    PlayCircle,
    Truck,
    XCircle,
} from "lucide-react";

export type MassDispatchStats = {
    created: number;
    scheduled: number;
    running: number;
    completed: number;
    totalEligible: number;
    totalDelivered: number;
    totalFailed: number;
    cancelled?: number;
};

type CardDef = {
    key: string;
    label: string;
    value: number;
    icon: LucideIcon;
    accent: string;
    iconBg: string;
};

export function MassDispatchStatsCards({
    stats,
}: {
    stats: MassDispatchStats | null;
}) {
    const s = stats || {
        created: 0,
        scheduled: 0,
        running: 0,
        completed: 0,
        totalEligible: 0,
        totalDelivered: 0,
        totalFailed: 0,
        cancelled: 0,
    };

    const cards: CardDef[] = [
        {
            key: "created",
            label: "Campanhas criadas",
            value: s.created,
            icon: Megaphone,
            accent: "text-[#1d4ed8]",
            iconBg: "bg-blue-50 text-blue-600",
        },
        {
            key: "scheduled",
            label: "Agendadas",
            value: s.scheduled,
            icon: CalendarClock,
            accent: "text-emerald-700",
            iconBg: "bg-emerald-50 text-emerald-600",
        },
        {
            key: "running",
            label: "Em andamento",
            value: s.running,
            icon: PlayCircle,
            accent: "text-orange-700",
            iconBg: "bg-orange-50 text-orange-600",
        },
        {
            key: "completed",
            label: "Concluídas",
            value: s.completed,
            icon: CheckCircle2,
            accent: "text-emerald-700",
            iconBg: "bg-emerald-50 text-emerald-600",
        },
        {
            key: "eligible",
            label: "Elegíveis",
            value: s.totalEligible,
            icon: Package,
            accent: "text-[#1d4ed8]",
            iconBg: "bg-blue-50 text-blue-600",
        },
        {
            key: "delivered",
            label: "Entregues",
            value: s.totalDelivered,
            icon: Truck,
            accent: "text-violet-700",
            iconBg: "bg-violet-50 text-violet-600",
        },
        {
            key: "failed",
            label: "Falhas",
            value: s.totalFailed,
            icon: XCircle,
            accent: "text-red-700",
            iconBg: "bg-red-50 text-red-600",
        },
        {
            key: "cancelled",
            label: "Canceladas",
            value: s.cancelled ?? 0,
            icon: Ban,
            accent: "text-slate-600",
            iconBg: "bg-slate-100 text-slate-600",
        },
    ];

    return (
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
            {cards.map((c) => (
                <div
                    key={c.key}
                    className="group rounded-2xl border border-slate-200/80 bg-white px-3.5 py-3.5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_8px_20px_-8px_rgba(15,23,42,0.18)] motion-reduce:transform-none"
                >
                    <div className="flex items-start justify-between gap-2">
                        <div
                            className={`flex h-9 w-9 items-center justify-center rounded-xl ${c.iconBg}`}
                        >
                            <c.icon className="h-4 w-4" />
                        </div>
                    </div>
                    <p className={`mt-3 text-2xl font-semibold tracking-tight ${c.accent}`}>
                        {c.value}
                    </p>
                    <p className="mt-0.5 text-[12px] font-medium text-slate-500 leading-snug">
                        {c.label}
                    </p>
                </div>
            ))}
        </div>
    );
}
