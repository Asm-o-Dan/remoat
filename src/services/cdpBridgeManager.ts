import { Api, InlineKeyboard } from 'grammy';

import { t } from '../utils/i18n';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/telegramFormatter';
import { ApprovalDetector, ApprovalInfo } from './approvalDetector';
import { AutoAcceptService } from './autoAcceptService';
import { CdpConnectionPool } from './cdpConnectionPool';
import { CdpService } from './cdpService';
import { ErrorPopupDetector, ErrorPopupInfo } from './errorPopupDetector';
import { PlanningDetector, PlanningInfo } from './planningDetector';
import { QuotaService } from './quotaService';
import { UserMessageDetector, UserMessageInfo } from './userMessageDetector';
import { buildPlanNotificationUI } from '../ui/planUi';

/** Represents a Telegram chat target: either a chat_id or chat_id + message_thread_id */
export interface TelegramChannel {
    chatId: number | string;
    threadId?: number;
}

export interface CdpBridge {
    pool: CdpConnectionPool;
    quota: QuotaService;
    autoAccept: AutoAcceptService;
    lastActiveWorkspace: string | null;
    lastActiveChannel: TelegramChannel | null;
    defaultAdminChatId?: string | number | null;
    approvalChannelByWorkspace: Map<string, TelegramChannel>;
    approvalChannelBySession: Map<string, TelegramChannel>;
    botApi: Api | null;
    botToken: string;
}

const APPROVE_ACTION_PREFIX = 'approve_action';
const ALWAYS_ALLOW_ACTION_PREFIX = 'always_allow_action';
const DENY_ACTION_PREFIX = 'deny_action';
const PLANNING_OPEN_ACTION_PREFIX = 'planning_open_action';
const PLANNING_PROCEED_ACTION_PREFIX = 'planning_proceed_action';
const ERROR_POPUP_DISMISS_ACTION_PREFIX = 'error_popup_dismiss_action';
const ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX = 'error_popup_copy_debug_action';
const ERROR_POPUP_RETRY_ACTION_PREFIX = 'error_popup_retry_action';

function normalizeSessionTitle(title: string): string {
    return title.trim().toLowerCase();
}

function buildSessionRouteKey(projectName: string, sessionTitle: string): string {
    return `${projectName}::${normalizeSessionTitle(sessionTitle)}`;
}

const GET_CURRENT_CHAT_TITLE_SCRIPT = `(() => {
    const header = document.querySelector('header');
    if (!header) return '';
    const titleEl = header.querySelector('div[class*="text-ellipsis"]');
    const title = titleEl ? (titleEl.textContent || '').trim() : '';
    if (!title || title === 'Agent') return '';
    return title;
})()`;

async function getCurrentChatTitle(cdp: CdpService): Promise<string | null> {
    const contexts = cdp.getContexts();
    for (const ctx of contexts) {
        try {
            const result = await cdp.call('Runtime.evaluate', {
                expression: GET_CURRENT_CHAT_TITLE_SCRIPT,
                returnByValue: true,
                contextId: ctx.id,
            });
            const value = result?.result?.value;
            if (typeof value === 'string' && value.trim().length > 0) {
                return value.trim();
            }
        } catch (e) { logger.debug('[CdpBridgeManager] Title probe failed, continuing:', e); }
    }
    return null;
}

export function registerApprovalWorkspaceChannel(
    bridge: CdpBridge,
    projectName: string,
    channel: TelegramChannel,
): void {
    bridge.approvalChannelByWorkspace.set(projectName, channel);
}

export function registerApprovalSessionChannel(
    bridge: CdpBridge,
    projectName: string,
    sessionTitle: string,
    channel: TelegramChannel,
): void {
    if (!sessionTitle || sessionTitle.trim().length === 0) return;
    bridge.approvalChannelBySession.set(buildSessionRouteKey(projectName, sessionTitle), channel);
    bridge.approvalChannelByWorkspace.set(projectName, channel);
}

export function resolveApprovalChannelForCurrentChat(
    bridge: CdpBridge,
    projectName: string,
    currentChatTitle: string | null,
): TelegramChannel | null {
    if (currentChatTitle && currentChatTitle.trim().length > 0) {
        const key = buildSessionRouteKey(projectName, currentChatTitle);
        const sessionChannel = bridge.approvalChannelBySession.get(key);
        if (sessionChannel) return sessionChannel;
    }
    const wsChannel = bridge.approvalChannelByWorkspace.get(projectName);
    if (wsChannel) return wsChannel;

    if (bridge.lastActiveChannel) return bridge.lastActiveChannel;

    if (bridge.defaultAdminChatId) {
        return { chatId: bridge.defaultAdminChatId };
    }

    return null;
}

