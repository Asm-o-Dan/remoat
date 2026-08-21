import { sendModelsUI, buildModelsUI } from '../../src/ui/modelsUi';
import { InlineKeyboard } from 'grammy';

describe('modelsUi', () => {
    it('sends a connection error message when not connected', async () => {
        const sendFn = jest.fn().mockResolvedValue(undefined);
        await sendModelsUI(sendFn, {
            getCurrentCdp: () => null,
            fetchQuota: async () => [],
        });

        expect(sendFn).toHaveBeenCalledTimes(1);
        expect(sendFn.mock.calls[0][0]).toBe('Not connected to CDP.');
        expect(sendFn.mock.calls[0][1]).toBeInstanceOf(InlineKeyboard);
    });

    it('sends text and keyboard when models are available', async () => {
        const sendFn = jest.fn().mockResolvedValue(undefined);
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Model A', 'Model B']),
            getCurrentModel: jest.fn().mockResolvedValue('Model A'),
        };

        await sendModelsUI(sendFn, {
            getCurrentCdp: () => cdp as any,
            fetchQuota: async () => [],
        });

        expect(sendFn).toHaveBeenCalledTimes(1);
        const text = sendFn.mock.calls[0][0] as string;
        expect(text).toContain('Model & Quota Management');
        expect(text).toContain('Model A');
        expect(sendFn.mock.calls[0][1]).toBeInstanceOf(InlineKeyboard);
    });
});

describe('buildModelsUI', () => {
    it('returns null when no models are available', async () => {
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue([]),
            getCurrentModel: jest.fn().mockResolvedValue(null),
        };

        const result = await buildModelsUI(cdp as any, async () => []);
        expect(result).toBeNull();
    });

    it('returns text and keyboard when models are available', async () => {
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Model A', 'Model B']),
            getCurrentModel: jest.fn().mockResolvedValue('Model A'),
        };

        const result = await buildModelsUI(cdp as any, async () => []);
        expect(result).not.toBeNull();
        expect(result!.text).toContain('Model & Quota Management');
        expect(result!.text).toContain('Model A');
        expect(result!.keyboard).toBeInstanceOf(InlineKeyboard);
    });

    it('shows exhausted status on button when remainingFraction is 0', async () => {
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Model A']),
            getCurrentModel: jest.fn().mockResolvedValue('Model A'),
        };
        const quota = [{
            label: 'Model A',
            model: 'model_a',
            quotaInfo: { remainingFraction: 0, resetTime: new Date(Date.now() + 3600000).toISOString() },
        }];

        const result = await buildModelsUI(cdp as any, async () => quota);
        const kbData = JSON.stringify((result!.keyboard as any).inline_keyboard);
        expect(kbData).toContain('⛔');
        expect(kbData).toContain('(0%)');
        expect(kbData).toContain('model_exhausted_');
    });

    it('shows percentage on button when remainingFraction is between 0 and 1', async () => {
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Model A']),
            getCurrentModel: jest.fn().mockResolvedValue('Model A'),
        };
        const quota = [{
            label: 'Model A',
            model: 'model_a',
            quotaInfo: { remainingFraction: 0.6, resetTime: new Date(Date.now() + 3600000).toISOString() },
        }];

        const result = await buildModelsUI(cdp as any, async () => quota);
        const kbData = JSON.stringify((result!.keyboard as any).inline_keyboard);
        expect(kbData).toContain('(60%)');
        expect(kbData).toContain('Model A');
    });

    it('handles pagination properly when models exceed page size', async () => {
        const models = ['Model 1', 'Model 2', 'Model 3', 'Model 4', 'Model 5', 'Model 6', 'Model 7'];
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(models),
            getCurrentModel: jest.fn().mockResolvedValue('Model 1'),
        };

        const page0 = await buildModelsUI(cdp as any, async () => [], 0, 5);
        expect(page0!.text).toContain('Page 1 of 2');
        const kb0 = JSON.stringify((page0!.keyboard as any).inline_keyboard);
        expect(kb0).toContain('Model 1');
        expect(kb0).toContain('Model 5');
        expect(kb0).not.toContain('Model 6');
        expect(kb0).toContain('Next ➡️');

        const page1 = await buildModelsUI(cdp as any, async () => [], 1, 5);
        expect(page1!.text).toContain('Page 2 of 2');
        const kb1 = JSON.stringify((page1!.keyboard as any).inline_keyboard);
        expect(kb1).toContain('Model 6');
        expect(kb1).toContain('Model 7');
        expect(kb1).toContain('⬅️ Prev');
    });

    it('uses model_exhausted_ callback prefix for exhausted model buttons', async () => {
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Healthy Model', 'Dead Model']),
            getCurrentModel: jest.fn().mockResolvedValue('Healthy Model'),
        };
        const quota = [
            { label: 'Healthy Model', model: 'healthy', quotaInfo: { remainingFraction: 0.8, resetTime: '' } },
            { label: 'Dead Model', model: 'dead', quotaInfo: { remainingFraction: 0, resetTime: new Date(Date.now() + 3600000).toISOString() } },
        ];

        const result = await buildModelsUI(cdp as any, async () => quota);
        const kbData = JSON.stringify((result!.keyboard as any).inline_keyboard);
        expect(kbData).toContain('model_btn_');
        expect(kbData).toContain('model_exhausted_');
        expect(kbData).toContain('⛔');
        expect(kbData).toContain('Dead Model');
    });

    it('sendModelsUI delegates to buildModelsUI', async () => {
        const sendFn = jest.fn().mockResolvedValue(undefined);
        const cdp = {
            getUiModels: jest.fn().mockResolvedValue(['Model A']),
            getCurrentModel: jest.fn().mockResolvedValue('Model A'),
        };

        await sendModelsUI(sendFn, {
            getCurrentCdp: () => cdp as any,
            fetchQuota: async () => [],
        });

        const text = sendFn.mock.calls[0][0] as string;
        expect(text).toContain('Model A');
    });
});
