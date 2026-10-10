"use client";

import {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
    useCallback,
} from "react";
import { getCookie, setCookie } from "@/lib/client-cookie";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
    DATAFY_OFFICIAL_CHANNEL_ID,
    isDatafyChannelId,
    resolveChannelProvider,
    type ChannelProvider,
} from "@/modules/channels/ids";

/** Unified selectable channel (Baileys session or Datafy official). */
export interface ChannelItem {
    id: string;
    provider: ChannelProvider;
    name: string;
    status: string;
    displayPhoneNumber: string | null;
    shared: boolean;
    official: boolean;
    lastVerifiedAt: string | null;
    healthy: boolean;
    providerLabel: string;
    dbId?: string;
    meta?: {
        lastError?: string | null;
        phoneNumberId?: string | null;
        enabled?: boolean;
        configured?: boolean;
    };
}

/** @deprecated Prefer ChannelItem — kept for pages that still read sessions[]. */
interface Session {
    id: string;
    sessionId: string;
    name: string;
    status: string;
}

interface SessionContextType {
    /** All selectable channels (Datafy + Baileys). */
    channels: ChannelItem[];
    /** Baileys-only view (compat). */
    sessions: Session[];
    /** Selected channel id (Baileys sessionId or datafy-official). Cookie: sessionId. */
    sessionId: string;
    channelId: string;
    provider: ChannelProvider | null;
    selectedChannel: ChannelItem | null;
    isDatafyChannel: boolean;
    setSessionId: (id: string) => void;
    setChannelId: (id: string) => void;
    refreshSessions: () => Promise<void>;
    refreshChannels: () => Promise<void>;
    loading: boolean;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

function toSessionCompat(channels: ChannelItem[]): Session[] {
    return channels
        .filter((c) => c.provider === "baileys")
        .map((c) => ({
            id: c.dbId || c.id,
            sessionId: c.id,
            name: c.name,
            status: c.status,
        }));
}

export function SessionProvider({ children }: { children: ReactNode }) {
    const [channels, setChannels] = useState<ChannelItem[]>([]);
    const [sessionId, setSessionIdState] = useState<string>("");
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    const fetchChannels = useCallback(async () => {
        try {
            const res = await fetch("/api/channels");
            if (!res.ok) {
                // Fallback: Baileys-only list if channels API unavailable
                const legacy = await fetch("/api/sessions");
                if (legacy.ok) {
                    const responseData = await legacy.json();
                    const data = responseData?.data || [];
                    const mapped: ChannelItem[] = (Array.isArray(data) ? data : []).map(
                        (s: Session & { sessionId: string }) => ({
                            id: s.sessionId,
                            provider: "baileys" as const,
                            name: s.name,
                            status: s.status,
                            displayPhoneNumber: null,
                            shared: false,
                            official: false,
                            lastVerifiedAt: null,
                            healthy: (s.status || "").toUpperCase() === "CONNECTED",
                            providerLabel: "Baileys",
                            dbId: s.id,
                        })
                    );
                    setChannels(mapped);
                    syncSelection(mapped);
                }
                return;
            }

            const json = await res.json();
            const list = (json?.data?.channels || []) as ChannelItem[];
            setChannels(list);
            syncSelection(list);
        } catch (error) {
            console.error(error);
            toast.error("Falha ao carregar canais");
        } finally {
            setLoading(false);
        }

        function syncSelection(list: ChannelItem[]) {
            const cookieId = getCookie("sessionId");
            if (cookieId && list.some((c) => c.id === cookieId)) {
                setSessionIdState(cookieId);
            } else if (list.length > 0) {
                // Prefer healthy Datafy official, else first channel
                const preferred =
                    list.find(
                        (c) =>
                            c.id === DATAFY_OFFICIAL_CHANNEL_ID && c.healthy
                    ) || list[0];
                setSessionIdState(preferred.id);
                setCookie("sessionId", preferred.id);
            } else {
                setSessionIdState("");
            }
        }
    }, []);

    useEffect(() => {
        fetchChannels();
    }, [fetchChannels]);

    const setChannelId = (id: string) => {
        setSessionIdState(id);
        setCookie("sessionId", id);
        router.refresh();
    };

    const selectedChannel =
        channels.find((c) => c.id === sessionId) || null;
    const provider = resolveChannelProvider(sessionId);
    const sessions = toSessionCompat(channels);

    return (
        <SessionContext.Provider
            value={{
                channels,
                sessions,
                sessionId,
                channelId: sessionId,
                provider,
                selectedChannel,
                isDatafyChannel: isDatafyChannelId(sessionId),
                setSessionId: setChannelId,
                setChannelId,
                refreshSessions: fetchChannels,
                refreshChannels: fetchChannels,
                loading,
            }}
        >
            {children}
        </SessionContext.Provider>
    );
}

export function useSession() {
    const context = useContext(SessionContext);
    if (!context) {
        throw new Error("useSession must be used within a SessionProvider");
    }
    return context;
}
