"use client";

import { SessionGuard } from "@/components/dashboard/session-guard";
import { CrmContactsPanel } from "@/components/dashboard/crm-contacts-panel";
import { BaileysContactsPanel } from "@/components/dashboard/baileys-contacts-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/components/dashboard/session-provider";
import { Contact, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ContactListPage() {
    const { isDatafyChannel } = useSession();

    return (
        <SessionGuard>
            <div className="overflow-x-hidden">
                <Tabs defaultValue="crm" className="space-y-5">
                    <TabsList
                        variant="line"
                        className="w-full sm:w-auto h-auto gap-1 bg-transparent p-0 border-b border-slate-200 rounded-none"
                    >
                        <TabsTrigger
                            value="crm"
                            className={cn(
                                "rounded-none px-4 py-2.5 text-sm font-medium text-slate-500",
                                "data-[state=active]:text-[#2563eb] data-[state=active]:shadow-none",
                                "after:bg-[#2563eb] after:h-0.5"
                            )}
                        >
                            <Contact className="h-4 w-4" />
                            CRM Bom Frete
                        </TabsTrigger>
                        <TabsTrigger
                            value="baileys"
                            disabled={isDatafyChannel}
                            className={cn(
                                "rounded-none px-4 py-2.5 text-sm font-medium text-slate-500",
                                "data-[state=active]:text-[#2563eb] data-[state=active]:shadow-none",
                                "after:bg-[#2563eb] after:h-0.5",
                                "disabled:opacity-50"
                            )}
                        >
                            <Smartphone className="h-4 w-4" />
                            Agenda Baileys
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="crm" className="mt-0 outline-none">
                        <CrmContactsPanel />
                    </TabsContent>
                    <TabsContent value="baileys" className="mt-0 outline-none">
                        {isDatafyChannel ? (
                            <p className="text-sm text-slate-500 py-8">
                                Selecione um canal Baileys no seletor de sessão
                                para ver a agenda sincronizada do WhatsApp não
                                oficial.
                            </p>
                        ) : (
                            <BaileysContactsPanel />
                        )}
                    </TabsContent>
                </Tabs>
            </div>
        </SessionGuard>
    );
}
