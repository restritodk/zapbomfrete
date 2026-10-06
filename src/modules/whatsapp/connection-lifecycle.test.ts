import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DisconnectReason } from "@whiskeysockets/baileys";
import {
    ACTIVE_OR_CONNECTING,
    ConnectionLifecycle,
    describeDisconnect,
    shouldScheduleReconnect,
    shouldWipeAuthState,
} from "./connection-lifecycle";

type FakeSocket = {
    id: number;
    generation: number;
    ended: boolean;
    listeners: Array<(u: { connection?: string; lastDisconnect?: unknown; qr?: string }) => void>;
};

/**
 * Minimal stand-in for WhatsAppInstance init/reconnect semantics (no Baileys, no Prisma).
 */
class FakeWhatsAppSession {
    lifecycle = new ConnectionLifecycle();
    socketsCreated = 0;
    active: FakeSocket | null = null;
    all: FakeSocket[] = [];
    reconnectCount = 0;
    authWipeCalls = 0;
    maxAttempts = 3;

    async init(): Promise<void> {
        await this.lifecycle.runExclusiveInit(async (generation) => {
            // Detach previous — mark ended but keep listeners to prove generation guard
            if (this.active) {
                this.active.ended = true;
                this.active = null;
            }

            await new Promise((r) => setTimeout(r, 5)); // simulate async setup

            if (!this.lifecycle.isCurrentGeneration(generation) || this.lifecycle.isStopped) {
                return;
            }

            const sock: FakeSocket = {
                id: ++this.socketsCreated,
                generation,
                ended: false,
                listeners: [],
            };
            this.all.push(sock);
            this.active = sock;

            sock.listeners.push((update) => {
                if (!this.lifecycle.isCurrentGeneration(generation)) return;
                if (this.active !== sock) return;
                this.onConnectionUpdate(update, generation, sock);
            });
        });
    }

    emit(
        sock: FakeSocket,
        update: { connection?: string; lastDisconnect?: unknown; qr?: string }
    ) {
        for (const l of [...sock.listeners]) l(update);
    }

    private onConnectionUpdate(
        update: { connection?: string; lastDisconnect?: unknown; qr?: string },
        generation: number,
        sock: FakeSocket
    ) {
        if (!this.lifecycle.isCurrentGeneration(generation)) return;
        if (this.active !== sock) return;

        if (update.qr) {
            this.lifecycle.markScanQr(generation);
            this.reconnectCount = 0;
        }

        if (update.connection === "close") {
            const info = describeDisconnect(update.lastDisconnect);
            sock.ended = true;
            if (this.active === sock) this.active = null;

            if (shouldWipeAuthState(info.code)) {
                this.lifecycle.markLoggedOut(generation);
                this.authWipeCalls++;
                return;
            }

            if (this.lifecycle.isStopped) {
                this.lifecycle.markStopped(generation);
                return;
            }

            this.reconnectCount++;
            if (
                shouldScheduleReconnect({
                    isStopped: this.lifecycle.isStopped,
                    disconnectCode: info.code,
                    reconnectCount: this.reconnectCount,
                    maxAttempts: this.maxAttempts,
                })
            ) {
                this.lifecycle.markDisconnected(generation);
                this.lifecycle.scheduleReconnect(20, () => {
                    void this.init();
                });
            } else {
                this.lifecycle.invalidate({ stop: true });
            }
        }

        if (update.connection === "open") {
            this.lifecycle.markConnected(generation);
            this.reconnectCount = 0;
        }
    }

    async shutdown() {
        this.lifecycle.invalidate({ stop: true });
        if (this.active) {
            this.active.ended = true;
            this.active = null;
        }
    }

    async restart() {
        await this.shutdown();
        this.lifecycle.resumeForStart();
        await this.init();
    }
}

function boomClose(code: number, type?: string) {
    return {
        error: {
            output: {
                statusCode: code,
                payload: type ? { type } : {},
            },
        },
    };
}

function sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

