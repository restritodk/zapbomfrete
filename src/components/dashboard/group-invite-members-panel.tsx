"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
    ExternalLink,
    Loader2,
    Search,
    Users,
    UserCheck,
    MousePointerClick,
    ShieldAlert,
    RefreshCw,
    Link2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { formatPhoneDisplay } from "@/lib/phone-br";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";
import { validateWhatsappGroupInviteUrl } from "@/modules/crm/consent/group-invite-url";

type Member = {
    id: string;
    waId: string;
    fullName: string | null;
    company: string | null;
    status: "clicked" | "joined";
    statusLabel: string;
    inviteUrl: string | null;
    campaignId: string | null;
    clickedAt: string;
    joinedAt: string | null;
};

function fmt(iso: string | null) {
    if (!iso) return "—";
    try {
        return new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
        }).format(new Date(iso));
    } catch {
        return iso;
    }
}

/**
 * CRM — Usuários no grupo (convite WhatsApp).
 * Distingue clique no link vs ingresso confirmado (nunca inventa join).
 */
export function GroupInviteMembersPanel() {
    const { data: session } = useSession();
    const canManage = ["OWNER", "SUPERADMIN"].includes(
        String((session?.user as { role?: string } | undefined)?.role || "")
    );
    const [loading, setLoading] = useState(true);
    const [rows, setRows] = useState<Member[]>([]);
    const [stats, setStats] = useState({
        total: 0,
        clicked: 0,
        joined: 0,
    });
    const [q, setQ] = useState("");
    const [filter, setFilter] = useState<"all" | "clicked" | "joined">("all");
    const [defaultUrl, setDefaultUrl] = useState("");
    const [savingUrl, setSavingUrl] = useState(false);
    const [confirmRow, setConfirmRow] = useState<Member | null>(null);
    const [evidence, setEvidence] = useState("");

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [mRes, sRes] = await Promise.all([
                fetch(
                    `/api/crm/group-invite/members?status=${filter}&q=${encodeURIComponent(q)}`
                ),
                fetch("/api/crm/group-invite/settings"),
            ]);
            const mJson = await mRes.json().catch(() => ({}));
            const sJson = await sRes.json().catch(() => ({}));
            if (mRes.ok) {
                setRows(mJson.data?.rows || []);
                setStats(
                    mJson.data?.stats || { total: 0, clicked: 0, joined: 0 }
                );
            }
            if (sRes.ok) {
                setDefaultUrl(
                    sJson.data?.settings?.defaultGroupInviteUrl || ""
                );
            }
        } catch {
            toast.error("Falha ao carregar usuários do grupo");
        } finally {
            setLoading(false);
        }
    }, [filter, q]);

    useEffect(() => {
        void load();
    }, [load]);

    const saveDefaultUrl = async () => {
        if (!canManage) return;
        if (defaultUrl.trim()) {
            const v = validateWhatsappGroupInviteUrl(defaultUrl);
            if (!v.ok) {
                toast.error(v.error);
                return;
            }
        }
        setSavingUrl(true);
        try {
            const res = await fetch("/api/crm/group-invite/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    defaultGroupInviteUrl: defaultUrl.trim() || null,
                }),
            });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(json.message || "Não foi possível salvar");
                return;
            }
            toast.success("Link padrão do grupo salvo");
            setDefaultUrl(
                json.data?.settings?.defaultGroupInviteUrl || ""
            );
        } finally {
            setSavingUrl(false);
        }
    };

    const confirmJoin = async () => {
        if (!confirmRow) return;
        const res = await fetch("/api/crm/group-invite/members", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                action: "confirm_join",
                waId: confirmRow.waId,
                evidenceText: evidence,
                inviteUrl: confirmRow.inviteUrl,
            }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
            toast.error(json.message || "Falha ao confirmar");
            return;
        }
        toast.success("Ingresso registrado com evidência");
        setConfirmRow(null);
        setEvidence("");
        void load();
    };

    return (
        <div className="space-y-6">
            <div className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-[#0b3d6e] via-[#0969E8] to-[#3b9eff] px-6 py-8 text-white shadow-lg">
                <div
                    className="pointer-events-none absolute inset-0 opacity-30"
                    style={{
                        backgroundImage:
                            "radial-gradient(circle at 20% 20%, rgba(255,255,255,0.35), transparent 45%), radial-gradient(circle at 80% 0%, rgba(255,255,255,0.2), transparent 40%)",
                    }}
                />
                <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-2 max-w-xl">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                            Contatos · CRM
                        </p>
                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                            Usuários no grupo
                        </h1>
                        <p className="text-sm text-white/85 leading-relaxed">
                            Acompanhe quem clicou no convite «Entrar no grupo
                            exclusivo» e quem teve ingresso confirmado. Clique no
                            link não prova entrada no grupo.
                        </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 min-w-[280px]">
                        <StatCard
                            icon={<Users className="h-4 w-4" />}
                            label="Total"
                            value={stats.total}
                        />
                        <StatCard
                            icon={<MousePointerClick className="h-4 w-4" />}
                            label="Clicaram"
                            value={stats.clicked}
                        />
                        <StatCard
                            icon={<UserCheck className="h-4 w-4" />}
                            label="Entraram"
                            value={stats.joined}
                        />
                    </div>
                </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-3 shadow-sm">
                <div className="flex items-center gap-2 text-slate-800">
                    <Link2 className="h-4 w-4 text-[#0969E8]" />
                    <p className="text-sm font-semibold">
                        Link padrão do grupo (empresa)
                    </p>
                </div>
                <p className="text-xs text-slate-500">
                    Usado para pré-preencher novas campanhas. Isolado por
                    organização — nunca compartilhado.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                    <Input
                        value={defaultUrl}
                        onChange={(e) => setDefaultUrl(e.target.value)}
                        disabled={!canManage}
                        className="font-mono text-xs h-10 rounded-xl"
                        placeholder="https://chat.whatsapp.com/…"
                    />
                    {canManage ? (
                        <Button
                            type="button"
                            className="rounded-xl bg-[#0969E8] hover:bg-[#0858c4]"
                            disabled={savingUrl}
                            onClick={() => void saveDefaultUrl()}
                        >
                            {savingUrl ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                "Salvar link"
                            )}
                        </Button>
                    ) : null}
                </div>
            </div>

            <div className="rounded-2xl border border-amber-200/80 bg-amber-50/70 px-4 py-3 text-xs text-amber-950 flex gap-2">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                    Status «Clicou no link» significa apenas abertura do
                    redirecionamento rastreado. Ingresso só aparece como
                    «Entrou» após confirmação com evidência (a Meta não notifica
                    ingresso via convite no Cloud API).
                </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 border-b border-slate-100">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Buscar nome, empresa ou telefone…"
                            className="pl-9 h-10 rounded-xl"
                        />
                    </div>
                    <div className="flex gap-1.5">
                        {(
                            [
                                ["all", "Todos"],
                                ["clicked", "Clicaram"],
                                ["joined", "Entraram"],
                            ] as const
                        ).map(([id, label]) => (
                            <Button
                                key={id}
                                type="button"
                                size="sm"
                                variant={filter === id ? "default" : "outline"}
                                className={cn(
                                    "rounded-lg",
                                    filter === id &&
                                        "bg-[#0969E8] hover:bg-[#0858c4]"
                                )}
                                onClick={() => setFilter(id)}
                            >
                                {label}
                            </Button>
                        ))}
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="rounded-lg"
                            onClick={() => void load()}
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Carregando…
                    </div>
                ) : rows.length === 0 ? (
                    <div className="py-16 text-center space-y-2 px-4">
                        <Users className="h-8 w-8 mx-auto text-slate-300" />
                        <p className="text-sm font-medium text-slate-700">
                            Nenhum usuário registrado ainda
                        </p>
                        <p className="text-xs text-slate-500 max-w-md mx-auto">
                            Quando um destinatário clicar no botão de convite
                            rastreado da campanha, o contato aparece aqui.
                        </p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Contato</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Clique</TableHead>
                                <TableHead>Ingresso</TableHead>
                                <TableHead className="text-right">
                                    Ações
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((r) => (
                                <TableRow key={r.id}>
                                    <TableCell>
                                        <p className="font-medium text-slate-900">
                                            {r.fullName ||
                                                formatPhoneDisplay(r.waId) ||
                                                r.waId}
                                        </p>
                                        <p className="text-xs text-slate-500 font-mono">
                                            {formatPhoneDisplay(r.waId) ||
                                                r.waId}
                                            {r.company
                                                ? ` · ${r.company}`
                                                : ""}
                                        </p>
                                    </TableCell>
                                    <TableCell>
                                        <Badge
                                            variant="outline"
                                            className={cn(
                                                "text-[10px]",
                                                r.status === "joined"
                                                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                                                    : "border-sky-300 bg-sky-50 text-sky-900"
                                            )}
                                        >
                                            {r.statusLabel}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-xs tabular-nums text-slate-600">
                                        {fmt(r.clickedAt)}
                                    </TableCell>
                                    <TableCell className="text-xs tabular-nums text-slate-600">
                                        {fmt(r.joinedAt)}
                                    </TableCell>
                                    <TableCell className="text-right space-x-1">
                                        {r.inviteUrl ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="ghost"
                                                className="h-8 rounded-lg"
                                                asChild
                                            >
                                                <a
                                                    href={r.inviteUrl}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                >
                                                    <ExternalLink className="h-3.5 w-3.5" />
                                                </a>
                                            </Button>
                                        ) : null}
                                        {canManage &&
                                        r.status !== "joined" ? (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline"
                                                className="h-8 rounded-lg text-xs"
                                                onClick={() => {
                                                    setConfirmRow(r);
                                                    setEvidence("");
                                                }}
                                            >
                                                Confirmar ingresso
                                            </Button>
                                        ) : null}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            <Dialog
                open={Boolean(confirmRow)}
                onOpenChange={(o) => {
                    if (!o) setConfirmRow(null);
                }}
            >
                <DialogContent className="rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>Confirmar ingresso no grupo</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-2 text-sm">
                        <p className="text-slate-600">
                            {confirmRow?.fullName ||
                                formatPhoneDisplay(confirmRow?.waId || "")}
                        </p>
                        <Label>Evidência (obrigatória)</Label>
                        <Textarea
                            value={evidence}
                            onChange={(e) => setEvidence(e.target.value)}
                            placeholder="Ex.: visto no grupo Bom Frete em 12/10 às 15:40"
                            className="min-h-[100px] rounded-xl"
                        />
                        <p className="text-[11px] text-slate-500">
                            Não confirme sem verificação real. Clique no link
                            sozinho não basta.
                        </p>
                    </div>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            className="rounded-xl"
                            onClick={() => setConfirmRow(null)}
                        >
                            Cancelar
                        </Button>
                        <Button
                            className="rounded-xl bg-[#0969E8] hover:bg-[#0858c4]"
                            onClick={() => void confirmJoin()}
                        >
                            Registrar ingresso
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function StatCard(props: {
    icon: React.ReactNode;
    label: string;
    value: number;
}) {
    return (
        <div className="rounded-2xl bg-white/15 backdrop-blur-sm border border-white/20 px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-white/80 text-[10px] uppercase tracking-wide">
                {props.icon}
                {props.label}
            </div>
            <p className="text-xl font-semibold tabular-nums mt-0.5">
                {props.value}
            </p>
        </div>
    );
}
