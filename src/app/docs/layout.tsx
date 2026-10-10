"use client";

import { SuperadminGate } from "@/components/auth/superadmin-gate";

export default function DocsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <SuperadminGate title="Docs da API — acesso restrito">
            {children}
        </SuperadminGate>
    );
}
