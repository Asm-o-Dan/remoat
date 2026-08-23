import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { DaemonSupervisor } from '../../services/daemonSupervisor';
import { logger } from '../../utils/logger';
import { LOGO } from '../../utils/logo';

const DAEMON_PID_FILE = path.join(os.homedir(), '.remoat', '.daemon.pid');
const BOT_LOCK_FILE = path.join(os.homedir(), '.remoat', '.bot.lock');

function isPidRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export async function daemonAction(subcommand?: string): Promise<void> {
    const action = (subcommand || 'start').toLowerCase();

    if (action === 'status') {
        let daemonPid: number | null = null;
        let botPid: number | null = null;

        if (fs.existsSync(DAEMON_PID_FILE)) {
            const p = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim(), 10);
            if (!isNaN(p) && isPidRunning(p)) daemonPid = p;
        }

        if (fs.existsSync(BOT_LOCK_FILE)) {
            const p = parseInt(fs.readFileSync(BOT_LOCK_FILE, 'utf8').trim(), 10);
            if (!isNaN(p) && isPidRunning(p)) botPid = p;
        }

        console.log('\n🛡️  Remoat Daemon Status:');
        console.log(`• Supervisor Daemon: ${daemonPid ? `🟢 Running (PID: ${daemonPid})` : '⚪ Inactive'}`);
        console.log(`• Active Bot Worker: ${botPid ? `🟢 Running (PID: ${botPid})` : '⚪ Inactive'}`);
        console.log('');
        return;
    }

    if (action === 'stop') {
        if (fs.existsSync(DAEMON_PID_FILE)) {
            const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim(), 10);
            if (!isNaN(pid) && isPidRunning(pid)) {
                try {
                    process.kill(pid, 'SIGTERM');
                    console.log(`🛑 Stopped Remoat Daemon (PID: ${pid})`);
                } catch (e) {
                    console.log(`⚠️ Failed to stop PID ${pid}:`, e);
                }
            } else {
                console.log('⚪ Daemon is not running.');
            }
            try { fs.unlinkSync(DAEMON_PID_FILE); } catch {}
        } else {
            console.log('⚪ No active daemon found.');
        }
        return;
    }

    // Default: run supervisor
    console.log(LOGO);
    const supervisor = new DaemonSupervisor();
    await supervisor.start().catch((err) => {
        logger.error('Failed to start supervisor daemon:', err);
        process.exit(1);
    });
}
