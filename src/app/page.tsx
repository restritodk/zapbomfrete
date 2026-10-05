import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

/**
 * Root `/` never renders a public landing page.
 * Auth check uses existing NextAuth (`auth()`); redirects are server-side.
 */
export default async function Home() {
  const session = await auth();

  if (session?.user) {
    redirect("/dashboard");
  }

  redirect("/auth/login");
}
