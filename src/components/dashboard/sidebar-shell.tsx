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

export function SidebarShell({
    appName,
    logoUrl,
    userName,
    userEmail,
    version,
}: SidebarShellProps) {
    const { isCollapsed } = useSidebar();
    const hasLogo = !!(logoUrl && logoUrl.trim());

    return (
        <aside
            className={`
                hidden md:flex flex-col h-full sticky left-0 top-0 z-20
                transition-all duration-300 ease-in-out
                text-slate-200
                bg-[linear-gradient(180deg,#071a33_0%,#0c2748_48%,#103057_100%)]
                border-r border-white/10
                shadow-[4px_0_24px_-12px_rgba(7,26,51,0.55)]
                ${isCollapsed ? "w-[72px]" : "w-[268px]"}
            `}
        >
            <div
                className={`border-b border-white/10 transition-all duration-300 ${
                    isCollapsed ? "px-2.5 py-4" : "px-4 py-5"
                }`}
            >
                {isCollapsed ? (
                    <div className="flex justify-center">
                        {hasLogo ? (
                            <div className="relative flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15 overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={logoUrl!}
                                    alt={appName}
                                    className="h-9 w-9 object-contain"
                                />
                            </div>
                        ) : (
                            <div className="h-11 w-11 rounded-xl bg-[#2563eb] flex items-center justify-center text-white font-bold text-sm shadow-md">
                                {appName.charAt(0)}
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <h1 className="text-[13px] font-semibold tracking-[0.04em] uppercase leading-snug text-white/95">
                            {appName}
                        </h1>
                        {hasLogo ? (
                            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-3">
                                <div className="relative flex items-center justify-center min-h-[72px] rounded-xl bg-white/95 px-3 py-2">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={logoUrl!}
                                        alt={`${appName} logo`}
                                        className="max-h-[64px] w-auto max-w-full object-contain"
                                    />
                                </div>
                            </div>
                        ) : (
                            <p className="text-[10px] text-slate-400 font-medium">
                                Gateway WhatsApp
                            </p>
                        )}
                    </div>
                )}
            </div>

            <SidebarNav variant="navy" />

            <div
                suppressHydrationWarning={true}
                className={`border-t border-white/10 transition-all duration-300 ${
                    isCollapsed ? "p-2" : "p-4"
                }`}
            >
                {isCollapsed ? (
                    <div
                        suppressHydrationWarning={true}
                        className="flex flex-col items-center gap-2"
                    >
                        <div
                            suppressHydrationWarning={true}
                            className="h-8 w-8 rounded-lg bg-[#2563eb]/30 flex items-center justify-center text-xs font-bold text-white"
                        >
                            {userName?.charAt(0)?.toUpperCase() || "U"}
                        </div>
                        <LogoutButton
                            collapsed
                            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                        />
                    </div>
                ) : (
                    <>
                        <div
                            suppressHydrationWarning={true}
                            className="flex items-center gap-2.5 mb-3"
                        >
                            <div
                                suppressHydrationWarning={true}
                                className="h-8 w-8 rounded-lg bg-[#2563eb] flex items-center justify-center text-xs font-bold text-white"
                            >
                                {userName?.charAt(0)?.toUpperCase() || "U"}
                            </div>
                            <div
                                suppressHydrationWarning={true}
                                className="flex-1 min-w-0"
                            >
                                <p className="text-sm font-semibold text-white truncate">
                                    {userName || "User"}
                                </p>
                                <p className="text-[10px] text-slate-400 truncate">
                                    {userEmail}
                                </p>
                            </div>
                        </div>
                        <LogoutButton className="w-full justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/10 hover:text-white transition-colors" />
                        <p className="text-[9px] text-slate-500 text-center mt-2 font-mono">
                            v{version}
                        </p>
                    </>
                )}
            </div>
        </aside>
    );
}