export function buildApprovalCustomId(
    action: string,
    projectName: string,
    channelId?: string,
): string {
    let prefix = DENY_ACTION_PREFIX;
    if (action === 'approve') prefix = APPROVE_ACTION_PREFIX;
    else if (action === 'always_allow') prefix = ALWAYS_ALLOW_ACTION_PREFIX;
    else if (action.startsWith('approve_opt_')) prefix = action;

    if (channelId && channelId.trim().length > 0) {
        return `${prefix}:${projectName}:${channelId}`;
    }
    return `${prefix}:${projectName}`;
}

export function parseApprovalCustomId(customId: string): { action: string; projectName: string | null; channelId: string | null } | null {
    const knownPrefixes = [
        ['approve', APPROVE_ACTION_PREFIX],
        ['always_allow', ALWAYS_ALLOW_ACTION_PREFIX],
        ['deny', DENY_ACTION_PREFIX]
    ];
    for (let i = 1; i <= 9; i++) {
        knownPrefixes.push([`approve_opt_${i}`, `approve_opt_${i}`]);
    }

    for (const [action, prefix] of knownPrefixes) {
        if (customId === prefix) return { action, projectName: null, channelId: null };
        if (customId.startsWith(`${prefix}:`)) {
            const rest = customId.substring(`${prefix}:`.length);
            const [projectName, channelId] = rest.split(':');
            return { action, projectName: projectName || null, channelId: channelId || null };
        }
    }
    return null;
}

export function buildPlanningCustomId(
    action: 'open' | 'proceed',
    projectName: string,
    channelId?: string,
): string {
    const prefix = action === 'open' ? PLANNING_OPEN_ACTION_PREFIX : PLANNING_PROCEED_ACTION_PREFIX;
    if (channelId && channelId.trim().length > 0) return `${prefix}:${projectName}:${channelId}`;
    return `${prefix}:${projectName}`;
}

export function parsePlanningCustomId(customId: string): { action: 'open' | 'proceed'; projectName: string | null; channelId: string | null } | null {
    for (const [action, prefix] of [['open', PLANNING_OPEN_ACTION_PREFIX], ['proceed', PLANNING_PROCEED_ACTION_PREFIX]] as const) {
        if (customId === prefix) return { action, projectName: null, channelId: null };
        if (customId.startsWith(`${prefix}:`)) {
            const rest = customId.substring(`${prefix}:`.length);
            const [projectName, channelId] = rest.split(':');
            return { action, projectName: projectName || null, channelId: channelId || null };
        }
    }
    return null;
}

export function buildErrorPopupCustomId(
    action: 'dismiss' | 'copy_debug' | 'retry',
    projectName: string,
    channelId?: string,
): string {
    const prefix = action === 'dismiss'
        ? ERROR_POPUP_DISMISS_ACTION_PREFIX
        : action === 'copy_debug'
            ? ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX
            : ERROR_POPUP_RETRY_ACTION_PREFIX;
    if (channelId && channelId.trim().length > 0) return `${prefix}:${projectName}:${channelId}`;
    return `${prefix}:${projectName}`;
}

export function parseErrorPopupCustomId(customId: string): { action: 'dismiss' | 'copy_debug' | 'retry'; projectName: string | null; channelId: string | null } | null {
    for (const [action, prefix] of [['dismiss', ERROR_POPUP_DISMISS_ACTION_PREFIX], ['copy_debug', ERROR_POPUP_COPY_DEBUG_ACTION_PREFIX], ['retry', ERROR_POPUP_RETRY_ACTION_PREFIX]] as const) {
        if (customId === prefix) return { action, projectName: null, channelId: null };
        if (customId.startsWith(`${prefix}:`)) {
            const rest = customId.substring(`${prefix}:`.length);
            const [projectName, channelId] = rest.split(':');
            return { action, projectName: projectName || null, channelId: channelId || null };
        }
    }
    return null;
}

