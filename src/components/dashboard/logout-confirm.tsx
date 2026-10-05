"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

type Step = "confirm" | "done";

interface LogoutConfirmProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function LogoutConfirm({ open, onOpenChange }: LogoutConfirmProps) {
    const [step, setStep] = useState<Step>("confirm");
    const [leaving, setLeaving] = useState(false);

    const handleClose = (next: boolean) => {
        if (leaving) return;
        onOpenChange(next);
        if (!next) {
            // reset after close animation
            setTimeout(() => setStep("confirm"), 200);
        }
    };

    const handleYes = () => {
        setStep("done");
        setLeaving(true);
        setTimeout(() => {
            signOut({ callbackUrl: "/auth/login" });
        }, 1100);
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden border-border/60 shadow-2xl gap-0">
                {step === "confirm" ? (
                    <>
                        <div className="relative px-6 pt-7 pb-5 text-center overflow-hidden">
                            <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-destructive/10 blur-3xl" />
                            <div className="pointer-events-none absolute -left-8 -bottom-8 h-28 w-28 rounded-full bg-primary/10 blur-3xl" />
                            <div className="relative mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive ring-1 ring-destructive/20">
                                <LogOut className="h-6 w-6" />
                            </div>
                            <DialogHeader className="space-y-2">
                                <DialogTitle className="text-xl font-bold tracking-tight text-center">
                                    Deseja sair?
                                </DialogTitle>
                                <DialogDescription className="text-center text-sm">
                                    Você será desconectado do painel. Poderá entrar novamente a qualquer momento.
                                </DialogDescription>
                            </DialogHeader>
                        </div>
                        <div className="grid grid-cols-2 gap-3 px-6 pb-6">
                            <Button
                                variant="outline"
                                className="h-11 rounded-xl active:scale-[0.98] transition-transform"
                                onClick={() => handleClose(false)}
                            >
                                Não
                            </Button>
                            <Button
                                className="h-11 rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.98] transition-transform"
                                onClick={handleYes}
                            >
                                Sim
                            </Button>
                        </div>
                    </>
                ) : (
                    <div className="relative px-6 py-10 text-center overflow-hidden">
                        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-emerald-500/[0.08] via-background to-primary/[0.06]" />
                        <div className="relative space-y-4">
                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 ring-1 ring-emerald-500/25 animate-in zoom-in-50 duration-300">
                                <CheckCircle2 className="h-8 w-8" />
                            </div>
                            <div className="space-y-1.5">
                                <h3 className="text-xl font-bold tracking-tight">Saída confirmada</h3>
                                <p className="text-sm text-muted-foreground">
                                    Encerrando sua sessão com segurança...
                                </p>
                            </div>
                            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Redirecionando
                            </div>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

interface LogoutButtonProps {
    collapsed?: boolean;
    className?: string;
    children?: React.ReactNode;
}

export function LogoutButton({ collapsed, className, children }: LogoutButtonProps) {
    const [open, setOpen] = useState(false);

    if (collapsed) {
        return (
            <>
                <button
                    type="button"
                    onClick={() => setOpen(true)}
                    className={className || "p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"}
                    title="Sair"
                >
                    <LogOut size={16} />
                </button>
                <LogoutConfirm open={open} onOpenChange={setOpen} />
            </>
        );
    }

    return (
        <>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className={
                    className ||
                    "w-full flex items-center justify-center gap-2 text-xs h-8 rounded-lg border-border/40 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                }
                onClick={() => setOpen(true)}
            >
                {children || (
                    <>
                        <LogOut size={14} /> Sair
                    </>
                )}
            </Button>
            <LogoutConfirm open={open} onOpenChange={setOpen} />
        </>
    );
}
