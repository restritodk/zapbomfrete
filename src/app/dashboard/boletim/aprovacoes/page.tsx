import { Suspense } from "react";
import { MetaApprovalsPanel } from "@/components/dashboard/meta-approvals-panel";
import { Skeleton } from "@/components/ui/skeleton";

export default function AprovacoesMetaPage() {
    return (
        <Suspense
            fallback={
                <div className="space-y-4">
                    <Skeleton className="h-12 w-72" />
                    <Skeleton className="h-24 w-full" />
                    <Skeleton className="h-64 w-full" />
                </div>
            }
        >
            <MetaApprovalsPanel />
        </Suspense>
    );
}
