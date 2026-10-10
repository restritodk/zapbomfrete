"use client";

import Link from "next/link";
import { BadgeCheck, MessageSquare, Megaphone, Users, Contact } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChannelProvider } from "@/modules/channels/ids";

type Feature = "chat" | "broadcast" | "contacts" | "groups";

const COPY: Record<
    Feature,
    { title: string; body: string; icon: typeof MessageSquare }
> = {
    chat: {
        title: "Chat do canal oficial em preparação",
        body: "Você selecionou o WhatsApp Oficial (Datafy). A conversa nativa deste canal será integrada em uma próxima fase. Nenhuma conversa fictícia é exibida e nenhuma rota Baileys é chamada.",
        icon: MessageSquare,
    },
    broadcast: {
        title: "Disparo oficial Datafy ainda não disponível",
        body: "O canal Bom Frete — WhatsApp Oficial está reconhecido, mas campanhas via Datafy não estão habilitadas nesta fase. Envios atuais continuam apenas por sessões Baileys.",
        icon: Megaphone,
    },
    contacts: {
        title: "Contatos do canal oficial em preparação",
        body: "A agenda do canal Datafy será sincronizada em fases futuras. Consultas Baileys não são executadas com este canal selecionado.",
        icon: Contact,
    },
    groups: {
        title: "Grupos não se aplicam ao canal oficial",
        body: "O WhatsApp Business API (Datafy) não utiliza a mesma gestão de grupos das sessões Baileys. Selecione uma sessão Baileys para gerenciar grupos.",
        icon: Users,
    },
};

export function ProviderUnavailablePanel({
    feature,
    provider = "datafy",
    channelName,
    displayPhoneNumber,
}: {
    feature: Feature;
    provider?: ChannelProvider;
    channelName?: string | null;
    displayPhoneNumber?: string | null;
}) {
    const copy = COPY[feature];
    const Icon = copy.icon;

    return (
        <div className="flex h-full min-h-[320px] flex-col items-center justify-center px-6 py-12 text-center">
            <div className="relative mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-700">
                <Icon className="h-7 w-7" />
                <span className="absolute -right-1 -top-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                    <BadgeCheck className="h-3.5 w-3.5" />
                </span>
            </div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-700/80">
                Canal {provider === "datafy" ? "oficial · Datafy API" : "Baileys"}
            </p>
            <h2 className="max-w-lg text-xl font-bold tracking-tight sm:text-2xl">
                {copy.title}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                {copy.body}
            </p>
            {(channelName || displayPhoneNumber) && (
                <div className="mt-5 rounded-xl border bg-muted/30 px-4 py-3 text-left text-sm">
                    {channelName && (
                        <p className="font-medium text-foreground">{channelName}</p>
                    )}
                    {displayPhoneNumber ? (
                        <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                            {displayPhoneNumber}
                        </p>
                    ) : (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                            Número ainda não disponível na integração
                        </p>
                    )}
                </div>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                <Button asChild variant="outline" className="rounded-xl">
                    <Link href="/dashboard/sessions">Ver canais e sessões</Link>
                </Button>
            </div>
        </div>
    );
}