export function initCdpBridge(autoApproveDefault: boolean): CdpBridge {
    const pool = new CdpConnectionPool({
        cdpCallTimeout: 15000,
        maxReconnectAttempts: 3,
        reconnectDelayMs: 3000,
    });

    const quota = new QuotaService();
    const autoAccept = new AutoAcceptService(autoApproveDefault);

    return {
        pool,
        quota,
        autoAccept,
        lastActiveWorkspace: null,
        lastActiveChannel: null,
        defaultAdminChatId: null,
        approvalChannelByWorkspace: new Map(),
        approvalChannelBySession: new Map(),
        botApi: null,
        botToken: '',
    };
}

export function getCurrentCdp(bridge: CdpBridge): CdpService | null {
    if (bridge.lastActiveWorkspace) {
        const cdp = bridge.pool.getConnected(bridge.lastActiveWorkspace);
        if (cdp) return cdp;
    }
    const activeNames = bridge.pool.getActiveWorkspaceNames();
    if (activeNames.length > 0) {
        return bridge.pool.getConnected(activeNames[0]);
    }
    return null;
}

async function sendTelegramMessage(
    api: Api,
    channel: TelegramChannel,
    text: string,
    keyboard?: InlineKeyboard,
): Promise<number | null> {
    try {
        const msg = await api.sendMessage(channel.chatId, text, {
            parse_mode: 'HTML',
            message_thread_id: channel.threadId,
            reply_markup: keyboard,
        });
        return msg.message_id;
    } catch (err) {
        logger.error('[Telegram] Failed to send message:', err);
        return null;
    }
}

export function ensureApprovalDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    projectName: string,
): void {
    const existing = bridge.pool.getApprovalDetector(projectName);
    if (existing && existing.isActive()) return;

    let lastMessageId: number | null = null;
    let lastMessageChatId: number | string | null = null;

    const detector = new ApprovalDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onResolved: () => {
            if (!lastMessageId || !lastMessageChatId || !bridge.botApi) return;
            const msgId = lastMessageId;
            const chatId = lastMessageChatId;
            lastMessageId = null;
            lastMessageChatId = null;
            bridge.botApi.editMessageReplyMarkup(chatId, msgId, { reply_markup: undefined })
                .catch((e) => logger.debug('[ApprovalDetector] Markup remove failed (expected if already removed):', e));
        },
        onApprovalRequired: async (info: ApprovalInfo) => {
            logger.debug(`[ApprovalDetector:${projectName}] Approval detected`);

            const currentChatTitle = await getCurrentChatTitle(cdp);
            const targetChannel = resolveApprovalChannelForCurrentChat(bridge, projectName, currentChatTitle);

            if (!targetChannel || !bridge.botApi) {
                logger.warn(`[ApprovalDetector:${projectName}] Skipped — no target channel`);
                return;
            }

            const targetChannelStr = targetChannel.threadId ? String(targetChannel.threadId) : String(targetChannel.chatId);

            if (bridge.autoAccept.isEnabled()) {
                const accepted = await detector.alwaysAllowButton() || await detector.approveButton();
                const text = accepted
                    ? `✅ <b>Auto-approved</b>\n${info.isQuestionModal ? `Auto-confirmed: ${escapeHtml(info.questionTitle || 'Permission')}` : 'An action was automatically approved.'}\n<b>Workspace:</b> ${escapeHtml(projectName)}`
                    : `⚠️ <b>Auto-approve failed</b>\nManual approval required.\n<b>Workspace:</b> ${escapeHtml(projectName)}`;
                await sendTelegramMessage(bridge.botApi, targetChannel, text);
                if (accepted) return;
            }

            if (info.isQuestionModal) {
                let text = `🔒 <b>${escapeHtml(info.questionTitle || 'Permission / Selection Required')}</b>\n\n`;
                if (info.targetText) {
                    text += `<b>Resource:</b> <code>${escapeHtml(info.targetText)}</code>\n\n`;
                }
                if (info.options && info.options.length > 0) {
                    text += `<b>Available Options:</b>\n`;
                    info.options.forEach(opt => {
                        text += `<b>${opt.index}.</b> ${escapeHtml(opt.text)}\n`;
                    });
                }
                text += `\n<b>Workspace:</b> ${escapeHtml(projectName)}`;

                const keyboard = new InlineKeyboard();
                if (info.options && info.options.length > 0) {
                    info.options.forEach((opt, idx) => {
                        const optLabel = opt.text.length > 25 ? opt.text.substring(0, 22) + '...' : opt.text;
                        keyboard.text(`${opt.index}. ${optLabel}`, buildApprovalCustomId(`approve_opt_${opt.index}`, projectName, targetChannelStr));
                        if ((idx + 1) % 2 === 0) keyboard.row();
                    });
                }
                keyboard.row().text(`❌ ${info.denyText || 'Skip'}`, buildApprovalCustomId('deny', projectName, targetChannelStr));
                keyboard.row().text('📸 Скриншот окна', `screenshot_action:${projectName}`);

                const msgId = await sendTelegramMessage(bridge.botApi, targetChannel, text, keyboard);
                if (msgId) {
                    lastMessageId = msgId;
                    lastMessageChatId = targetChannel.chatId;
                }
                return;
            }

            let text = `🔔 <b>Approval Required</b>\n\n`;
            if (info.description) text += `${escapeHtml(info.description)}\n\n`;
            text += `<b>Approve:</b> ${escapeHtml(info.approveText)}\n`;
            if (info.alwaysAllowText) text += `<b>Always:</b> ${escapeHtml(info.alwaysAllowText)}\n`;
            text += `<b>Deny:</b> ${escapeHtml(info.denyText || '(None)')}\n`;
            text += `<b>Workspace:</b> ${escapeHtml(projectName)}`;

            const approveLabel = info.approveText.replace(/[⌃⌥⇧⏎⌘\u2318\u2325\u21B5]+/g, '').trim() || 'Allow';
            const denyLabel = info.denyText || 'Deny';
            const keyboard = new InlineKeyboard()
                .text(`✅ ${approveLabel}`, buildApprovalCustomId('approve', projectName, targetChannelStr));
            if (info.alwaysAllowText) {
                keyboard.text('✅ Allow Chat', buildApprovalCustomId('always_allow', projectName, targetChannelStr));
            }
            keyboard.text(`❌ ${denyLabel}`, buildApprovalCustomId('deny', projectName, targetChannelStr));
            keyboard.row().text('📸 Скриншот окна', `screenshot_action:${projectName}`);

            const msgId = await sendTelegramMessage(bridge.botApi, targetChannel, text, keyboard);
            if (msgId) {
                lastMessageId = msgId;
                lastMessageChatId = targetChannel.chatId;
            }
        },
    });

    detector.start();
    bridge.pool.registerApprovalDetector(projectName, detector);
    logger.debug(`[ApprovalDetector:${projectName}] Started`);
}

