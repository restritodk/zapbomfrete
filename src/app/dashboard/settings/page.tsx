"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { RefreshCw, Save, AlertCircle, Upload, ImageIcon, Globe } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type SystemConfigState = {
    appName: string;
    logoUrl: string;
    faviconUrl: string;
    timezone: string;
    enableRegistration: boolean;
};

export default function SettingsPage() {
    const { data: authSession } = useSession();
    const router = useRouter();
    const isSuperAdmin = (authSession?.user as any)?.role === "SUPERADMIN";

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
    const [timezones, setTimezones] = useState<string[]>([
        "UTC",
        "America/Sao_Paulo",
        "America/Manaus",
        "America/Fortaleza",
    ]);

    const logoInputRef = useRef<HTMLInputElement>(null);
    const faviconInputRef = useRef<HTMLInputElement>(null);

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
                if (!r.ok) throw new Error();
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
            .catch(() => {});
    }, []);

    const handleSaveSystem = async () => {
        setSystemLoading(true);
        try {
            const res = await fetch("/api/settings/system", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(systemConfig),
            });

            if (res.ok) {
                toast.success("Configurações salvas. Atualizando a interface...");
                router.refresh();
            } else {
                toast.error("Falha ao atualizar as configurações do sistema");
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao salvar as configurações do sistema");
        } finally {
            setSystemLoading(false);
        }
    };

    const handleUpload = async (type: "logo" | "favicon", file: File | undefined) => {
        if (!file || !isSuperAdmin) return;
        setUploading(type);
        try {
            const form = new FormData();
            form.append("type", type);
            form.append("file", file);

            const res = await fetch("/api/settings/branding/upload", {
                method: "POST",
                body: form,
            });
            const data = await res.json();
            if (!res.ok) {
                toast.error(data.message || "Falha no upload");
                return;
            }

            setSystemConfig((prev) => ({
                ...prev,
                logoUrl: data.data?.logoUrl ?? prev.logoUrl,
                faviconUrl: data.data?.faviconUrl ?? prev.faviconUrl,
            }));
            if (type === "logo") setLogoBroken(false);
            if (type === "favicon") setFaviconBroken(false);
            toast.success(type === "logo" ? "Logo enviado com sucesso" : "Favicon enviado com sucesso");
            router.refresh();
        } catch (e) {
            console.error(e);
            toast.error("Erro ao enviar arquivo");
        } finally {
            setUploading(null);
            if (type === "logo" && logoInputRef.current) logoInputRef.current.value = "";
            if (type === "favicon" && faviconInputRef.current) faviconInputRef.current.value = "";
        }
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

            {!isSuperAdmin && (
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
                                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif,.png,.jpg,.jpeg,.webp,.svg"
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
                                                ? "Logo atual carregado"
                                                : "Nenhum logo enviado"}
                                        </p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="mt-2"
                                            disabled={!isSuperAdmin || uploading === "logo"}
                                            onClick={() => logoInputRef.current?.click()}
                                        >
                                            {uploading === "logo" ? (
                                                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                            ) : (
                                                <Upload className="h-3.5 w-3.5 mr-1.5" />
                                            )}
                                            Anexar do computador
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
                                accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/jpeg,image/webp,.png,.ico,.jpg,.jpeg,.webp"
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
                                                ? "Favicon atual carregado"
                                                : "Nenhum favicon enviado"}
                                        </p>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="mt-2"
                                            disabled={!isSuperAdmin || uploading === "favicon"}
                                            onClick={() => faviconInputRef.current?.click()}
                                        >
                                            {uploading === "favicon" ? (
                                                <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                            ) : (
                                                <Upload className="h-3.5 w-3.5 mr-1.5" />
                                            )}
                                            Anexar do computador
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
