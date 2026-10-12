"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link2, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import type { GroupedVersionDto } from "@/components/dashboard/bulletin-grouped-cards";
import {
    buildCompatibleCardOptions,
    emptyCompatMessage,
} from "@/modules/datafy/campaigns/bulletin/association-compat";

type Orphan = {
    id: string;
    technicalName: string;
    displayName: string;
    language: string;
    loadsPerMessage: number;
    bodyPreview: string;
    associationStatus: string;
};

/**
 * Admin UI: associate APPROVED templates that are not linked to any bulletin card.
 * Never resubmits to Meta. Never invents card order.
 */
export function BulletinOrphanAssociatePanel() {
    const [orphans, setOrphans] = useState<Orphan[]>([]);
    const [versions, setVersions] = useState<GroupedVersionDto[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [pick, setPick] = useState<Record<string, string>>({});

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const [oRes, vRes] = await Promise.all([
                fetch("/api/channels/datafy/bulletins/grouped?orphans=1"),
                fetch("/api/channels/datafy/bulletins/grouped?history=1"),
            ]);
            const oJson = await oRes.json().catch(() => ({}));
            const vJson = await vRes.json().catch(() => ({}));
            if (!oRes.ok) throw new Error(oJson.message || "Falha orphans");
            if (!vRes.ok) throw new Error(vJson.message || "Falha versões");
            setOrphans(oJson.data.orphans || []);
            setVersions([
                ...(vJson.data.current || []),
                ...(vJson.data.history || []),
            ]);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao carregar");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void reload();
    }, [reload]);

    const optionsFor = useCallback(
        (orphan: Orphan) =>
            buildCompatibleCardOptions(versions, {
                templateLoadsPerMessage: orphan.loadsPerMessage,
                templateLanguage: orphan.language || "pt_BR",
                excludeAlreadyLinked: true,
            }),
        [versions]
    );

    const associate = async (orphanId: string) => {
        const cardId = pick[orphanId];
        if (!cardId) {
            toast.error("Escolha o card do boletim/versão");
            return;
        }
        setBusyId(orphanId);
        try {
            const res = await fetch("/api/channels/datafy/bulletins/grouped", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "associate",
                    cardId,
                    managedTemplateId: orphanId,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.message || "Falha na associação");
            toast.success("Template associado ao card (sem reenvio Meta)");
            await reload();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro");
        } finally {
            setBusyId(null);
        }
    };

    const createCompat = async (orphan: Orphan) => {
        setBusyId(orphan.id);
        try {
            const res = await fetch("/api/channels/datafy/bulletins/grouped", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action: "create_from_orphans",
                    title: orphan.displayName || orphan.technicalName,
                    managedTemplateIds: [orphan.id],
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.message || "Falha ao criar card");
            toast.success("Card compatível criado e associado");
            await reload();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro");
        } finally {
            setBusyId(null);
        }
    };

    const totalCards = useMemo(
        () => versions.reduce((n, v) => n + (v.cards?.length || 0), 0),
        [versions]
    );

    return (
        <Card className="border-slate-200/80 shadow-sm">
            <CardHeader>
                <CardTitle className="text-lg inline-flex items-center gap-2">
                    <Link2 className="h-5 w-5" />
                    Templates aprovados não associados
                </CardTitle>
                <CardDescription>
                    Associe manualmente templates APPROVED existentes a um card
                    de boletim/versão. Prévia obrigatória. Não reenvia à Meta.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {loading ? (
                    <p className="text-sm text-slate-500 inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Carregando…
                    </p>
                ) : null}
                {!loading && orphans.length === 0 ? (
                    <p className="text-sm text-slate-500">
                        Nenhum template órfão — todos os APPROVED em biblioteca
                        já estão ligados a algum card, ou ainda não há
                        registros.
                    </p>
                ) : null}
                {orphans.map((o) => {
                    const options = optionsFor(o);
                    return (
                        <div
                            key={o.id}
                            className="rounded-2xl border border-slate-200 bg-white p-3.5 space-y-2.5"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold font-mono">
                                    {o.technicalName}
                                </p>
                                <Badge
                                    variant="outline"
                                    className="rounded-md text-[10px]"
                                >
                                    Não associado
                                </Badge>
                                <Badge
                                    variant="outline"
                                    className="rounded-md text-[10px]"
                                >
                                    {o.loadsPerMessage} carga(s)/msg
                                </Badge>
                            </div>
                            <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 border border-slate-100 p-2 text-[11px] text-slate-600">
                                {o.bodyPreview}
                            </pre>
                            {options.length === 0 ? (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950 space-y-2">
                                    <p>
                                        {emptyCompatMessage({
                                            templateLoadsPerMessage:
                                                o.loadsPerMessage,
                                            templateLanguage: o.language,
                                            totalCards,
                                            totalVersions: versions.length,
                                        })}
                                    </p>
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="rounded-xl"
                                        disabled={busyId === o.id}
                                        onClick={() => void createCompat(o)}
                                    >
                                        {busyId === o.id ? (
                                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                                        )}
                                        Criar card compatível
                                    </Button>
                                </div>
                            ) : (
                                <div className="flex flex-wrap items-end gap-2">
                                    <div className="min-w-[240px] flex-1 space-y-1">
                                        <p className="text-xs text-slate-500">
                                            Card do boletim/versão
                                        </p>
                                        <Select
                                            value={pick[o.id] || undefined}
                                            onValueChange={(v) =>
                                                setPick((prev) => ({
                                                    ...prev,
                                                    [o.id]: v,
                                                }))
                                            }
                                        >
                                            <SelectTrigger className="bg-white">
                                                <SelectValue placeholder="Selecione o card compatível" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {options.map((c) => (
                                                    <SelectItem
                                                        key={c.value}
                                                        value={c.value}
                                                    >
                                                        {c.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="rounded-xl"
                                        disabled={
                                            busyId === o.id || !pick[o.id]
                                        }
                                        onClick={() => void associate(o.id)}
                                    >
                                        {busyId === o.id ? (
                                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                            <Link2 className="mr-1.5 h-3.5 w-3.5" />
                                        )}
                                        Confirmar associação
                                    </Button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </CardContent>
        </Card>
    );
}