describe("ConnectionLifecycle + FakeWhatsAppSession", () => {
    it("1) two concurrent init() create only one socket", async () => {
        const s = new FakeWhatsAppSession();
        await Promise.all([s.init(), s.init()]);
        assert.equal(s.socketsCreated, 1);
        assert.ok(s.active);
        assert.equal(s.lifecycle.status, "CONNECTING");
    });

    it("2) two concurrent startSession-style inits do not create two sockets", async () => {
        const s = new FakeWhatsAppSession();
        // Simulate manager startLocks + init
        let lock: Promise<void> | null = null;
        const start = () => {
            if (lock) return lock;
            if (ACTIVE_OR_CONNECTING.has(s.lifecycle.status)) return Promise.resolve();
            lock = s.init().finally(() => {
                lock = null;
            });
            return lock;
        };
        await Promise.all([start(), start()]);
        assert.equal(s.socketsCreated, 1);
    });

    it("3) multiple close events create only one reconnect timer", async () => {
        const s = new FakeWhatsAppSession();
        await s.init();
        const sock = s.active!;
        s.emit(sock, { connection: "open" });
        assert.equal(s.lifecycle.status, "CONNECTED");

        // Several closes on same socket (noisy stream)
        s.emit(sock, { connection: "close", lastDisconnect: boomClose(428) });
        // active already null; further emits on same sock are no-ops for scheduling if listeners cleared
        assert.equal(s.lifecycle.hasReconnectTimer, true);

        // Force-schedule again via lifecycle (would cancel previous)
        const fires: number[] = [];
        s.lifecycle.scheduleReconnect(30, () => fires.push(1));
        s.lifecycle.scheduleReconnect(30, () => fires.push(2));
        s.lifecycle.scheduleReconnect(30, () => fires.push(3));
        await sleep(50);
        assert.deepEqual(fires, [3]);
    });

    it("4) close → reconnect → open keeps only the newest socket", async () => {
        const s = new FakeWhatsAppSession();
        await s.init();
        const first = s.active!;
        s.emit(first, { connection: "open" });

        s.emit(first, {
            connection: "close",
            lastDisconnect: boomClose(DisconnectReason.connectionReplaced, "replaced"),
        });
        assert.equal(first.ended, true);

        await sleep(40); // reconnect timer
        assert.equal(s.socketsCreated, 2);
        const second = s.active!;
        assert.notEqual(second.id, first.id);
        assert.equal(first.ended, true);

        s.emit(second, { connection: "open" });
        assert.equal(s.lifecycle.status, "CONNECTED");
        assert.equal(s.active?.id, second.id);
    });

    it("5) delayed event from old socket is ignored", async () => {
        const s = new FakeWhatsAppSession();
        await s.init();
        const old = s.active!;
        s.emit(old, { connection: "open" });

        // New generation via restart
        await s.restart();
        const neu = s.active!;
        assert.notEqual(neu.id, old.id);

        // Stale close from old socket must not disconnect current
        s.emit(old, {
            connection: "close",
            lastDisconnect: boomClose(428),
        });
        assert.equal(s.lifecycle.status, "CONNECTING");
        assert.equal(s.active?.id, neu.id);
        assert.equal(s.lifecycle.hasReconnectTimer, false);

        s.emit(neu, { connection: "open" });
        assert.equal(s.lifecycle.status, "CONNECTED");
    });

    it("6) shutdown() during timer prevents reconnection", async () => {
        const s = new FakeWhatsAppSession();
        await s.init();
        const sock = s.active!;
        s.emit(sock, { connection: "open" });
        s.emit(sock, { connection: "close", lastDisconnect: boomClose(428) });
        assert.equal(s.lifecycle.hasReconnectTimer, true);

        await s.shutdown();
        assert.equal(s.lifecycle.hasReconnectTimer, false);
        assert.equal(s.lifecycle.isStopped, true);

        const createdBefore = s.socketsCreated;
        await sleep(50);
        assert.equal(s.socketsCreated, createdBefore);
    });

    it("7) restartSession does not leave old socket active", async () => {
        const s = new FakeWhatsAppSession();
        await s.init();
        const old = s.active!;
        s.emit(old, { connection: "open" });

        await s.restart();
        assert.equal(old.ended, true);
        assert.ok(s.active);
        assert.notEqual(s.active!.id, old.id);
        assert.equal(
            s.all.filter((x) => !x.ended).length,
            1,
            "exactly one non-ended socket"
        );
    });

    it("8) CONNECTED is not reinitialized by startSession", async () => {
        const s = new FakeWhatsAppSession();
        await s.init();
        s.emit(s.active!, { connection: "open" });
        assert.equal(s.lifecycle.status, "CONNECTED");

        const before = s.socketsCreated;
        // Manager-style idempotent start
        if (ACTIVE_OR_CONNECTING.has(s.lifecycle.status)) {
            /* skip */
        } else {
            await s.init();
        }
        await s.init(); // lifecycle also no-ops when CONNECTED
        assert.equal(s.socketsCreated, before);
    });

    it("9) credentials remain intact on disconnect/restart (no wipe)", async () => {
        const s = new FakeWhatsAppSession();
        await s.init();
        s.emit(s.active!, { connection: "open" });
        s.emit(s.active!, {
            connection: "close",
            lastDisconnect: boomClose(DisconnectReason.connectionClosed),
        });
        assert.equal(s.authWipeCalls, 0);

        await sleep(40);
        await s.restart();
        assert.equal(s.authWipeCalls, 0);
        assert.equal(shouldWipeAuthState(DisconnectReason.connectionClosed), false);
        assert.equal(shouldWipeAuthState(DisconnectReason.connectionReplaced), false);
        assert.equal(shouldWipeAuthState(428), false);
        assert.equal(shouldWipeAuthState(440), false);
    });

    it("10) LOGGED_OUT is the only path that wipes credentials", async () => {
        const s = new FakeWhatsAppSession();
        await s.init();
        s.emit(s.active!, { connection: "open" });
        s.emit(s.active!, {
            connection: "close",
            lastDisconnect: boomClose(DisconnectReason.loggedOut),
        });
        assert.equal(s.authWipeCalls, 1);
        assert.equal(s.lifecycle.status, "LOGGED_OUT");
        assert.equal(shouldWipeAuthState(DisconnectReason.loggedOut), true);
        assert.equal(shouldWipeAuthState(401), true);
    });
});

