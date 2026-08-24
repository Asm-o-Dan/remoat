import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger';

export interface SupervisorOptions {
    targetScript?: string;
    watchDirs?: string[];
    debounceMs?: number;
    autoRestartOnCrash?: boolean;
    maxCrashesPerMinute?: number;
    cwd?: string;
}

const DAEMON_PID_FILE = path.join(os.homedir(), '.remoat', '.daemon.pid');

/**
 * Production-grade Process Supervisor Daemon for Remoat.
 * 
 * Capabilities:
 * - Auto-restart on unexpected crashes / unhandled errors.
 * - Hot-reload / auto-update when new code is compiled to dist/.
 * - Instant remote restart via Telegram `/restart` command.
 * - Anti-crash-loop throttling.
 * - Windows and Unix process tree lifecycle management.
 */
export class DaemonSupervisor {
    private child: ChildProcess | null = null;
    private isShuttingDown = false;
    private restartTimer: NodeJS.Timeout | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private watchers: fs.FSWatcher[] = [];
    private crashTimestamps: number[] = [];
    private options: Required<SupervisorOptions>;

    constructor(options: SupervisorOptions = {}) {
        const rootDir = path.resolve(__dirname, '../..');
        const defaultDist = path.join(rootDir, 'dist');
        const defaultScript = path.join(defaultDist, 'bin', 'cli.js');

        this.options = {
            targetScript: options.targetScript || defaultScript,
            watchDirs: options.watchDirs || (process.env.REMOAT_WATCH === 'true' && fs.existsSync(defaultDist) ? [defaultDist] : []),
            debounceMs: options.debounceMs ?? 1500,
            autoRestartOnCrash: options.autoRestartOnCrash ?? true,
            maxCrashesPerMinute: options.maxCrashesPerMinute ?? 10,
            cwd: options.cwd || rootDir,
        };
    }

    /**
     * Start the supervisor and spawn the initial child bot process.
     */
    public async start(): Promise<void> {
        this.saveDaemonPid();
        this.setupSignalHandlers();
        this.setupWatchers();

        // Keep event loop alive
        if (!this.heartbeatTimer) {
            this.heartbeatTimer = setInterval(() => {}, 30000);
        }

        logger.info(`🛡️ [Supervisor] Remoat Daemon Supervisor started (PID: ${process.pid})`);
        logger.info(`📁 [Supervisor] Target script: ${this.options.targetScript}`);
        if (this.options.watchDirs.length > 0) {
            logger.info(`👀 [Supervisor] Watching directories for hot-reload: ${this.options.watchDirs.join(', ')}`);
        }

        await this.spawnChild();
    }

    /**
     * Stop the supervisor and terminate the child process.
     */
    public async stop(): Promise<void> {
        this.isShuttingDown = true;
        this.clearWatchers();

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }

        if (this.child && this.child.pid) {
            logger.info(`🛑 [Supervisor] Stopping child process (PID: ${this.child.pid})...`);
            await this.killProcessTree(this.child.pid);
            this.child = null;
        }

