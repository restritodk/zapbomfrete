"use client";

import { SidebarNav } from "./sidebar-nav";
import { useSidebar } from "./sidebar-context";
import { LogoutButton } from "./logout-confirm";

interface SidebarShellProps {
    appName: string;
    logoUrl?: string | null;
    userName?: string | null;
    userEmail?: string | null;
    version: string;
}

export function SidebarShell({ appName, logoUrl, userName, userEmail, version }: SidebarShellProps) {
    const { isCollapsed } = useSidebar();
    const hasLogo = !!(logoUrl && logoUrl.trim());

    return (
        <aside
            className={`
                bg-background/80 backdrop-blur-xl border-r border-border/40
                hidden md:flex flex-col h-full sticky left-0 top-0 z-20
                shadow-[1px_0_12px_-4px_rgba(0,0,0,0.08)]
                transition-all duration-300 ease-in-out
                ${isCollapsed ? "w-[72px]" : "w-[260px]"}
            `}
        >
            {/* Logo / Brand */}
            <div className={`border-b border-border/30 transition-all duration-300 ${isCollapsed ? "px-2.5 py-4" : "px-4 py-5"}`}>
                {isCollapsed ? (
                    <div className="flex justify-center">
                        {hasLogo ? (
                            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 via-background to-emerald-500/10 ring-1 ring-primary/20 shadow-sm overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={logoUrl!}
                                    alt={appName}
                                    className="h-9 w-9 object-contain"
                                />
                            </div>
                        ) : (
                            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-primary to-blue-500 flex items-center justify-center text-white font-bold text-sm shadow-md">
                                {appName.charAt(0)}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <h1 className="text-lg font-bold tracking-tight leading-snug text-transparent bg-clip-text bg-gradient-to-r from-primary to-blue-500 text-balance">
                            {appName}
                        </h1>
                        {hasLogo ? (
                            <div className="relative overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.08] via-background to-emerald-500/[0.06] p-3 shadow-[0_8px_24px_-12px_rgba(16,185,129,0.35)]">
                                <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/15 blur-2xl" />
                                <div className="pointer-events-none absolute -bottom-8 -left-4 h-16 w-16 rounded-full bg-emerald-400/15 blur-2xl" />
                                <div className="relative flex items-center justify-center min-h-[88px] rounded-xl bg-background/70 ring-1 ring-border/40 backdrop-blur-sm px-3 py-2">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={logoUrl!}
                                        alt={`${appName} logo`}
                                        className="max-h-[76px] w-auto max-w-full object-contain"
                                    />
                                </div>
                            </div>
                        ) : (
                            <p className="text-[10px] text-muted-foreground font-medium">Gateway WhatsApp</p>
                        )}
                    </div>
                )}
            </div>

            {/* Navigation */}
            <SidebarNav />

            {/* User Footer */}
            <div 
                suppressHydrationWarning={true}
                className={`border-t border-border/30 bg-background/40 transition-all duration-300 ${isCollapsed ? "p-2" : "p-4"}`}
            >
                {isCollapsed ? (
                    <div suppressHydrationWarning={true} className="flex flex-col items-center gap-2">
                        <div suppressHydrationWarning={true} className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/20 to-blue-500/20 flex items-center justify-center text-xs font-bold text-primary">
                            {userName?.charAt(0)?.toUpperCase() || "U"}
                        </div>
                        <LogoutButton collapsed />
                    </div>
                ) : (
                    <>
                        <div suppressHydrationWarning={true} className="flex items-center gap-2.5 mb-3">
                            <div 
                                suppressHydrationWarning={true}
                                className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/20 to-blue-500/20 flex items-center justify-center text-xs font-bold text-primary border border-primary/10"
                            >
                                {userName?.charAt(0)?.toUpperCase() || "U"}
                            </div>
                            <div suppressHydrationWarning={true} className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-foreground truncate">{userName || "User"}</p>
                                <p className="text-[10px] text-muted-foreground truncate">{userEmail}</p>
                            </div>
                        </div>
                        <LogoutButton />
                        <p className="text-[9px] text-muted-foreground/50 text-center mt-2 font-mono">v{version}</p>
                    </>
                )}
            </div>
        </aside>
    );
}
