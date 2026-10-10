"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Users,
    Plus,
    RefreshCw,
    Download,
    Megaphone,
    Copy,
    Phone,
    FileText,
    CheckCircle2,
} from "lucide-react";
import { SearchFilter } from "@/components/dashboard/search-filter";
import { useSession } from "@/components/dashboard/session-provider";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { ProviderUnavailablePanel } from "@/components/dashboard/provider-unavailable";
import { toast } from "sonner";
import {
    BROADCAST_IMPORT_KEY,
    extractPhonesFromParticipants,
} from "@/lib/phone-br";

interface Group {
    id: string;
    subject: string;
    jid: string;
    participants?: unknown[];
}

export default function GroupsPage() {
    const { sessionId, isDatafyChannel, selectedChannel } = useSession();
    const router = useRouter();

    const [groups, setGroups] = useState<Group[]>([]);
    const [loading, setLoading] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newGroupName, setNewGroupName] = useState("");
    const [searchTerm, setSearchTerm] = useState("");

    const [extractOpen, setExtractOpen] = useState(false);
    const [extractLoading, setExtractLoading] = useState(false);
    const [extractGroup, setExtractGroup] = useState<Group | null>(null);
    const [extractPhonesList, setExtractPhonesList] = useState<string[]>([]);
    const [actionBusy, setActionBusy] = useState<"copy" | "save" | "broadcast" | null>(null);

    const fetchGroups = async (sessId: string) => {
        setLoading(true);
        try {
            const res = await fetch(`/api/groups/${sessId}`);
            if (res.ok) {
                const data = await res.json();
                setGroups(data?.data || []);
            } else {
                setGroups([]);
            }
        } catch {
            toast.error("Falha ao buscar grupos");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (sessionId && !isDatafyChannel) {
            fetchGroups(sessionId);
        } else {
            setGroups([]);
        }
    }, [sessionId, isDatafyChannel]);

    const handleCreateGroup = async () => {
        if (!sessionId || !newGroupName) return;
        try {
            const res = await fetch(`/api/groups/${sessionId}/create`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sessionId, subject: newGroupName }),
            });
            if (res.ok) {
                toast.success("Grupo criado");
                setIsCreateOpen(false);
                setNewGroupName("");
                fetchGroups(sessionId);
            } else {
                toast.error("Falha ao criar grupo");
            }
        } catch {
            toast.error("Falha ao criar grupo");
        }
    };

    const extractPhones = async (group: Group): Promise<string[]> => {
        if (!sessionId) return [];

        let participants: unknown[] = [];
        try {
            const liveRes = await fetch(
                `/api/groups/${sessionId}/${encodeURIComponent(group.jid)}`
            );
            if (liveRes.ok) {
                const meta = await liveRes.json();
                participants = meta?.participants || [];
            }
        } catch {
            // fallback to DB participants
        }

        if (!participants.length) {
            participants = group.participants || [];
        }

        return extractPhonesFromParticipants(participants);
    };

    const openExtractModal = async (group: Group) => {
        setExtractGroup(group);
        setExtractPhonesList([]);
        setExtractOpen(true);
        setExtractLoading(true);
        try {
            const phones = await extractPhones(group);
            setExtractPhonesList(phones);
            if (phones.length === 0) {
                toast.error("Nenhum número de telefone encontrado neste grupo");
            }
        } catch {
            toast.error("Falha ao extrair números do grupo");
            setExtractOpen(false);
        } finally {
            setExtractLoading(false);
        }
    };

    const handleCopy = async () => {
        if (!extractPhonesList.length) return;
        setActionBusy("copy");
        try {
            await navigator.clipboard.writeText(extractPhonesList.join("\n"));
            toast.success(`${extractPhonesList.length} número(s) copiado(s)`);
        } catch {
            toast.error("Não foi possível copiar. Use Salvar arquivo.");
        } finally {
            setActionBusy(null);
        }
    };

    const handleSaveFile = () => {
        if (!extractPhonesList.length || !extractGroup) return;
        setActionBusy("save");
        try {
            const slug = (extractGroup.subject || "grupo")
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^\w\-]+/g, "_")
                .replace(/_+/g, "_")
                .slice(0, 40);
            const filename = `numeros_${slug || "grupo"}.txt`;
            // One number per line — compatible with Broadcast import (TXT/CSV)
            const blob = new Blob([extractPhonesList.join("\n") + "\n"], {
                type: "text/plain;charset=utf-8",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success(`Arquivo salvo: ${filename}`);
        } catch {
            toast.error("Falha ao salvar arquivo");
        } finally {
            setActionBusy(null);
        }
    };

    const handleUseInBroadcast = async () => {
        if (!extractPhonesList.length || !extractGroup) return;
        setActionBusy("broadcast");
        try {
            sessionStorage.setItem(
                BROADCAST_IMPORT_KEY,
                JSON.stringify({
                    phones: extractPhonesList,
                    groupJid: extractGroup.jid,
                    subject: extractGroup.subject,
                })
            );
            toast.success(`${extractPhonesList.length} número(s) prontos no Disparo`);
            setExtractOpen(false);
            router.push("/dashboard/broadcast");
        } catch {
            toast.error("Falha ao enviar números ao Disparo");
        } finally {
            setActionBusy(null);
        }
    };

    const filteredGroups = groups.filter(
        (g) =>
            (g.subject || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
            g.jid.includes(searchTerm)
    );

    const preview = extractPhonesList.slice(0, 8);

    if (isDatafyChannel) {
        return (
            <SessionGuard>
                <ProviderUnavailablePanel
                    feature="groups"
                    channelName={selectedChannel?.name}
                    displayPhoneNumber={selectedChannel?.displayPhoneNumber}
                />
            </SessionGuard>
        );
    }

    return (
        <SessionGuard>
            <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                    <div>
                        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                            <Users className="h-5 w-5 sm:h-6 sm:w-6" /> Grupos
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {sessionId
                                ? "Gerencie grupos e extraia números para disparo em massa."
                                : "Selecione uma sessão na barra superior."}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button
                            variant="outline"
                            size="sm"
                            className="flex-1 sm:flex-none"
                            onClick={() => sessionId && fetchGroups(sessionId)}
                            disabled={loading || !sessionId}
                        >
                            <RefreshCw className={`h-4 w-4 mr-1 sm:mr-2 ${loading ? "animate-spin" : ""}`} />
                            Atualizar
                        </Button>
                        <Button
                            size="sm"
                            className="flex-1 sm:flex-none"
                            onClick={() => setIsCreateOpen(true)}
                            disabled={!sessionId}
                        >
                            <Plus className="h-4 w-4 mr-1 sm:mr-2" /> Criar
                        </Button>
                    </div>
                </div>

                <SearchFilter placeholder="Buscar grupos..." onSearch={setSearchTerm} />

                {isCreateOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                        <div className="bg-white dark:bg-background p-4 sm:p-6 rounded-lg shadow-lg w-full max-w-sm">
                            <h2 className="text-lg sm:text-xl font-bold mb-4">Criar novo grupo</h2>
                            <div className="space-y-4">
                                <div>
                                    <Label>Nome do grupo</Label>
                                    <Input
                                        value={newGroupName}
                                        onChange={(e) => setNewGroupName(e.target.value)}
                                        placeholder="Meu novo grupo"
                                    />
                                </div>
                                <div className="flex justify-end gap-2">
                                    <Button variant="ghost" onClick={() => setIsCreateOpen(false)}>
                                        Cancelar
                                    </Button>
                                    <Button onClick={handleCreateGroup}>Criar</Button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {loading ? (
                    <div className="text-center p-8">Carregando grupos...</div>
                ) : filteredGroups.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground border rounded-lg bg-slate-50">
                        {sessionId ? "Nenhum grupo encontrado." : "Nenhuma sessão selecionada."}
                    </div>
                ) : (
                    <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                        {filteredGroups.map((group) => (
                            <div
                                key={group.id}
                                className="bg-white dark:bg-background p-4 rounded-lg shadow border flex flex-col gap-3"
                            >
                                <div>
                                    <h3 className="font-bold text-lg">{group.subject || "Sem nome"}</h3>
                                    <div className="text-xs text-muted-foreground mt-1 break-all">{group.jid}</div>
                                    <div className="text-xs text-slate-500 mt-1">
                                        Participantes:{" "}
                                        {Array.isArray(group.participants) ? group.participants.length : 0}
                                    </div>
                                </div>
                                <div className="flex flex-wrap gap-2 mt-auto">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={!sessionId}
                                        onClick={() => openExtractModal(group)}
                                    >
                                        <Phone className="h-3.5 w-3.5 mr-1" />
                                        Extrair números
                                    </Button>
                                    <Button
                                        size="sm"
                                        disabled={!sessionId}
                                        onClick={() => openExtractModal(group)}
                                    >
                                        <Megaphone className="h-3.5 w-3.5 mr-1" />
                                        Usar no Disparo
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                <Dialog open={extractOpen} onOpenChange={setExtractOpen}>
                    <DialogContent className="sm:max-w-lg p-0 overflow-hidden border-0 shadow-2xl">
                        <div className="relative bg-gradient-to-br from-emerald-600 via-teal-600 to-slate-900 px-6 pt-6 pb-8 text-white">
                            <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_top_right,_white,_transparent_55%)]" />
                            <DialogHeader className="relative space-y-2">
                                <DialogTitle className="text-xl font-semibold tracking-tight text-white">
                                    Extrair números do grupo
                                </DialogTitle>
                                <DialogDescription className="text-emerald-50/90">
                                    {extractGroup?.subject || "Grupo"} — escolha como deseja exportar os contatos.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="relative mt-5 flex items-end gap-3">
                                <div className="rounded-2xl bg-white/10 backdrop-blur px-4 py-3 border border-white/15">
                                    <div className="text-3xl font-bold leading-none">
                                        {extractLoading ? "…" : extractPhonesList.length}
                                    </div>
                                    <div className="text-xs mt-1 text-emerald-50/80">números válidos</div>
                                </div>
                                <div className="text-xs text-emerald-50/80 pb-1">
                                    DDI 55 aplicado automaticamente · formato pronto para importar no Disparo
                                </div>
                            </div>
                        </div>

                        <div className="px-6 py-5 space-y-4 bg-background">
                            {extractLoading ? (
                                <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground text-sm">
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                    Extraindo participantes...
                                </div>
                            ) : extractPhonesList.length === 0 ? (
                                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                                    Nenhum número de telefone encontrado. Participantes podem estar só com LID.
                                </div>
                            ) : (
                                <>
                                    <div className="rounded-xl border bg-muted/30 p-3 max-h-40 overflow-y-auto font-mono text-xs space-y-1">
                                        {preview.map((phone) => (
                                            <div key={phone} className="flex items-center gap-2">
                                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                                <span>{phone}</span>
                                            </div>
                                        ))}
                                        {extractPhonesList.length > preview.length && (
                                            <div className="text-muted-foreground pt-1">
                                                +{extractPhonesList.length - preview.length} outros...
                                            </div>
                                        )}
                                    </div>

                                    <div className="grid gap-2">
                                        <Button
                                            className="h-11 justify-start gap-3"
                                            variant="outline"
                                            disabled={!!actionBusy}
                                            onClick={handleCopy}
                                        >
                                            {actionBusy === "copy" ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Copy className="h-4 w-4 text-emerald-600" />
                                            )}
                                            <div className="text-left">
                                                <div className="font-medium">Copiar números</div>
                                                <div className="text-[11px] text-muted-foreground font-normal">
                                                    Cola na área de transferência (um por linha)
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            className="h-11 justify-start gap-3"
                                            variant="outline"
                                            disabled={!!actionBusy}
                                            onClick={handleSaveFile}
                                        >
                                            {actionBusy === "save" ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Download className="h-4 w-4 text-sky-600" />
                                            )}
                                            <div className="text-left">
                                                <div className="font-medium">Salvar arquivo TXT</div>
                                                <div className="text-[11px] text-muted-foreground font-normal">
                                                    Pronto para Importar TXT/CSV no Disparo
                                                </div>
                                            </div>
                                        </Button>

                                        <Button
                                            className="h-11 justify-start gap-3 bg-emerald-600 hover:bg-emerald-700 text-white"
                                            disabled={!!actionBusy}
                                            onClick={handleUseInBroadcast}
                                        >
                                            {actionBusy === "broadcast" ? (
                                                <RefreshCw className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <Megaphone className="h-4 w-4" />
                                            )}
                                            <div className="text-left">
                                                <div className="font-medium">Usar no Disparo</div>
                                                <div className="text-[11px] text-emerald-50/90 font-normal">
                                                    Abre o Disparo em massa já com a lista
                                                </div>
                                            </div>
                                        </Button>
                                    </div>

                                    <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                                        <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                        O arquivo TXT usa um número por linha (com 55), o mesmo formato aceito em
                                        Disparo → Importar TXT/CSV.
                                    </p>
                                </>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
