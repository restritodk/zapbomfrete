import { auth } from "@/lib/auth";
import { BulletinTemplateManager } from "@/components/dashboard/bulletin-template-manager";
import { canManageBulletinTemplates } from "@/modules/datafy/campaigns/access";

export default async function BibliotecaTemplatesPage() {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role || "";
    const canManage = canManageBulletinTemplates(role);

    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <BulletinTemplateManager
                canManage={canManage}
                hasChannelToken
                showPageChrome
                showOrphans
            />
        </div>
    );
}
