import makeWASocket, {
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    WASocket,
    ConnectionState,
} from "@whiskeysockets/baileys";
import { prisma } from "@/lib/prisma";
import { usePrismaAuthState } from "./auth/usePrismaAuthState";
import { Server } from "socket.io";
import pino from "pino";
import { bindSessionStore } from "./store";
import { syncGroups } from "./store/groups";
import { bindContactSync } from "./store/contacts";
import { bindChatSync } from "./store/chats";
import { bindAutoReply } from "./store/autoreply";
import { bindPpGuard } from "./store/ppguard";
import { antispam } from "./antispam";
import { logger } from "@/lib/logger";
import {
    ConnectionLifecycle,
    describeDisconnect,
    shouldScheduleReconnect,
    shouldWipeAuthState,
} from "./connection-lifecycle";

const MAX_RECONNECT_ATTEMPTS = 3;
const RECONNECT_DELAY_MS = 3000;
const RECONNECT_DELAY_REPLACED_MS = 5000;

export class WhatsAppInstance {
    socket: WASocket | null = null;
    qr: string | null = null;
    rq: string | null = null;
    sessionId: string;
    userId: string;
    io: Server;
    config: any = {};
    startTime: Date | null = null;
    pairingCode: string | null = null;

    /** @deprecated prefer lifecycle.isStopped — kept for manager compatibility */
    get isStopped(): boolean {
        return this.lifecycle.isStopped;
    }
    set isStopped(value: boolean) {
        this.lifecycle.isStopped = value;
    }

    get status(): string {
        return this.lifecycle.status;
    }
    set status(value: string) {
        this.lifecycle.status = value as any;
    }

    private reconnectCount: number = 0;
    private readonly lifecycle = new ConnectionLifecycle();
    /** Bound socket for the active generation — used to ignore stale refs */
    private socketRef: WASocket | null = null;

    /** Called when instance auto-stops or logs out — lets manager remove it from Map */
    onRemovedFromManager: (() => void) | null = null;

    constructor(sessionId: string, userId: string, io: Server) {
        this.sessionId = sessionId;
        this.userId = userId;
        this.io = io;
    }

    /**
     * Idempotent init: concurrent callers share one in-flight initialization.
     * Never creates concurrent WASockets for the same session.
     */
    async init(): Promise<void> {
        await this.lifecycle.runExclusiveInit(async (generation) => {
            await this.doInit(generation);
        });
    }

    private async doInit(generation: number): Promise<void> {
        if (!this.lifecycle.isCurrentGeneration(generation)) return;

        this.io?.to(this.sessionId).emit("connection.update", {
            status: "CONNECTING",
            qr: null,
        });
        await prisma.session
            .update({
                where: { sessionId: this.sessionId },
                data: { status: "CONNECTING", qr: null },
            })
            .catch(() => {});

        const sessionData = await prisma.session.findUnique({
            where: { sessionId: this.sessionId },
            include: { botConfig: true },
        });
        if (!sessionData) {
            logger.warn("Instance", `Session ${this.sessionId} not found in DB, aborting init`);
            this.lifecycle.markDisconnected(generation);
            return;
        }
        if (!this.lifecycle.isCurrentGeneration(generation) || this.lifecycle.isStopped) {
            return;
        }

        this.config = sessionData?.config || {};
        const botConfig = (sessionData as any)?.botConfig;

        // Tear down previous socket BEFORE creating a new one (prevents conflict/replaced loops)
        await this.detachSocket(this.socketRef, "replace");

        if (!this.lifecycle.isCurrentGeneration(generation) || this.lifecycle.isStopped) {
            return;
        }

        const { state, saveCreds } = await usePrismaAuthState(this.sessionId);
        const { version } = await fetchLatestBaileysVersion();

        if (!this.lifecycle.isCurrentGeneration(generation) || this.lifecycle.isStopped) {
            return;
        }

        const sock = makeWASocket({
            version,
            logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any,
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(
                    state.keys,
                    pino({ level: process.env.BAILEYS_LOG_LEVEL || "error" }) as any
                ),
            },
            browser: ["Ubuntu", "Chrome", "20.0.04"],
            markOnlineOnConnect: botConfig?.alwaysOnline ?? true,
            syncFullHistory: true,
        });

        if (!this.lifecycle.isCurrentGeneration(generation) || this.lifecycle.isStopped) {
            await this.detachSocket(sock, "aborted-init");
            return;
        }

