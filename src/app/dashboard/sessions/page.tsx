import { auth } from "@/lib/auth";
import { SessionManager } from "@/components/dashboard/session-manager";

export default async function SessionsPage() {
    const session = await auth();

    return <SessionManager user={session?.user} />;
}
