"use client";

import { useState, useSyncExternalStore } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { DM_Sans } from "next/font/google";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const formSchema = z.object({
  email: z.string().email("Informe um e-mail válido"),
  password: z.string().min(1, "A senha é obrigatória"),
});

/**
 * Left panel organic curve (objectBoundingBox 0–1).
 * Top/mid unchanged; lower third nudged right (~46.5% at bottom).
 */
const LEFT_PANEL_PATH_BOX =
  "M0,0 H0.465 C0.518,0.05 0.568,0.175 0.542,0.36 C0.528,0.54 0.522,0.80 0.475,1 H0 Z";

function subscribeDesktop(cb: () => void) {
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function useIsDesktop() {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia("(min-width: 768px)").matches,
    () => true
  );
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

const benefits = [
  {
    title: "WhatsApp",
    description: "Conexões estáveis\ne seguras",
    Icon: WhatsAppIcon,
    iconClass: "text-[#25D366]",
  },
  {
    title: "Ambiente protegido",
    description: "Seus dados sempre\nem segurança",
    Icon: ShieldCheck,
    iconClass: "text-[#5BA8FF]",
  },
  {
    title: "Mais controle",
    description: "Gestão completa\ndas suas operações",
    Icon: BarChart3,
    iconClass: "text-[#7EC8FF]",
  },
] as const;

function LoginCard({
  form,
  error,
  loading,
  showPassword,
  setShowPassword,
  onSubmit,
  className = "",
}: {
  form: ReturnType<typeof useForm<z.infer<typeof formSchema>>>;
  error: string | null;
  loading: boolean;
  showPassword: boolean;
  setShowPassword: (v: boolean | ((p: boolean) => boolean)) => void;
  onSubmit: (values: z.infer<typeof formSchema>) => void;
  className?: string;
}) {
  return (
    <div
      className={`rounded-[26px] border border-[#E4EEF8] bg-white shadow-[0_34px_90px_-30px_rgba(15,39,68,0.32)] ${className}`}
    >
      <div className="mb-7 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/media/logo-transparent.png"
          alt="Bom Frete Logística e Transportes"
          className="mx-auto mb-6 h-auto w-[clamp(110px,22vw,150px)] max-w-[55%] object-contain"
        />
        <h2 className="text-[clamp(1.5rem,2vw,1.85rem)] font-bold tracking-tight text-[#061C3C]">
          Acesse sua conta
        </h2>
        <p className="mt-1.5 text-[clamp(0.9rem,1vw,1rem)] text-[#6B829C]">
          Use suas credenciais corporativas para continuar.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-xl border border-red-200/80 bg-red-50 px-3.5 py-3 text-sm text-red-700"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-[#173553]">E-mail</FormLabel>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8AA0B8]" />
                  <FormControl>
                    <input
                      {...field}
                      type="email"
                      autoComplete="email"
                      placeholder="nome@empresa.com"
                      className="h-[58px] w-full rounded-[14px] border border-[#D7E3F0] bg-white pl-12 pr-4 text-[15px] text-[#0B1F3A] shadow-[0_1px_2px_rgba(15,39,68,0.04)] outline-none transition-all duration-200 placeholder:text-[#9AADC2] focus:border-[#1269D3] focus:ring-[3px] focus:ring-[#1269D3]/15"
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-sm font-medium text-[#173553]">Senha</FormLabel>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#8AA0B8]" />
                  <FormControl>
                    <input
                      {...field}
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className="h-[58px] w-full rounded-[14px] border border-[#D7E3F0] bg-white pl-12 pr-12 text-[15px] text-[#0B1F3A] shadow-[0_1px_2px_rgba(15,39,68,0.04)] outline-none transition-all duration-200 placeholder:text-[#9AADC2] focus:border-[#1269D3] focus:ring-[3px] focus:ring-[#1269D3]/15"
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-[#7A90A8] transition-colors duration-150 hover:bg-[#F1F6FC] hover:text-[#173553] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1269D3]/35"
                    aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <button
            type="submit"
            disabled={loading}
            className="group mt-1 flex h-[62px] w-full cursor-pointer items-center justify-center gap-2 rounded-[14px] bg-gradient-to-r from-[#0969E8] to-[#064ACB] text-base font-bold text-white shadow-[0_16px_34px_-14px_rgba(9,105,232,0.75)] transition-all duration-200 hover:-translate-y-px hover:brightness-105 hover:shadow-[0_20px_40px_-14px_rgba(9,105,232,0.85)] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-80 disabled:hover:translate-y-0 disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0969E8]/35"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Entrando...
              </>
            ) : (
              <>
                Entrar
                <ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>
      </Form>
    </div>
  );
}

export function LoginScreen() {
  const searchParams = useSearchParams();
  const isDesktop = useIsDesktop();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    setError(null);
    try {
      const result = await signIn("credentials", {
        redirect: false,
        email: values.email,
        password: values.password,
      });

      if (result?.error) {
        setError("E-mail ou senha incorretos.");
      } else {
        // Full navigation only — avoid router.refresh() racing with location change
        window.location.assign(callbackUrl);
        return;
      }
    } catch {
      setError("Ocorreu um erro inesperado");
    } finally {
      setLoading(false);
    }
  }

  const cardProps = {
    form,
    error,
    loading,
    showPassword,
    setShowPassword,
    onSubmit,
  };

  return (
    <div
      className={`${dmSans.className} relative h-dvh min-h-dvh w-screen overflow-x-hidden overflow-y-auto bg-[#F7FAFE] text-[#0B1F3A] md:overflow-hidden`}
    >
      {/* ===== DESKTOP ===== */}
      {isDesktop && <div className="relative h-dvh w-full">
        {/* Clip defs — objectBoundingBox scales with any viewport */}
        <svg width="0" height="0" className="absolute" aria-hidden>
          <defs>
            <clipPath id="bf-panel-clip" clipPathUnits="objectBoundingBox">
              <path d={LEFT_PANEL_PATH_BOX} />
            </clipPath>
          </defs>
        </svg>

        {/* Soft right atmosphere — organic, almost imperceptible */}
        <div className="pointer-events-none absolute inset-0 z-0" aria-hidden>
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1920 1080" preserveAspectRatio="none">
            <path
              d="M1120 -40 C1380 180 1580 420 1920 280 C1680 520 1480 760 1920 980 C1520 920 1280 780 1180 1080"
              fill="#EAF3FC"
              opacity="0.55"
            />
            <path
              d="M1240 60 C1500 200 1700 360 1960 220"
              stroke="#D3E6F8"
              strokeWidth="1.2"
              fill="none"
              opacity="0.45"
            />
            <path
              d="M1300 940 C1560 820 1760 900 1960 860"
              stroke="#D8ECFA"
              strokeWidth="1.1"
              fill="none"
              opacity="0.4"
            />
          </svg>
        </div>

        {/* LEFT panel: navy + photo share ONE Bézier clip */}
        <div
          className="pointer-events-none absolute inset-0 z-[1]"
          style={{ clipPath: "url(#bf-panel-clip)" }}
          aria-hidden
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(165deg, #0A3D82 0%, #082B5C 42%, #061C3C 100%)",
            }}
          />

          {/* Aspect closer to photo (~3:2) so cover zooms out */}
          <div className="absolute bottom-0 left-0 h-[60%] w-[52%] overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/media/imagem-login.jpg"
              alt=""
              className="h-full w-full object-cover object-[30%_40%]"
            />
            {/* Soft navy veil — keep seamless blue → photo fusion */}
            <div
              className="absolute inset-0"
              style={{
                background: `
                  linear-gradient(
                    to bottom,
                    #082B5C 0%,
                    rgba(8,43,92,0.96) 4%,
                    rgba(7,51,106,0.88) 12%,
                    rgba(7,51,106,0.62) 22%,
                    rgba(7,51,106,0.32) 34%,
                    rgba(7,51,106,0.12) 46%,
                    rgba(7,51,106,0.03) 56%,
                    transparent 66%
                  ),
                  linear-gradient(
                    to right,
                    rgba(3,25,58,0.22) 0%,
                    transparent 40%,
                    rgba(8,43,92,0.26) 100%
                  ),
                  linear-gradient(
                    to top,
                    rgba(4,24,55,0.30) 0%,
                    transparent 32%
                  )
                `,
              }}
            />
          </div>
        </div>

        {/* LEFT content column — cohesive inner block, not full panel width */}
        <aside className="absolute inset-y-0 left-0 z-[3] w-[min(53vw,1040px)] pointer-events-none">
          <div
            className="pointer-events-auto flex h-full flex-col pt-[clamp(2rem,4.2vh,3.25rem)] pb-[1.75rem]"
            style={{
              width: "min(720px, calc(100% - 100px))",
              marginLeft: "clamp(2.75rem, 8vw, 10.5rem)",
            }}
          >
            <div className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/media/logo-principal.png"
                alt="ZapPro"
                className="h-auto w-[clamp(130px,14vw,170px)] max-w-full object-contain drop-shadow-[0_10px_28px_rgba(0,0,0,0.4)]"
              />
            </div>

            <div className="mt-[clamp(1rem,2.8vh,2.1rem)] max-w-[36rem] shrink-0">
              <div className="mb-3.5 h-[3px] w-14 rounded-full bg-gradient-to-r from-[#2E9B4A] via-[#1FA0A0] to-[#1269D3]" />
              <h1 className="whitespace-nowrap text-[clamp(2.2rem,3.05vw,3.55rem)] font-extrabold leading-[1.05] tracking-tight text-white">
                Bem-vindo
              </h1>
              <p className="mt-[clamp(0.55rem,1.15vh,0.9rem)] max-w-[27rem] text-[clamp(0.9rem,1.1vw,1.05rem)] leading-relaxed text-white/78">
                Centralize suas conexões e operações do WhatsApp em um ambiente seguro, organizado e profissional.
              </p>
            </div>

            {/* Benefits — titles stay on one line on desktop */}
            <div className="mt-[clamp(1.35rem,3.4vh,2.35rem)] grid max-w-[36rem] shrink-0 grid-cols-[0.9fr_1.25fr_1fr]">
              {benefits.map((item, index) => (
                <div
                  key={item.title}
                  className={`flex flex-col items-start px-[clamp(0.5rem,1vw,1rem)] first:pl-0 last:pr-0 ${
                    index > 0 ? "border-l border-white/20" : ""
                  }`}
                >
                  <div className="mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl border border-white/20 bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-md">
                    <item.Icon className={`h-5 w-5 ${item.iconClass}`} />
                  </div>
                  <p className="whitespace-nowrap text-[clamp(0.8rem,0.95vw,0.93rem)] font-semibold text-white">
                    {item.title}
                  </p>
                  <p className="mt-1 whitespace-pre-line text-[clamp(0.68rem,0.85vw,0.82rem)] leading-snug text-white/60">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>

            <div className="min-h-0 flex-1" aria-hidden />

            <p
              className="shrink-0 text-[12px] leading-relaxed text-white/65"
              style={{ textShadow: "0 1px 3px rgba(0,0,0,0.55)" }}
            >
              v1.0.0 | Bom Frete Transportes © 2026. Todos os direitos reservados.
            </p>
          </div>
        </aside>

        {/* RIGHT: card close to the curve (~55–58%) */}
        <main
          className="absolute inset-y-0 z-[4] flex items-center justify-start pr-[clamp(1rem,2.5vw,2.5rem)]"
          style={{
            left: "clamp(54%, 56vw, 58.5%)",
            right: 0,
          }}
        >
          <div className="absolute bottom-8 right-8 hidden items-center gap-1.5 text-[11px] text-[#7A90A8] lg:flex">
            <ShieldCheck className="h-3.5 w-3.5 text-[#2E9B4A]" />
            <span>Ambiente protegido • Sessão criptografada</span>
          </div>

          <div
            className="-translate-y-[clamp(0px,1.8vh,16px)] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500"
            style={{ width: "min(560px, calc(100vw - 56vw - 3rem))" }}
          >
            <LoginCard {...cardProps} className="p-[clamp(2rem,3vw,3.75rem)]" />
          </div>
        </main>
      </div>}

      {/* ===== MOBILE ===== */}
      {!isDesktop && (
      <div className="relative">
        <div className="relative overflow-hidden bg-gradient-to-b from-[#0A3D82] via-[#082B5C] to-[#061C3C] px-5 pt-7 pb-28">
          <div className="relative z-10 space-y-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/media/logo-principal.png"
              alt="ZapPro"
              className="h-auto w-[clamp(120px,40vw,160px)] max-w-full object-contain"
            />
            <div>
              <div className="mb-3 h-[3px] w-12 rounded-full bg-gradient-to-r from-[#2E9B4A] to-[#1269D3]" />
              <h1 className="text-[clamp(1.75rem,7vw,2.15rem)] font-extrabold leading-tight tracking-tight text-white">
                Bem-vindo
              </h1>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/75">
                Centralize suas conexões e operações do WhatsApp em um ambiente seguro, organizado e profissional.
              </p>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/media/imagem-login.jpg"
              alt=""
              className="h-full w-full object-cover object-[22%_52%]"
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(to bottom, #07336a 0%, rgba(7,51,106,0.92) 14%, rgba(7,51,106,0.35) 48%, rgba(4,24,55,0.4) 100%)",
              }}
            />
          </div>
        </div>

        <div className="px-4 py-6">
          <LoginCard {...cardProps} className="p-6" />
          <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-[#7A90A8]">
            <ShieldCheck className="h-3.5 w-3.5 text-[#2E9B4A]" />
            <span>Ambiente protegido • Sessão criptografada</span>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
