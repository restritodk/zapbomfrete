'use client';

import { Suspense } from 'react';
import { Loader2 } from "lucide-react";
import { LoginScreen } from "@/components/auth/login-screen";
import { DM_Sans } from "next/font/google";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className={`${dmSans.className} flex h-dvh min-h-dvh w-screen items-center justify-center bg-[#F8FBFF]`}>
        <Loader2 className="h-8 w-8 animate-spin text-[#0969E8]" />
      </div>
    }>
      <LoginScreen />
    </Suspense>
  );
}