        this.removeDaemonPid();
        logger.info(`🛡️ [Supervisor] Remoat Daemon stopped cleanly.`);
    }

    /**
     * Trigger a manual reload / restart.
     */
    public async restart(reason = 'manual trigger'): Promise<void> {
        logger.info(`🔄 [Supervisor] Restart requested (${reason}). Reloading bot...`);
        if (this.child && this.child.pid) {
            await this.killProcessTree(this.child.pid);
            this.child = null;
            await new Promise((r) => setTimeout(r, 600));
        }
        await this.spawnChild();
    }

    /**
     * Spawn child process.
     */
    private async spawnChild(): Promise<void> {
        if (this.isShuttingDown) return;

        // Ensure script exists
        if (!fs.existsSync(this.options.targetScript)) {
            logger.warn(`⚠️ [Supervisor] Target script not found: ${this.options.targetScript}. Attempting fallback build...`);
        }

        const args = [this.options.targetScript, 'start'];
        logger.info(`🚀 [Supervisor] Spawning child bot: node ${args.join(' ')}`);

        const child = spawn(process.execPath, args, {
            cwd: this.options.cwd,
            env: { ...process.env, REMOAT_SUPERVISED: 'true' },
            stdio: 'inherit',
            windowsHide: false,
        });

        this.child = child;

        child.on('error', (err) => {
            logger.error(`❌ [Supervisor] Child process spawn error:`, err);
            this.handleChildExit(-1, 'SPAWN_ERROR');
        });

        child.on('exit', (code, signal) => {
            this.handleChildExit(code, signal);
        });
    }

    /**
     * Handle child process exit.
     */
    private handleChildExit(code: number | null, signal: string | null): void {
        if (this.isShuttingDown) return;

        const exitInfo = code !== null ? `code ${code}` : `signal ${signal}`;
        logger.info(`⚠️ [Supervisor] Child process exited with ${exitInfo}`);

        // Record crash timestamp
        const now = Date.now();
        this.crashTimestamps = this.crashTimestamps.filter(t => now - t < 60000);
        this.crashTimestamps.push(now);

        // Crash loop guard
        if (this.crashTimestamps.length > this.options.maxCrashesPerMinute) {
            logger.error(`🚨 [Supervisor] Crash loop detected (${this.crashTimestamps.length} exits in 1 min). Throttling restart for 10s...`);
            this.scheduleRestart(10000, 'crash-loop throttle');
            return;
        }

        if (this.options.autoRestartOnCrash) {
            const delay = code === 0 ? 500 : 1500;
            this.scheduleRestart(delay, code === 0 ? 'clean restart' : 'crash recovery');
        }
    }

    /**
     * Schedule a delayed restart.
     */
    private scheduleRestart(delayMs: number, reason: string): void {
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
        }

        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.restart(reason).catch((err) => {
                logger.error(`[Supervisor] Failed to restart child:`, err);
            });
        }, delayMs);
    }

    /**
     * Watch directories for hot-reload on recompile.
     */
    private setupWatchers(): void {
        for (const dir of this.options.watchDirs) {
            if (!fs.existsSync(dir)) continue;

            try {
                const watcher = fs.watch(dir, { recursive: true }, (_eventType, filename) => {
                    if (!filename) return;
                    // Only restart on compiled .js files, ignore .d.ts, .map, .tmp, .lock, tsbuildinfo
                    if (!filename.endsWith('.js') || filename.includes('.lock') || filename.includes('.tmp')) return;

                    logger.info(`[Supervisor] File change detected: ${filename}`);
                    this.scheduleRestart(this.options.debounceMs, `file change: ${filename}`);
                });

                this.watchers.push(watcher);
            } catch (e) {
                logger.warn(`[Supervisor] Failed to watch ${dir}:`, e);
            }
        }
    }

    private clearWatchers(): void {
        for (const w of this.watchers) {
            try { w.close(); } catch {}
        }
        this.watchers = [];
    }

    /**
     * Kill process and its child processes cross-platform.
     */
    private killProcessTree(pid: number): Promise<void> {
        return new Promise((resolve) => {
            if (process.platform === 'win32') {
                const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
                killer.on('close', () => resolve());
                killer.on('error', () => resolve());
            } else {
                try {
                    process.kill(pid, 'SIGTERM');
                    setTimeout(() => {
                        try { process.kill(pid, 'SIGKILL'); } catch {}
                        resolve();
                    }, 2000);
                } catch {
                    resolve();
                }
            }
        });
    }

    private saveDaemonPid(): void {
        try {
            fs.mkdirSync(path.dirname(DAEMON_PID_FILE), { recursive: true });
            fs.writeFileSync(DAEMON_PID_FILE, String(process.pid), 'utf8');
        } catch {}
    }

    private removeDaemonPid(): void {
        try {
            if (fs.existsSync(DAEMON_PID_FILE)) {
                fs.unlinkSync(DAEMON_PID_FILE);
            }
        } catch {}
    }

    private setupSignalHandlers(): void {
        const onSignal = async () => {
            await this.stop();
            process.exit(0);
        };
        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);
    }
}

// Direct CLI entrypoint if executed via node daemonSupervisor.js
if (require.main === module) {
    const supervisor = new DaemonSupervisor();
    supervisor.start().catch((err) => {
        logger.error('[Supervisor] Fatal error:', err);
        process.exit(1);
    });
}
