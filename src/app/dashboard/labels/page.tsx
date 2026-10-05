"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Tag, Loader2, Plus, Pencil, Trash2, ChevronDown, ChevronUp, X, Search, MessageSquare, UserCheck } from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { SessionGuard } from "@/components/dashboard/session-guard";
import { formatPhoneDisplay } from "@/lib/phone-br";

export const WAP_COLORS = [
    "#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF",
    "#4B0082", "#9400D3", "#FF1493", "#00CED1", "#32CD32",
    "#FFD700", "#FF69B4", "#8B4513", "#2F4F4F", "#696969",
    "#708090", "#778899", "#B0C4DE", "#ADD8E6", "#F0E68C"
];

interface LabelData {
    id: string;
    sessionId: string;
    name: string;
    color: number;
    colorHex: string;
    _count: {
        chatLabels: number;
    };
}

interface ChatLabelEntry {
    id: string;
    chatJid: string;
    labelId: string;
    contactName?: string;
}

interface Contact {
    id: string;
    jid: string;
    name?: string;
    notify?: string;
}

function displayContactId(value: string): string {
    return formatPhoneDisplay(value) || value.replace(/@s\.whatsapp\.net$/i, "").replace(/@g\.us$/i, " (Grupo)");
}

export default function LabelsPage() {
    const { sessionId } = useSession();
    const [labels, setLabels] = useState<LabelData[]>([]);
    const [loading, setLoading] = useState(false);

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [isEditOpen, setIsEditOpen] = useState(false);

    const [currentName, setCurrentName] = useState("");
    const [currentColor, setCurrentColor] = useState(0);
    const [currentLabelId, setCurrentLabelId] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const [expandedLabelId, setExpandedLabelId] = useState<string | null>(null);
    const [chatLabels, setChatLabels] = useState<ChatLabelEntry[]>([]);
    const [chatLabelsLoading, setChatLabelsLoading] = useState(false);

    const [isAssignOpen, setIsAssignOpen] = useState(false);
    const [assignLabelId, setAssignLabelId] = useState<string | null>(null);
    const [contactSearch, setContactSearch] = useState("");
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [contactsLoading, setContactsLoading] = useState(false);

    useEffect(() => {
        if (sessionId) {
            fetchLabels();
        }
    }, [sessionId]);

    const fetchLabels = async () => {
        if (!sessionId) return;
        setLoading(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}`);
            const data = await res.json();

            if (res.ok && data.data?.labels) {
                setLabels(data.data.labels);
            } else {
                toast.error(data.message || "Falha ao carregar etiquetas");
            }
        } catch (error) {
            console.error(error);
            toast.error("Erro ao buscar etiquetas");
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!sessionId) return;
        if (!currentName.trim()) {
            toast.error("O nome da etiqueta é obrigatório");
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: currentName.trim(), color: currentColor })
            });
            const data = await res.json();

            if (res.ok) {
                toast.success("Etiqueta criada com sucesso");
                setIsCreateOpen(false);
                resetForm();
                fetchLabels();
            } else {
                toast.error(data.message || "Falha ao criar etiqueta");
            }
        } catch (error) {
            console.error(error);
            toast.error("Erro ao criar etiqueta");
        } finally {
            setSubmitting(false);
        }
    };

    const handleEdit = async () => {
        if (!sessionId || !currentLabelId) return;
        if (!currentName.trim()) {
            toast.error("O nome da etiqueta é obrigatório");
            return;
        }

        setSubmitting(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}/${currentLabelId}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: currentName.trim(), color: currentColor })
            });
            const data = await res.json();

            if (res.ok) {
                toast.success("Etiqueta atualizada com sucesso");
                setIsEditOpen(false);
                resetForm();
                fetchLabels();
            } else {
                toast.error(data.message || "Falha ao atualizar etiqueta");
            }
        } catch (error) {
            console.error(error);
            toast.error("Erro ao atualizar etiqueta");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (labelId: string) => {
        if (!sessionId) return;
        try {
            const res = await fetch(`/api/labels/${sessionId}/${labelId}`, {
                method: "DELETE"
            });
            const data = await res.json();

            if (res.ok) {
                toast.success("Etiqueta excluída com sucesso");
                if (expandedLabelId === labelId) {
                    setExpandedLabelId(null);
                }
                fetchLabels();
            } else {
                toast.error(data.message || "Falha ao excluir etiqueta");
            }
        } catch (error) {
            console.error(error);
            toast.error("Erro ao excluir etiqueta");
        }
    };

    const resetForm = () => {
        setCurrentName("");
        setCurrentColor(0);
        setCurrentLabelId(null);
    };

    const openEditModal = (label: LabelData) => {
        setCurrentLabelId(label.id);
        setCurrentName(label.name);
        setCurrentColor(label.color);
        setIsEditOpen(true);
    };

    const openAssign = (labelId: string) => {
        setAssignLabelId(labelId);
        setContactSearch("");
        setContacts([]);
        setIsAssignOpen(true);
    };

    const toggleLabelExpand = async (labelId: string) => {
        if (expandedLabelId === labelId) {
            setExpandedLabelId(null);
            return;
        }
        setExpandedLabelId(labelId);
        await fetchChatLabels(labelId);
    };

    const fetchChatLabels = async (labelId: string) => {
        if (!sessionId) return;
        setChatLabelsLoading(true);
        try {
            const res = await fetch(`/api/labels/${sessionId}/chats?labelId=${labelId}`);
            const data = await res.json();
            if (res.ok) {
                setChatLabels(data.data || []);
            } else {
                setChatLabels([]);
            }
        } catch (error) {
            console.error(error);
            setChatLabels([]);
        } finally {
            setChatLabelsLoading(false);
        }
    };

    const searchContacts = useCallback(async (query: string) => {
        if (!sessionId || !query.trim()) {
            setContacts([]);
            return;
        }
        setContactsLoading(true);
        try {
            const res = await fetch(`/api/contacts/${sessionId}?search=${encodeURIComponent(query)}&limit=20`);
            const data = await res.json();
            if (res.ok) {
                setContacts(data.data || []);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setContactsLoading(false);
        }
    }, [sessionId]);

    useEffect(() => {
        const timer = setTimeout(() => {
            searchContacts(contactSearch);
        }, 300);
        return () => clearTimeout(timer);
    }, [contactSearch, searchContacts]);

    const assignChatToLabel = async (jid: string) => {
        if (!sessionId || !assignLabelId) return;
        try {
            const res = await fetch(`/api/labels/${sessionId}/chat/${encodeURIComponent(jid)}/labels`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ labelIds: [assignLabelId], action: "add" })
            });

            if (res.ok) {
                toast.success("Chat atribuído à etiqueta");
                fetchLabels();
                if (expandedLabelId === assignLabelId) {
                    fetchChatLabels(assignLabelId);
                }
            } else {
                const data = await res.json();
                toast.error(data.message || "Falha ao atribuir etiqueta");
            }
        } catch (error) {
            toast.error("Erro ao atribuir etiqueta");
        }
    };

    const removeChatFromLabel = async (labelId: string, jid: string) => {
        if (!sessionId) return;
        try {
            const res = await fetch(`/api/labels/${sessionId}/chat/${encodeURIComponent(jid)}/labels`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ labelIds: [labelId], action: "remove" })
            });

            if (res.ok) {
                toast.success("Chat removido da etiqueta");
                fetchLabels();
                if (expandedLabelId === labelId) {
                    fetchChatLabels(labelId);
                }
            } else {
                toast.error("Falha ao remover etiqueta");
            }
        } catch (error) {
            toast.error("Erro ao remover etiqueta");
        }
    };

    const ColorPicker = () => (
        <div className="space-y-2">
            <Label>Cor</Label>
            <div className="grid grid-cols-10 gap-1.5 mt-2">
                {WAP_COLORS.map((hex, index) => (
                    <button
                        type="button"
                        key={index}
                        onClick={() => setCurrentColor(index)}
                        className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full cursor-pointer transition-transform duration-150 ease-out border-2 active:scale-95 ${currentColor === index ? "border-foreground scale-110 ring-2 ring-foreground/20" : "border-transparent hover:scale-105"}`}
                        style={{ backgroundColor: hex }}
                        aria-label={`Cor ${index + 1}`}
                    />
                ))}
            </div>
        </div>
    );

    const canAssignDirect =
        contactSearch.trim().length >= 8 &&
        (/^\+?\d[\d\s\-()]+$/.test(contactSearch.trim()) || contactSearch.includes("@"));

    return (
        <SessionGuard>
            <div className="w-full space-y-6">
                <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary/[0.06] via-background to-emerald-500/[0.04] px-5 py-6 sm:px-8 sm:py-8">
                    <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/10 blur-3xl" />
                    <div className="pointer-events-none absolute -bottom-20 -left-10 h-40 w-40 rounded-full bg-emerald-400/10 blur-3xl" />
                    <div className="relative flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div className="space-y-1.5">
                            <div className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary/80">
                                <Tag className="h-3.5 w-3.5" />
                                Organização
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Etiquetas de chat</h1>
                            <p className="text-sm text-muted-foreground max-w-xl">
                                Organize conversas com etiquetas coloridas. Clique em uma etiqueta para ver e gerenciar os chats atribuídos.
                            </p>
                        </div>

                        <Dialog open={isCreateOpen} onOpenChange={(open) => {
                            setIsCreateOpen(open);
                            if (!open) resetForm();
                        }}>
                            <DialogTrigger asChild>
                                <Button size="lg" className="shrink-0 shadow-sm active:scale-[0.98] transition-transform">
                                    <Plus className="w-4 h-4 mr-2" />
                                    Nova etiqueta
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Criar nova etiqueta</DialogTitle>
                                    <DialogDescription>Adicione uma nova etiqueta colorida para organizar chats.</DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label>Nome da etiqueta</Label>
                                        <Input
                                            value={currentName}
                                            onChange={(e) => setCurrentName(e.target.value)}
                                            placeholder="ex.: Cliente VIP"
                                        />
                                    </div>
                                    <ColorPicker />
                                </div>
                                <DialogFooter>
                                    <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancelar</Button>
                                    <Button onClick={handleCreate} disabled={submitting || !currentName.trim()}>
                                        {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                        Criar etiqueta
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center p-16">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : labels.length === 0 ? (
                    <div className="w-full rounded-2xl border border-dashed bg-muted/20 px-6 py-16 sm:py-20 text-center">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 mb-5">
                            <Tag className="w-8 h-8 text-primary/70" />
                        </div>
                        <h3 className="text-lg font-semibold">Nenhuma etiqueta encontrada</h3>
                        <p className="text-muted-foreground mt-1 mb-6 max-w-md mx-auto">
                            Você ainda não criou nenhuma etiqueta de chat. Crie a primeira para organizar suas conversas.
                        </p>
                        <Button onClick={() => setIsCreateOpen(true)}>
                            <Plus className="w-4 h-4 mr-2" />
                            Criar sua primeira etiqueta
                        </Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {labels.map((label) => {
                            const isExpanded = expandedLabelId === label.id;
                            return (
                                <div
                                    key={label.id}
                                    className={`group relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-shadow duration-200 ease-out hover:shadow-md ${isExpanded ? "md:col-span-2 xl:col-span-3 shadow-md" : ""}`}
                                >
                                    <div className="h-1.5 w-full" style={{ backgroundColor: label.colorHex }} />
                                    <div className="p-4 sm:p-5 flex flex-col gap-3 flex-1">
                                        <div className="flex items-start justify-between gap-3">
                                            <button
                                                type="button"
                                                className="flex items-start gap-3 flex-1 min-w-0 text-left"
                                                onClick={() => toggleLabelExpand(label.id)}
                                            >
                                                <div
                                                    className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                                                    style={{ backgroundColor: `${label.colorHex}22` }}
                                                >
                                                    <Tag className="w-4.5 h-4.5" style={{ color: label.colorHex }} />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-semibold text-base truncate">{label.name}</span>
                                                        <Badge
                                                            variant="secondary"
                                                            className="font-normal text-[11px] shrink-0"
                                                            style={{
                                                                backgroundColor: `${label.colorHex}18`,
                                                                color: label.colorHex,
                                                                borderColor: `${label.colorHex}33`,
                                                            }}
                                                        >
                                                            {label._count.chatLabels} chat{label._count.chatLabels !== 1 ? "s" : ""}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-xs text-muted-foreground mt-1">
                                                        {isExpanded ? "Ocultar chats" : "Ver chats atribuídos"}
                                                    </p>
                                                </div>
                                                {isExpanded
                                                    ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                                                    : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                                                }
                                            </button>
                                        </div>

                                        <div className="flex items-center gap-1 pt-1 border-t border-border/60">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-8 px-2 text-primary hover:text-primary hover:bg-primary/10"
                                                onClick={() => openAssign(label.id)}
                                            >
                                                <UserCheck className="w-3.5 h-3.5 mr-1" />
                                                <span className="text-xs">Atribuir</span>
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                onClick={() => openEditModal(label)}
                                            >
                                                <Pencil className="w-3.5 h-3.5" />
                                            </Button>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Excluir etiqueta?</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Isso excluirá permanentemente a etiqueta <strong>{label.name}</strong> e a removerá de todos os chats atribuídos.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleDelete(label.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                                            Excluir
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </div>

                                        {isExpanded && (
                                            <div className="pt-2 space-y-2">
                                                {chatLabelsLoading ? (
                                                    <div className="flex items-center justify-center py-6">
                                                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                                        <span className="ml-2 text-sm text-muted-foreground">Carregando chats...</span>
                                                    </div>
                                                ) : chatLabels.length === 0 ? (
                                                    <div className="rounded-xl bg-muted/40 px-4 py-8 text-center">
                                                        <MessageSquare className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                                                        <p className="text-sm text-muted-foreground">Nenhum chat atribuído a esta etiqueta ainda.</p>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="mt-3"
                                                            onClick={() => openAssign(label.id)}
                                                        >
                                                            <UserCheck className="w-3.5 h-3.5 mr-1.5" /> Atribuir um chat
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                                        {chatLabels.map((cl) => {
                                                            const phone = displayContactId(cl.chatJid);
                                                            return (
                                                                <div
                                                                    key={cl.id}
                                                                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors"
                                                                >
                                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                                        <div
                                                                            className="h-8 w-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                                                                            style={{
                                                                                backgroundColor: `${label.colorHex}22`,
                                                                                color: label.colorHex,
                                                                            }}
                                                                        >
                                                                            {(cl.contactName || phone).charAt(0).toUpperCase()}
                                                                        </div>
                                                                        <div className="min-w-0">
                                                                            <p className="text-sm font-medium truncate">
                                                                                {cl.contactName || phone}
                                                                            </p>
                                                                            {cl.contactName && (
                                                                                <p className="text-[11px] text-muted-foreground truncate">
                                                                                    {phone}
                                                                                </p>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="icon"
                                                                        className="h-7 w-7 text-destructive/70 hover:text-destructive hover:bg-destructive/10 shrink-0"
                                                                        onClick={() => removeChatFromLabel(label.id, cl.chatJid)}
                                                                        title="Remover da etiqueta"
                                                                    >
                                                                        <X className="w-3.5 h-3.5" />
                                                                    </Button>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                <Dialog open={isEditOpen} onOpenChange={(open) => {
                    setIsEditOpen(open);
                    if (!open) resetForm();
                }}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Editar etiqueta</DialogTitle>
                            <DialogDescription>Atualize o nome ou a cor da etiqueta.</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label>Nome da etiqueta</Label>
                                <Input
                                    value={currentName}
                                    onChange={(e) => setCurrentName(e.target.value)}
                                    placeholder="ex.: Cliente VIP"
                                />
                            </div>
                            <ColorPicker />
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
                            <Button onClick={handleEdit} disabled={submitting || !currentName.trim()}>
                                {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                Salvar alterações
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

                <Dialog open={isAssignOpen} onOpenChange={(open) => {
                    setIsAssignOpen(open);
                    if (!open) {
                        setAssignLabelId(null);
                        setContactSearch("");
                        setContacts([]);
                    }
                }}>
                    <DialogContent className="max-w-md">
                        <DialogHeader>
                            <DialogTitle>Atribuir chat à etiqueta</DialogTitle>
                            <DialogDescription>
                                Busque um contato ou digite o número de contato para atribuir a esta etiqueta.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                            <div className="relative">
                                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar ou digitar número de contato..."
                                    className="pl-9"
                                    value={contactSearch}
                                    onChange={(e) => setContactSearch(e.target.value)}
                                    autoFocus
                                />
                            </div>

                            <div className="max-h-[300px] overflow-y-auto space-y-1">
                                {contactsLoading ? (
                                    <div className="flex items-center justify-center py-6">
                                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                    </div>
                                ) : contacts.length > 0 ? (
                                    contacts.map((c) => (
                                        <button
                                            key={c.id}
                                            type="button"
                                            className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors text-left active:scale-[0.99]"
                                            onClick={() => {
                                                assignChatToLabel(c.jid);
                                            }}
                                        >
                                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                                                {(c.name || c.notify || c.jid).charAt(0).toUpperCase()}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium truncate">{c.name || c.notify || "Desconhecido"}</p>
                                                <p className="text-[11px] text-muted-foreground truncate">{displayContactId(c.jid)}</p>
                                            </div>
                                            <Badge variant="outline" className="text-[10px] shrink-0">Atribuir</Badge>
                                        </button>
                                    ))
                                ) : contactSearch.trim() ? (
                                    <div className="text-center py-6 space-y-3">
                                        <p className="text-sm text-muted-foreground">Nenhum contato encontrado</p>
                                        {canAssignDirect && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => assignChatToLabel(contactSearch.trim())}
                                            >
                                                Atribuir &quot;{displayContactId(contactSearch.trim())}&quot; diretamente
                                            </Button>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-sm text-muted-foreground text-center py-6">
                                        Digite para buscar contatos...
                                    </p>
                                )}
                            </div>
                        </div>
                    </DialogContent>
                </Dialog>
            </div>
        </SessionGuard>
    );
}