        this.socketRef = sock;
        this.socket = sock;

        const originalSendMessage = sock.sendMessage.bind(sock);
        const sessionId = this.sessionId;
        sock.sendMessage = async function (jid: string, content: any, options?: any) {
            await antispam.enqueue(sessionId, jid, content);
            return originalSendMessage(jid, content, options);
        } as any;

        bindSessionStore(sock, this.sessionId, this.io);
        bindContactSync(sock, this.sessionId);
        bindChatSync(sock, this.sessionId, this.io);

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", (update) => {
            // Stale socket / superseded generation — ignore completely
            if (!this.lifecycle.isCurrentGeneration(generation)) return;
            if (this.socketRef !== sock) return;
            void this.handleConnectionUpdate(update, generation);
        });
    }

    /**
     * Safely end a socket and drop our listeners. Never touches AuthState.
     */
    private async detachSocket(
        sock: WASocket | null,
        reason: string
    ): Promise<void> {
        if (!sock) return;
        if (this.socketRef === sock) {
            this.socketRef = null;
            this.socket = null;
        }
        try {
            sock.ev.removeAllListeners("connection.update");
            sock.ev.removeAllListeners("creds.update");
        } catch {
            /* ignore */
        }
        try {
            sock.end(undefined);
        } catch {
            /* ignore */
        }
        logger.info(
            "Instance",
            `Session ${this.sessionId} detached socket (${reason}) — AuthState preserved`
        );
    }

    async handleConnectionUpdate(
        update: Partial<ConnectionState>,
        generation: number
    ) {
        if (!this.lifecycle.isCurrentGeneration(generation)) return;

        const { connection, lastDisconnect, qr } = update;

        try {
            if (qr) {
                if (!this.lifecycle.markScanQr(generation)) return;
                this.reconnectCount = 0;
                this.qr = qr;

                this.io?.to(this.sessionId).emit("connection.update", {
                    status: this.status,
                    qr,
                });

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { qr, status: "SCAN_QR" },
                });
            }

            if (connection === "close") {
                if (!this.lifecycle.isCurrentGeneration(generation)) return;

                const info = describeDisconnect(lastDisconnect);
                const code = info.code;
                const isLoggedOut = shouldWipeAuthState(code);

                logger.warn(
                    "Instance",
                    `Session ${this.sessionId} connection.close code=${info.code ?? "?"} reason=${info.reason ?? "?"} conflictType=${info.conflictType ?? "-"} gen=${generation}`
                );

                // Drop this socket immediately so it cannot keep the WA presence alive
                const closing = this.socketRef;
                if (closing) {
                    await this.detachSocket(closing, `close:${info.reason ?? code}`);
                }

                if (isLoggedOut) {
                    if (!this.lifecycle.markLoggedOut(generation)) return;
                    this.config = {};
                    this.io?.to(this.sessionId).emit("connection.update", {
                        status: "LOGGED_OUT",
                        qr: null,
                    });

                    logger.info(
                        "Instance",
                        `Session ${this.sessionId} logged out. Deleting credentials...`
                    );
                    try {
                        await prisma.$transaction([
                            prisma.session.update({
                                where: { sessionId: this.sessionId },
                                data: { status: "LOGGED_OUT", qr: null },
                            }),
                            prisma.authState.deleteMany({
                                where: { sessionId: this.sessionId },
                            }),
                        ]);
                    } catch {
                        /* ignore */
                    }
                    logger.success(
                        "Instance",
                        `Session ${this.sessionId} credentials deleted.`
                    );

                    this.onRemovedFromManager?.();
                    return;
                }

                if (this.lifecycle.isStopped) {
                    this.lifecycle.markStopped(generation);
                    this.reconnectCount = 0;
                    this.io?.to(this.sessionId).emit("connection.update", {
                        status: "STOPPED",
                        qr: null,
                    });

                    await prisma.session
                        .update({
                            where: { sessionId: this.sessionId },
                            data: { status: "STOPPED", qr: null },
                        })
                        .catch(() => {});
                    logger.warn(
                        "Instance",
                        `Session ${this.sessionId} stopped. Credentials preserved.`
                    );

                    this.onRemovedFromManager?.();
                    return;
                }

                this.reconnectCount++;
                const canRetry = shouldScheduleReconnect({
                    isStopped: this.lifecycle.isStopped,
                    disconnectCode: code,
                    reconnectCount: this.reconnectCount,
                    maxAttempts: MAX_RECONNECT_ATTEMPTS,
                });

                if (canRetry && this.lifecycle.markDisconnected(generation)) {
                    this.io?.to(this.sessionId).emit("connection.update", {
                        status: "DISCONNECTED",
                        qr: null,
                    });
                    await prisma.session
                        .update({
                            where: { sessionId: this.sessionId },
                            data: { status: "DISCONNECTED", qr: null },
                        })
                        .catch(() => {});

                    const delay =
                        code === DisconnectReason.connectionReplaced
                            ? RECONNECT_DELAY_REPLACED_MS
                            : RECONNECT_DELAY_MS;

                    logger.warn(
                        "Instance",
                        `Session ${this.sessionId} disconnected. Scheduling reconnect ${this.reconnectCount}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms (code=${code ?? "?"}${info.conflictType ? ` type=${info.conflictType}` : ""})`
                    );

                    this.lifecycle.scheduleReconnect(delay, () => {
                        void this.init();
                    });
                } else if (!canRetry) {
                    this.lifecycle.invalidate({ stop: true });
                    this.reconnectCount = 0;
                    this.io?.to(this.sessionId).emit("connection.update", {
                        status: "STOPPED",
                        qr: null,
                    });

                    await prisma.session
                        .update({
                            where: { sessionId: this.sessionId },
                            data: { status: "STOPPED", qr: null },
                        })
                        .catch(() => {});
                    logger.error(
                        "Instance",
                        `Session ${this.sessionId} max reconnects (${MAX_RECONNECT_ATTEMPTS}) reached. Auto-stopped.`
                    );

                    this.onRemovedFromManager?.();
                }
            }

            if (connection === "open") {
                if (!this.lifecycle.markConnected(generation)) return;

                this.reconnectCount = 0;
                this.qr = null;
                this.startTime = new Date();

                this.io?.to(this.sessionId).emit("connection.update", {
                    status: "CONNECTED",
                    qr: null,
                });

                try {
                    if (this.socket) {
                        await syncGroups(this.socket, this.sessionId);
                    }
                } catch (e) {
                    logger.error("Instance", "Group sync failed:", e);
                }

                if (
                    this.lifecycle.shouldBindServices(generation) &&
                    this.socket
                ) {
                    bindAutoReply(this.socket, this.sessionId);
                    bindPpGuard(this.socket, this.sessionId);
                }

                await prisma.session.update({
                    where: { sessionId: this.sessionId },
                    data: { status: "CONNECTED", qr: null },
                });

                logger.success(
                    "Instance",
                    `Session ${this.sessionId} connected and synced successfully (gen=${generation})`
                );
            }
        } catch (error: any) {
            if (!this.lifecycle.isCurrentGeneration(generation)) return;
            if (error.code === "P2025") {
                logger.warn(
                    "Instance",
                    `Session ${this.sessionId} record not found during update. Stopping.`
                );
                await this.shutdown();
            } else {
                logger.error("Instance", "Error in handleConnectionUpdate:", error);
            }
        }
    }

    async requestPairingCode(phoneNumber: string) {
        if (!this.socket) {
            throw new Error("Socket not initialized");
        }

        try {
            const cleanNumber = phoneNumber.replace(/[^0-9]/g, "");
            if (!cleanNumber) throw new Error("Invalid phone number");

            const code = await this.socket.requestPairingCode(cleanNumber);
            this.pairingCode = code;
            this.status = "SCAN_QR";

            this.io?.to(this.sessionId).emit("connection.update", {
                status: this.status,
                qr: this.qr,
                pairingCode: code,
            });

            return code;
        } catch (error) {
            logger.error("Instance", "Pairing code error:", error);
            throw error;
        }
    }

    /** Clean shutdown: cancel reconnect, invalidate generation, end socket. Auth preserved. */
    async shutdown(): Promise<void> {
        this.lifecycle.invalidate({ stop: true });
        this.reconnectCount = 0;
        const sock = this.socketRef || this.socket;
        await this.detachSocket(sock, "shutdown");
        this.socket = null;
        this.socketRef = null;
    }

    get hasInitInFlight(): boolean {
        return this.lifecycle.hasInitInFlight;
    }

    /** Resume after stop — used by manager.startSession */
    resumeForStart(): void {
        this.lifecycle.resumeForStart();
    }

    /** @internal test helper */
    getLifecycleForTests(): ConnectionLifecycle {
        return this.lifecycle;
    }
}
