"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
    ArrowLeft,
    CheckCircle2,
    Copy,
    ExternalLink,
    Eye,
    EyeOff,
    Loader2,
    Plug,
    RefreshCw,
    Save,
    Shield,
    Webhook,
    XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BulletinTemplateManager } from "@/components/dashboard/bulletin-template-manager";
import { SuperadminGate } from "@/components/auth/superadmin-gate";
import { cn } from "@/lib/utils";

type IntegrationStatus = {
    provider: "datafy";
    enabled: boolean;
    configured: boolean;
    hasChannelToken: boolean;
    hasWebhookSecret: boolean;
    channelTokenMasked: string | null;
    webhookSecretMasked: string | null;
    phoneNumberId: string | null;
    wabaId: string | null;
    businessId: string | null;
    displayPhoneNumber: string | null;
    clienteId: string | null;
    webhookUrl: string;
    webhookUrlIsHttps: boolean;
    webhookConfigured: boolean;
    lastVerifiedAt: string | null;
    lastError: string | null;
    outboundCampaignsEnabled: boolean;
    encryptionKeySource: "datafy" | "auth_secret" | "none";
    recommendedWebhookEvents?: string[];
    docsUrl?: string;
};

type TemplateRow = {
    id: string;
    name: string;
    language: string;
    status: string;
    category?: string;
};

