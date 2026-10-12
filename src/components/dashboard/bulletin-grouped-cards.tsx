"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    CheckCircle2,
    Layers,
    Loader2,
    Megaphone,
    RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type GroupedVersionDto = {
    bundleId: string;
    publicKey: string;
    name: string;
    versionId: string;
    version: number;
    isCurrent: boolean;
    title: string;
    loadCount: number;
    cardCount: number;
    approvalStatus: string;
    approvedCardCount: number;
    createdAt: string;
    updatedAt: string;
    cards: Array<{
        id: string;
        position: number;
        loadSummary: string;
        technicalName: string | null;
        displayName: string | null;
        approvalStatus: string;
        lastSyncedAt: string | null;
        bodyPreview: string | null;
        libraryTemplateId: string | null;
    }>;
};

function approvalLabel(status: string) {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED" || s === "FULLY_APPROVED") return "Aprovado";
    if (s === "PENDING" || s === "PENDING_APPROVAL") return "Pendente";
    if (s === "PARTIALLY_APPROVED") return "Parcial";
    if (s === "REJECTED") return "Rejeitado";
    return status || "Rascunho";
}

function approvalTone(status: string) {
    const s = String(status || "").toUpperCase();
    if (s === "APPROVED" || s === "FULLY_APPROVED")
        return "border-emerald-300 bg-emerald-50 text-emerald-900";
    if (s === "PENDING" || s === "PENDING_APPROVAL" || s === "PARTIALLY_APPROVED")
        return "border-amber-300 bg-amber-50 text-amber-950";
    if (s === "REJECTED") return "border-red-300 bg-red-50 text-red-900";
    return "border-slate-200 bg-slate-50 text-slate-700";
}

