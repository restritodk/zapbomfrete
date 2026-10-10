"use client";

import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Menu, ChevronDown } from "lucide-react";
import Link from "next/link";
import {
    LayoutDashboard,
    MessageSquare,
    Users,
    Settings,
    QrCode,
    ImageIcon,
    Webhook,
    CalendarClock,
    Bot,
    Bell,
    FileText,
    Code,
    UserCheck,
    Megaphone,
    HardDrive,
    Activity,
    UserCircle,
    Tag,
    MessageCircleReply,
    UserPlus,
    Plug,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import pkg from "../../../package.json";
import { LogoutButton } from "./logout-confirm";

interface NavGroup {
    label: string;
    items: { href: string; label: string; icon: React.ElementType; external?: boolean; superadminOnly?: boolean }[];
}

// Keep in sync with sidebar-nav.tsx
const navGroups: NavGroup[] = [
    {
        label: "Principal",
        items: [
            { href: "/dashboard", label: "Painel", icon: LayoutDashboard },
            { href: "/dashboard/sessions", label: "Sessões / QR", icon: QrCode },
        ],
    },
    {
        label: "Mensagens",
        items: [
            { href: "/dashboard/chat", label: "Chat", icon: MessageSquare },
            { href: "/dashboard/broadcast", label: "Disparo em massa", icon: Megaphone },
            { href: "/dashboard/boletim", label: "Criador de boletins", icon: FileText },
            { href: "/dashboard/sticker", label: "Criador de figurinhas", icon: ImageIcon },
        ],
    },
    {
        label: "Contatos",
        items: [
            { href: "/dashboard/contacts", label: "Contatos", icon: UserCheck },
            { href: "/dashboard/groups", label: "Grupos", icon: Users },
            { href: "/dashboard/labels", label: "Etiquetas", icon: Tag },
        ],
    },
    {
        label: "Automação",
        items: [
            { href: "/dashboard/bot-settings", label: "Config. do bot", icon: Bot },
            { href: "/dashboard/autoreply", label: "Resposta automática", icon: MessageCircleReply },
            { href: "/dashboard/profile", label: "Perfil do bot", icon: UserCircle },
            { href: "/dashboard/scheduler", label: "Agendador", icon: CalendarClock },
            { href: "/dashboard/webhooks", label: "Webhooks e API", icon: Webhook },
        ],
    },
    {
        label: "Desenvolvedor",
        items: [
            { href: "/docs", label: "Docs da API", icon: FileText, superadminOnly: true },
            { href: "/swagger", label: "Swagger UI", icon: Code, external: true, superadminOnly: true },
            { href: "/dashboard/api-docs", label: "Docs (painel)", icon: FileText, superadminOnly: true },
        ],
    },
    {
        label: "Administração",
        items: [
            { href: "/dashboard/media", label: "Gerenciador de mídia", icon: HardDrive },
            { href: "/dashboard/sessions/access", label: "Acesso às sessões", icon: UserPlus },
            { href: "/dashboard/users", label: "Usuários", icon: Users, superadminOnly: true },
            { href: "/dashboard/settings", label: "Configurações", icon: Settings },
            {
                href: "/dashboard/settings/integrations/datafy",
                label: "Integrações · Datafy",
                icon: Plug,
                superadminOnly: true,
            },
            { href: "/dashboard/system-monitor", label: "Monitor do sistema", icon: Activity, superadminOnly: true },
            { href: "/dashboard/notifications", label: "Notificações", icon: Bell, superadminOnly: true },
        ],
    },
];

export function MobileNav({ appName = "WA-AKG", logoUrl }: { appName?: string; logoUrl?: string | null }) {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();
    const { data: session } = useSession();
    // @ts-ignore
    const userRole = session?.user?.role;

    const isActive = (href: string) => {
        if (href === "/dashboard") return pathname === "/dashboard";
        return pathname.startsWith(href);
    };

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                    <Menu className="h-5 w-5" />
                </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85vw] sm:w-[320px] p-0 flex flex-col">
                <SheetHeader className="px-5 py-5 text-left border-b border-slate-100 space-y-3">
                    <SheetTitle className="text-lg font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500">
                        {appName}
                    </SheetTitle>
                    {logoUrl ? (
                        <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.08] via-background to-emerald-500/[0.06] p-3 shadow-[0_8px_24px_-12px_rgba(16,185,129,0.35)]">
                            <div className="relative flex items-center justify-center min-h-[80px] rounded-xl bg-background/70 ring-1 ring-border/40 px-3 py-2">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={logoUrl}
                                    alt={`${appName} logo`}
                                    className="max-h-[72px] w-auto max-w-full object-contain"
                                />
                            </div>
                        </div>
                    ) : (
                        <SheetDescription className="text-[11px] text-slate-400">
                            Gateway WhatsApp
                        </SheetDescription>
                    )}
                </SheetHeader>

                <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-1">
                    {navGroups.map((group) => {
                        const visibleItems = group.items.filter(
                            (item) => !item.superadminOnly || userRole === "SUPERADMIN"
                        );
                        if (visibleItems.length === 0) return null;

                        return (
                            <div key={group.label} className="mb-1">
                                {group.label !== "Main" && (
                                    <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                                        {group.label}
                                    </p>
                                )}
                                <div className="space-y-0.5">
                                    {visibleItems.map(({ href, label, icon: Icon, external }) => (
                                        <Link
                                            key={href}
                                            href={href}
                                            target={external ? "_blank" : undefined}
                                            onClick={() => setOpen(false)}
                                            className={`
                                                flex items-center rounded-lg text-sm font-medium
                                                transition-all duration-200 group relative
                                                gap-3 px-3 py-2
                                                ${isActive(href)
                                                    ? "text-primary bg-primary/10 shadow-sm"
                                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                                }
                                            `}
                                        >
                                            {isActive(href) && (
                                                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-primary rounded-r-full" />
                                            )}
                                            <Icon
                                                size={17}
                                                className={`flex-shrink-0 transition-colors duration-200 ${isActive(href) ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"}`}
                                            />
                                            <span className="truncate">{label}</span>
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </nav>

                <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-semibold text-slate-600">
                            {session?.user?.name?.charAt(0)?.toUpperCase() || "U"}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700 truncate">{session?.user?.name || "User"}</p>
                            <p className="text-[11px] text-slate-400 truncate">{session?.user?.email}</p>
                        </div>
                    </div>
                    <LogoutButton className="w-full flex items-center justify-center gap-2 text-xs h-8 rounded-lg" />
                    <p className="text-[10px] text-slate-300 text-center mt-2 font-mono">v{pkg.version}</p>
                </div>
            </SheetContent>
        </Sheet>
    );
}
