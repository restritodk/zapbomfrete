import { Suspense } from "react";
import { MetaApprovalsPanel } from "@/components/dashboard/meta-approvals-panel";
import { Skeleton } from "@/components/ui/skeleton";

export default function AprovacoesMetaPage() {
    return (
        <div className="p-4 sm:p-6 lg:p-8">
            <Suspense
                fallback={
                    <div className="space-y-4">
                        <Skeleton className="h-10 w-64" />
                        <Skeleton className="h-24 w-full" />
                        <Skeleton className="h-64 w-full" />
                    </div>
                }
            >
                <MetaApprovalsPanel />
            </Suspense>
        </div>
    );
}
