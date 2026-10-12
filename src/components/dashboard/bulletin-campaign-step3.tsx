"use client";

import { AlertTriangle, CheckCircle2, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { BulletinVersionPick } from "@/modules/datafy/campaigns/bulletin/selection";
import {
    estimateMessagesFromSelection,
    flattenBulletinSelections,
    isOrphanVersionId,
    validateBulletinPicks,
} from "@/modules/datafy/campaigns/bulletin/selection";
import { assessBulletinLaunchIssues } from "@/modules/datafy/campaigns/create-payload";
import type { CampaignMessagePart } from "@/modules/datafy/campaigns/bulletin/types";

/**
 * Etapa 3 — Validação de envio (sem nova seleção de boletins).
 */
export function BulletinCampaignValidation(props: {
    contentKind: "message" | "bulletin";
    purpose: string;
    messageBody: string;
    templateName?: string | null;
    templateStatus?: string | null;
    sendModeLabel: string;
    openWindowCount: number;
    needsTemplateCount: number;
    eligibleCount: number;
    technicallySendableCount: number;
    bulletinSelections: BulletinVersionPick[];
    parts: CampaignMessagePart[];
    consentButtonsEnabled?: boolean;
    consentButtonsAttachable?: boolean;
    onGoToStep1: () => void;
    messageFooter?: React.ReactNode;
}) {
    if (props.contentKind === "message") {
        return (
            <div className="space-y-4 max-w-3xl">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                    <p className="font-semibold text-slate-900">
                        Validação — Mensagem comum
                    </p>
                    <p className="text-xs text-slate-500">
                        Modalidade: {props.sendModeLabel}
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2 text-sm text-slate-700">
                        <p>
                            Janelas 24h abertas:{" "}
                            <strong>{props.openWindowCount}</strong>
                        </p>
                        <p>
                            Exigem template:{" "}
                            <strong>{props.needsTemplateCount}</strong>
                        </p>
                        <p>
                            Elegíveis (consentimento):{" "}
                            <strong>{props.eligibleCount}</strong>
                        </p>
                        <p>
                            Aptos tecnicamente:{" "}
                            <strong>{props.technicallySendableCount}</strong>
                        </p>
                    </div>
                    {props.templateName ? (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm">
                            Template efetivo:{" "}
                            <code className="font-mono">
                                {props.templateName}
                            </code>{" "}
                            · {props.templateStatus || "—"}
                            <p className="text-[11px] text-emerald-900/80 mt-1">
                                A prévia e a fila usam este template quando a
                                modalidade exigir APPROVED — não o texto livre
                                fora da janela.
                            </p>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                            Sem template selecionado — envio depende de texto
                            livre / janela / finalidade.
                        </div>
                    )}
                    <ConsentStatus
                        enabled={Boolean(props.consentButtonsEnabled)}
                        attachable={Boolean(props.consentButtonsAttachable)}
                    />
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 border border-slate-100 p-3 text-[12px] text-slate-700">
                        {props.messageBody || "(sem texto)"}
                    </pre>
                </div>
                {props.messageFooter}
            </div>
        );
    }

    const prepared = flattenBulletinSelections(props.bulletinSelections);
    const validation = validateBulletinPicks(props.bulletinSelections);
    const planned = estimateMessagesFromSelection(
        props.technicallySendableCount || props.eligibleCount,
        props.bulletinSelections
    );
    const launch = assessBulletinLaunchIssues({
        purpose: props.purpose,
        parts: props.parts.length ? props.parts : prepared.parts,
        dryRun: false,
        confirmMarketingWithUtilityPurpose: false,
    });
    const launchSim = assessBulletinLaunchIssues({
        purpose: props.purpose,
        parts: props.parts.length ? props.parts : prepared.parts,
        dryRun: true,
        confirmMarketingWithUtilityPurpose: false,
    });

    const statusLabel =
        !validation.ok || launch.status === "blocked"
            ? "Bloqueado"
            : launch.status === "attention" || launchSim.status === "attention"
              ? "Atenção necessária"
              : "Pronto para envio";

    return (
        <div className="space-y-4 max-w-3xl">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                        <p className="font-semibold text-slate-900 inline-flex items-center gap-2">
                            <Layers className="h-4 w-4" />
                            Validação de envio
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                            A seleção foi feita na Etapa 1. Aqui validamos
                            templates, idioma, categoria, variáveis e
                            elegibilidade.
                        </p>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-xl"
                        onClick={props.onGoToStep1}
                    >
                        Alterar boletins na Etapa 1
                    </Button>
                </div>

                <div
                    className={cn(
                        "rounded-xl border px-3 py-2 text-sm font-medium",
                        statusLabel === "Pronto para envio"
                            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                            : statusLabel === "Atenção necessária"
                              ? "border-amber-200 bg-amber-50 text-amber-950"
                              : "border-red-200 bg-red-50 text-red-900"
                    )}
                >
                    Resultado: {statusLabel}
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                    <Stat
                        label="Templates / cards"
                        value={String(prepared.meta.cardCount)}
                    />
                    <Stat
                        label="Itens selecionados"
                        value={String(prepared.meta.bulletinCount)}
                    />
                    <Stat
                        label="Destinatários aptos"
                        value={String(props.technicallySendableCount)}
                    />
                    <Stat label="Mensagens previstas" value={String(planned)} />
                </div>

                <ConsentStatus
                    enabled={Boolean(props.consentButtonsEnabled)}
                    attachable={Boolean(props.consentButtonsAttachable)}
                />

                {!props.bulletinSelections.length ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 inline-flex gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        Nenhum conteúdo selecionado. Volte à Etapa 1.
                    </div>
                ) : null}

                {props.bulletinSelections.map((b) => {
                    const orphan = isOrphanVersionId(b.versionId);
                    return (
                        <div
                            key={b.versionId}
                            className="rounded-xl border border-slate-200 px-3 py-2.5 space-y-2"
                        >
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold">
                                    {b.title}
                                </p>
                                <Badge
                                    variant="outline"
                                    className="font-mono text-[10px]"
                                >
                                    {b.publicKey}
                                </Badge>
                                {orphan ? (
                                    <Badge
                                        variant="outline"
                                        className="text-[10px] border-sky-300 text-sky-900"
                                    >
                                        Template individual
                                    </Badge>
                                ) : (
                                    <>
                                        <Badge
                                            variant="outline"
                                            className="text-[10px]"
                                        >
                                            v{b.version}
                                        </Badge>
                                        <Badge
                                            variant="outline"
                                            className="text-[10px]"
                                        >
                                            {b.mode === "complete_bulletin"
                                                ? "Boletim completo"
                                                : "Cards específicos"}
                                        </Badge>
                                    </>
                                )}
                            </div>
                            <ul className="space-y-1">
                                {b.cardPositions.map((pos) => {
                                    const card = b.cards.find(
                                        (c) => c.position === pos
                                    );
                                    const ok =
                                        card &&
                                        String(
                                            card.approvalStatus
                                        ).toUpperCase() === "APPROVED" &&
                                        card.technicalName;
                                    return (
                                        <li
                                            key={`${b.versionId}-${pos}`}
                                            className="text-xs text-slate-700 flex flex-wrap gap-2 items-center"
                                        >
                                            {ok ? (
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                            ) : (
                                                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                            )}
                                            {orphan ? "Template" : `Card ${pos}`}{" "}
                                            ·{" "}
                                            <code className="font-mono">
                                                {card?.technicalName || "—"}
                                            </code>{" "}
                                            ·{" "}
                                            {card?.language ||
                                                card?.category ||
                                                "—"}{" "}
                                            · {card?.approvalStatus || "—"}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}

                {[...validation.errors, ...launch.issues.map((i) => i.message)]
                    .length ? (
                    <ul className="text-xs text-amber-950 list-disc pl-5 space-y-1">
                        {validation.errors.map((e) => (
                            <li key={e}>{e}</li>
                        ))}
                        {launch.issues.map((i) => (
                            <li
                                key={i.code + i.message}
                                className={
                                    i.level === "error"
                                        ? "text-red-800"
                                        : undefined
                                }
                            >
                                {i.message}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-emerald-800 inline-flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4" />
                        Seleção válida — a fila enviará exatamente estas{" "}
                        {props.parts.length} mensagem(ns) por destinatário, nesta
                        ordem, com o idioma de cada template.
                    </p>
                )}
            </div>
        </div>
    );
}

function ConsentStatus(props: { enabled: boolean; attachable: boolean }) {
    let label = "Desativados";
    if (props.enabled && props.attachable) {
        label = "Ativados e compatíveis com a modalidade atual";
    } else if (props.enabled) {
        label =
            "Configurados, mas indisponíveis nesta modalidade de template APPROVED";
    }
    return (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            Botões de resposta e consentimento:{" "}
            <strong className="font-medium">{label}</strong>
        </div>
    );
}

function Stat(props: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-slate-400">
                {props.label}
            </p>
            <p className="text-lg font-semibold text-slate-900">{props.value}</p>
        </div>
    );
}

/** @deprecated Use BulletinCampaignValidation — kept for import compatibility. */
export function BulletinCampaignStep3(
    props: Parameters<typeof BulletinCampaignValidation>[0]
) {
    return <BulletinCampaignValidation {...props} />;
}
