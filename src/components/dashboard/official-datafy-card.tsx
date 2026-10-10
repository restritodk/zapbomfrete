"use client";

import { BadgeCheck, Plug, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChannelItem } from "./session-provider";
import { useSession } from "./session-provider";

function statusMeta(status: string, healthy: boolean) {
    const key = (status || "").toUpperCase();
    if (key === "CONNECTED" && healthy) {
        return {
            label: "Conectado",
            className: "bg-emerald-500/10 text-emerald-700 border-emerald-500/25",
            dot: "bg-emerald-500 animate-pulse",
        };
    }
    if (key === "DEGRADED") {
        return {
            label: "Atenção",
            className: "bg-amber-500/10 text-amber-700 border-amber-500/25",
            dot: "bg-amber-500 animate-pulse",
        };
    }
    return {
        label: key === "DISCONNECTED" ? "Desconectado" : status || "Indisponível",
        className: "bg-muted text-muted-foreground border-border",
        dot: "bg-slate-400",
    };
}

export function OfficialDatafyCard({
    channel,
    canSelect,
}: {
    channel: ChannelItem;
    canSelect: boolean;
}) {
    const { sessionId, setChannelId } = useSession();
    const meta = statusMeta(channel.status, channel.healthy);
    const selected = sessionId === channel.id;

    return (
        <div className="relative overflow-hidden rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-50/80 via-background to-background shadow-sm">
            <div className="h-1 w-full bg-emerald-500" />
            <div className="p-5 sm:p-6 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                            <BadgeCheck className="h-6 w-6" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-semibold text-base sm:text-lg tracking-tight truncate">
                                    {channel.name}
                                </h3>
                                <Badge
                                    variant="outline"
                                    className="text-[10px] border-emerald-300 text-emerald-800 bg-emerald-50"
                                >
                                    Oficial
                                </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                                Provider: {channel.providerLabel} · Canal compartilhado
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

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            Número conectado
                        </p>
                        <p className="text-sm font-medium font-mono truncate">
                            {channel.displayPhoneNumber || "Não disponível"}
                        </p>
                    </div>
                    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            Última verificação
                        </p>
                        <p className="text-sm font-medium truncate">
                            {channel.lastVerifiedAt
                                ? new Date(channel.lastVerifiedAt).toLocaleString("pt-BR")
                                : "—"}
                        </p>
                    </div>
                    <div className="rounded-xl bg-muted/40 px-3 py-2.5">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                            Compartilhamento
                        </p>
                        <p className="text-sm font-medium inline-flex items-center gap-1.5">
                            <Shield className="h-3.5 w-3.5 text-emerald-700" />
                            Usuários autorizados
                        </p>
                    </div>
                </div>

                {channel.meta?.lastError && (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        {channel.meta.lastError}
                    </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                    {canSelect ? (
                        <Button
                            size="sm"
                            className="h-9 rounded-xl"
                            variant={selected ? "secondary" : "default"}
                            onClick={() => setChannelId(channel.id)}
                            disabled={selected}
                        >
                            <Plug className="h-3.5 w-3.5 mr-1.5" />
                            {selected ? "Canal selecionado" : "Selecionar canal"}
                        </Button>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            Sem permissão operacional para selecionar este canal.
                        </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                        Sem QR Code · Sem reconexão Baileys · Sem exclusão de sessão
                    </p>
                </div>
            </div>
        </div>
    );
}
