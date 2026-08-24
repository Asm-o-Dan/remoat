import { logger } from './logger';
import fs from 'fs';
import os from 'os';
import path from 'path';

const LOCK_FILE = path.join(os.homedir(), '.remoat', '.bot.lock');

/**
 * Check if a process with the given PID is running
 */
function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/**
 * Stop an existing process and wait for it to exit
 */
function sleepSync(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function killExistingProcess(pid: number): void {
    const daemonPidFile = path.join(os.homedir(), '.remoat', '.daemon.pid');
    let daemonPid: number | null = null;
    try {
        if (fs.existsSync(daemonPidFile)) {
            daemonPid = parseInt(fs.readFileSync(daemonPidFile, 'utf-8').trim(), 10);
        }
    } catch {}

    // Never kill own parent process or the daemon supervisor
    if (pid === process.pid || pid === process.ppid || (daemonPid && pid === daemonPid)) {
        return;
    }

    logger.info(`🔄 Stopping existing Bot process (PID: ${pid})...`);
    try {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            execSync(`taskkill /pid ${pid} /F`, { stdio: 'ignore' });
        } else {
            process.kill(pid, 'SIGTERM');
        }
    } catch {
        // Ignore if already terminated
        return;
    }

    // Wait up to 3 seconds for process to exit
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
        if (!isProcessRunning(pid)) {
            logger.info(`✅ Existing process (PID: ${pid}) stopped`);
            return;
        }
        sleepSync(50);
    }
}

/**
 * Acquire a lockfile to prevent duplicate bot instances.
 * If another process is already running, stop it before starting.
 *
 * @returns A function to release the lock
 */
export function acquireLock(): () => void {
    // Check existing lock file
    if (fs.existsSync(LOCK_FILE)) {
        const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
        const existingPid = parseInt(content, 10);

        if (!isNaN(existingPid) && existingPid !== process.pid && existingPid !== process.ppid && isProcessRunning(existingPid)) {
            // Stop existing process and restart
            killExistingProcess(existingPid);
        } else if (!isNaN(existingPid) && !isProcessRunning(existingPid)) {
            logger.warn(`⚠️  Stale lock file detected (PID: ${existingPid} has exited). Cleaning up.`);
        }

        // Remove stale lock file
        try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ }
    }

    // Create new lock file (ensure directory exists)
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    fs.writeFileSync(LOCK_FILE, String(process.pid), 'utf-8');
    logger.info(`🔒 Lock acquired (PID: ${process.pid})`);

    // Cleanup function
    const releaseLock = () => {
        try {
            if (fs.existsSync(LOCK_FILE)) {
                const content = fs.readFileSync(LOCK_FILE, 'utf-8').trim();
                if (parseInt(content, 10) === process.pid) {
                    fs.unlinkSync(LOCK_FILE);
                    logger.info(`🔓 Lock released (PID: ${process.pid})`);
                }
            }
        } catch {
            // Ignore errors during cleanup
        }
    };

    // Auto cleanup on process exit
    process.on('exit', releaseLock);
    process.on('SIGINT', () => {
        releaseLock();
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        releaseLock();
        process.exit(0);
    });
    process.on('uncaughtException', (err) => {
        console.error('💥 UNCAUGHT EXCEPTION IN BOT:', err);
        releaseLock();
        process.exit(1);
    });
    process.on('unhandledRejection', (reason) => {
        console.error('💥 UNHANDLED REJECTION IN BOT:', reason);
    });

    return releaseLock;
}
