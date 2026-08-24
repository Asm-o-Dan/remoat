import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import Database from 'better-sqlite3';
import { Bot } from 'grammy';

import { TelegramSimulator } from '../harness/telegramSimulator';
import { createBot } from '../../src/bot';
import { WorkspaceService } from '../../src/services/workspaceService';
import { WorkspaceBindingRepository } from '../../src/database/workspaceBindingRepository';
import { ChatSessionRepository } from '../../src/database/chatSessionRepository';
import { TemplateRepository } from '../../src/database/templateRepository';
import { ModeService } from '../../src/services/modeService';
import { AppConfig } from '../../src/utils/config';

import { EventEmitter } from 'events';

describe('Integration Test Suite: Workspace & Project Management via Telegram', () => {
    let tempDir: string;
    let testBaseDir: string;
    let db: Database.Database;
    let simulator: TelegramSimulator;
    let workspaceService: WorkspaceService;
    let workspaceBindingRepo: WorkspaceBindingRepository;

    // Mock bridge with pool and cdp
    const mockCdp = {
        isConnected: jest.fn().mockReturnValue(true),
        getCurrentWorkspaceName: jest.fn().mockReturnValue('my_awesome_app'),
        getUiModels: jest.fn().mockResolvedValue(['Gemini 3.7 Flash High', 'Claude Sonnet 4.6']),
        getCurrentModel: jest.fn().mockResolvedValue('Gemini 3.7 Flash High'),
        setUiModel: jest.fn().mockResolvedValue({ ok: true, model: 'Claude Sonnet 4.6' }),
        injectMessage: jest.fn().mockResolvedValue({ ok: true }),
        startNewChat: jest.fn().mockResolvedValue(true),
        switchProjectInSidebar: jest.fn().mockResolvedValue(true),
        createNewProjectQuickStart: jest.fn().mockResolvedValue({ ok: true, projectName: 'my_awesome_app' }),
        getPrimaryContextId: jest.fn().mockReturnValue(1),
        call: jest.fn().mockResolvedValue({ result: { value: true } }),
    };

    const mockPool = Object.assign(new EventEmitter(), {
        getOrConnect: jest.fn().mockResolvedValue(mockCdp),
        getConnected: jest.fn().mockReturnValue(mockCdp),
        disconnectWorkspace: jest.fn(),
        closeBrowserWorkspace: jest.fn().mockResolvedValue(undefined),
        disconnectAll: jest.fn(),
        getActiveWorkspaceNames: jest.fn().mockReturnValue(['my_awesome_app']),
    });

    const mockBridge = {
        pool: mockPool,
        quota: { fetchQuota: jest.fn().mockResolvedValue([]) },
        getCurrentCdp: jest.fn().mockReturnValue(mockCdp),
    };

    beforeEach(async () => {
        // Setup isolated temp directory for test workspaces
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remoat_ws_test_'));
        testBaseDir = path.join(tempDir, 'workspaces');
        fs.mkdirSync(testBaseDir, { recursive: true });

        // Setup in-memory SQLite database
        db = new Database(':memory:');
        workspaceBindingRepo = new WorkspaceBindingRepository(db);
        const chatSessionRepo = new ChatSessionRepository(db);
        const templateRepo = new TemplateRepository(db);
        workspaceService = new WorkspaceService(testBaseDir);
        const modeService = new ModeService();

        const config: AppConfig = {
            telegramBotToken: '123456:TEST_MOCK_TOKEN',
            allowedUserIds: ['999888'],
            workspaceBaseDir: testBaseDir,
            logLevel: 'error',
            extractionMode: 'structured',
            autoApproveFileEdits: false,
            useTopics: false,
        };

        const bot = createBot({
            config,
            db,
            bridge: mockBridge as any,
            workspaceBindingRepo,
            chatSessionRepo,
            templateRepo,
            workspaceService,
            modeService,
        });

        simulator = new TelegramSimulator(bot);
        await simulator.init();
    });

    afterEach(() => {
        db.close();
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch {}
    });

    describe('1. /newproject Command', () => {
        it('triggers Quick Start in Antigravity, binds topic in SQLite, and initializes chat session', async () => {
            const replies = await simulator.sendText('/newproject my_awesome_app');

            // 1. SQLite Database binding check
            const defaultChannelKey = `12345678`;
            const binding = workspaceBindingRepo.findByChannelId(defaultChannelKey);
            expect(binding).toBeDefined();
            expect(binding?.workspacePath).toBe('my_awesome_app');

            // 2. Cdp Quick Start invocation check
            expect(mockCdp.createNewProjectQuickStart).toHaveBeenCalled();

            // 3. Telegram user response check
            const allText = replies.map(r => r.text).join('\n');
            expect(allText).toContain('Project Created & Ready!');
            expect(allText).toContain('my_awesome_app');
        });
    });

    describe('2. /project List and Interactive Button Switching', () => {
        beforeEach(() => {
            // Seed 3 test workspaces
            fs.mkdirSync(path.join(testBaseDir, 'project_alpha'), { recursive: true });
            fs.mkdirSync(path.join(testBaseDir, 'project_beta'), { recursive: true });
            fs.mkdirSync(path.join(testBaseDir, 'project_gamma'), { recursive: true });
        });

        it('lists all workspaces and provides inline selection buttons', async () => {
            const replies = await simulator.sendText('/project');
            expect(replies.length).toBe(1);

            const msg = replies[0];
            expect(msg.text).toContain('Select a project');
            expect(msg.replyMarkup).toBeDefined();

            // Extract inline buttons
            const buttons: any[] = [];
            for (const row of msg.replyMarkup.inline_keyboard) {
                for (const btn of row) {
                    buttons.push(btn);
                }
            }

            const alphaBtn = buttons.find(b => b.text.includes('project_alpha'));
            const betaBtn = buttons.find(b => b.text.includes('project_beta'));
            expect(alphaBtn).toBeDefined();
            expect(betaBtn).toBeDefined();
            expect(alphaBtn.callback_data).toBe('project_select:project_alpha');
        });

        it('switches current chat binding when project button is clicked', async () => {
            await simulator.sendText('/project');

            // User clicks "project_beta"
            const { toast } = await simulator.clickButton('project_select:project_beta');

            // SQLite binding must now be project_beta
            const binding = workspaceBindingRepo.findByChannelId('12345678');
            expect(binding?.workspacePath).toBe('project_beta');

            // Telegram UI feedback
            const lastMsg = simulator.getLastMessage();
            expect(lastMsg?.text).toContain('Project Selected');
            expect(lastMsg?.text).toContain('project_beta');
            expect(toast?.text).toContain('project_beta');
        });
    });

    describe('4. Multi-Topic Supergroup Isolation', () => {
        it('isolates different Telegram forum topics to separate projects', async () => {
            const groupId = -1001999888777;

            // Topic 101: creates frontend
            await simulator.sendText('/newproject client_frontend', {
                chatId: groupId,
                threadId: 101,
                isGroup: true,
            });

            // Topic 102: creates backend
            await simulator.sendText('/newproject server_backend', {
                chatId: groupId,
                threadId: 102,
                isGroup: true,
            });

            // Verify Topic 101 binding
            const topic101Key = `${groupId}:101`;
            const binding101 = workspaceBindingRepo.findByChannelId(topic101Key);
            expect(binding101?.workspacePath).toBe('client_frontend');

            // Verify Topic 102 binding
            const topic102Key = `${groupId}:102`;
            const binding102 = workspaceBindingRepo.findByChannelId(topic102Key);
            expect(binding102?.workspacePath).toBe('server_backend');

            // Verify independent directories
            expect(fs.existsSync(path.join(testBaseDir, 'client_frontend'))).toBe(true);
            expect(fs.existsSync(path.join(testBaseDir, 'server_backend'))).toBe(true);
        });
    });
});