export function ensurePlanningDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    projectName: string,
): void {
    const existing = bridge.pool.getPlanningDetector(projectName);
    if (existing && existing.isActive()) return;

    let lastMessageId: number | null = null;
    let lastMessageChatId: number | string | null = null;

    const detector = new PlanningDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onResolved: () => {
            if (!lastMessageId || !lastMessageChatId || !bridge.botApi) return;
            const msgId = lastMessageId;
            const chatId = lastMessageChatId;
            lastMessageId = null;
            lastMessageChatId = null;
            bridge.botApi.editMessageReplyMarkup(chatId, msgId, { reply_markup: undefined })
                .catch((e) => logger.debug('[PlanningDetector] Markup remove failed (expected if already removed):', e));
        },
        onPlanningRequired: async (info: PlanningInfo) => {
            logger.debug(`[PlanningDetector:${projectName}] Planning detected`);

            const currentChatTitle = await getCurrentChatTitle(cdp);
            const targetChannel = resolveApprovalChannelForCurrentChat(bridge, projectName, currentChatTitle);

            if (!targetChannel || !bridge.botApi) return;

            const targetChannelStr = targetChannel.threadId ? String(targetChannel.threadId) : String(targetChannel.chatId);

            const { text, keyboard } = buildPlanNotificationUI(info, projectName, targetChannelStr);

            const msgId = await sendTelegramMessage(bridge.botApi, targetChannel, text, keyboard);
            if (msgId) {
                lastMessageId = msgId;
                lastMessageChatId = targetChannel.chatId;
            }
        },
        onAutoOpened: async (chipText: string) => {
            logger.debug(`[PlanningDetector:${projectName}] Auto-opened chip: ${chipText}`);
        },
    });

    detector.start();
    bridge.pool.registerPlanningDetector(projectName, detector);
    logger.debug(`[PlanningDetector:${projectName}] Started`);
}

