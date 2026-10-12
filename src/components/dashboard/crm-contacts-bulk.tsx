"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
    Ban,
    Loader2,
    ShieldCheck,
    Trash2,
    X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { crmConsentLabel } from "@/modules/crm/crm-display";
import type { CrmListFilters } from "@/modules/crm/bulk/selection";
import { cn } from "@/lib/utils";

export type CrmBulkSelection =
    | { mode: "ids"; ids: string[] }
    | { mode: "filters"; filters: CrmListFilters; excludeIds: string[] };

type PreviewData = {
    count: number;
    byStatus: Record<string, number>;
    blocked: number;
    inactive: number;
};

type Props = {
    selectedCount: number;
    selection: CrmBulkSelection | null;
    canDelete: boolean;
    onClear: () => void;
    onDone: () => void;
};

export function CrmContactsBulkBar({
    selectedCount,
    selection,
    canDelete,
    onClear,
    onDone,
}: Props) {
    const [grantOpen, setGrantOpen] = useState(false);
    const [blockOpen, setBlockOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<PreviewData | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState("");

    const [evidenceText, setEvidenceText] = useState("");
    const [consentSource, setConsentSource] = useState("manual_evidence");
    const [originLabel, setOriginLabel] = useState("Registro manual com evidência");
    const [authorizedAt, setAuthorizedAt] = useState(() =>
        new Date().toISOString().slice(0, 16)
    );
    const [purpose, setPurpose] = useState("marketing_offers");
    const [wabaId, setWabaId] = useState("");

    useEffect(() => {
        if (!grantOpen || !selection) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/crm/contacts/bulk/preview", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(selection),
                });
                const json = await res.json().catch(() => ({}));
                if (!cancelled && res.ok) {
                    setPreview(json.data as PreviewData);
                }
            } catch {
                /* ignore */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [grantOpen, selection]);

    const runAction = async (
        action: "grant_consent" | "block" | "delete",
        extra?: Record<string, unknown>
    ) => {
        if (!selection || busy) return;
        setBusy(true);
        try {
            const res = await fetch("/api/crm/contacts/bulk", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    action,
                    selection,
                    ...extra,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Falha na operação em massa");
                return;
            }
            const d = json.data || {};
            toast.success(
                `${d.success || 0} ok · ${d.skipped || 0} ignorados · ${d.failed || 0} falhas`
            );
            if (d.skippedReasons && Object.keys(d.skippedReasons).length) {
                const detail = Object.entries(d.skippedReasons)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(" · ");
                toast.message(detail);
            }
            setGrantOpen(false);
            setBlockOpen(false);
            setDeleteOpen(false);
            setDeleteConfirm("");
            onDone();
        } catch {
            toast.error("Erro na operação em massa");
        } finally {
            setBusy(false);
        }
    };

    if (selectedCount <= 0) return null;

    const needsStrongDelete = selectedCount >= 20;

    return (
        <>
            <div
                className={cn(
                    "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
                    "rounded-2xl border border-[#bfdbfe] bg-gradient-to-r from-[#eff6ff] to-white",
                    "px-4 py-3 shadow-[0_1px_4px_rgba(37,99,235,0.08)]"
                )}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2563eb] text-white text-sm font-bold tabular-nums">
                        {selectedCount > 99 ? "99+" : selectedCount}
                    </div>
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#0f2744]">
                            {selectedCount} contato
                            {selectedCount === 1 ? "" : "s"} selecionado
                            {selectedCount === 1 ? "" : "s"}
                        </p>
                        <p className="text-xs text-slate-500">
                            Ações coletivas respeitam organização e permissões.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl border-slate-200"
                        onClick={onClear}
                        disabled={busy}
                    >
                        <X className="h-3.5 w-3.5 mr-1" />
                        Limpar seleção
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                size="sm"
                                className="rounded-xl bg-[#2563eb] hover:bg-[#1d4ed8] text-white"
                                disabled={busy}
                            >
                                {busy ? (
                                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                                ) : null}
                                Ações em massa
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem
                                onClick={() => setGrantOpen(true)}
                                className="gap-2"
                            >
                                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                                Conceder consentimento
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onClick={() => setBlockOpen(true)}
                                className="gap-2"
                            >
                                <Ban className="h-4 w-4 text-orange-600" />
                                Bloquear contatos
                            </DropdownMenuItem>
                            {canDelete && (
                                <DropdownMenuItem
                                    onClick={() => setDeleteOpen(true)}
                                    className="gap-2 text-red-600 focus:text-red-600"
                                >
                                    <Trash2 className="h-4 w-4" />
                                    Excluir contatos
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            {/* Grant consent */}
            <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
                <DialogContent
                    size="wide"
                    className="max-h-[90vh] overflow-y-auto rounded-2xl border-slate-200/80"
                >
                    <DialogHeader>
                        <DialogTitle className="text-[#0f2744]">
                            Conceder consentimento
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 text-sm">
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-emerald-900">
                            <p className="font-medium">
                                {selectedCount} contato
                                {selectedCount === 1 ? "" : "s"} selecionado
                                {selectedCount === 1 ? "" : "s"}
                            </p>
                            <p className="text-xs mt-1 text-emerald-800/80">
                                A seleção sozinha não concede consentimento.
                                É obrigatório informar evidência verificável.
                                Contatos com opt-out ou já concedidos serão
                                ignorados.
                            </p>
                            {preview && (
                                <ul className="mt-2 text-xs space-y-0.5">
                                    {Object.entries(preview.byStatus).map(
                                        ([status, n]) => (
                                            <li key={status}>
                                                {crmConsentLabel(status)}: {n}
                                            </li>
                                        )
                                    )}
                                </ul>
                            )}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label>Origem da autorização *</Label>
                                <Select
                                    value={consentSource}
                                    onValueChange={(v) => {
                                        setConsentSource(v);
                                        const labels: Record<string, string> = {
                                            manual_evidence:
                                                "Registro manual com evidência",
                                            contrato: "Contrato",
                                            formulario: "Formulário",
                                            ligacao: "Ligação",
                                            presencial: "Presencial",
                                            email: "E-mail",
                                            interactive_button:
                                                "Botão interativo",
                                            outro: "Outro",
                                        };
                                        setOriginLabel(labels[v] || v);
                                    }}
                                >
                                    <SelectTrigger className="rounded-xl h-11">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="manual_evidence">
                                            Registro manual com evidência
                                        </SelectItem>
                                        <SelectItem value="contrato">
                                            Contrato
                                        </SelectItem>
                                        <SelectItem value="formulario">
                                            Formulário
                                        </SelectItem>
                                        <SelectItem value="ligacao">
                                            Ligação
                                        </SelectItem>
                                        <SelectItem value="presencial">
                                            Presencial
                                        </SelectItem>
                                        <SelectItem value="email">
                                            E-mail
                                        </SelectItem>
                                        <SelectItem value="interactive_button">
                                            Botão interativo
                                        </SelectItem>
                                        <SelectItem value="outro">
                                            Outro
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Data da autorização *</Label>
                                <Input
                                    type="datetime-local"
                                    value={authorizedAt}
                                    onChange={(e) =>
                                        setAuthorizedAt(e.target.value)
                                    }
                                    className="rounded-xl h-11"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Finalidade *</Label>
                                <Select
                                    value={purpose}
                                    onValueChange={setPurpose}
                                >
                                    <SelectTrigger className="rounded-xl h-11">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="marketing_offers">
                                            Ofertas de frete (marketing)
                                        </SelectItem>
                                        <SelectItem value="utility">
                                            Utilidade
                                        </SelectItem>
                                        <SelectItem value="other">
                                            Outra
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Canal WhatsApp (WABA)</Label>
                                <Input
                                    value={wabaId}
                                    onChange={(e) => setWabaId(e.target.value)}
                                    placeholder="ID do WABA (opcional)"
                                    className="rounded-xl h-11"
                                />
                            </div>
                            <div className="space-y-1.5 sm:col-span-2">
                                <Label>
                                    Evidência / referência verificável *
                                </Label>
                                <Textarea
                                    value={evidenceText}
                                    onChange={(e) =>
                                        setEvidenceText(e.target.value)
                                    }
                                    placeholder="Ex.: Contrato nº 123, protocolo, link do arquivo, ID do atendimento…"
                                    className="rounded-xl min-h-[110px]"
                                />
                            </div>
                        </div>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            className="rounded-xl"
                            disabled={busy}
                            onClick={() => setGrantOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            className="rounded-xl bg-emerald-600 hover:bg-emerald-700"
                            disabled={busy || evidenceText.trim().length < 10}
                            onClick={() =>
                                void runAction("grant_consent", {
                                    evidence: {
                                        evidenceText,
                                        consentSource,
                                        authorizedAt: new Date(
                                            authorizedAt
                                        ).toISOString(),
                                        purpose,
                                        wabaId,
                                        originLabel,
                                    },
                                })
                            }
                        >
                            {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Registrar consentimento"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Block */}
            <Dialog open={blockOpen} onOpenChange={setBlockOpen}>
                <DialogContent className="sm:max-w-lg rounded-2xl border-slate-200/80">
                    <DialogHeader>
                        <DialogTitle className="text-[#0f2744]">
                            Bloquear {selectedCount} contato
                            {selectedCount === 1 ? "" : "s"}?
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm text-slate-600">
                        <p>
                            Contatos bloqueados não poderão ser incluídos em
                            novos disparos enquanto permanecerem bloqueados.
                        </p>
                        <p className="rounded-xl border border-orange-100 bg-orange-50/80 px-3 py-2 text-orange-900 text-xs">
                            Bloqueio administrativo <strong>não</strong>{" "}
                            revoga consentimento. Opt-out e regras da Meta
                            continuam válidos.
                        </p>
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            className="rounded-xl"
                            disabled={busy}
                            onClick={() => setBlockOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            className="rounded-xl bg-orange-600 hover:bg-orange-700 text-white"
                            disabled={busy}
                            onClick={() =>
                                void runAction("block", { blocked: true })
                            }
                        >
                            {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Confirmar bloqueio"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete */}
            <Dialog
                open={deleteOpen}
                onOpenChange={(o) => {
                    setDeleteOpen(o);
                    if (!o) setDeleteConfirm("");
                }}
            >
                <DialogContent className="sm:max-w-lg rounded-2xl border-slate-200/80">
                    <DialogHeader>
                        <DialogTitle className="text-[#0f2744]">
                            Excluir {selectedCount} contato
                            {selectedCount === 1 ? "" : "s"}?
                        </DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3 text-sm text-slate-600">
                        <p>
                            Contatos com histórico de conversas Datafy serão
                            apenas desativados para preservar auditoria e
                            retenção. Consentimentos e envios não são apagados
                            automaticamente.
                        </p>
                        {needsStrongDelete && (
                            <div className="space-y-1.5">
                                <Label>
                                    Digite{" "}
                                    <span className="font-mono font-semibold">
                                        EXCLUIR
                                    </span>{" "}
                                    para confirmar
                                </Label>
                                <Input
                                    value={deleteConfirm}
                                    onChange={(e) =>
                                        setDeleteConfirm(
                                            e.target.value.toUpperCase()
                                        )
                                    }
                                    className="rounded-xl h-11 font-mono"
                                    placeholder="EXCLUIR"
                                />
                            </div>
                        )}
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                        <Button
                            variant="outline"
                            className="rounded-xl"
                            disabled={busy}
                            onClick={() => setDeleteOpen(false)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            className="rounded-xl"
                            disabled={
                                busy ||
                                (needsStrongDelete &&
                                    deleteConfirm !== "EXCLUIR")
                            }
                            onClick={() => void runAction("delete")}
                        >
                            {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Excluir contatos"
                            )}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
