"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
    Send,
    CheckCircle2,
    XCircle,
    Clock,
    Hourglass,
    Loader2,
    X,
    List,
    Download,
    AlertCircle,
    Ban,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

export type RecipientRowStatus = "waiting" | "sending" | "sent" | "failed" | "cancelled";

export interface BroadcastRecipientRow {
    id: string;
    jid: string;
    display: string;
    status: RecipientRowStatus;
    at: string | null;
    detail: string;
}

export interface BroadcastProgressModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    phase: "running" | "completed" | "cancelled";
    recipients: BroadcastRecipientRow[];
    startedAt: string | null;
    completedAt: string | null;
    delayMs: number;
    timezone?: string;
    onViewHistory?: () => void;
    /** Backend cancel — must await real confirmation via socket, not close the modal alone. */
    onCancelBroadcast?: () => Promise<void>;
    cancelling?: boolean;
    /**
     * Datafy campaigns: allow closing while the queue keeps running in background.
     * Baileys default remains false (cannot dismiss mid-send).
     */
    allowDismissWhileRunning?: boolean;
    /** Optional subtitle under the title (e.g. campaign name). */
    subtitle?: string | null;
    /** Extra counters for official API (accepted ≠ delivered). */
    datafyCounters?: {
        accepted: number;
        delivered: number;
        read: number;
        failed: number;
        dryRun?: boolean;
    } | null;
}

function formatDateTime(value: string | null | undefined, timeZone: string): string {
    if (!value) return "-";
    try {
        return new Intl.DateTimeFormat("pt-BR", {
            timeZone,
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
        }).format(new Date(value));
    } catch {
        return "-";
    }
}

