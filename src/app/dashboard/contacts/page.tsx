"use client";

import { SessionGuard } from "@/components/dashboard/session-guard";
import { CrmContactsPanel } from "@/components/dashboard/crm-contacts-panel";
import { BaileysContactsPanel } from "@/components/dashboard/baileys-contacts-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSession } from "@/components/dashboard/session-provider";

export default function ContactListPage() {
    const { isDatafyChannel } = useSession();

    return (
        <SessionGuard>
            <Tabs
                defaultValue="crm"
                className="space-y-4"
            >
                <TabsList variant="line" className="w-full sm:w-auto">
                    <TabsTrigger value="crm">CRM Bom Frete</TabsTrigger>
                    <TabsTrigger value="baileys" disabled={isDatafyChannel}>
                        Agenda Baileys
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="crm">
                    <CrmContactsPanel />
                </TabsContent>
                <TabsContent value="baileys">
                    {isDatafyChannel ? (
                        <p className="text-sm text-muted-foreground py-8">
                            Selecione um canal Baileys no seletor de sessão para
                            ver a agenda sincronizada do WhatsApp não oficial.
                        </p>
                    ) : (
                        <BaileysContactsPanel />
                    )}
                </TabsContent>
            </Tabs>
        </SessionGuard>
    );
}
