"use client";

import { SessionGuard } from "@/components/dashboard/session-guard";
import { ConsentimentosPanel } from "@/components/dashboard/consentimentos-panel";

export default function ConsentimentosPage() {
    return (
        <SessionGuard>
            <ConsentimentosPanel />
        </SessionGuard>
    );
}