function formatDuration(startIso: string | null, endIso: string | null): string {
    if (!startIso || !endIso) return "00:00:00";
    const ms = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function exportCsv(rows: BroadcastRecipientRow[], timeZone: string) {
    const header = ["#", "Destinatario", "Status", "Data/Hora", "Detalhes"];
    const statusLabel: Record<RecipientRowStatus, string> = {
        waiting: "Aguardando",
        sending: "Enviando",
        sent: "Enviado",
        failed: "Nao enviado",
        cancelled: "Cancelado",
    };
    const lines = [
        header.join(","),
        ...rows.map((r, i) =>
            [
                i + 1,
                r.display,
                statusLabel[r.status],
                r.at ? formatDateTime(r.at, timeZone) : "-",
                `"${(r.detail || "").replace(/"/g, '""')}"`,
            ].join(",")
        ),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], {
        type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `disparo-relatorio-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

export function BroadcastProgressModal({
    open,
    onOpenChange,
    phase,
    recipients,
    startedAt,
    completedAt,
    delayMs,
    timezone = "America/Sao_Paulo",
    onViewHistory,
    onCancelBroadcast,
    cancelling = false,
    allowDismissWhileRunning = false,
    subtitle = null,
    datafyCounters = null,
}: BroadcastProgressModalProps) {
    const titleId = useId();
    const descId = useId();
    const closeRef = useRef<HTMLButtonElement>(null);
    const isRunning = phase === "running";
    const isCancelled = phase === "cancelled";
    const [confirmOpen, setConfirmOpen] = useState(false);
    const blockDismiss = isRunning && !allowDismissWhileRunning;

    const counts = useMemo(() => {
        const sent = recipients.filter((r) => r.status === "sent").length;
        const failed = recipients.filter((r) => r.status === "failed").length;
        const sending = recipients.filter((r) => r.status === "sending").length;
        const waiting = recipients.filter((r) => r.status === "waiting").length;
        const cancelled = recipients.filter((r) => r.status === "cancelled").length;
        const total = recipients.length;
        const processed = sent + failed + cancelled;
        const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
        return { sent, failed, sending, waiting, cancelled, total, processed, pct };
    }, [recipients]);

    useEffect(() => {
        if (open) {
            const t = window.setTimeout(() => closeRef.current?.focus(), 50);
            return () => window.clearTimeout(t);
        }
    }, [open, phase]);

    useEffect(() => {
        if (!isRunning) setConfirmOpen(false);
    }, [isRunning]);

    const handleOpenChange = (next: boolean) => {
        if (!next && blockDismiss) {
            return;
        }
        onOpenChange(next);
    };

    const delayLabel = `${(delayMs / 1000).toFixed(1)}s`;

    const handleConfirmCancel = async () => {
        if (!onCancelBroadcast || cancelling) return;
        setConfirmOpen(false);
        await onCancelBroadcast();
    };

    return (
        <>
            <Dialog open={open} onOpenChange={handleOpenChange}>
                <DialogContent
                    showCloseButton={false}
                    aria-labelledby={titleId}
                    aria-describedby={descId}
                    className={cn(
                        "flex max-h-[min(92vh,880px)] w-[min(960px,calc(100%-1.5rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-2xl sm:max-w-none",
                        "data-[state=open]:zoom-in-100"
                    )}
                    onEscapeKeyDown={(e) => {
                        if (blockDismiss) e.preventDefault();
                    }}
                    onPointerDownOutside={(e) => {
                        if (blockDismiss) e.preventDefault();
                    }}
                    onInteractOutside={(e) => {
                        if (blockDismiss) e.preventDefault();
                    }}
                >
                    {/* Header */}
                    <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4 sm:px-6 sm:py-5">
                        <div
                            className={cn(
                                "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                                isRunning
                                    ? "bg-blue-50 text-blue-600"
                                    : isCancelled
                                      ? "bg-amber-50 text-amber-600"
                                      : "bg-emerald-50 text-emerald-600"
                            )}
                            aria-hidden
                        >
                            {isRunning ? (
                                <Send className="h-5 w-5" />
                            ) : isCancelled ? (
                                <Ban className="h-5 w-5" />
                            ) : (
                                <CheckCircle2 className="h-5 w-5" />
                            )}
                        </div>
                        <div className="min-w-0 flex-1 pr-8">
                            <DialogTitle
                                id={titleId}
                                className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl"
                            >
                                {isRunning
                                    ? "Disparo em andamento"
                                    : isCancelled
                                      ? "Disparo cancelado"
                                      : "Disparo concluído"}
                            </DialogTitle>
                            {subtitle && (
                                <p className="mt-0.5 text-sm font-medium text-slate-700 truncate">
                                    {subtitle}
                                </p>
                            )}
                            <DialogDescription
                                id={descId}
                                className="mt-1 text-sm text-slate-500"
                            >
                                {isRunning
                                    ? allowDismissWhileRunning
                                        ? "Enviando pela fila oficial. Você pode fechar — o processamento continua."
                                        : "Enviando mensagens para os destinatários. Aguarde a conclusão."
                                    : isCancelled
                                      ? "O envio foi interrompido. As mensagens já processadas permaneceram enviadas."
                                      : "O processo de envio foi finalizado. Veja o resumo e os detalhes abaixo."}
                            </DialogDescription>
                        </div>
                        <button
                            ref={closeRef}
                            type="button"
                            onClick={() => {
                                if (blockDismiss) return;
                                onOpenChange(false);
                            }}
                            disabled={blockDismiss}
                            className={cn(
                                "absolute top-4 right-4 rounded-md p-1.5 text-slate-400 transition-colors",
                                blockDismiss
                                    ? "cursor-not-allowed opacity-40"
                                    : "hover:bg-slate-100 hover:text-slate-700"
                            )}
                            aria-label={
                                blockDismiss
                                    ? "Não é possível fechar enquanto o disparo está em andamento"
                                    : "Fechar"
                            }
                            title={
                                blockDismiss
                                    ? "O disparo continua em andamento — feche após a conclusão"
                                    : allowDismissWhileRunning && isRunning
                                      ? "Fechar (o envio continua em segundo plano)"
                                      : "Fechar"
                            }
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>

                    {/* Body */}
                    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 sm:gap-5 sm:px-6 sm:py-5">
                        {isRunning ? (
                            <>
                                <div className="space-y-2">
                                    <div className="flex items-end justify-between gap-3">
                                        <p className="text-sm font-semibold text-slate-800">
                                            <span className="tabular-nums">
                                                {counts.processed}
                                            </span>
                                            {" de "}
                                            <span className="tabular-nums">{counts.total}</span>
                                            {" destinatários processados"}
                                        </p>
                                        <span className="text-sm font-semibold tabular-nums text-slate-700">
                                            {counts.pct}%
                                        </span>
                                    </div>
                                    <div
                                        className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100"
                                        role="progressbar"
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                        aria-valuenow={counts.pct}
                                        aria-label="Progresso do disparo"
                                    >
                                        <div
                                            className="h-full rounded-full bg-blue-500 transition-[width] duration-300 ease-out"
                                            style={{ width: `${counts.pct}%` }}
                                        />
                                    </div>
                                </div>

                                {datafyCounters && (
                                    <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 text-xs text-slate-600 grid grid-cols-2 sm:grid-cols-4 gap-2">
                                        <span>
                                            Aceitas API:{" "}
                                            <strong className="text-slate-900">
                                                {datafyCounters.accepted}
                                            </strong>
                                        </span>
                                        <span>
                                            Entregues:{" "}
                                            <strong className="text-slate-900">
                                                {datafyCounters.delivered}
                                            </strong>
                                        </span>
                                        <span>
                                            Lidas:{" "}
                                            <strong className="text-slate-900">
                                                {datafyCounters.read}
                                            </strong>
                                        </span>
                                        <span>
                                            Falhas:{" "}
                                            <strong className="text-slate-900">
                                                {datafyCounters.failed}
                                            </strong>
                                        </span>
                                        {datafyCounters.dryRun && (
                                            <span className="col-span-2 sm:col-span-4 font-medium text-amber-800">
                                                Modo simulação — nenhum envio real
                                            </span>
                                        )}
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
                                    <StatusCard
                                        tone="green"
                                        icon={<Send className="h-4 w-4" />}
                                        value={
                                            datafyCounters
                                                ? datafyCounters.accepted
                                                : counts.sent
                                        }
                                        label={
                                            datafyCounters
                                                ? "Aceitas (API)"
                                                : "Enviados"
                                        }
                                    />
                                    <StatusCard
                                        tone="blue"
                                        icon={<Loader2 className="h-4 w-4 animate-spin" />}
                                        value={counts.sending}
                                        label="Enviando..."
                                    />
                                    <StatusCard
                                        tone="gray"
                                        icon={<Hourglass className="h-4 w-4" />}
                                        value={counts.waiting}
                                        label="Aguardando"
                                    />
                                    <StatusCard
                                        tone="red"
                                        icon={<XCircle className="h-4 w-4" />}
                                        value={counts.failed}
                                        label="Falhas"
                                    />
                                </div>
                            </>
                        ) : (
                            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
                                <StatusCard
                                    tone="green"
                                    icon={<Send className="h-4 w-4" />}
                                    value={counts.sent}
                                    label="Enviados"
                                    percent={
                                        counts.total
                                            ? Math.round((counts.sent / counts.total) * 100)
                                            : 0
                                    }
                                />
                                <StatusCard
                                    tone="red"
                                    icon={<XCircle className="h-4 w-4" />}
                                    value={counts.failed}
                                    label="Falhas"
                                    percent={
                                        counts.total
                                            ? Math.round((counts.failed / counts.total) * 100)
                                            : 0
                                    }
                                />
                                {isCancelled ? (
                                    <StatusCard
                                        tone="amber"
                                        icon={<Ban className="h-4 w-4" />}
                                        value={counts.cancelled}
                                        label="Cancelados"
                                        percent={
                                            counts.total
                                                ? Math.round(
                                                      (counts.cancelled / counts.total) * 100
                                                  )
                                                : 0
                                        }
                                    />
                                ) : (
                                    <StatusCard
                                        tone="gray"
                                        icon={<Hourglass className="h-4 w-4" />}
                                        value={counts.waiting + counts.sending}
                                        label="Pendentes"
                                        percent={
                                            counts.total
                                                ? Math.round(
                                                      ((counts.waiting + counts.sending) /
                                                          counts.total) *
                                                          100
                                                  )
                                                : 0
                                        }
                                    />
                                )}
                                <div className="col-span-2 flex flex-col justify-between rounded-xl border border-blue-100 bg-blue-50/70 px-3.5 py-3 sm:col-span-1 lg:col-span-1">
                                    <div className="flex items-center gap-2 text-blue-600">
                                        <Clock className="h-4 w-4" />
                                        <span className="text-xs font-medium">
                                            {isCancelled ? "Total" : "Duração total"}
                                        </span>
                                    </div>
                                    {isCancelled ? (
                                        <>
                                            <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900">
                                                {counts.total}
                                            </p>
                                            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                                                destinatários no disparo
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900">
                                                {formatDuration(startedAt, completedAt)}
                                            </p>
                                            <div className="mt-2 space-y-0.5 text-[11px] leading-relaxed text-slate-500">
                                                <p>Início: {formatDateTime(startedAt, timezone)}</p>
                                                <p>
                                                    Término:{" "}
                                                    {formatDateTime(completedAt, timezone)}
                                                </p>
                                                <p>
                                                    Total:{" "}
                                                    <span className="font-semibold text-slate-700">
                                                        {counts.total} destinatários
                                                    </span>
                                                </p>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Table */}
                        <div className="overflow-hidden rounded-xl border border-slate-200">
                            <div className="max-h-[min(42vh,360px)] overflow-auto">
                                <table className="w-full min-w-[640px] border-collapse text-sm">
                                    <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
                                        <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                                            <th className="px-3 py-2.5 w-10">#</th>
                                            <th className="px-3 py-2.5">Destinatário</th>
                                            <th className="px-3 py-2.5">Status</th>
                                            <th className="px-3 py-2.5">Data / Hora</th>
                                            <th className="px-3 py-2.5">Detalhes</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {recipients.map((row, index) => (
                                            <RecipientTableRow
                                                key={row.id}
                                                index={index + 1}
                                                row={row}
                                                timeZone={timezone}
                                            />
                                        ))}
                                        {recipients.length === 0 && (
                                            <tr>
                                                <td
                                                    colSpan={5}
                                                    className="px-3 py-8 text-center text-sm text-slate-400"
                                                >
                                                    Aguardando destinatários…
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {isRunning && (
                            <p className="flex items-start gap-2 text-xs text-slate-500 sm:hidden">
                                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                O disparo continua mesmo se você sair desta tela. Não inicie outro
                                envio até concluir.
                            </p>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                        {isRunning ? (
                            <>
                                <p className="flex items-center gap-2 text-xs text-slate-500 sm:text-sm">
                                    <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                    <span>
                                        Início: {formatDateTime(startedAt, timezone)}
                                        <span className="mx-1.5 text-slate-300">|</span>
                                        Intervalo: {delayLabel} mínimo entre mensagens
                                        <span className="text-slate-400">
                                            {" "}
                                            (+ até 50% aleatório)
                                        </span>
                                    </span>
                                </p>
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={cancelling || !onCancelBroadcast}
                                    onClick={() => setConfirmOpen(true)}
                                    className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700"
                                >
                                    {cancelling ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Cancelando...
                                        </>
                                    ) : (
                                        "Cancelar disparo"
                                    )}
                                </Button>
                            </>
                        ) : (
                            <>
                                <div className="flex flex-wrap gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={() => onOpenChange(false)}
                                        className="gap-1.5"
                                    >
                                        <X className="h-4 w-4" />
                                        Fechar
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={onViewHistory}
                                        className="gap-1.5"
                                    >
                                        <List className="h-4 w-4" />
                                        Ver histórico deste disparo
                                    </Button>
                                </div>
                                <Button
                                    type="button"
                                    onClick={() => exportCsv(recipients, timezone)}
                                    className="gap-1.5 bg-blue-600 text-white hover:bg-blue-700"
                                >
                                    <Download className="h-4 w-4" />
                                    Exportar relatório (CSV)
                                </Button>
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Cancelar disparo?</AlertDialogTitle>
                        <AlertDialogDescription>
                            As mensagens já enviadas não poderão ser canceladas. Os destinatários
                            que ainda não foram processados não receberão a mensagem.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={cancelling}>
                            Continuar enviando
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={cancelling}
                            onClick={(e) => {
                                e.preventDefault();
                                void handleConfirmCancel();
                            }}
                            className="bg-red-600 text-white hover:bg-red-700"
                        >
                            Sim, cancelar disparo
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

function StatusCard({
    tone,
    icon,
    value,
    label,
    percent,
}: {
    tone: "green" | "blue" | "gray" | "red" | "amber";
    icon: ReactNode;
    value: number;
    label: string;
    percent?: number;
}) {
    const tones = {
        green: "border-emerald-100 bg-emerald-50/80 text-emerald-600",
        blue: "border-blue-100 bg-blue-50/80 text-blue-600",
        gray: "border-slate-200 bg-slate-50 text-slate-500",
        red: "border-red-100 bg-red-50/80 text-red-500",
        amber: "border-amber-100 bg-amber-50/80 text-amber-600",
    } as const;

    return (
        <div className={cn("rounded-xl border px-3 py-3", tones[tone])}>
            <div className="flex items-center gap-1.5 opacity-90">{icon}</div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight text-slate-900">
                {value}
                {typeof percent === "number" && (
                    <span className="ml-1 text-sm font-semibold text-slate-500">({percent}%)</span>
                )}
            </p>
            <p className="mt-0.5 text-xs font-medium">{label}</p>
        </div>
    );
}

function RecipientTableRow({
    index,
    row,
    timeZone,
}: {
    index: number;
    row: BroadcastRecipientRow;
    timeZone: string;
}) {
    const rowTone =
        row.status === "sending"
            ? "bg-blue-50/70"
            : row.status === "failed"
              ? "bg-red-50/50"
              : row.status === "cancelled"
                ? "bg-amber-50/40"
                : "bg-white";

    return (
        <tr className={cn("border-b border-slate-100 last:border-0", rowTone)}>
            <td className="px-3 py-2.5 tabular-nums text-slate-400">{index}</td>
            <td className="px-3 py-2.5 font-mono text-[13px] font-medium text-slate-800">
                {row.display}
            </td>
            <td className="px-3 py-2.5">
                <StatusBadge status={row.status} />
            </td>
            <td className="px-3 py-2.5 tabular-nums text-slate-600">
                {row.at ? formatDateTime(row.at, timeZone) : "-"}
            </td>
            <td className="px-3 py-2.5">
                <DetailCell status={row.status} detail={row.detail} />
            </td>
        </tr>
    );
}

function StatusBadge({ status }: { status: RecipientRowStatus }) {
    if (status === "sent") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-600">
                <Send className="h-3.5 w-3.5" aria-hidden />
                Enviado
            </span>
        );
    }
    if (status === "sending") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-blue-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                <span>
                    Enviando
                    <span className="sr-only"> em andamento</span>...
                </span>
            </span>
        );
    }
    if (status === "failed") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-red-600">
                <XCircle className="h-3.5 w-3.5" aria-hidden />
                Não enviado
            </span>
        );
    }
    if (status === "cancelled") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-700">
                <Ban className="h-3.5 w-3.5" aria-hidden />
                Cancelado
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
            <Hourglass className="h-3.5 w-3.5" aria-hidden />
            Aguardando
        </span>
    );
}

function DetailCell({ status, detail }: { status: RecipientRowStatus; detail: string }) {
    if (status === "sent") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {detail || "Mensagem enviada com sucesso"}
            </span>
        );
    }
    if (status === "sending") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-blue-600">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                {detail || "Enviando mensagem..."}
            </span>
        );
    }
    if (status === "failed") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-red-600">
                <XCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {detail || "Falha no envio"}
            </span>
        );
    }
    if (status === "cancelled") {
        return (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-amber-700">
                <Ban className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {detail || "Não enviado — disparo cancelado"}
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-slate-500">
            <Hourglass className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {detail || "Aguardando na fila..."}
        </span>
    );
}
