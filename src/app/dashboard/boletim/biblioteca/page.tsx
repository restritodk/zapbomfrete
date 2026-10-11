import Link from "next/link";
import { auth } from "@/lib/auth";
import { BulletinTemplateManager } from "@/components/dashboard/bulletin-template-manager";
import { Button } from "@/components/ui/button";
import { Library, ShieldCheck } from "lucide-react";
import { canManageBulletinTemplates } from "@/modules/datafy/campaigns/access";

export default async function BibliotecaTemplatesPage() {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role || "";
    const canManage = canManageBulletinTemplates(role);

    return (
        <div className="p-4 sm:p-6 lg:p-8 mx-auto w-full max-w-[1400px] space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight flex items-center gap-2">
                        <Library className="h-7 w-7 text-primary" />
                        Biblioteca de templates
                    </h1>
                    <p className="mt-1.5 text-sm text-muted-foreground max-w-2xl">
                        Modelos reutilizáveis mapeados para o Criador de Boletins
                        e o Disparo em massa. Templates oficiais sem mapeamento
                        ficam em Aprovações Meta até serem importados.
                    </p>
                </div>
                <Button variant="outline" size="sm" asChild>
                    <Link href="/dashboard/boletim/aprovacoes">
                        <ShieldCheck className="h-4 w-4 mr-1.5" />
                        Aprovações Meta
                    </Link>
                </Button>
            </div>
            <BulletinTemplateManager
                canManage={canManage}
                hasChannelToken
            />
        </div>
    );
}
