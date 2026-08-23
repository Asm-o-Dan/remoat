import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EventEmitter } from 'events';
import { DaemonSupervisor } from '../../src/services/daemonSupervisor';

describe('DaemonSupervisor Service', () => {
    let tempDir: string;
    let dummyScript: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon_test_'));
        dummyScript = path.join(tempDir, 'dummy.js');
        fs.writeFileSync(dummyScript, 'console.log("Dummy bot running"); setTimeout(() => process.exit(0), 100);', 'utf8');
    });

    afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    });

    it('initializes with default options and resolves root directory', () => {
        const supervisor = new DaemonSupervisor({
            targetScript: dummyScript,
            debounceMs: 100,
            autoRestartOnCrash: false,
        });

        expect(supervisor).toBeDefined();
    });

    it('handles clean shutdown and terminates watchers', async () => {
        const supervisor = new DaemonSupervisor({
            targetScript: dummyScript,
            watchDirs: [tempDir],
            debounceMs: 100,
            autoRestartOnCrash: false,
            cwd: tempDir,
        });

        await supervisor.start();
        // Allow brief execution
        await new Promise(r => setTimeout(r, 150));
        await supervisor.stop();
    });

    it('schedules restart on manual trigger', async () => {
        const supervisor = new DaemonSupervisor({
            targetScript: dummyScript,
            debounceMs: 50,
            autoRestartOnCrash: false,
            cwd: tempDir,
        });

        await supervisor.start();
        await supervisor.restart('unit-test');
        await supervisor.stop();
    });
});
