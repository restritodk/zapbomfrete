"use client";

/**
 * Agenda Baileys — preserved from the original Contatos page.
 * Do not redesign import flows here (Disparo keeps TXT/CSV import).
 */

import { useState, useEffect } from "react";
import { useSession } from "@/components/dashboard/session-provider";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
} from "@/components/ui/pagination";
import { Search, Loader2, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatPhoneDisplay } from "@/lib/phone-br";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface Contact {
    id: string;
    jid: string;
    name?: string;
    notify?: string;
    verifiedName?: string;
    profilePic?: string;
    remoteJidAlt?: string;
}

export function BaileysContactsPanel() {
    const { sessionId, isDatafyChannel } = useSession();
    const [contacts, setContacts] = useState<Contact[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState("10");
    const [meta, setMeta] = useState({ total: 0, totalPages: 1 });

    useEffect(() => {
        const timer = setTimeout(() => {
            setPage(1);
            fetchContacts();
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search]);

    useEffect(() => {
        fetchContacts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, sessionId, limit]);

    const fetchContacts = async () => {
        if (!sessionId || isDatafyChannel) return;
        setLoading(true);
        try {
            const params = new URLSearchParams({
                page: page.toString(),
                limit: limit,
                search: search,
            });
            const res = await fetch(`/api/contacts/${sessionId}?${params}`);
            const data = await res.json();
            if (res.ok) {
                setContacts(data.data);
                setMeta(data.meta);
            } else {
                setContacts([]);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    if (isDatafyChannel) {
        return (
            <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                    A agenda Baileys exige uma sessão WhatsApp (QR) selecionada.
                    Use a aba CRM Bom Frete para o diretório oficial.
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                        <div className="space-y-1">
                            <CardTitle>Lista de contatos</CardTitle>
                            <CardDescription>
                                Total: {meta.total} contatos encontrados
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 w-full md:w-auto">
                            <Select
                                value={limit}
                                onValueChange={(val) => {
                                    setLimit(val);
                                    setPage(1);
                                }}
                            >
                                <SelectTrigger className="w-[120px]">
                                    <SelectValue placeholder="Por página" />
                                </SelectTrigger>
                                <SelectContent>
                                    {[10, 25, 50, 100].map((l) => (
                                        <SelectItem key={l} value={l.toString()}>
                                            {l} / página
                                        </SelectItem>
                                    ))}
                                    <SelectItem value="all">Mostrar todos</SelectItem>
                                </SelectContent>
                            </Select>
                            <div className="relative w-full md:w-64">
                                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Buscar contatos..."
                                    className="pl-8"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[80px]">Imagem</TableHead>
                                    <TableHead>Nome / Pushname</TableHead>
                                    <TableHead className="hidden md:table-cell">
                                        Número de contato
                                    </TableHead>
                                    <TableHead className="hidden md:table-cell">
                                        Telefone / Alt
                                    </TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-24 text-center">
                                            <div className="flex justify-center items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                                Carregando...
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : contacts.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-24 text-center">
                                            Nenhum contato encontrado.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    contacts.map((contact) => (
                                        <TableRow key={contact.id}>
                                            <TableCell>
                                                <Avatar>
                                                    <AvatarImage
                                                        src={contact.profilePic || ""}
                                                    />
                                                    <AvatarFallback>
                                                        <User className="h-4 w-4" />
                                                    </AvatarFallback>
                                                </Avatar>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium">
                                                        {contact.name ||
                                                            contact.notify ||
                                                            "Desconhecido"}
                                                    </span>
                                                    {contact.verifiedName && (
                                                        <span className="text-xs text-green-600 flex items-center gap-1">
                                                            ✓ {contact.verifiedName}
                                                        </span>
                                                    )}
                                                </div>
                                            </TableCell>
                                            <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                                                {formatPhoneDisplay(contact.jid) ||
                                                    contact.jid.replace(
                                                        /@s\.whatsapp\.net$/i,
                                                        ""
                                                    )}
                                            </TableCell>
                                            <TableCell className="hidden md:table-cell text-sm">
                                                {contact.remoteJidAlt || "-"}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {meta.totalPages > 1 && (
                        <div className="mt-4">
                            <Pagination>
                                <PaginationContent>
                                    <PaginationItem>
                                        <Button
                                            variant="ghost"
                                            disabled={page <= 1}
                                            onClick={() =>
                                                setPage((p) => Math.max(1, p - 1))
                                            }
                                        >
                                            Anterior
                                        </Button>
                                    </PaginationItem>
                                    <PaginationItem>
                                        <span className="text-sm text-muted-foreground mx-4">
                                            Página {page} de {meta.totalPages}
                                        </span>
                                    </PaginationItem>
                                    <PaginationItem>
                                        <Button
                                            variant="ghost"
                                            disabled={page >= meta.totalPages}
                                            onClick={() =>
                                                setPage((p) =>
                                                    Math.min(meta.totalPages, p + 1)
                                                )
                                            }
                                        >
                                            Próxima
                                        </Button>
                                    </PaginationItem>
                                </PaginationContent>
                            </Pagination>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
