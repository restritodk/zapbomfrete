"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BadgeCheck, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "./session-provider";

function statusDotClass(status: string, healthy?: boolean) {
    const key = (status || "").toUpperCase();
    if (key === "CONNECTED" || healthy) return "bg-emerald-500";
    if (key === "DEGRADED" || key === "QR" || key === "CONNECTING") return "bg-amber-500";
    return "bg-destructive";
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

    return (
        <div className="flex items-center gap-1 sm:gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:inline">
                Canal:
            </span>
            <div className="w-[150px] sm:w-[220px]">
                <Select
                    value={sessionId}
                    onValueChange={setChannelId}
                    disabled={loading || channels.length === 0}
                >
                    <SelectTrigger className="h-9 border border-border/60 bg-background/50 hover:bg-muted/30 transition-colors rounded-xl shadow-sm focus:ring-1 focus:ring-primary/20">
                        <SelectValue placeholder={loading ? "Carregando..." : "Selecionar canal"}>
                            {selectedChannel ? (
                                <div className="flex items-center gap-2 text-left min-w-0">
                                    <span className="relative flex h-2 w-2 shrink-0">
                                        {selectedChannel.status === "CONNECTED" && (
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                        )}
                                        <span
                                            className={`relative inline-flex rounded-full h-2 w-2 ${statusDotClass(selectedChannel.status, selectedChannel.healthy)}`}
                                        />
                                    </span>
                                    {selectedChannel.official && (
                                        <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                    )}
                                    <span className="truncate font-medium text-xs sm:text-sm">
                                        {selectedChannel.name}
                                    </span>
                                </div>
                            ) : null}
                        </SelectValue>
                    </SelectTrigger>
                    <SelectContent className="rounded-xl border border-border/50 shadow-lg p-1 max-h-[320px]">
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
                                            <span className="truncate">{c.name}</span>
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                            {c.providerLabel}
                                            {c.displayPhoneNumber
                                                ? ` · ${c.displayPhoneNumber}`
                                                : c.provider === "baileys"
                                                  ? ` · ${c.id}`
                                                  : ""}
                                            {c.shared ? " · compartilhado" : ""}
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
                className="h-9 w-9 hover:bg-muted/50 rounded-xl"
                onClick={refreshChannels}
                title="Atualizar canais"
                disabled={loading}
            >
                <RefreshCw
                    className={`h-4 w-4 text-muted-foreground hover:text-foreground ${loading ? "animate-spin" : ""}`}
                />
            </Button>
        </div>
    );
}