function DatafyIntegrationPageInner() {
    const { data: authSession, status: authStatus } = useSession();
    // Credential management is SUPERADMIN-only (matches API isAdmin).
    const isAdmin = authSession?.user?.role === "SUPERADMIN";
    // Template library submit/sync: OWNER + SUPERADMIN
    const canManageTemplates =
        isAdmin || authSession?.user?.role === "OWNER";

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [loadingTemplates, setLoadingTemplates] = useState(false);
    const [status, setStatus] = useState<IntegrationStatus | null>(null);
    const [templates, setTemplates] = useState<TemplateRow[]>([]);
    const [enabled, setEnabled] = useState(false);
    const [webhookConfigured, setWebhookConfigured] = useState(false);
    const [channelToken, setChannelToken] = useState("");
    const [webhookSecret, setWebhookSecret] = useState("");
    const [showToken, setShowToken] = useState(false);
    const [showSecret, setShowSecret] = useState(false);
    const [accessMode, setAccessMode] = useState<
        "ROLE_OWNER" | "EXPLICIT" | "SUPERADMIN_ONLY"
    >("ROLE_OWNER");
    const [accessUserIds, setAccessUserIds] = useState("");
    const [savingAccess, setSavingAccess] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/integrations/datafy");
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.message || "Falha ao carregar integração Datafy");
                return;
            }
            const s = data.data as IntegrationStatus;
            setStatus(s);
            setEnabled(Boolean(s.enabled));
            setWebhookConfigured(Boolean(s.webhookConfigured));
            setChannelToken("");
            setWebhookSecret("");

            const accessRes = await fetch("/api/channels/datafy/access");
            if (accessRes.ok) {
                const accessJson = await accessRes.json().catch(() => ({}));
                const access = accessJson?.data;
                if (access?.mode) setAccessMode(access.mode);
                if (Array.isArray(access?.userIds)) {
                    setAccessUserIds(access.userIds.join(", "));
                }
            }
        } catch {
            toast.error("Erro ao carregar Datafy");
        } finally {
            setLoading(false);
        }
    }, []);

    const handleSaveAccess = async () => {
        if (!isAdmin) {
            toast.error("Sem permissão");
            return;
        }
        setSavingAccess(true);
        try {
            const userIds =
                accessMode === "EXPLICIT"
                    ? accessUserIds
                          .split(/[,\s]+/)
                          .map((s) => s.trim())
                          .filter(Boolean)
                    : [];
            const res = await fetch("/api/channels/datafy/access", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mode: accessMode, userIds }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.message || "Falha ao salvar acesso");
                return;
            }
            toast.success("Acesso operacional do canal atualizado");
        } catch {
            toast.error("Erro ao salvar acesso");
        } finally {
            setSavingAccess(false);
        }
    };

    useEffect(() => {
        if (authStatus === "authenticated") void load();
    }, [authStatus, load]);

    const handleSave = async () => {
        if (!isAdmin) {
            toast.error("Sem permissão para alterar integrações");
            return;
        }
        setSaving(true);
        try {
            const payload: Record<string, unknown> = {
                enabled,
                webhookConfigured,
            };
            if (channelToken.trim() && !channelToken.includes("••••")) {
                payload.channelToken = channelToken.trim();
            }
            if (webhookSecret.trim() && !webhookSecret.includes("••••")) {
                payload.webhookSecret = webhookSecret.trim();
            }

            const res = await fetch("/api/integrations/datafy", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.message || "Falha ao salvar");
                return;
            }
            setStatus(data.data);
            setChannelToken("");
            setWebhookSecret("");
            toast.success("Configuração salva com segurança");
        } catch {
            toast.error("Erro ao salvar");
        } finally {
            setSaving(false);
        }
    };

    const handleVerify = async () => {
        setVerifying(true);
        try {
            const res = await fetch("/api/integrations/datafy/verify", {
                method: "POST",
            });
            const data = await res.json().catch(() => ({}));
            if (data?.data?.integration) setStatus(data.data.integration);
            if (res.ok && data.status) {
                toast.success("Número / conta Datafy verificados");
            } else {
                toast.error(data.message || "Verificação falhou");
            }
        } catch {
            toast.error("Erro na verificação");
        } finally {
            setVerifying(false);
        }
    };

    const handleLoadTemplates = async () => {
        setLoadingTemplates(true);
        try {
            const res = await fetch(
                "/api/integrations/datafy/templates?status=APPROVED"
            );
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                toast.error(data.message || "Falha ao listar templates");
                return;
            }
            setTemplates(Array.isArray(data.data?.data) ? data.data.data : []);
            toast.success("Templates APPROVED carregados da Datafy/Meta");
        } catch {
            toast.error("Erro ao carregar templates");
        } finally {
            setLoadingTemplates(false);
        }
    };

    const copyWebhook = async () => {
        if (!status?.webhookUrl) return;
        try {
            await navigator.clipboard.writeText(status.webhookUrl);
            toast.success("URL do webhook copiada");
        } catch {
            toast.error("Não foi possível copiar");
        }
    };

    if (authStatus === "loading" || loading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Carregando integração…
            </div>
        );
    }

    const healthOk = Boolean(status?.configured && status?.enabled && !status?.lastError);
    const events = status?.recommendedWebhookEvents || [
        "messages",
        "message_template_status_update",
        "phone_number_quality_update",
        "account_update",
    ];

    return (
        <div className="mx-auto max-w-4xl space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <Link
                        href="/dashboard/settings"
                        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Configurações
                    </Link>
                    <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                        Datafy API
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Integração oficial WhatsApp (Meta Cloud) via Datafy —
                        canal compartilhado. Campanhas oficiais em Disparo →
                        Datafy.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Atualizar
                </Button>
            </div>

            {/* Status strip */}
            <div className="grid gap-3 sm:grid-cols-3">
                <StatusTile
                    label="Integração"
                    value={status?.enabled ? "Ativa" : "Desligada"}
                    ok={Boolean(status?.enabled)}
                />
                <StatusTile
                    label="Credenciais"
                    value={status?.configured ? "Configuradas" : "Pendentes"}
                    ok={Boolean(status?.configured)}
                />
                <StatusTile
                    label="Saúde"
                    value={
                        healthOk
                            ? "OK"
                            : status?.lastError
                              ? "Atenção"
                              : "Aguardando"
                    }
                    ok={healthOk}
                />
            </div>

            <Card className="overflow-hidden border-slate-200/80 shadow-sm">
                <CardHeader className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white">
                    <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                            <Plug className="h-5 w-5" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">Credenciais do canal</CardTitle>
                            <CardDescription className="mt-1">
                                Token <code className="text-xs">sk_live_…</code> e secret{" "}
                                <code className="text-xs">whsec_…</code>. Nunca
                                exibidos por completo após salvar.
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-5 pt-6">
                    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                        <div>
                            <p className="text-sm font-medium">Habilitar Datafy</p>
                            <p className="text-xs text-muted-foreground">
                                Baileys permanece ativo. Providers isolados.
                            </p>
                        </div>
                        <Switch checked={enabled} onCheckedChange={setEnabled} />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="channelToken">Token do canal</Label>
                        <div className="relative">
                            <Input
                                id="channelToken"
                                type={showToken ? "text" : "password"}
                                autoComplete="off"
                                placeholder={
                                    status?.channelTokenMasked ||
                                    "sk_live_•••• (cole um novo para substituir)"
                                }
                                value={channelToken}
                                onChange={(e) => setChannelToken(e.target.value)}
                                className="pr-10 font-mono text-sm"
                            />
                            <button
                                type="button"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowToken((v) => !v)}
                                aria-label={showToken ? "Ocultar token" : "Mostrar token"}
                            >
                                {showToken ? (
                                    <EyeOff className="h-4 w-4" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </button>
                        </div>
                        {status?.channelTokenMasked && (
                            <p className="text-xs text-muted-foreground">
                                Salvo:{" "}
                                <span className="font-mono">
                                    {status.channelTokenMasked}
                                </span>
                            </p>
                        )}
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="webhookSecret">Webhook secret</Label>
                        <div className="relative">
                            <Input
                                id="webhookSecret"
                                type={showSecret ? "text" : "password"}
                                autoComplete="off"
                                placeholder={
                                    status?.webhookSecretMasked ||
                                    "whsec_•••• (cole um novo para substituir)"
                                }
                                value={webhookSecret}
                                onChange={(e) => setWebhookSecret(e.target.value)}
                                className="pr-10 font-mono text-sm"
                            />
                            <button
                                type="button"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                onClick={() => setShowSecret((v) => !v)}
                                aria-label={
                                    showSecret ? "Ocultar secret" : "Mostrar secret"
                                }
                            >
                                {showSecret ? (
                                    <EyeOff className="h-4 w-4" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </button>
                        </div>
                        {status?.webhookSecretMasked && (
                            <p className="text-xs text-muted-foreground">
                                Salvo:{" "}
                                <span className="font-mono">
                                    {status.webhookSecretMasked}
                                </span>
                            </p>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button onClick={() => void handleSave()} disabled={saving}>
                            {saving ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Save className="mr-2 h-4 w-4" />
                            )}
                            Salvar
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => void handleVerify()}
                            disabled={verifying || !status?.hasChannelToken}
                        >
                            {verifying ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Shield className="mr-2 h-4 w-4" />
                            )}
                            Verificar conexão
                        </Button>
                    </div>

                    {status?.lastError && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            Último erro: {status.lastError}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="border-slate-200/80 shadow-sm">
                <CardHeader>
                    <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                            <Webhook className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                            <CardTitle className="text-lg">Webhook</CardTitle>
                            <CardDescription className="mt-1">
                                Cadastre esta URL HTTPS no painel Datafy (aba
                                Webhooks do número).
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <code className="flex-1 overflow-x-auto rounded-lg border bg-slate-50 px-3 py-2 text-xs sm:text-sm">
                            {status?.webhookUrl || "— configure BASE_URL —"}
                        </code>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void copyWebhook()}
                        >
                            <Copy className="mr-2 h-4 w-4" />
                            Copiar
                        </Button>
                    </div>
                    {status && !status.webhookUrlIsHttps && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            Em produção a Datafy exige URL HTTPS. Defina{" "}
                            <code className="text-xs">BASE_URL=https://…</code>{" "}
                            no ambiente.
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                        Criptografia em repouso:{" "}
                        {status?.encryptionKeySource === "datafy"
                            ? "DATAFY_ENCRYPTION_KEY"
                            : status?.encryptionKeySource === "auth_secret"
                              ? "AUTH_SECRET (legado/fallback)"
                              : "nenhuma chave disponível"}
                    </p>

                    <div className="flex items-center justify-between rounded-xl border px-4 py-3">
                        <div>
                            <p className="text-sm font-medium">
                                Webhook cadastrado no painel Datafy
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Marque após configurar a URL e os eventos.
                            </p>
                        </div>
                        <Switch
                            checked={webhookConfigured}
                            onCheckedChange={setWebhookConfigured}
                        />
                    </div>

                    <div>
                        <p className="mb-2 text-sm font-medium">
                            Eventos recomendados
                        </p>
                        <ul className="flex flex-wrap gap-2">
                            {events.map((ev) => (
                                <li
                                    key={ev}
                                    className="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-xs text-slate-700"
                                >
                                    {ev}
                                </li>
                            ))}
                        </ul>
                    </div>
                </CardContent>
            </Card>

            <Card className="border-slate-200/80 shadow-sm">
                <CardHeader>
                    <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
                            <Shield className="h-5 w-5" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">
                                Acesso operacional ao canal
                            </CardTitle>
                            <CardDescription className="mt-1">
                                Define quem pode selecionar o canal oficial
                                compartilhado. Não altera tokens nem webhook.
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="accessMode">Modo de acesso</Label>
                        <select
                            id="accessMode"
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            value={accessMode}
                            onChange={(e) =>
                                setAccessMode(
                                    e.target.value as
                                        | "ROLE_OWNER"
                                        | "EXPLICIT"
                                        | "SUPERADMIN_ONLY"
                                )
                            }
                        >
                            <option value="ROLE_OWNER">
                                SUPERADMIN + todos os OWNER
                            </option>
                            <option value="EXPLICIT">
                                SUPERADMIN + usuários explícitos (IDs)
                            </option>
                            <option value="SUPERADMIN_ONLY">
                                Somente SUPERADMIN
                            </option>
                        </select>
                    </div>
                    {accessMode === "EXPLICIT" && (
                        <div className="space-y-2">
                            <Label htmlFor="accessUserIds">
                                IDs de usuário (separados por vírgula)
                            </Label>
                            <Input
                                id="accessUserIds"
                                value={accessUserIds}
                                onChange={(e) => setAccessUserIds(e.target.value)}
                                placeholder="cuid1, cuid2"
                            />
                        </div>
                    )}
                    <Button
                        type="button"
                        variant="outline"
                        disabled={savingAccess}
                        onClick={() => void handleSaveAccess()}
                    >
                        {savingAccess ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        Salvar acesso operacional
                    </Button>
                </CardContent>
            </Card>

            <Card className="border-slate-200/80 shadow-sm">
                <CardHeader>
                    <CardTitle className="text-lg">Número conectado</CardTitle>
                    <CardDescription>
                        Dados retornados por <code className="text-xs">GET /me</code>{" "}
                        após verificação.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <dl className="grid gap-3 sm:grid-cols-2">
                        <InfoRow
                            label="Telefone exibido"
                            value={status?.displayPhoneNumber || "—"}
                        />
                        <InfoRow
                            label="phone_number_id"
                            value={status?.phoneNumberId || "—"}
                            mono
                        />
                        <InfoRow
                            label="waba_id"
                            value={status?.wabaId || "—"}
                            mono
                        />
                        <InfoRow
                            label="business_id"
                            value={status?.businessId || "—"}
                            mono
                        />
                        <InfoRow
                            label="Última verificação"
                            value={
                                status?.lastVerifiedAt
                                    ? new Date(status.lastVerifiedAt).toLocaleString(
                                          "pt-BR"
                                      )
                                    : "—"
                            }
                        />
                        <InfoRow
                            label="Campanhas Datafy"
                            value="Habilitadas (Disparo → Datafy)"
                        />
                    </dl>
                </CardContent>
            </Card>

            <BulletinTemplateManager
                canManage={canManageTemplates}
                hasChannelToken={!!status?.hasChannelToken}
            />

            <Card className="border-slate-200/80 shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
                    <div>
                        <CardTitle className="text-lg">Templates Meta</CardTitle>
                        <CardDescription>
                            Lista oficial APPROVED via Datafy (fonte Meta).
                            PENDING/REJECTED não entram nesta lista e não são
                            usados em envio real.
                        </CardDescription>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleLoadTemplates()}
                        disabled={loadingTemplates || !status?.hasChannelToken}
                    >
                        {loadingTemplates ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <RefreshCw className="mr-2 h-4 w-4" />
                        )}
                        Buscar aprovados
                    </Button>
                </CardHeader>
                <CardContent>
                    {templates.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            Nenhum template APPROVED carregado ainda.
                        </p>
                    ) : (
                        <div className="overflow-hidden rounded-xl border">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                    <tr>
                                        <th className="px-3 py-2">Nome</th>
                                        <th className="px-3 py-2">Idioma</th>
                                        <th className="px-3 py-2">Status</th>
                                        <th className="px-3 py-2">Categoria</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {templates.map((t) => (
                                        <tr
                                            key={`${t.id}-${t.language}`}
                                            className="border-t"
                                        >
                                            <td className="px-3 py-2 font-medium">
                                                {t.name}
                                            </td>
                                            <td className="px-3 py-2 font-mono text-xs">
                                                {t.language}
                                            </td>
                                            <td className="px-3 py-2">
                                                {t.status}
                                            </td>
                                            <td className="px-3 py-2">
                                                {t.category || "—"}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>

            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <a
                    href={status?.docsUrl || "https://developers.datafyapi.com.br/"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-blue-600 hover:underline"
                >
                    Documentação Datafy
                    <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <span className="text-slate-300">|</span>
                <span>
                    Submissão de templates: Datafy API → análise Meta
                </span>
            </div>
        </div>
    );
}

function StatusTile({
    label,
    value,
    ok,
}: {
    label: string;
    value: string;
    ok: boolean;
}) {
    return (
        <div
            className={cn(
                "rounded-2xl border px-4 py-3 transition-colors",
                ok
                    ? "border-emerald-100 bg-emerald-50/60"
                    : "border-slate-200 bg-white"
            )}
        >
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {label}
            </p>
            <div className="mt-1 flex items-center gap-2">
                {ok ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                ) : (
                    <XCircle className="h-4 w-4 text-slate-400" />
                )}
                <p className="text-sm font-semibold text-slate-900">{value}</p>
            </div>
        </div>
    );
}

function InfoRow({
    label,
    value,
    mono,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 px-3 py-2.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd
                className={cn(
                    "mt-0.5 break-all text-sm font-medium text-slate-900",
                    mono && "font-mono text-xs"
                )}
            >
                {value}
            </dd>
        </div>
    );
}

export default function DatafyIntegrationPage() {
    return (
        <SuperadminGate title="Integrações Datafy — acesso restrito">
            <DatafyIntegrationPageInner />
        </SuperadminGate>
    );
}
