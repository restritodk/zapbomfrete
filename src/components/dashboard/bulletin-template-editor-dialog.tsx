"use client";

import {
    useEffect,
    useMemo,
    useState,
    type Dispatch,
    type SetStateAction,
} from "react";
import {
    AlertTriangle,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    FilePlus2,
    Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { META_BODY_MAX } from "@/modules/datafy/campaigns/bulletin/template-validation";
import {
    EDITOR_STEPS,
    fillPreviewFromExamples,
    isDraftDirty,
    nextEditorStep,
    prevEditorStep,
    type EditorStepId,
    type TemplateEditorDraft,
} from "@/modules/datafy/campaigns/bulletin/template-editor-helpers";

type FieldOpt = { key: string; label: string };

type Props = {
    open: boolean;
    mode: "create" | "edit";
    draft: TemplateEditorDraft;
    setDraft: Dispatch<SetStateAction<TemplateEditorDraft>>;
    fieldOpts: FieldOpt[];
    saving: boolean;
    technicalNameLocked?: boolean;
    onBodyChange: (body: string) => void;
    onSave: () => void;
    onClose: () => void;
};

const premiumBtn =
    "rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-[0_6px_16px_-6px_rgba(37,99,235,0.55)]";
const premiumBtnOutline =
    "rounded-xl border-slate-200 bg-white text-[#0f2744] hover:bg-slate-50";
const fieldClass =
    "h-10 rounded-xl border-slate-200 bg-white focus-visible:ring-[#2563eb]/30";

export function BulletinTemplateEditorDialog({
    open,
    mode,
    draft,
    setDraft,
    fieldOpts,
    saving,
    technicalNameLocked,
    onBodyChange,
    onSave,
    onClose,
}: Props) {
    const [step, setStep] = useState<EditorStepId>("info");
    const [baseline, setBaseline] = useState<TemplateEditorDraft | null>(null);
    const [discardOpen, setDiscardOpen] = useState(false);
    const [mobilePreview, setMobilePreview] = useState(false);

    useEffect(() => {
        if (open) {
            setStep("info");
            setBaseline(structuredClone(draft));
            setDiscardOpen(false);
            setMobilePreview(false);
        }
        // Capture baseline only when the dialog opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional open-edge snapshot
    }, [open]);

    const dirty = isDraftDirty(draft, baseline);
    const bodyLen = draft.bodyText.length;
    const bodyOver = bodyLen > META_BODY_MAX;
    const previewBody = useMemo(
        () => fillPreviewFromExamples(draft.bodyText, draft.exampleRow),
        [draft.bodyText, draft.exampleRow]
    );

    const requestClose = () => {
        if (saving) return;
        if (dirty) {
            setDiscardOpen(true);
            return;
        }
        onClose();
    };

    const confirmDiscard = () => {
        setDiscardOpen(false);
        onClose();
    };

    const stepIndex = EDITOR_STEPS.findIndex((s) => s.id === step);

    const WhatsAppPreview = (
        <div className="rounded-2xl border border-slate-200/80 bg-[#efeae2] p-3 sm:p-4 shadow-inner min-h-[240px] flex flex-col">
            <div className="flex items-center justify-between mb-3">
                <p className="text-[11px] font-medium text-slate-600">
                    Prévia WhatsApp
                </p>
                <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-slate-500 ring-1 ring-slate-200">
                    Ilustrativa · exemplos
                </span>
            </div>
            <div className="flex-1 flex flex-col justify-end gap-1.5">
                <div className="max-w-[min(100%,300px)] self-start rounded-2xl rounded-tl-md bg-white shadow-sm border border-black/5 overflow-hidden">
                    {draft.headerText.trim() ? (
                        <div className="px-3 pt-2.5 text-[13px] font-semibold text-[#111b21]">
                            {draft.headerText}
                        </div>
                    ) : null}
                    <div className="px-3 py-2.5 text-[13px] leading-relaxed text-[#111b21] whitespace-pre-wrap break-words">
                        {previewBody.trim() || (
                            <span className="text-slate-400 italic">
                                Digite o corpo da mensagem para ver a prévia…
                            </span>
                        )}
                    </div>
                    {draft.footerText.trim() ? (
                        <div className="px-3 pb-2 text-[11px] text-slate-500">
                            {draft.footerText}
                        </div>
                    ) : null}
                    <div className="px-3 pb-1.5 text-[10px] text-slate-400 text-right">
                        prévia
                    </div>
                </div>
                {draft.buttons.enabled ? (
                    <div className="max-w-[min(100%,300px)] space-y-1">
                        {[
                            draft.buttons.grantText.trim() ||
                                "Sim, quero ofertas",
                            draft.buttons.denyText.trim() ||
                                "Não quero receber",
                        ].map((label) => (
                            <div
                                key={label}
                                className="rounded-xl bg-white border border-black/5 text-center text-[13px] font-medium text-[#027eb5] py-2 shadow-sm"
                            >
                                {label}
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
            <p className="mt-3 text-[10px] text-center text-slate-500 leading-snug">
                Não é uma mensagem enviada. Valores são exemplos de variáveis.
            </p>
        </div>
    );

    return (
        <>
            <Dialog
                open={open}
                onOpenChange={(next) => {
                    if (!next) requestClose();
                }}
            >
                <DialogContent
                    showCloseButton={false}
                    className={cn(
                        "p-0 gap-0 overflow-hidden border-slate-200/80 bg-white",
                        "w-[min(1120px,calc(100vw-1.25rem))] max-w-[1120px]",
                        "h-[min(90vh,860px)] max-h-[90vh]",
                        "rounded-2xl shadow-[0_24px_64px_-24px_rgba(15,23,42,0.45)]",
                        "flex flex-col"
                    )}
                    onPointerDownOutside={(e) => {
                        if (dirty) {
                            e.preventDefault();
                            requestClose();
                        }
                    }}
                    onEscapeKeyDown={(e) => {
                        e.preventDefault();
                        requestClose();
                    }}
                >
                    {/* Header */}
                    <div className="shrink-0 flex items-start gap-3 px-4 sm:px-6 py-4 border-b border-slate-100 bg-white">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#2563eb] text-white shadow-[0_8px_20px_-8px_rgba(37,99,235,0.7)]">
                            <FilePlus2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1 pr-8">
                            <DialogTitle className="text-lg sm:text-xl font-bold tracking-tight text-[#0f2744]">
                                {mode === "create"
                                    ? "Novo template"
                                    : "Editar template"}
                            </DialogTitle>
                            <DialogDescription className="text-sm text-slate-500 mt-0.5">
                                Configure o modelo local da biblioteca. O
                                salvamento não envia o template à Meta.
                            </DialogDescription>
                        </div>
                        <button
                            type="button"
                            aria-label="Fechar"
                            className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                            onClick={requestClose}
                            disabled={saving}
                        >
                            <span className="sr-only">Fechar</span>
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            >
                                <path d="M18 6 6 18" />
                                <path d="m6 6 12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* Steps */}
                    <div className="shrink-0 px-4 sm:px-6 py-3 border-b border-slate-100 bg-slate-50/60">
                        <div className="flex flex-wrap gap-1.5">
                            {EDITOR_STEPS.map((s, i) => {
                                const active = s.id === step;
                                const done = i < stepIndex;
                                return (
                                    <button
                                        key={s.id}
                                        type="button"
                                        onClick={() => setStep(s.id)}
                                        className={cn(
                                            "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors",
                                            active
                                                ? "bg-[#2563eb] text-white shadow-sm"
                                                : done
                                                  ? "bg-blue-50 text-[#1d4ed8] ring-1 ring-blue-100"
                                                  : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                                                active
                                                    ? "bg-white/20"
                                                    : done
                                                      ? "bg-blue-100"
                                                      : "bg-slate-100"
                                            )}
                                        >
                                            {done ? (
                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                            ) : (
                                                s.short
                                            )}
                                        </span>
                                        <span className="hidden sm:inline">
                                            {s.label}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="mt-2 lg:hidden">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-lg text-xs text-[#2563eb]"
                                onClick={() =>
                                    setMobilePreview((v) => !v)
                                }
                            >
                                {mobilePreview
                                    ? "Voltar ao formulário"
                                    : "Ver prévia WhatsApp"}
                            </Button>
                        </div>
                    </div>

                    {/* Body */}
                    <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_360px]">
                        <div
                            className={cn(
                                "sidebar-scroll px-4 sm:px-6 py-4 min-h-0",
                                mobilePreview && "hidden lg:block"
                            )}
                        >
                            {step === "info" && (
                                <div className="space-y-4 max-w-2xl">
                                    <p className="text-sm text-slate-500">
                                        Identifique o template na biblioteca
                                        local. O nome técnico será usado na
                                        Meta se você enviar depois.
                                    </p>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <Label className="text-[#0f2744]">
                                                Nome técnico
                                            </Label>
                                            <Input
                                                className={cn(
                                                    fieldClass,
                                                    "font-mono text-sm"
                                                )}
                                                value={draft.technicalName}
                                                disabled={technicalNameLocked}
                                                onChange={(e) =>
                                                    setDraft((d) => ({
                                                        ...d,
                                                        technicalName: e.target
                                                            .value
                                                            .toLowerCase()
                                                            .replace(
                                                                /[^a-z0-9_]/g,
                                                                ""
                                                            ),
                                                    }))
                                                }
                                                placeholder="boletim_frete_1"
                                            />
                                            <p className="text-[11px] text-slate-400">
                                                Apenas a–z, 0–9 e underscore
                                            </p>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[#0f2744]">
                                                Nome de exibição
                                            </Label>
                                            <Input
                                                className={fieldClass}
                                                value={draft.displayName}
                                                onChange={(e) =>
                                                    setDraft((d) => ({
                                                        ...d,
                                                        displayName:
                                                            e.target.value,
                                                    }))
                                                }
                                                placeholder="Boletim frete 1 carga"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[#0f2744]">
                                                Categoria
                                            </Label>
                                            <Select
                                                value={draft.category}
                                                onValueChange={(v) =>
                                                    setDraft((d) => ({
                                                        ...d,
                                                        category:
                                                            v as TemplateEditorDraft["category"],
                                                    }))
                                                }
                                            >
                                                <SelectTrigger
                                                    className={fieldClass}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="MARKETING">
                                                        MARKETING
                                                    </SelectItem>
                                                    <SelectItem value="UTILITY">
                                                        UTILITY
                                                    </SelectItem>
                                                    <SelectItem value="AUTHENTICATION">
                                                        AUTHENTICATION
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label className="text-[#0f2744]">
                                                Cargas por mensagem
                                            </Label>
                                            <Select
                                                value={String(
                                                    draft.loadsPerMessage
                                                )}
                                                onValueChange={(v) =>
                                                    setDraft((d) => ({
                                                        ...d,
                                                        loadsPerMessage:
                                                            Number(
                                                                v
                                                            ) as 1 | 2 | 3,
                                                    }))
                                                }
                                            >
                                                <SelectTrigger
                                                    className={fieldClass}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="1">
                                                        1
                                                    </SelectItem>
                                                    <SelectItem value="2">
                                                        2
                                                    </SelectItem>
                                                    <SelectItem value="3">
                                                        3
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1.5 sm:col-span-2">
                                            <Label className="text-[#0f2744]">
                                                Descrição
                                            </Label>
                                            <Input
                                                className={fieldClass}
                                                value={draft.description}
                                                onChange={(e) =>
                                                    setDraft((d) => ({
                                                        ...d,
                                                        description:
                                                            e.target.value,
                                                    }))
                                                }
                                                placeholder="Uso interno / notas do modelo"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {step === "content" && (
                                <div className="space-y-4 max-w-2xl">
                                    <p className="text-sm text-slate-500">
                                        Monte o conteúdo oficial do template.
                                        Use {"{{1}}"}, {"{{2}}"}… para
                                        variáveis. Quebras de linha e emojis
                                        são preservados.
                                    </p>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between">
                                            <Label className="text-[#0f2744]">
                                                Cabeçalho{" "}
                                                <span className="text-slate-400 font-normal">
                                                    (opcional)
                                                </span>
                                            </Label>
                                            <span className="text-[11px] text-slate-400">
                                                {draft.headerText.length}/60
                                            </span>
                                        </div>
                                        <Input
                                            className={fieldClass}
                                            value={draft.headerText}
                                            maxLength={60}
                                            onChange={(e) =>
                                                setDraft((d) => ({
                                                    ...d,
                                                    headerText: e.target.value,
                                                }))
                                            }
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between">
                                            <Label className="text-[#0f2744]">
                                                Corpo
                                            </Label>
                                            <span
                                                className={cn(
                                                    "text-[11px] tabular-nums",
                                                    bodyOver
                                                        ? "text-red-600 font-medium"
                                                        : "text-slate-400"
                                                )}
                                            >
                                                {bodyLen}/{META_BODY_MAX}
                                            </span>
                                        </div>
                                        <Textarea
                                            className="min-h-[220px] rounded-xl border-slate-200 font-mono text-xs leading-relaxed focus-visible:ring-[#2563eb]/30"
                                            value={draft.bodyText}
                                            onChange={(e) =>
                                                onBodyChange(e.target.value)
                                            }
                                            placeholder={
                                                "*ATUALIZAÇÃO*\nOrigem: {{1}}\nDestino: {{2}}"
                                            }
                                        />
                                        {bodyOver ? (
                                            <p className="text-xs text-red-600 inline-flex items-center gap-1.5">
                                                <AlertTriangle className="h-3.5 w-3.5" />
                                                Corpo ultrapassa o limite Meta
                                                de {META_BODY_MAX} caracteres.
                                            </p>
                                        ) : (
                                            <p className="text-[11px] text-slate-400">
                                                Variáveis detectadas:{" "}
                                                {draft.fieldMappings.length}
                                            </p>
                                        )}
                                    </div>
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between">
                                            <Label className="text-[#0f2744]">
                                                Rodapé{" "}
                                                <span className="text-slate-400 font-normal">
                                                    (opcional)
                                                </span>
                                            </Label>
                                            <span className="text-[11px] text-slate-400">
                                                {draft.footerText.length}/60
                                            </span>
                                        </div>
                                        <Input
                                            className={fieldClass}
                                            value={draft.footerText}
                                            maxLength={60}
                                            onChange={(e) =>
                                                setDraft((d) => ({
                                                    ...d,
                                                    footerText: e.target.value,
                                                }))
                                            }
                                        />
                                    </div>
                                </div>
                            )}

                            {step === "vars" && (
                                <div className="space-y-5 max-w-2xl">
                                    <div>
                                        <p className="text-sm font-medium text-[#0f2744]">
                                            Variáveis → campos da carga
                                        </p>
                                        <p className="text-sm text-slate-500 mt-0.5">
                                            Mapeie cada {"{{n}}"} a um campo da
                                            carga e defina o exemplo enviado à
                                            Meta.
                                        </p>
                                    </div>
                                    {draft.fieldMappings.length === 0 ? (
                                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500 text-center">
                                            Nenhuma variável no corpo. Inclua{" "}
                                            {"{{1}}"} no texto da etapa Conteúdo
                                            para mapear campos.
                                        </div>
                                    ) : (
                                        <div className="space-y-2">
                                            {draft.fieldMappings.map(
                                                (m, i) => (
                                                    <div
                                                        key={i}
                                                        className="rounded-xl border border-slate-200 bg-white p-3 grid gap-2 sm:grid-cols-[72px_1fr_1fr] items-center"
                                                    >
                                                        <span className="inline-flex h-9 items-center justify-center rounded-lg bg-slate-100 font-mono text-xs font-semibold text-slate-600">
                                                            {`{{${i + 1}}}`}
                                                        </span>
                                                        <div className="space-y-1">
                                                            <Label className="text-[11px] text-slate-400">
                                                                Campo da carga
                                                            </Label>
                                                            <Select
                                                                value={m}
                                                                onValueChange={(
                                                                    v
                                                                ) => {
                                                                    const fieldMappings =
                                                                        [
                                                                            ...draft.fieldMappings,
                                                                        ];
                                                                    fieldMappings[
                                                                        i
                                                                    ] = v;
                                                                    setDraft(
                                                                        (
                                                                            d
                                                                        ) => ({
                                                                            ...d,
                                                                            fieldMappings,
                                                                        })
                                                                    );
                                                                }}
                                                            >
                                                                <SelectTrigger className="h-9 rounded-lg text-xs border-slate-200">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {fieldOpts.map(
                                                                        (
                                                                            o
                                                                        ) => (
                                                                            <SelectItem
                                                                                key={
                                                                                    o.key
                                                                                }
                                                                                value={
                                                                                    o.key
                                                                                }
                                                                            >
                                                                                {
                                                                                    o.label
                                                                                }
                                                                            </SelectItem>
                                                                        )
                                                                    )}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="space-y-1">
                                                            <Label className="text-[11px] text-slate-400">
                                                                Exemplo Meta
                                                            </Label>
                                                            <Input
                                                                className="h-9 rounded-lg text-xs border-slate-200"
                                                                value={
                                                                    draft
                                                                        .exampleRow[
                                                                        i
                                                                    ] || ""
                                                                }
                                                                placeholder="Exemplo"
                                                                onChange={(
                                                                    e
                                                                ) => {
                                                                    const exampleRow =
                                                                        [
                                                                            ...draft.exampleRow,
                                                                        ];
                                                                    exampleRow[
                                                                        i
                                                                    ] =
                                                                        e.target.value;
                                                                    setDraft(
                                                                        (
                                                                            d
                                                                        ) => ({
                                                                            ...d,
                                                                            exampleRow,
                                                                        })
                                                                    );
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    )}

                                    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm font-medium text-[#0f2744]">
                                                    Botões interativos
                                                </p>
                                                <p className="text-[11px] text-slate-500 mt-0.5 max-w-md">
                                                    Solicitar confirmação de
                                                    recebimento de ofertas
                                                    (QUICK_REPLY · máx. 25
                                                    caracteres). Templates
                                                    APPROVED exigem nova
                                                    versão.
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span className="text-xs text-slate-500">
                                                    {draft.buttons.enabled
                                                        ? "Ativado"
                                                        : "Desativado"}
                                                </span>
                                                <Switch
                                                    checked={
                                                        draft.buttons.enabled
                                                    }
                                                    onCheckedChange={(
                                                        enabled
                                                    ) =>
                                                        setDraft((d) => ({
                                                            ...d,
                                                            buttons: {
                                                                ...d.buttons,
                                                                enabled,
                                                            },
                                                        }))
                                                    }
                                                />
                                            </div>
                                        </div>
                                        {draft.buttons.enabled && (
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <div className="space-y-1">
                                                    <Label className="text-xs">
                                                        Botão positivo
                                                    </Label>
                                                    <Input
                                                        className="h-9 rounded-lg text-sm border-slate-200"
                                                        maxLength={25}
                                                        value={
                                                            draft.buttons
                                                                .grantText
                                                        }
                                                        onChange={(e) =>
                                                            setDraft((d) => ({
                                                                ...d,
                                                                buttons: {
                                                                    ...d.buttons,
                                                                    grantText:
                                                                        e
                                                                            .target
                                                                            .value,
                                                                },
                                                            }))
                                                        }
                                                    />
                                                    <p className="text-[10px] text-slate-400">
                                                        {
                                                            draft.buttons
                                                                .grantText
                                                                .length
                                                        }
                                                        /25
                                                    </p>
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-xs">
                                                        Botão negativo
                                                    </Label>
                                                    <Input
                                                        className="h-9 rounded-lg text-sm border-slate-200"
                                                        maxLength={25}
                                                        value={
                                                            draft.buttons
                                                                .denyText
                                                        }
                                                        onChange={(e) =>
                                                            setDraft((d) => ({
                                                                ...d,
                                                                buttons: {
                                                                    ...d.buttons,
                                                                    denyText:
                                                                        e
                                                                            .target
                                                                            .value,
                                                                },
                                                            }))
                                                        }
                                                    />
                                                    <p className="text-[10px] text-slate-400">
                                                        {
                                                            draft.buttons
                                                                .denyText
                                                                .length
                                                        }
                                                        /25
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {step === "review" && (
                                <div className="space-y-4 max-w-2xl">
                                    <p className="text-sm text-slate-500">
                                        Confira o resumo antes de salvar na
                                        biblioteca local.
                                    </p>
                                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm">
                                        <div>
                                            <dt className="text-[11px] text-slate-400">
                                                Nome técnico
                                            </dt>
                                            <dd className="font-mono font-medium text-[#0f2744]">
                                                {draft.technicalName || "—"}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-[11px] text-slate-400">
                                                Exibição
                                            </dt>
                                            <dd className="font-medium text-[#0f2744]">
                                                {draft.displayName || "—"}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-[11px] text-slate-400">
                                                Categoria
                                            </dt>
                                            <dd>{draft.category}</dd>
                                        </div>
                                        <div>
                                            <dt className="text-[11px] text-slate-400">
                                                Cargas / msg
                                            </dt>
                                            <dd>{draft.loadsPerMessage}</dd>
                                        </div>
                                        <div>
                                            <dt className="text-[11px] text-slate-400">
                                                Variáveis
                                            </dt>
                                            <dd>
                                                {draft.fieldMappings.length}
                                            </dd>
                                        </div>
                                        <div>
                                            <dt className="text-[11px] text-slate-400">
                                                Botões
                                            </dt>
                                            <dd>
                                                {draft.buttons.enabled
                                                    ? "QUICK_REPLY ativos"
                                                    : "Desativados"}
                                            </dd>
                                        </div>
                                        <div className="sm:col-span-2">
                                            <dt className="text-[11px] text-slate-400">
                                                Corpo
                                            </dt>
                                            <dd
                                                className={cn(
                                                    "text-xs mt-0.5",
                                                    bodyOver && "text-red-600"
                                                )}
                                            >
                                                {bodyLen}/{META_BODY_MAX}{" "}
                                                caracteres
                                            </dd>
                                        </div>
                                    </dl>
                                    {bodyOver && (
                                        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 flex gap-2">
                                            <AlertTriangle className="h-4 w-4 shrink-0" />
                                            Corrija o limite do corpo antes de
                                            submeter à Meta. O salvamento local
                                            ainda pode ser bloqueado pelas
                                            validações do servidor.
                                        </div>
                                    )}
                                    <div className="lg:hidden">
                                        {WhatsAppPreview}
                                    </div>
                                </div>
                            )}
                        </div>

                        <aside
                            className={cn(
                                "border-l border-slate-100 bg-slate-50/40 p-4 min-h-0 sidebar-scroll",
                                mobilePreview
                                    ? "block"
                                    : "hidden lg:block"
                            )}
                        >
                            <div className="lg:sticky lg:top-0">
                                {WhatsAppPreview}
                            </div>
                        </aside>
                    </div>

                    {/* Footer */}
                    <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-t border-slate-100 bg-white">
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={premiumBtnOutline}
                                disabled={step === "info" || saving}
                                onClick={() => setStep(prevEditorStep(step))}
                            >
                                <ChevronLeft className="h-4 w-4 mr-1" />
                                Voltar
                            </Button>
                            {step !== "review" && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={premiumBtnOutline}
                                    disabled={saving}
                                    onClick={() =>
                                        setStep(nextEditorStep(step))
                                    }
                                >
                                    Próxima
                                    <ChevronRight className="h-4 w-4 ml-1" />
                                </Button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 justify-end">
                            {dirty && (
                                <span className="text-[11px] text-amber-700 hidden sm:inline">
                                    Alterações não salvas
                                </span>
                            )}
                            <Button
                                type="button"
                                variant="outline"
                                className={premiumBtnOutline}
                                disabled={saving}
                                onClick={requestClose}
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="button"
                                className={premiumBtn}
                                disabled={saving}
                                onClick={() => onSave()}
                            >
                                {saving && (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                {mode === "create"
                                    ? "Salvar template"
                                    : "Salvar alterações"}
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Descartar alterações?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Há alterações não salvas neste template. Se
                            fechar agora, o trabalho será perdido.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Continuar editando</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={confirmDiscard}
                        >
                            Descartar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
