"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { ChevronDown, PanelLeftClose, PanelLeft } from "lucide-react";
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
    Send,
    UserCheck,
    Megaphone,
    HardDrive,
    Activity,
    UserCircle,
    Tag,
    MessageCircleReply,
    Contact,
    UserPlus,
    Plug,
} from "lucide-react";
import { useSidebar } from "./sidebar-context";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";

interface NavGroup {
    label: string;
    items: NavItem[];
}

interface NavItem {
    href: string;
    label: string;
    icon: React.ElementType;
    external?: boolean;
    superadminOnly?: boolean;
    allowedRoles?: string[];
    /** Nested submenu (e.g. Criador de Boletins) */
    children?: Array<{ href: string; label: string }>;
}

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
            {
                href: "/dashboard/boletim",
                label: "Criador de Boletins",
                icon: FileText,
                children: [
                    { href: "/dashboard/boletim", label: "Criar boletim" },
                    {
                        href: "/dashboard/boletim/aprovacoes",
                        label: "Aprovações Meta",
                    },
                    {
                        href: "/dashboard/boletim/biblioteca",
                        label: "Biblioteca de templates",
                    },
                ],
            },
            { href: "/dashboard/sticker", label: "Criador de figurinhas", icon: ImageIcon },
        ],
    },
    {
        label: "Contatos",
        items: [
            {
                href: "/dashboard/contacts",
                label: "Contatos",
                icon: UserCheck,
                children: [
                    {
                        href: "/dashboard/contacts",
                        label: "Todos os contatos",
                    },
                    {
                        href: "/dashboard/contatos/consentimentos",
                        label: "Consentimentos",
                    },
                    { href: "/dashboard/groups", label: "Grupos" },
                    { href: "/dashboard/labels", label: "Etiquetas" },
                ],
            },
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

export function SidebarNav() {
    const pathname = usePathname();
    const { data: session } = useSession();
    const { isCollapsed, toggleCollapse } = useSidebar();
    // @ts-ignore
    const userRole = session?.user?.role;

    // Track collapsed groups — all expanded by default
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
    const [openSubmenus, setOpenSubmenus] = useState<Record<string, boolean>>({
        "/dashboard/boletim": true,
    });

    const toggleGroup = (label: string) => {
        setCollapsedGroups(prev => ({ ...prev, [label]: !prev[label] }));
    };

    const isActive = (href: string) => {
        if (href === "/dashboard") return pathname === "/dashboard";
        if (href === "/dashboard/boletim") {
            return (
                pathname === "/dashboard/boletim" ||
                pathname.startsWith("/dashboard/boletim/")
            );
        }
        return pathname.startsWith(href);
    };

    const isChildActive = (href: string) => {
        if (href === "/dashboard/boletim") {
            return pathname === "/dashboard/boletim";
        }
        return pathname === href || pathname.startsWith(`${href}/`);
    };

    return (
        <TooltipProvider delayDuration={0}>
            <nav className="flex-1 px-2 py-2 overflow-y-auto overflow-x-hidden space-y-0.5 styled-scrollbar">
                {navGroups.map((group) => {
                    const visibleItems = group.items.filter((item) => {
                        if (item.superadminOnly && userRole !== "SUPERADMIN") return false;
                        if (item.allowedRoles && (!userRole || !item.allowedRoles.includes(userRole))) return false;
                        return true;
                    });
                    if (visibleItems.length === 0) return null;

                    const isGroupCollapsed = collapsedGroups[group.label] ?? false;

                    // "Main" group doesn't show a collapsible header
                    if (group.label === "Main") {
                        return (
                            <div key={group.label} className="mb-1">
                                {visibleItems.map((item) => (
                                    <NavLink
                                        key={item.href}
                                        item={item}
                                        active={isActive(item.href)}
                                        isCollapsed={isCollapsed}
                                    />
                                ))}
                            </div>
                        );
                    }

                    return (
                        <div key={group.label} className="mb-1">
                            {/* Group header — hidden when sidebar collapsed */}
                            {!isCollapsed && (
                                <button
                                    onClick={() => toggleGroup(group.label)}
                                    className="flex items-center justify-between w-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 hover:text-foreground/80 transition-colors group"
                                >
                                    {group.label}
                                    <ChevronDown
                                        size={12}
                                        className={`transition-transform duration-200 ${isGroupCollapsed ? "-rotate-90" : ""}`}
                                    />
                                </button>
                            )}

                            {/* Collapsed sidebar: show a thin divider between groups */}
                            {isCollapsed && (
                                <div className="mx-3 my-2 border-t border-border/30" />
                            )}

                            {(!isGroupCollapsed || isCollapsed) && (
                                <div className="space-y-0.5">
                                    {visibleItems.map((item) => {
                                        if (item.children?.length && !isCollapsed) {
                                            const open =
                                                openSubmenus[item.href] ??
                                                isActive(item.href);
                                            return (
                                                <div key={item.href} className="space-y-0.5">
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setOpenSubmenus((prev) => ({
                                                                ...prev,
                                                                [item.href]: !open,
                                                            }))
                                                        }
                                                        className={`
                                                            flex items-center justify-between w-full rounded-lg text-sm font-medium
                                                            gap-3 px-3 py-2 transition-all duration-200
                                                            ${
                                                                isActive(item.href)
                                                                    ? "text-primary bg-primary/10"
                                                                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                                                            }
                                                        `}
                                                    >
                                                        <span className="flex items-center gap-3 min-w-0">
                                                            <item.icon
                                                                size={17}
                                                                className={`flex-shrink-0 ${
                                                                    isActive(item.href)
                                                                        ? "text-primary"
                                                                        : "text-muted-foreground/70"
                                                                }`}
                                                            />
                                                            <span className="truncate">
                                                                {item.label}
                                                            </span>
                                                        </span>
                                                        <ChevronDown
                                                            size={14}
                                                            className={`shrink-0 transition-transform duration-200 ${
                                                                open ? "" : "-rotate-90"
                                                            }`}
                                                        />
                                                    </button>
                                                    {open && (
                                                        <div className="ml-4 pl-3 border-l border-border/40 space-y-0.5">
                                                            {item.children.map((child) => (
                                                                <Link
                                                                    key={child.href}
                                                                    href={child.href}
                                                                    className={`
                                                                        block rounded-md px-2.5 py-1.5 text-[13px] transition-colors
                                                                        ${
                                                                            isChildActive(
                                                                                child.href
                                                                            )
                                                                                ? "text-primary font-medium bg-primary/5"
                                                                                : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                                                                        }
                                                                    `}
                                                                >
                                                                    {child.label}
                                                                </Link>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        }
                                        return (
                                            <NavLink
                                                key={item.href}
                                                item={item}
                                                active={isActive(item.href)}
                                                isCollapsed={isCollapsed}
                                            />
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </nav>

            {/* Collapse Toggle Button */}
            <div className="px-2 py-2 border-t border-border/30">
                <button
                    onClick={toggleCollapse}
                    className="flex items-center justify-center w-full gap-2 px-3 py-2 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200"
                >
                    {isCollapsed ? (
                        <PanelLeft size={18} />
                    ) : (
                        <>
                            <PanelLeftClose size={16} />
                            <span>Collapse</span>
                        </>
                    )}
                </button>
            </div>
        </TooltipProvider>
    );
}

function NavLink({ item, active, isCollapsed }: { item: NavItem; active: boolean; isCollapsed: boolean }) {
    const Icon = item.icon;

    const linkContent = (
        <Link
            href={item.href}
            target={item.external ? "_blank" : undefined}
            className={`
                flex items-center rounded-lg text-sm font-medium
                transition-all duration-200 group relative
                ${isCollapsed ? "justify-center px-2 py-2.5 mx-1" : "gap-3 px-3 py-2"}
                ${active
                    ? "text-primary bg-primary/10 shadow-sm"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }
            `}
        >
            {active && !isCollapsed && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-primary rounded-r-full" />
            )}
            <Icon
                size={isCollapsed ? 20 : 17}
                className={`flex-shrink-0 transition-colors duration-200 ${active ? "text-primary" : "text-muted-foreground/70 group-hover:text-foreground"}`}
            />
            {!isCollapsed && <span className="truncate">{item.label}</span>}
        </Link>
    );

    if (isCollapsed) {
        return (
            <Tooltip>
                <TooltipTrigger asChild>
                    {linkContent}
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                    <p className="text-xs font-medium">{item.label}</p>
                </TooltipContent>
            </Tooltip>
        );
    }

    return linkContent;
}
