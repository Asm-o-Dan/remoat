import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { InlineKeyboard } from 'grammy';

import { scanInstalledSkills } from '../src/services/skillsScanner';
import { buildSkillsText, sendSkillsUI } from '../src/ui/skillsUi';
import { buildModelsUI, sendModelsUI } from '../src/ui/modelsUi';
import { ModeService, AVAILABLE_MODES, MODE_DISPLAY_NAMES } from '../src/services/modeService';
import { buildModeUI } from '../src/ui/modeUi';
import { WorkspaceBindingRepository } from '../src/database/workspaceBindingRepository';

describe('E2E Bot Suite: Dynamic Agent Skills, Models/Quota, Mode & Shell Execution', () => {

    describe('1. Dynamic Skills Engine', () => {
        it('dynamically discovers skills from Antigravity system directories', () => {
            const skills = scanInstalledSkills();
            expect(Array.isArray(skills)).toBe(true);
            expect(skills.length).toBeGreaterThan(0);

            // Should have parsed real skills with names and descriptions
            const debugSkill = skills.find(s => s.name === 'debug-detective');
            expect(debugSkill).toBeDefined();
            expect(debugSkill?.description.length).toBeGreaterThan(10);
        });

        it('formats skills as tap-to-copy HTML text with pagination controls', async () => {
            const { buildSkillsPayload } = require('../src/ui/skillsUi');
            const payload = buildSkillsPayload(undefined, 0, 6);
            expect(payload.text).toContain('⚡ <b>Antigravity Agent Skills');
            expect(payload.text).toContain('<code>/');
            expect(payload.totalPages).toBeGreaterThan(1);
            expect(payload.currentPage).toBe(0);
            expect(payload.keyboard).toBeDefined();

            const sendFn = jest.fn().mockResolvedValue(undefined);
            await sendSkillsUI(sendFn);
            expect(sendFn).toHaveBeenCalledTimes(1);
            expect(typeof sendFn.mock.calls[0][0]).toBe('string');
            expect(sendFn.mock.calls[0][1]).toBeDefined();
        });
    });

    describe('2. Unified Models & Quota Management UI', () => {
        it('builds compact model UI with real-time quota status directly on buttons', async () => {
            const mockModels = [
                'Gemini 3.7 Pro',
                'Claude 3.7 Sonnet',
                'Claude 3.5 Haiku',
                'GPT-4o',
            ];
            const mockQuota = [
                { model: 'Gemini 3.7 Pro', quotaInfo: { remainingFraction: 0.85 } },
                { model: 'Claude 3.7 Sonnet', quotaInfo: { remainingFraction: 0.40 } },
                { model: 'Claude 3.5 Haiku', quotaInfo: { remainingFraction: 0.00 } },
            ];

            const mockCdp = {
                getUiModels: jest.fn().mockResolvedValue(mockModels),
                getCurrentModel: jest.fn().mockResolvedValue('Gemini 3.7 Pro'),
            };

            const payload = await buildModelsUI(mockCdp as any, async () => mockQuota, 0, 5);
            expect(payload).not.toBeNull();
            expect(payload!.text).toContain('🧠 <b>Model & Quota Management</b>');
            expect(payload!.text).toContain('Current Model:');
            expect(payload!.text).toContain('Gemini 3.7 Pro');

            const kbData = JSON.stringify((payload!.keyboard as any).inline_keyboard);
            // Gemini 3.7 Pro active
            expect(kbData).toContain('Gemini 3.7 Pro');
            expect(kbData).toContain('(85%)');
            // Claude Sonnet 40%
            expect(kbData).toContain('(40%)');
            // Claude Haiku 0% exhausted
            expect(kbData).toContain('⛔');
            expect(kbData).toContain('(0%)');
            expect(kbData).toContain('model_exhausted_');
        });

        it('supports multi-page pagination for long model lists', async () => {
            const mockModels = Array.from({ length: 12 }, (_, i) => `Custom Model ${i + 1}`);
            const mockCdp = {
                getUiModels: jest.fn().mockResolvedValue(mockModels),
                getCurrentModel: jest.fn().mockResolvedValue('Custom Model 1'),
            };

            // Page 0
            const page0 = await buildModelsUI(mockCdp as any, async () => [], 0, 5);
            expect(page0!.text).toContain('Page 1 of 3 (12 available)');
            const kb0 = JSON.stringify((page0!.keyboard as any).inline_keyboard);
            expect(kb0).toContain('Custom Model 1');
            expect(kb0).toContain('Custom Model 5');
            expect(kb0).not.toContain('Custom Model 6');
            expect(kb0).toContain('models_page:1');

            // Page 1
            const page1 = await buildModelsUI(mockCdp as any, async () => [], 1, 5);
            expect(page1!.text).toContain('Page 2 of 3 (12 available)');
            const kb1 = JSON.stringify((page1!.keyboard as any).inline_keyboard);
            expect(kb1).toContain('Custom Model 6');
            expect(kb1).toContain('Custom Model 10');
            expect(kb1).toContain('models_page:0');
            expect(kb1).toContain('models_page:2');
        });
    });

    describe('3. Execution Modes (Default / Full Machine / Turbo Mode)', () => {
        it('supports default, full_machine, and turbo modes', () => {
            const modeService = new ModeService();
            expect(modeService.getCurrentMode()).toBe('default');

            const resFull = modeService.setMode('full_machine');
            expect(resFull.success).toBe(true);
            expect(modeService.getCurrentMode()).toBe('full_machine');

            const resTurbo = modeService.setMode('turbo');
            expect(resTurbo.success).toBe(true);
            expect(modeService.getCurrentMode()).toBe('turbo');
        });

        it('generates rich UI with active marker and buttons for each mode', async () => {
            const modeService = new ModeService();
            modeService.setMode('turbo');

            const { text, keyboard } = await buildModeUI(modeService);
            expect(text).toContain('Execution Mode Management');
            expect(text).toContain('Turbo Mode');
            expect(text).toContain('<b>(Active)</b>');

            const kbData = JSON.stringify((keyboard as any).inline_keyboard);
            expect(kbData).toContain('mode_select:default');
            expect(kbData).toContain('mode_select:full_machine');
            expect(kbData).toContain('mode_select:turbo');
            expect(kbData).toContain('✅ 🚀 Turbo Mode');
        });
    });

    describe('4. Project and Workspace Database Bindings', () => {
        it('upserts workspace bindings in SQLite', () => {
            const db = new Database(':memory:');
            const repo = new WorkspaceBindingRepository(db);

            repo.upsert({ channelId: '12345:1', workspacePath: 'my_awesome_app', guildId: '12345' });
            const found = repo.findByChannelId('12345:1');
            expect(found).toBeDefined();
            expect(found?.workspacePath).toBe('my_awesome_app');

            // Re-binding should update cleanly
            repo.upsert({ channelId: '12345:1', workspacePath: 'another_project', guildId: '12345' });
            const updated = repo.findByChannelId('12345:1');
            expect(updated?.workspacePath).toBe('another_project');
        });
    });

    describe('5. Host Shell Execution Safety', () => {
        it('strips ANSI escape sequence codes from terminal output', () => {
            const ansiOutput = '\x1B[32m[PASS]\x1B[0m Test suite succeeded in \x1B[1m2.5s\x1B[22m';
            const stripped = ansiOutput.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
            expect(stripped).toBe('[PASS] Test suite succeeded in 2.5s');
        });
    });
});
