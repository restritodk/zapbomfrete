import { prisma } from "@/lib/prisma";
import { WhatsAppInstance } from "./instance";
import { Server } from "socket.io";
import { initScheduler } from "@/lib/cron";
import { logger } from "@/lib/logger";
import { ACTIVE_OR_CONNECTING } from "./connection-lifecycle";

export class WhatsAppManager {
    private static instance: WhatsAppManager;
    private sessions: Map<string, WhatsAppInstance> = new Map();
    /** Per-session start mutex — concurrent startSession share one promise */
    private startLocks: Map<string, Promise<void>> = new Map();
    public io: Server | null = null;

    private constructor() {
        initScheduler();
    }

    public static getInstance(): WhatsAppManager {
        if (!WhatsAppManager.instance) {
            WhatsAppManager.instance = new WhatsAppManager();
        }
        return WhatsAppManager.instance;
    }

    setup(io: Server) {
        this.io = io;
    }

    async loadSessions() {
        if (!this.io) throw new Error("Socket.IO not initialized in WhatsAppManager");
        const sessions = await prisma.session.findMany({
            where: {
                status: { not: "LOGGED_OUT" },
            },
            select: { sessionId: true, userId: true, status: true },
        });

        let started = 0;
        for (const session of sessions) {
            const authCount = await prisma.authState.count({
                where: { sessionId: session.sessionId },
            });
            if (authCount === 0) {
                await prisma.session
                    .update({
                        where: { sessionId: session.sessionId },
                        data: { status: "STOPPED" },
                    })
                    .catch(() => {});
                continue;
            }

            const instance = new WhatsAppInstance(
                session.sessionId,
                session.userId,
                this.io
            );
            instance.onRemovedFromManager = () =>
                this.removeInstance(session.sessionId);
            this.sessions.set(session.sessionId, instance);
            await instance.init();
            started++;
        }
        logger.success(
            "Manager",
            `Loaded ${started} sessions (${sessions.length - started} idle skipped).`
        );
    }

    async createSession(userId: string, name: string, customSessionId?: string) {
        if (!this.io && (global as any).io) {
            this.io = (global as any).io;
        }

        if (!this.io) {
            logger.error("Manager", "Socket.IO not initialized in WhatsAppManager");
            throw new Error("Socket.IO not initialized");
        }

        const sessionId = customSessionId || Math.random().toString(36).substring(7);

        const session = await prisma.session.create({
            data: {
                userId,
                name,
                sessionId,
                status: "STOPPED",
                botConfig: {
                    create: {
                        enabled: true,
                        botMode: "OWNER",
                        autoReplyMode: "ALL",
                    },
                },
            },
        });

        logger.info(
            "Manager",
            `Session ${sessionId} created (STOPPED). User must click Start to connect.`
        );
        return session;
    }

    public getInstance(sessionId: string) {
        return this.sessions.get(sessionId);
    }

    public removeInstance(sessionId: string) {
        const inst = this.sessions.get(sessionId);
        if (inst) {
            logger.info("Manager", `Removing session ${sessionId} from memory.`);
            this.sessions.delete(sessionId);
        }
    }

    async deleteSession(sessionId: string) {
        const instance = this.sessions.get(sessionId);
        if (instance) {
            await instance.shutdown();
            this.sessions.delete(sessionId);
        }
        await prisma.session.delete({ where: { sessionId } });
    }

    async stopSession(sessionId: string) {
        const instance = this.sessions.get(sessionId);
        if (instance) {
            await instance.shutdown();
            instance.status = "STOPPED";
            this.io?.to(sessionId).emit("connection.update", {
                status: "STOPPED",
                qr: null,
            });
            await prisma.session
                .update({
                    where: { sessionId },
                    data: { status: "STOPPED" },
                })
                .catch(() => {});
            this.sessions.delete(sessionId);
        }
        this.startLocks.delete(sessionId);
    }

    async startSession(sessionId: string) {
        const inflight = this.startLocks.get(sessionId);
        if (inflight) {
            return inflight;
        }

        const run = this.doStartSession(sessionId).finally(() => {
            if (this.startLocks.get(sessionId) === run) {
                this.startLocks.delete(sessionId);
            }
        });
        this.startLocks.set(sessionId, run);
        return run;
    }

    private async doStartSession(sessionId: string) {
        const existingInstance = this.sessions.get(sessionId);
        if (existingInstance && ACTIVE_OR_CONNECTING.has(existingInstance.status)) {
            // CONNECTED / CONNECTING / SCAN_QR — idempotent no-op
            // If init still in flight, await it so callers observe readiness
            if (existingInstance.hasInitInFlight) {
                await existingInstance.init();
            }
            logger.info(
                "Manager",
                `startSession(${sessionId}) skipped — already ${existingInstance.status}`
            );
            return;
        }

        const session = await prisma.session.findUnique({ where: { sessionId } });
        if (!session) throw new Error("Session not found");

        let instance = this.sessions.get(sessionId);
        if (!instance) {
            instance = new WhatsAppInstance(sessionId, session.userId, this.io!);
            instance.onRemovedFromManager = () => this.removeInstance(sessionId);
            this.sessions.set(sessionId, instance);
        } else {
            instance.resumeForStart();
        }

        await instance.init();
    }

    async restartSession(sessionId: string) {
        // Fully tear down previous generation (cancels timers, ends socket)
        await this.stopSession(sessionId);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await this.startSession(sessionId);
    }

    async requestPairingCode(sessionId: string, phoneNumber: string) {
        const instance = this.sessions.get(sessionId);
        if (!instance) throw new Error("Instance not found or not running");
        return await instance.requestPairingCode(phoneNumber);
    }
}

const globalForWhatsapp = global as unknown as { waManager: WhatsAppManager };

export const waManager =
    globalForWhatsapp.waManager || WhatsAppManager.getInstance();

globalForWhatsapp.waManager = waManager;
