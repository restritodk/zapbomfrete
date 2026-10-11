import { prisma } from "@/lib/prisma";

/**
 * Typed accessor for Phase 9 models/fields.
 * Casts Prisma client so local builds work even if `prisma generate`
 * is briefly blocked by a locked query engine DLL on Windows.
 */
export function consentDb() {
    return prisma as unknown as {
        crmContact: typeof prisma.crmContact;
        crmConsentDecision: {
            findUnique: (args: unknown) => Promise<{
                id: string;
                crmContactId: string | null;
                resultingStatus: string;
            } | null>;
            findMany: (args: unknown) => Promise<
                Array<{
                    id: string;
                    decision: string;
                    resultingStatus: string;
                    source: string;
                    evidenceText: string | null;
                    buttonTitle: string | null;
                    relatedMessageId: string | null;
                    templateName: string | null;
                    wabaId: string;
                    decidedAt: Date;
                    appliedToContact: boolean;
                }>
            >;
            create: (args: unknown) => Promise<{ id: string }>;
        };
        user: typeof prisma.user;
        notification: typeof prisma.notification;
    };
}