export function BulletinGroupedCardsSection(props: {
    version: GroupedVersionDto | null;
    busy?: boolean;
    onRefresh?: () => void;
    onRegister?: () => void;
}) {
    const router = useRouter();
    const v = props.version;
    const fullyApproved =
        v &&
        v.cardCount > 0 &&
        v.approvedCardCount === v.cardCount &&
        (v.approvalStatus === "fully_approved" ||
            v.approvedCardCount === v.cardCount);

    return (
        <Card className="border-slate-200/80 shadow-sm overflow-hidden">
            <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <CardTitle className="text-lg inline-flex items-center gap-2">
                            <Layers className="h-5 w-5 text-slate-700" />
                            Cards do boletim
                        </CardTitle>
                        <CardDescription>
                            Cada card fica vinculado ao boletim e à versão —
                            nunca só pelo nome do template.
                        </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {props.onRegister ? (
                            <Button
                                type="button"
                                size="sm"
                                className="rounded-xl"
                                disabled={props.busy}
                                onClick={() => props.onRegister?.()}
                            >
                                {props.busy ? (
                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Layers className="mr-1.5 h-3.5 w-3.5" />
                                )}
                                Registrar boletim / versão
                            </Button>
                        ) : null}
                        {props.onRefresh ? (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="rounded-xl"
                                disabled={props.busy}
                                onClick={() => props.onRefresh?.()}
                            >
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                Sincronizar
                            </Button>
                        ) : null}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {!v ? (
                    <p className="text-sm text-slate-500">
                        Analise o boletim e registre a versão para gerar o
                        identificador (ex.: COTTON-20261012-001) e os cards
                        ordenados.
                    </p>
                ) : (
                    <>
                        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-3 space-y-1.5">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-900">
                                    {v.title}
                                </p>
                                <Badge
                                    variant="outline"
                                    className="rounded-lg font-mono text-[11px]"
                                >
                                    {v.publicKey}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className="rounded-lg text-[11px]"
                                >
                                    Versão {v.version}
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className={cn(
                                        "rounded-lg text-[11px]",
                                        approvalTone(v.approvalStatus)
                                    )}
                                >
                                    {approvalLabel(v.approvalStatus)}
                                </Badge>
                            </div>
                            <p className="text-xs text-slate-500">
                                {v.loadCount} carga(s) · {v.cardCount} card(s) ·{" "}
                                {v.approvedCardCount} de {v.cardCount} aprovados
                            </p>
                            {fullyApproved ? (
                                <p className="text-sm font-medium text-emerald-800 inline-flex items-center gap-1.5 pt-1">
                                    <CheckCircle2 className="h-4 w-4" />
                                    Boletim completo aprovado —{" "}
                                    {v.approvedCardCount} de {v.cardCount} cards
                                </p>
                            ) : (
                                <p className="text-sm text-amber-900 pt-1">
                                    Pendentes:{" "}
                                    {v.cards
                                        .filter(
                                            (c) =>
                                                String(
                                                    c.approvalStatus
                                                ).toUpperCase() !== "APPROVED"
                                        )
                                        .map((c) => `Card ${c.position}`)
                                        .join(", ") || "aguardando sync"}
                                </p>
                            )}
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {v.cards.map((card) => (
                                <div
                                    key={card.id}
                                    className={cn(
                                        "rounded-2xl border bg-white p-3.5 space-y-2",
                                        String(card.approvalStatus).toUpperCase() ===
                                            "APPROVED"
                                            ? "border-emerald-200"
                                            : "border-slate-200"
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <p className="text-sm font-semibold">
                                            Card {card.position} de {v.cardCount}
                                        </p>
                                        <Badge
                                            variant="outline"
                                            className={cn(
                                                "rounded-lg text-[10px]",
                                                approvalTone(card.approvalStatus)
                                            )}
                                        >
                                            {approvalLabel(card.approvalStatus)}
                                        </Badge>
                                    </div>
                                    <p className="text-xs text-slate-600">
                                        {card.loadSummary}
                                    </p>
                                    <p className="text-[11px] text-slate-500 font-mono truncate">
                                        {card.technicalName ||
                                            card.libraryTemplateId ||
                                            "Sem template"}
                                    </p>
                                    {card.lastSyncedAt ? (
                                        <p className="text-[10px] text-slate-400">
                                            Sync:{" "}
                                            {new Date(
                                                card.lastSyncedAt
                                            ).toLocaleString("pt-BR")}
                                        </p>
                                    ) : null}
                                    {card.bodyPreview ? (
                                        <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 border border-slate-100 p-2 text-[11px] leading-relaxed text-slate-600">
                                            {card.bodyPreview.slice(0, 420)}
                                        </pre>
                                    ) : null}
                                </div>
                            ))}
                        </div>

                        {fullyApproved ? (
                            <Button
                                type="button"
                                className="rounded-xl"
                                onClick={() => {
                                    const q = new URLSearchParams({
                                        bulletin: "1",
                                        versionId: v.versionId,
                                        mode: "complete_bulletin",
                                    });
                                    router.push(
                                        `/dashboard/broadcast?${q.toString()}`
                                    );
                                }}
                            >
                                <Megaphone className="mr-1.5 h-4 w-4" />
                                Usar boletim em uma campanha
                            </Button>
                        ) : null}
                    </>
                )}
            </CardContent>
        </Card>
    );
}

export function useBulletinGrouping() {
    const [version, setVersion] = useState<GroupedVersionDto | null>(null);
    const [busy, setBusy] = useState(false);

    const registerVersion = useCallback(
        async (input: {
            title: string;
            rawText: string;
            loads?: unknown;
            loadCount?: number;
            parts?: unknown[];
            draftId?: string | null;
            bundleId?: string | null;
        }) => {
            setBusy(true);
            try {
                const res = await fetch(
                    "/api/channels/datafy/bulletins/grouped",
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            action: "create_version",
                            ...input,
                        }),
                    }
                );
                const json = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(json.message || "Falha ao registrar boletim");
                }
                setVersion(json.data.version as GroupedVersionDto);
                toast.success(
                    `Boletim ${json.data.bundle.publicKey} · v${json.data.version.version}`
                );
                return json.data.version as GroupedVersionDto;
            } finally {
                setBusy(false);
            }
        },
        []
    );

    const refreshVersion = useCallback(async (versionId: string) => {
        setBusy(true);
        try {
            await fetch("/api/channels/datafy/bulletins/grouped", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "auto_link", versionId }),
            });
            const res = await fetch(
                `/api/channels/datafy/bulletins/grouped?versionId=${encodeURIComponent(versionId)}`
            );
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.message || "Falha ao sincronizar");
            setVersion(json.data.version as GroupedVersionDto);
            toast.success("Status dos cards atualizado");
        } finally {
            setBusy(false);
        }
    }, []);

    return { version, setVersion, busy, registerVersion, refreshVersion };
}
