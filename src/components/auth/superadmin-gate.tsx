"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Client gate for SUPERADMIN-only pages (Docs, Swagger, Integrações Datafy).
 * OWNER/STAFF see acesso negado — operational Datafy routes stay elsewhere.
 */
export function SuperadminGate({
    children,
    title = "Acesso restrito",
}: {
    children: React.ReactNode;
    title?: string;
}) {
    const { data: session, status } = useSession();
    const router = useRouter();
    const role = (session?.user as { role?: string } | undefined)?.role;
    const allowed = role === "SUPERADMIN";

    useEffect(() => {
        if (status === "unauthenticated") {
            router.replace("/auth/login");
        }
    }, [status, router]);

    if (status === "loading" || status === "unauthenticated") {
        return (
            <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Verificando permissão…
            </div>
        );
    }

    if (!allowed) {
        return (
            <div className="mx-auto max-w-lg p-6">
                <Card className="border-amber-200">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <ShieldX className="h-5 w-5 text-amber-700" />
                            {title}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm text-muted-foreground">
                        <p>
                            Esta área é exclusiva para SUPERADMIN (ferramentas
                            de desenvolvedor e credenciais Datafy globais).
                        </p>
                        <p>
                            Recursos operacionais (Chat oficial, Criador de
                            boletins e Disparo em massa) permanecem disponíveis
                            no menu principal.
                        </p>
                        <Button asChild variant="outline" className="mt-2">
                            <Link href="/dashboard">Voltar ao painel</Link>
                        </Button>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return <>{children}</>;
}
