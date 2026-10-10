"use client";

import { useSession } from "./session-provider";
import { QrCode, BadgeCheck } from "lucide-react";
import { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function SessionGuard({ children }: { children: ReactNode }) {
    const { sessionId, loading, channels, isDatafyChannel, selectedChannel } =
        useSession();

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center p-8">
                Carregando canal...
            </div>
        );
    }

    if (!sessionId) {
        return (
            <div className="flex h-full flex-col items-center justify-center space-y-6 text-center p-8">
                <div className="rounded-full bg-green-100 p-6">
                    <QrCode className="h-12 w-12 text-green-600" />
                </div>
                <div className="space-y-2 max-w-md">
                    <h2 className="text-2xl font-bold tracking-tight">
                        Nenhum canal ativo
                    </h2>
                    <p className="text-gray-500">
                        Selecione um canal WhatsApp na barra superior para usar
                        este recurso.
                    </p>
                </div>

                {channels.length === 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-sm text-gray-500">
                            Você ainda não tem canais ou sessões acessíveis.
                        </p>
                        <Link href="/dashboard/sessions">
                            <Button variant="outline">Ir para Sessões</Button>
                        </Link>
                    </div>
                )}
            </div>
        );
    }

    // Datafy channel is a valid selection — feature pages decide the UI state.
    if (isDatafyChannel && selectedChannel) {
        return <>{children}</>;
    }

    return <>{children}</>;
}

/** Small badge for pages that want to show official channel context. */
export function OfficialChannelHint() {
    const { isDatafyChannel, selectedChannel } = useSession();
    if (!isDatafyChannel || !selectedChannel) return null;
    return (
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
            <BadgeCheck className="h-3.5 w-3.5" />
            Oficial · Datafy
            {selectedChannel.displayPhoneNumber
                ? ` · ${selectedChannel.displayPhoneNumber}`
                : ""}
        </div>
    );
}
