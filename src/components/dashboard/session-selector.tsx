"use client";

import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { BadgeCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "./session-provider";
import { cn } from "@/lib/utils";

function statusDotClass(status: string, healthy?: boolean) {
    const key = (status || "").toUpperCase();
    if (key === "CONNECTED" || healthy) return "bg-emerald-500";
    if (key === "DEGRADED" || key === "QR" || key === "CONNECTING")
        return "bg-amber-500";
    return "bg-destructive";
}

function statusLabel(status: string, healthy?: boolean) {
    const key = (status || "").toUpperCase();
    if (key === "CONNECTED" || healthy) return "Conectado";
    if (key === "DEGRADED") return "Degradado";
    if (key === "QR" || key === "CONNECTING") return "Conectando";
    return "Desconectado";
}

export function SessionSelector() {
    const {
        channels,
        sessionId,
        setChannelId,
        loading,
        refreshChannels,
        selectedChannel,
    } = useSession();

    const channelTitle = selectedChannel
        ? `${selectedChannel.name} · ${statusLabel(selectedChannel.status, selectedChannel.healthy)}`
        : undefined;

    return (
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 max-w-full">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 hidden xl:inline shrink-0">
                Canal
            </span>

            {/* Flexible width: grows on desktop so full name fits; never overflows refresh btn */}
            <div
                className={cn(
                    "min-w-0 flex-1",
                    "w-[10.5rem] sm:w-[14rem] md:w-[17rem] lg:w-[20rem] xl:w-[22.5rem]",
                    "max-w-[min(100%,22.5rem)]"
                )}
            >
                <Select
                    value={sessionId}
                    onValueChange={setChannelId}
                    disabled={loading || channels.length === 0}
                >
                    <SelectTrigger
                        title={channelTitle}
                        className={cn(
                            "h-9 w-full min-w-0 max-w-full overflow-hidden",
                            "border border-slate-200/80 bg-white hover:bg-slate-50/80",
                            "rounded-xl shadow-sm focus:ring-1 focus:ring-primary/20",
                            "gap-1.5 px-2.5 sm:px-3",
                            "whitespace-nowrap",
                            "[&>span]:min-w-0 [&>span]:flex-1 [&>span]:overflow-hidden",
                            "*:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:overflow-hidden"
                        )}
                    >
                        <SelectValue
                            placeholder={
                                loading ? "Carregando..." : "Selecionar canal"
                            }
                        >
                            {selectedChannel ? (
                                <div className="flex items-center gap-1.5 sm:gap-2 text-left min-w-0 w-full overflow-hidden">
                                    <span className="relative flex h-2 w-2 shrink-0">
                                        {selectedChannel.status ===
                                            "CONNECTED" && (
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                        )}
                                        <span
                                            className={`relative inline-flex rounded-full h-2 w-2 ${statusDotClass(selectedChannel.status, selectedChannel.healthy)}`}
                                        />
                                    </span>
                                    {selectedChannel.official && (
                                        <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                    )}
                                    <span className="truncate font-medium text-xs sm:text-sm text-[#0f2744] min-w-0">
                                        {selectedChannel.name}
                                    </span>
                                    <span className="hidden 2xl:inline shrink-0 text-[10px] font-medium text-slate-400 capitalize">
                                        {statusLabel(
                                            selectedChannel.status,
                                            selectedChannel.healthy
                                        )}
                                    </span>
                                </div>
                            ) : null}
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border border-border/50 shadow-lg p-1 max-h-[320px] min-w-[var(--radix-select-trigger-width)]">
                        {channels.map((c) => (
                            <SelectItem
                                key={c.id}
                                value={c.id}
                                className="rounded-lg py-2 focus:bg-muted/50 cursor-pointer"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="relative flex h-2 w-2 flex-shrink-0">
                                        {c.status === "CONNECTED" && (
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                        )}
                                        <span
                                            className={`relative inline-flex rounded-full h-2 w-2 ${statusDotClass(c.status, c.healthy)}`}
                                        />
                                    </span>
                                    <div className="flex flex-col min-w-0">
                                        <span className="font-medium text-sm text-foreground flex items-center gap-1.5">
                                            {c.official && (
                                                <BadgeCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                            )}
                                            <span className="truncate">
                                                {c.name}
                                            </span>
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                            {c.providerLabel}
                                            {c.displayPhoneNumber
                                                ? ` · ${c.displayPhoneNumber}`
                                                : c.provider === "baileys"
                                                  ? ` · ${c.id}`
                                                  : ""}
                                            {c.shared
                                                ? " · compartilhado"
                                                : ""}
                                            {" · "}
                                            {statusLabel(c.status, c.healthy)}
                                        </span>
                                    </div>
                                </div>
                            </SelectItem>
                        ))}
                        {channels.length === 0 && !loading && (
                            <div className="py-6 px-2 text-xs text-muted-foreground text-center">
                                Nenhum canal disponível.
                            </div>
                        )}
                    </SelectContent>
                </Select>
            </div>

            <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0 hover:bg-slate-100 rounded-xl"
                onClick={refreshChannels}
                title="Atualizar canais"
                aria-label="Atualizar canais"
                disabled={loading}
            >
                <RefreshCw
                    className={`h-4 w-4 text-slate-500 hover:text-[#0f2744] ${loading ? "animate-spin" : ""}`}
                />
            </Button>
        </div>
    );
}