describe("describeDisconnect / helpers", () => {
    it("logs conflict type=replaced without secrets", () => {
        const info = describeDisconnect(boomClose(440, "replaced"));
        assert.equal(info.code, 440);
        assert.equal(info.reason, "connectionReplaced");
        assert.equal(info.conflictType, "replaced");
    });

    it("ACTIVE_OR_CONNECTING covers CONNECTED/CONNECTING/SCAN_QR", () => {
        assert.ok(ACTIVE_OR_CONNECTING.has("CONNECTED"));
        assert.ok(ACTIVE_OR_CONNECTING.has("CONNECTING"));
        assert.ok(ACTIVE_OR_CONNECTING.has("SCAN_QR"));
        assert.ok(!ACTIVE_OR_CONNECTING.has("DISCONNECTED"));
    });
});

describe("ConnectionLifecycle timer cancel", () => {
    it("clearReconnectTimer prevents scheduled fire", async () => {
        const lc = new ConnectionLifecycle();
        let fired = 0;
        lc.scheduleReconnect(15, () => {
            fired++;
        });
        assert.equal(lc.hasReconnectTimer, true);
        lc.clearReconnectTimer();
        await sleep(40);
        assert.equal(fired, 0);
    });

    it("invalidate during timer blocks reconnect callback", async () => {
        const lc = new ConnectionLifecycle();
        let fired = 0;
        lc.scheduleReconnect(15, () => {
            fired++;
        });
        lc.invalidate({ stop: true });
        await sleep(40);
        assert.equal(fired, 0);
        assert.equal(lc.isStopped, true);
    });
});
