"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCw, Save, AlertCircle, Upload, ImageIcon, Globe, Plug, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import Link from "next/link";

type SystemConfigState = {
    appName: string;
    logoUrl: string;
    faviconUrl: string;
    timezone: string;
    enableRegistration: boolean;
};

const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg";
const FAVICON_ACCEPT = "image/png,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/webp,.png,.ico,.jpg,.jpeg,.webp";
const MAX_BYTES = 2 * 1024 * 1024;

function isAllowedLogo(file: File): boolean {
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();
    return (
        /\.(png|jpe?g|webp|svg)$/i.test(name) ||
        ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"].includes(type)
    );
}

function isAllowedFavicon(file: File): boolean {
    const name = file.name.toLowerCase();
    const type = (file.type || "").toLowerCase();
    return (
        /\.(png|ico|jpe?g|webp)$/i.test(name) ||
        ["image/png", "image/x-icon", "image/vnd.microsoft.icon", "image/jpeg", "image/jpg", "image/webp"].includes(type)
    );
}

export default function SettingsPage() {
    const { data: authSession, status: authStatus } = useSession();
    const router = useRouter();
    const isSuperAdmin = authSession?.user?.role === "SUPERADMIN";

    const [systemConfig, setSystemConfig] = useState<SystemConfigState>({
        appName: "WA-AKG",
        logoUrl: "",
        faviconUrl: "",
        timezone: "America/Sao_Paulo",
        enableRegistration: true,
    });
    const [systemLoading, setSystemLoading] = useState(false);
    const [uploading, setUploading] = useState<"logo" | "favicon" | null>(null);
    const [logoBroken, setLogoBroken] = useState(false);
    const [faviconBroken, setFaviconBroken] = useState(false);
    const [logoFileName, setLogoFileName] = useState<string | null>(null);
    const [faviconFileName, setFaviconFileName] = useState<string | null>(null);
    const [timezones, setTimezones] = useState<string[]>([
        "UTC",
        "America/Sao_Paulo",
        "America/Manaus",
        "America/Fortaleza",
    ]);

    const logoInputRef = useRef<HTMLInputElement>(null);
    const faviconInputRef = useRef<HTMLInputElement>(null);
    const logoObjectUrlRef = useRef<string | null>(null);
    const faviconObjectUrlRef = useRef<string | null>(null);

    useEffect(() => {
        try {
            if (typeof Intl !== "undefined" && Intl.supportedValuesOf) {
                const list = Intl.supportedValuesOf("timeZone");
                if (!list.includes("UTC")) list.push("UTC");
                list.sort();
                setTimezones(list);
            }
        } catch (e) {
            console.error("Failed to load timezones dynamically", e);
        }
    }, []);

    useEffect(() => {
        fetch("/api/settings/system")
            .then((r) => {
                if (!r.ok) throw new Error("Falha ao carregar configurações");
                return r.json();
            })
            .then((responseData) => {
                const data = responseData?.data;
                if (data && !responseData.error) {
                    const favicon =
                        data.faviconUrl && data.faviconUrl !== "/favicon.ico"
                            ? data.faviconUrl
                            : "";
                    setSystemConfig({
                        appName: data.appName || "WA-AKG",
                        logoUrl: data.logoUrl || "",
                        faviconUrl: favicon,
                        timezone: data.timezone || "America/Sao_Paulo",
                        enableRegistration:
                            data.enableRegistration !== undefined ? data.enableRegistration : true,
                    });
                    setLogoBroken(false);
                    setFaviconBroken(false);
                }
            })
            .catch(() => {
                toast.error("Não foi possível carregar as configurações do sistema");
            });
    }, []);

    useEffect(() => {
        return () => {
            if (logoObjectUrlRef.current) URL.revokeObjectURL(logoObjectUrlRef.current);
            if (faviconObjectUrlRef.current) URL.revokeObjectURL(faviconObjectUrlRef.current);
        };
    }, []);

    const handleSaveSystem = async () => {
        if (!isSuperAdmin) {
            toast.error("Sem permissão. Apenas SuperAdmin pode salvar configurações.");
            return;
        }
        setSystemLoading(true);
        try {
            // Never persist blob: preview URLs
            const payload = {
                ...systemConfig,
                logoUrl: systemConfig.logoUrl.startsWith("blob:") ? undefined : systemConfig.logoUrl,
                faviconUrl: systemConfig.faviconUrl.startsWith("blob:")
                    ? undefined
                    : systemConfig.faviconUrl,
            };

            const res = await fetch("/api/settings/system", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await res.json().catch(() => ({}));
            if (res.ok) {
                if (data?.data) {
                    setSystemConfig((prev) => ({
                        ...prev,
                        appName: data.data.appName ?? prev.appName,
                        logoUrl: data.data.logoUrl ?? prev.logoUrl,
                        faviconUrl:
                            data.data.faviconUrl && data.data.faviconUrl !== "/favicon.ico"
                                ? data.data.faviconUrl
                                : prev.faviconUrl,
                        timezone: data.data.timezone ?? prev.timezone,
                        enableRegistration:
                            data.data.enableRegistration !== undefined
                                ? data.data.enableRegistration
                                : prev.enableRegistration,
                    }));
                }
                toast.success("Configurações salvas. Atualizando a interface...");
                router.refresh();
            } else {
                toast.error(data.message || "Falha ao atualizar as configurações do sistema");
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao salvar as configurações do sistema");
        } finally {
            setSystemLoading(false);
        }
    };

    const handleUpload = async (type: "logo" | "favicon", file: File | undefined) => {
        if (!file) return;

        if (authStatus === "loading") {
            toast.message("Aguarde", { description: "Verificando sessão…" });
            return;
        }
        if (authStatus !== "authenticated") {
            toast.error("Sessão expirada. Faça login novamente.");
            return;
        }
        if (!isSuperAdmin) {
            toast.error("Sem permissão. Apenas SuperAdmin pode enviar logo/favicon.");
            return;
        }

        if (file.size > MAX_BYTES) {
            toast.error("Arquivo maior que 2 MB");
            return;
        }
        if (type === "logo" && !isAllowedLogo(file)) {
            toast.error("Formato não permitido. Use PNG, JPG, WEBP ou SVG");
            return;
        }
        if (type === "favicon" && !isAllowedFavicon(file)) {
            toast.error("Formato não permitido. Use PNG ou ICO");
            return;
        }

        // Immediate local preview
        const objectUrl = URL.createObjectURL(file);
        if (type === "logo") {
            if (logoObjectUrlRef.current) URL.revokeObjectURL(logoObjectUrlRef.current);
            logoObjectUrlRef.current = objectUrl;
            setSystemConfig((prev) => ({ ...prev, logoUrl: objectUrl }));
            setLogoBroken(false);
            setLogoFileName(file.name);
        } else {
            if (faviconObjectUrlRef.current) URL.revokeObjectURL(faviconObjectUrlRef.current);
            faviconObjectUrlRef.current = objectUrl;
            setSystemConfig((prev) => ({ ...prev, faviconUrl: objectUrl }));
            setFaviconBroken(false);
            setFaviconFileName(file.name);
        }

        setUploading(type);
        try {
            const form = new FormData();
            form.append("type", type);
            form.append("file", file);

            const res = await fetch("/api/settings/branding/upload", {
                method: "POST",
                body: form,
            });

            let data: any = {};
            try {
                data = await res.json();
            } catch {
                data = {};
            }

            if (!res.ok) {
                toast.error(data.message || "Falha no upload");
                // Keep local preview so user still sees what they picked; they can retry
                return;
            }

            const serverLogo = data.data?.logoUrl;
            const serverFavicon = data.data?.faviconUrl;

            setSystemConfig((prev) => ({
                ...prev,
                logoUrl: type === "logo" ? serverLogo || prev.logoUrl : prev.logoUrl,
                faviconUrl: type === "favicon" ? serverFavicon || prev.faviconUrl : prev.faviconUrl,
            }));

            if (type === "logo") {
                if (logoObjectUrlRef.current) {
                    URL.revokeObjectURL(logoObjectUrlRef.current);
                    logoObjectUrlRef.current = null;
                }
                setLogoBroken(false);
            }
            if (type === "favicon") {
                if (faviconObjectUrlRef.current) {
                    URL.revokeObjectURL(faviconObjectUrlRef.current);
                    faviconObjectUrlRef.current = null;
                }
                setFaviconBroken(false);
                // Hint browser to refresh favicon
                const link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
                if (link && serverFavicon) {
                    link.href = serverFavicon;
                }
            }

            toast.success(type === "logo" ? "Logo enviado com sucesso" : "Favicon enviado com sucesso");
            router.refresh();
        } catch (e) {
            console.error(e);
            toast.error("Erro ao enviar arquivo. Verifique a conexão e tente novamente.");
        } finally {
            setUploading(null);
            if (type === "logo" && logoInputRef.current) logoInputRef.current.value = "";
            if (type === "favicon" && faviconInputRef.current) faviconInputRef.current.value = "";
        }
    };

    const openFilePicker = (type: "logo" | "favicon") => {
        if (authStatus === "loading") {
            toast.message("Aguarde", { description: "Verificando sessão…" });
            return;
        }
        if (!isSuperAdmin) {
            toast.error("Sem permissão. Apenas SuperAdmin pode enviar logo/favicon.");
            return;
        }
        if (type === "logo") logoInputRef.current?.click();
        else faviconInputRef.current?.click();
    };

    const inputClass =
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl sm:text-3xl font-bold tracking-tight">Configurações</h2>
                <p className="text-muted-foreground text-sm mt-1">
                    Configuração global do sistema. Apenas SuperAdmins podem fazer alterações.
                </p>
            </div>

            <Card className="border-emerald-100 bg-gradient-to-br from-emerald-50/50 via-white to-white shadow-sm">
                <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                    <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                            <Plug className="h-5 w-5" />
                        </div>
                        <div>
                            <CardTitle className="text-lg">Integrações</CardTitle>
                            <CardDescription className="mt-1">
                                Datafy API (WhatsApp oficial Meta Cloud) — conexão, webhook e
                                templates. Baileys permanece intacto.
                            </CardDescription>
                        </div>
                    </div>
                    <Button asChild variant="outline" className="shrink-0">
                        <Link href="/dashboard/settings/integrations/datafy">
                            Abrir Datafy
                            <ArrowRight className="ml-2 h-4 w-4" />
                        </Link>
                    </Button>
                </CardHeader>
            </Card>

            {!isSuperAdmin && authStatus === "authenticated" && (
                <Card className="border-yellow-200 bg-yellow-50">
                    <CardContent className="pt-6">
                        <div className="flex items-start gap-3">
                            <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-yellow-900">Modo somente leitura</p>
                                <p className="text-xs text-yellow-700 mt-1">
                                    Apenas Superadmins podem modificar as configurações do sistema. Você pode
                                    visualizar as configurações atuais, mas não pode alterá-las.
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card className="border-primary/20 bg-primary/5">
                <CardHeader>
                    <CardTitle className="text-xl">Configuração do aplicativo</CardTitle>
                    <CardDescription>
                        Configurações globais de marca e controle de acesso do aplicativo.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                        <div className="grid gap-2">
                            <Label>Nome do aplicativo</Label>
                            <input
                                className={inputClass}
                                placeholder="Bom Frete Transportes"
                                value={systemConfig.appName}
                                onChange={(e) =>
                                    setSystemConfig((prev) => ({ ...prev, appName: e.target.value }))
                                }
                                disabled={!isSuperAdmin}
                            />
                            <p className="text-xs text-muted-foreground">
                                Altera o nome na barra lateral e no título do navegador.
                            </p>
                        </div>

                        <div className="grid gap-2">
                            <Label>Fuso horário</Label>
                            <select
                                className={inputClass}
                                value={systemConfig.timezone}
                                onChange={(e) =>
                                    setSystemConfig((prev) => ({ ...prev, timezone: e.target.value }))
                                }
                                disabled={!isSuperAdmin}
                            >
                                {timezones.map((tz) => (
                                    <option key={tz} value={tz}>
                                        {tz}
                                    </option>
                                ))}
                            </select>
                            <p className="text-xs text-muted-foreground">
                                O agendador usará este fuso horário.
                            </p>
                        </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                        {/* Logo upload */}
                        <div className="grid gap-2">
                            <Label>Logo do aplicativo</Label>
                            <input
                                ref={logoInputRef}
                                type="file"
                                accept={LOGO_ACCEPT}
                                className="hidden"
                                disabled={!isSuperAdmin || uploading === "logo"}
                                onChange={(e) => handleUpload("logo", e.target.files?.[0])}
                            />
                            <div className="rounded-lg border bg-background p-3 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="h-14 w-14 rounded-md border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
                                        {systemConfig.logoUrl && !logoBroken ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={systemConfig.logoUrl}
                                                alt="Logo"
                                                className="h-full w-full object-contain"
                                                onError={() => setLogoBroken(true)}
                                            />
                                        ) : (
                                            <ImageIcon className="h-5 w-5 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs text-muted-foreground truncate">
                                            {systemConfig.logoUrl && !logoBroken
                                                ? logoFileName || "Logo atual carregado"
                                                : "Nenhum logo enviado"}
                                        </p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="mt-2"
                                            disabled={!isSuperAdmin || uploading === "logo"}
                                            onClick={() => openFilePicker("logo")}
                                        >
                                            {uploading === "logo" ? (
                                                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                            ) : (
                                                <Upload className="h-3.5 w-3.5 mr-1.5" />
                                            )}
                                            {uploading === "logo" ? "Enviando…" : "Anexar do computador"}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Aparece abaixo do nome do aplicativo no menu lateral (no lugar de “Gateway
                                WhatsApp”). PNG/JPG/WEBP/SVG · máx. 2MB.
                            </p>
                        </div>

                        {/* Favicon upload */}
                        <div className="grid gap-2">
                            <Label>Favicon</Label>
                            <input
                                ref={faviconInputRef}
                                type="file"
                                accept={FAVICON_ACCEPT}
                                className="hidden"
                                disabled={!isSuperAdmin || uploading === "favicon"}
                                onChange={(e) => handleUpload("favicon", e.target.files?.[0])}
                            />
                            <div className="rounded-lg border bg-background p-3 space-y-3">
                                <div className="flex items-center gap-3">
                                    <div className="h-14 w-14 rounded-md border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0">
                                        {systemConfig.faviconUrl && !faviconBroken ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img
                                                src={systemConfig.faviconUrl}
                                                alt="Favicon"
                                                className="h-8 w-8 object-contain"
                                                onError={() => setFaviconBroken(true)}
                                            />
                                        ) : (
                                            <Globe className="h-5 w-5 text-muted-foreground" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="text-xs text-muted-foreground truncate">
                                            {systemConfig.faviconUrl && !faviconBroken
                                                ? faviconFileName || "Favicon atual carregado"
                                                : "Nenhum favicon enviado"}
                                        </p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="mt-2"
                                            disabled={!isSuperAdmin || uploading === "favicon"}
                                            onClick={() => openFilePicker("favicon")}
                                        >
                                            {uploading === "favicon" ? (
                                                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                            ) : (
                                                <Upload className="h-3.5 w-3.5 mr-1.5" />
                                            )}
                                            {uploading === "favicon" ? "Enviando…" : "Anexar do computador"}
                                        </Button>
                                    </div>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Ícone da aba do navegador. Tamanho ideal: <strong>32×32</strong> ou{" "}
                                <strong>48×48 px</strong> (PNG ou ICO). Também aceita 180×180 para Apple.
                                Máx. 2MB.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center justify-between space-x-2 pt-2 border-t border-border/50">
                        <Label htmlFor="enable-registration" className="flex flex-col space-y-1">
                            <span>Ativar registro de usuários</span>
                            <span className="font-normal text-xs text-muted-foreground">
                                Permitir que novos usuários criem contas. Desative para manter a plataforma
                                privada.
                            </span>
                        </Label>
                        <Switch
                            id="enable-registration"
                            checked={systemConfig.enableRegistration}
                            onCheckedChange={(c) =>
                                setSystemConfig((prev) => ({ ...prev, enableRegistration: c }))
                            }
                            disabled={!isSuperAdmin}
                        />
                    </div>

                    <div className="pt-2">
                        <Button onClick={handleSaveSystem} disabled={systemLoading || !isSuperAdmin}>
                            {systemLoading ? (
                                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                            ) : (
                                <Save className="h-4 w-4 mr-2" />
                            )}
                            Salvar configuração
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