export function ensureErrorPopupDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    projectName: string,
): void {
    const existing = bridge.pool.getErrorPopupDetector(projectName);
    if (existing && existing.isActive()) return;

    let lastMessageId: number | null = null;
    let lastMessageChatId: number | string | null = null;

    const detector = new ErrorPopupDetector({
        cdpService: cdp,
        pollIntervalMs: 2000,
        onResolved: () => {
            if (!lastMessageId || !lastMessageChatId || !bridge.botApi) return;
            const msgId = lastMessageId;
            const chatId = lastMessageChatId;
            lastMessageId = null;
            lastMessageChatId = null;
            bridge.botApi.editMessageReplyMarkup(chatId, msgId, { reply_markup: undefined })
                .catch((e) => logger.debug('[ErrorPopupDetector] Markup remove failed (expected if already removed):', e));
        },
        onErrorPopup: async (info: ErrorPopupInfo) => {
            logger.debug(`[ErrorPopupDetector:${projectName}] Error popup detected`);

            const currentChatTitle = await getCurrentChatTitle(cdp);
            const targetChannel = resolveApprovalChannelForCurrentChat(bridge, projectName, currentChatTitle);

            if (!targetChannel || !bridge.botApi) return;

            const targetChannelStr = targetChannel.threadId ? String(targetChannel.threadId) : String(targetChannel.chatId);

            let text = `🚨 <b>${escapeHtml(info.title || 'Error Dialog Detected')}</b>\n\n`;
            if (info.body) text += `${escapeHtml(info.body)}\n\n`;
            text += `<b>Workspace:</b> ${escapeHtml(projectName)}`;

            const keyboard = new InlineKeyboard();
            if (info.buttons && info.buttons.length > 0) {
                info.buttons.forEach((btnText) => {
                    const norm = btnText.toLowerCase();
                    if (norm.includes('retry') || norm.includes('повтор')) {
                        keyboard.text(`🔄 ${escapeHtml(btnText)}`, buildErrorPopupCustomId('retry', projectName, targetChannelStr));
                    } else if (norm.includes('debug') || norm.includes('copy')) {
                        keyboard.text(`📋 ${escapeHtml(btnText)}`, buildErrorPopupCustomId('copy_debug', projectName, targetChannelStr));
                    } else {
                        keyboard.text(`✕ ${escapeHtml(btnText)}`, buildErrorPopupCustomId('dismiss', projectName, targetChannelStr));
                    }
                });
            } else {
                keyboard.text('✕ Dismiss', buildErrorPopupCustomId('dismiss', projectName, targetChannelStr));
            }
            keyboard.row().text('📸 Скриншот окна', `screenshot_action:${projectName}`);

            const msgId = await sendTelegramMessage(bridge.botApi, targetChannel, text, keyboard);
            if (msgId) {
                lastMessageId = msgId;
                lastMessageChatId = targetChannel.chatId;
            }
        },
    });

    detector.start();
    bridge.pool.registerErrorPopupDetector(projectName, detector);
    logger.debug(`[ErrorPopupDetector:${projectName}] Started`);
}

export function ensureUserMessageDetector(
    bridge: CdpBridge,
    cdp: CdpService,
    projectName: string,
): void {
    const existing = bridge.pool.getUserMessageDetector(projectName);
    if (existing && existing.isActive()) return;

    const detector = new UserMessageDetector({
        cdpService: cdp,
        pollIntervalMs: 1500,
        onUserMessage: async (info: UserMessageInfo) => {
            logger.debug(`[UserMessageDetector:${projectName}] User message: ${info.text.substring(0, 30)}`);

            const currentChatTitle = await getCurrentChatTitle(cdp);
            const targetChannel = resolveApprovalChannelForCurrentChat(bridge, projectName, currentChatTitle);

            if (!targetChannel || !bridge.botApi) return;

            const text = `💬 <b>Antigravity Input (${escapeHtml(projectName)})</b>\n\n` +
                `<blockquote>${escapeHtml(info.text)}</blockquote>`;

            await sendTelegramMessage(bridge.botApi, targetChannel, text);
        },
    });

    detector.start();
    bridge.pool.registerUserMessageDetector(projectName, detector);
    logger.debug(`[UserMessageDetector:${projectName}] Started`);
}
