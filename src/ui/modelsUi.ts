import { InlineKeyboard } from 'grammy';
import { CdpService } from '../services/cdpService';
import { escapeHtml } from '../utils/telegramFormatter';

export interface ModelsUiDeps {
    getCurrentCdp: () => CdpService | null;
    fetchQuota: () => Promise<any[]>;
}

export interface ModelsUiPayload {
    text: string;
    keyboard: InlineKeyboard;
}

export const MODEL_PAGE_SIZE = 5;

declare global {
    var modelSwitchMap: Map<string, string> | undefined;
}

global.modelSwitchMap = global.modelSwitchMap || new Map();

/**
 * Builds a unified, compact Model & Quota switcher UI with inline pagination.
 */
export async function buildModelsUI(
    cdp: CdpService,
    fetchQuota: () => Promise<any[]>,
    page = 0,
    pageSize = MODEL_PAGE_SIZE,
): Promise<ModelsUiPayload | null> {
    const quotaData = await fetchQuota();
    let currentModel = await cdp.getCurrentModel();

    let models: string[] = [];
    if (quotaData && quotaData.length > 0) {
        // Prioritize actual LLM models from the language server
        models = quotaData.map(q => q.label || q.model).filter(Boolean);
    } else {
        // Fallback: try CDP UI models
        models = await cdp.getUiModels();
    }

    if (models.length === 0) return null;

    if (!currentModel && models.length > 0) {
        currentModel = models[0];
    }

    const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '');

    function getQuotaForModel(mName: string) {
        if (!mName) return null;
        const nName = normalize(mName);
        return quotaData.find(q => {
            const nLabel = normalize(q.label || '');
            const nModel = normalize(q.model || '');
            const matchLabel = Boolean(nLabel && (nLabel === nName || nName.includes(nLabel) || nLabel.includes(nName)));
            const matchModel = Boolean(nModel && (nModel === nName || nName.includes(nModel) || nModel.includes(nName)));
            return matchLabel || matchModel;
        });
    }

    const totalPages = Math.max(1, Math.ceil(models.length / pageSize));
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = currentPage * pageSize;
    const pageModels = models.slice(startIndex, startIndex + pageSize);

    // Minimal, clean text header
    const currentDisplayName = currentModel || 'None';
    let text = `🧠 <b>Model & Quota Management</b>\n\n`;
    text += `<b>Current Model:</b> ⚡ <b>${escapeHtml(currentDisplayName)}</b>\n`;
    text += `<i>Page ${currentPage + 1} of ${totalPages} (${models.length} available)</i>`;

    const keyboard = new InlineKeyboard();

    for (let i = 0; i < pageModels.length; i++) {
        const mName = pageModels[i];
        const isCurrent = mName === currentModel;
        const q = getQuotaForModel(mName);
        const rem = q?.quotaInfo?.remainingFraction;

        let quotaLabel = '';
        let icon = '⚪';
        let isExhausted = false;

        if (rem !== undefined && rem !== null && !isNaN(rem)) {
            const percent = Math.round(rem * 100);
            if (percent <= 0) {
                icon = '⛔';
                quotaLabel = ' (0%)';
                isExhausted = true;
            } else if (percent <= 20) {
                icon = '🔴';
                quotaLabel = ` (${percent}%)`;
            } else if (percent <= 50) {
                icon = '🟡';
                quotaLabel = ` (${percent}%)`;
            } else {
                icon = '🟢';
                quotaLabel = ` (${percent}%)`;
            }
        }

        const activePrefix = isExhausted ? '⛔ ' : (isCurrent ? '✅ ' : `${icon} `);
        const cleanName = mName.length > 26 ? mName.slice(0, 23) + '...' : mName;
        const buttonText = `${activePrefix}${cleanName}${quotaLabel}`;

        const key = `m_${currentPage}_${i}_` + Math.random().toString(36).slice(2, 6);
        global.modelSwitchMap?.set(key, mName);
        if (global.modelSwitchMap && global.modelSwitchMap.size > 150) {
            const firstKey = global.modelSwitchMap.keys().next().value;
            if (firstKey) global.modelSwitchMap.delete(firstKey);
        }

        const callbackData = isExhausted ? `model_exhausted_${key}` : `model_btn_${key}`;
        keyboard.text(buttonText, callbackData).row();
    }

    // Pagination row
    if (totalPages > 1) {
        if (currentPage > 0) {
            keyboard.text('⬅️ Prev', `models_page:${currentPage - 1}`);
        } else {
            keyboard.text('▪️', 'models_noop');
        }

        keyboard.text(`📄 ${currentPage + 1}/${totalPages}`, 'models_noop');

        if (currentPage < totalPages - 1) {
            keyboard.text('Next ➡️', `models_page:${currentPage + 1}`);
        } else {
            keyboard.text('▪️', 'models_noop');
        }
        keyboard.row();
    }

    keyboard.text('🔄 Refresh Quota', `models_refresh_btn:${currentPage}`).row();

    return { text, keyboard };
}

export async function sendModelsUI(
    sendFn: (text: string, keyboard: InlineKeyboard) => Promise<void>,
    deps: ModelsUiDeps,
    page = 0,
): Promise<void> {
    const cdp = deps.getCurrentCdp();
    if (!cdp) {
        await sendFn('Not connected to CDP.', new InlineKeyboard());
        return;
    }

    const payload = await buildModelsUI(cdp, deps.fetchQuota, page);
    if (!payload) {
        await sendFn('Failed to retrieve model list from Antigravity.', new InlineKeyboard());
        return;
    }

    await sendFn(payload.text, payload.keyboard);
}
