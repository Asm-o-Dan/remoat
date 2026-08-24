import { logger } from '../utils/logger';
import { CdpService } from './cdpService';

/** Approval button information */
export interface ApprovalInfo {
    /** Allow button text (e.g. "Allow") */
    approveText: string;
    /** Per-conversation allow button text (e.g. "Allow This Conversation") */
    alwaysAllowText?: string;
    /** Deny button text (e.g. "Deny") */
    denyText: string;
    /** Action description (e.g. "write to file.ts") */
    description: string;
    /** Whether this dialog is an interactive question / selection / URL permission modal */
    isQuestionModal?: boolean;
    /** Title / header of the question modal */
    questionTitle?: string;
    /** Target URL or resource */
    targetText?: string;
    /** List of selectable options */
    options?: Array<{ index: number; text: string }>;
}

export interface ApprovalDetectorOptions {
    /** CDP service instance */
    cdpService: CdpService;
    /** Poll interval in milliseconds (default: 1500ms) */
    pollIntervalMs?: number;
    /** Callback when an approval button is detected */
    onApprovalRequired: (info: ApprovalInfo) => void;
    /** Callback when a previously detected approval is resolved (buttons disappeared) */
    onResolved?: () => void;
}

/**
 * Approval button and interactive question detection script for Antigravity UI
 */
const DETECT_APPROVAL_SCRIPT = `(() => {
    const ALLOW_ONCE_PATTERNS = [
        'allow once', 'allow one time', 'разрешить один раз', 'выполнить один раз',
        'proceed', 'continue', 'продолжить',
        '今回のみ許可', '1回のみ許可', '一度許可'
    ];
    const ALWAYS_ALLOW_PATTERNS = [
        'allow this conversation',
        'allow this chat',
        'always allow',
        'всегда разрешать',
        'разрешить для этой беседы',
        'разрешать всегда',
        'всегда выполнять',
        '常に許可',
        'この会話を許可',
    ];
    const ALLOW_PATTERNS = [
        'allow', 'permit', 'accept', 'approve', 'confirm',
        'разрешить', 'подтвердить', 'принять', 'согласен',
        '許可', '承認', '確認', '実行'
    ];
    const DENY_PATTERNS = [
        'deny', 'reject', 'cancel', 'decline', 'dismiss', 'block',
        'отклонить', 'отмена', 'запретить', 'отменить', 'блокировать',
        '拒否', '却下'
    ];
    const IGNORE_PATTERNS = [
        'finished', 'completed', 'failed', 'running', 'success', 'succeeded', 'завершено', 'выполнено'
    ];

    const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();

    const allButtons = Array.from(document.querySelectorAll('button'))
        .filter(btn => btn.offsetParent !== null || (btn.getBoundingClientRect && btn.getBoundingClientRect().width > 0));

    // =========================================================================
    // Path A: Interactive Question / URL / Command Permission Modal (Submit + Skip / Options)
    // =========================================================================
    const submitBtn = allButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        const aria = normalize(btn.getAttribute('aria-label') || '');
        return /^(submit|confirm|proceed|continue|apply|отправить|подтвердить|продолжить|применить)\b/i.test(t) || /submit|confirm/i.test(aria);
    });
    if (submitBtn) {
        let modal = submitBtn.closest('[role="dialog"], [role="alertdialog"], .modal, .dialog, [class*="modal"], [class*="dialog"]');
        if (!modal) {
            let curr = submitBtn.parentElement;
            while (curr && curr !== document.body) {
                const text = normalize(curr.textContent || '');
                const hasHeader = curr.querySelector('h1, h2, h3, h4, [class*="font-semibold"], [class*="font-bold"]');
                if (hasHeader && (text.includes('allow') || text.includes('permission') || text.includes('command') || text.includes('url') || text.includes('question') || text.includes('разреш') || text.includes('вариант') || text.includes('выберите'))) {
                    modal = curr;
                    break;
                }
                if (curr.children.length >= 2 && (text.includes('allow') || text.includes('permission') || text.includes('command') || text.includes('1 yes') || text.includes('1. ') || text.includes('вариант') || text.includes('option'))) {
                    modal = curr;
                    break;
                }
                curr = curr.parentElement;
            }
        }
        if (!modal) modal = submitBtn.parentElement?.parentElement?.parentElement || document.body;

        const skipBtn = allButtons.find(btn => {
            const t = normalize(btn.textContent || '');
            const aria = normalize(btn.getAttribute('aria-label') || '');
            return /^(skip|cancel|отмена|пропустить)\b/i.test(t) || /skip/i.test(aria);
        });

        // 1. Look for question header
        const headerEl = modal.querySelector('h1, h2, h3, h4, [class*="font-bold"], [class*="font-semibold"], [class*="title"]')
            || Array.from(modal.querySelectorAll('div, p, span')).find(el => {
                const t = normalize(el.textContent || '');
                return t.startsWith('allow ') || t.startsWith('do you want to') || t.startsWith('разрешить') || t.startsWith('выберите') || t.endsWith('?');
            });
        let questionTitle = headerEl ? (headerEl.textContent || '').trim() : '';

        // 2. Look for target / command badge
        const badgeEl = modal.querySelector('code, pre, [class*="bg-muted"], [class*="bg-secondary"], [class*="bg-background"], input')
            || Array.from(modal.querySelectorAll('div, p')).find(el => {
                const t = (el.textContent || '').trim();
                return t.length > 0 && t !== questionTitle && !/^(submit|skip|cancel|1\b|2\b|3\b|4\b|5\b)/i.test(t);
            });
        let targetText = badgeEl ? (badgeEl.textContent || badgeEl.value || '').trim() : '';

        // 3. Extract option items (e.g. 1 Yes, allow this time... or Вариант 1...)
        const rawOptions = Array.from(modal.querySelectorAll('div, li, label, [role="radio"], [role="option"], [role="checkbox"], p, span')).filter(el => {
            if (el.children.length > 3) return false;
            const t = normalize(el.textContent || '');
            if (t.length < 2 || t.length > 300) return false;
            if (/^(submit|skip|cancel|отмена|отправить|подтвердить|продолжить|применить)\b/i.test(t)) return false;
            const isRole = el.getAttribute('role') === 'radio' || el.getAttribute('role') === 'option' || el.getAttribute('role') === 'checkbox';
            const hasInput = el.tagName === 'LABEL' && !!el.querySelector('input');
            const matchesPattern = /^[1-9][\.\)\s]\s*[a-zа-я]/i.test(t)
                || /^[1-9]$/.test(t)
                || /^(yes|no|allow|deny|да|нет|всегда|always|вариант|пункт|option|choice|\(recommended\))\b/i.test(t)
                || /\b(вариант|option)\s*[1-9]/i.test(t);
            return isRole || hasInput || matchesPattern;
        });

        // Filter unique parent option texts
        const uniqueOptions = [];
        const seenTexts = new Set();
        for (const opt of rawOptions) {
            const cleanText = (opt.textContent || '').trim().replace(/\\s+/g, ' ');
            if (cleanText.length > 0 && !seenTexts.has(cleanText) && cleanText !== questionTitle && cleanText !== targetText) {
                const isSub = uniqueOptions.some(o => o.text.includes(cleanText));
                if (!isSub) {
                    seenTexts.add(cleanText);
                    uniqueOptions.push({
                        index: uniqueOptions.length + 1,
                        text: cleanText
                    });
                }
            }
        }

        if (uniqueOptions.length > 0 || /allow|permission|url|command|question|выбор|разрешить|выберите/i.test(questionTitle)) {
            return {
                isQuestionModal: true,
                questionTitle: questionTitle || 'Permission / Selection Required',
                targetText: targetText,
                options: uniqueOptions,
                approveText: 'Submit',
                alwaysAllowText: uniqueOptions.some(o => /always|всегда/i.test(o.text)) ? 'Always Allow' : '',
                denyText: skipBtn ? 'Skip' : 'Deny',
                description: questionTitle + (targetText ? ': ' + targetText : '')
            };
        }
    }

    // =========================================================================
    // Path B: Standard Allow / Deny buttons
    // =========================================================================
    let approveBtn = allButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        if (IGNORE_PATTERNS.some(p => t.includes(p))) return false;
        return ALLOW_ONCE_PATTERNS.some(p => t.includes(p));
    }) || null;

    if (!approveBtn) {
        approveBtn = allButtons.find(btn => {
            const t = normalize(btn.textContent || '');
            if (IGNORE_PATTERNS.some(p => t.includes(p))) return false;
            const isAlways = ALWAYS_ALLOW_PATTERNS.some(p => t.includes(p));
            return !isAlways && ALLOW_PATTERNS.some(p => t === p || t.startsWith(p + ' ') || t.endsWith(' ' + p));
        }) || null;
    }

    if (!approveBtn) return null;

    let container = approveBtn.closest('[role="dialog"], .modal, .dialog, .approval-container, .permission-dialog, [class*="modal"], [class*="dialog"]');
    if (!container) {
        container = approveBtn.parentElement?.parentElement || approveBtn.parentElement || null;
    }

    const containerButtons = container
        ? Array.from(container.querySelectorAll('button')).filter(btn => btn.offsetParent !== null || (btn.getBoundingClientRect && btn.getBoundingClientRect().width > 0))
        : allButtons;

    const denyBtn = containerButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        if (IGNORE_PATTERNS.some(p => t.includes(p))) return false;
        return DENY_PATTERNS.some(p => t === p || t.startsWith(p + ' ') || t.endsWith(' ' + p));
    }) || null;

    if (!denyBtn) return null;

    const alwaysAllowBtn = containerButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return ALWAYS_ALLOW_PATTERNS.some(p => t.includes(p));
    }) || null;

    const approveText = (approveBtn.textContent || '').trim();
    const alwaysAllowText = alwaysAllowBtn ? (alwaysAllowBtn.textContent || '').trim() : '';
    const denyText = (denyBtn.textContent || '').trim();

    let description = '';
    const dialog = container;
    if (dialog) {
        const descEl = dialog.querySelector('p, .description, [data-testid="description"]');
        if (descEl) {
            description = (descEl.textContent || '').trim();
        }
    }

    if (!description) {
        const parent = approveBtn.parentElement?.parentElement || approveBtn.parentElement;
        if (parent) {
            const clone = parent.cloneNode(true);
            const buttons = clone.querySelectorAll('button');
            buttons.forEach(b => b.remove());
            const parentText = (clone.textContent || '').trim();
            if (parentText.length > 5 && parentText.length < 500) {
                description = parentText;
            }
        }
    }

    if (!description) {
        const ariaLabel = approveBtn.getAttribute('aria-label') || '';
        if (ariaLabel) description = ariaLabel;
    }

    return { approveText, alwaysAllowText, denyText, description };
})()`;

/**
 * Generate script to select an option and submit in an interactive question modal
 */
export function buildSelectAndSubmitScript(optionIndexOrText: number | string): string {
    const targetArg = typeof optionIndexOrText === 'number'
        ? optionIndexOrText
        : JSON.stringify(optionIndexOrText);

    return `(() => {
        const target = ${targetArg};
        const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();

        const allButtons = Array.from(document.querySelectorAll('button'))
            .filter(btn => btn.offsetParent !== null || (btn.getBoundingClientRect && btn.getBoundingClientRect().width > 0));
        const submitBtn = allButtons.find(btn => {
            const t = normalize(btn.textContent || '');
            const aria = normalize(btn.getAttribute('aria-label') || '');
            return /^(submit|confirm|отправить|подтвердить)\\b/i.test(t) || /submit/i.test(aria);
        });

        if (!submitBtn) return { ok: false, error: 'Submit button not found' };

        let modal = submitBtn.closest('[role="dialog"], [role="alertdialog"], .modal, .dialog');
        if (!modal) {
            let curr = submitBtn.parentElement;
            while (curr && curr !== document.body) {
                const text = normalize(curr.textContent || '');
                if (text.includes('allow') || text.includes('permission') || text.includes('command') || text.includes('1 yes') || text.includes('1. ')) {
                    modal = curr;
                    break;
                }
                curr = curr.parentElement;
            }
        }
        if (!modal) modal = submitBtn.parentElement?.parentElement?.parentElement || document.body;

        const candidateElements = Array.from(modal.querySelectorAll('div, li, label, [role="radio"], [role="option"], p, span, input')).filter(el => {
            if (!el.offsetParent && (!el.getBoundingClientRect || el.getBoundingClientRect().width === 0)) return false;
            const t = normalize(el.textContent || el.value || '');
            if (typeof target === 'number') {
                return t.startsWith(target + ' ') || t.startsWith(target + '.') || t.startsWith(target + ')') || t === String(target);
            } else {
                return t.includes(normalize(target));
            }
        });

        const targetEl = candidateElements[0] || null;
        if (targetEl) {
            targetEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            targetEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            targetEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            if (typeof targetEl.click === 'function') targetEl.click();
            if (targetEl.tagName === 'LABEL') {
                const inp = targetEl.querySelector('input') || (targetEl.getAttribute('for') ? document.getElementById(targetEl.getAttribute('for')) : null);
                if (inp && typeof inp.click === 'function') inp.click();
            }
        }

        submitBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        submitBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        submitBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        if (typeof submitBtn.click === 'function') submitBtn.click();

        return { ok: true, optionFound: !!targetEl };
    })()`;
}

/**
 * Press the toggle on the right side of Allow Once to expand the Always Allow dropdown.
 */
const EXPAND_ALWAYS_ALLOW_MENU_SCRIPT = `(() => {
    const ALLOW_ONCE_PATTERNS = ['allow once', 'allow one time', '今回のみ許可', '1回のみ許可', '一度許可'];
    const ALWAYS_ALLOW_PATTERNS = [
        'allow this conversation',
        'allow this chat',
        'always allow',
        '常に許可',
        'この会話を許可',
    ];

    const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
    const visibleButtons = Array.from(document.querySelectorAll('button'))
        .filter(btn => btn.offsetParent !== null);

    const directAlways = visibleButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return ALWAYS_ALLOW_PATTERNS.some(p => t.includes(p));
    });
    if (directAlways) return { ok: true, reason: 'already-visible' };

    const allowOnceBtn = visibleButtons.find(btn => {
        const t = normalize(btn.textContent || '');
        return ALLOW_ONCE_PATTERNS.some(p => t.includes(p));
    });
    if (!allowOnceBtn) return { ok: false, error: 'allow-once button not found' };

    const container = allowOnceBtn.closest('[role="dialog"], .modal, .dialog, .approval-container, .permission-dialog')
        || allowOnceBtn.parentElement?.parentElement
        || allowOnceBtn.parentElement
        || document.body;

    const containerButtons = Array.from(container.querySelectorAll('button'))
        .filter(btn => btn.offsetParent !== null);

    const toggleBtn = containerButtons.find(btn => {
        if (btn === allowOnceBtn) return false;
        const text = normalize(btn.textContent || '');
        const aria = normalize(btn.getAttribute('aria-label') || '');
        const hasPopup = btn.getAttribute('aria-haspopup');
        if (hasPopup === 'menu' || hasPopup === 'listbox') return true;
        if (text === '') return true;
        return /menu|more|expand|options|dropdown|chevron|arrow/.test(aria);
    });

    if (toggleBtn) {
        toggleBtn.click();
        return { ok: true, reason: 'toggle-button' };
    }

    const rect = allowOnceBtn.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
        return { ok: false, error: 'allow-once button rect unavailable' };
    }

    const clickX = rect.right - Math.max(4, Math.min(12, rect.width * 0.15));
    const clickY = rect.top + rect.height / 2;

    const events = ['pointerdown', 'mousedown', 'mouseup', 'click'];
    for (const type of events) {
        allowOnceBtn.dispatchEvent(new MouseEvent(type, {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: clickX,
            clientY: clickY,
        }));
    }
    return { ok: true, reason: 'allow-once-right-edge' };
})()`;

/**
 * Generate a CDP script that clicks a button
 */
export function buildClickScript(buttonText: string): string {
    const safeText = JSON.stringify(buttonText);
    return `(() => {
        const normalize = (text) => (text || '').toLowerCase().replace(/\\s+/g, ' ').trim();
        const text = ${safeText};
        const wanted = normalize(text);
        const allButtons = Array.from(document.querySelectorAll('button'));
        const target = allButtons.find(btn => {
            if (!btn.offsetParent) return false;
            const buttonText = normalize(btn.textContent || '');
            const ariaLabel = normalize(btn.getAttribute('aria-label') || '');
            return buttonText === wanted ||
                ariaLabel === wanted ||
                buttonText.includes(wanted) ||
                ariaLabel.includes(wanted);
        });
        if (!target) return { ok: false, error: 'Button not found: ' + text };
        target.click();
        return { ok: true };
    })()`;
}

/**
 * Class that detects approval buttons in the Antigravity UI via polling.
 */
export class ApprovalDetector {
    private cdpService: CdpService;
    private pollIntervalMs: number;
    private onApprovalRequired: (info: ApprovalInfo) => void;
    private onResolved?: () => void;

    private pollTimer: NodeJS.Timeout | null = null;
    private isRunning: boolean = false;
    /** Key of the last detected button info (for duplicate notification prevention) */
    private lastDetectedKey: string | null = null;
    /** Full ApprovalInfo from the last detection (used for clicking) */
    private lastDetectedInfo: ApprovalInfo | null = null;

    constructor(options: ApprovalDetectorOptions) {
        this.cdpService = options.cdpService;
        this.pollIntervalMs = options.pollIntervalMs ?? 1500;
        this.onApprovalRequired = options.onApprovalRequired;
        this.onResolved = options.onResolved;
    }

    /**
     * Start monitoring.
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastDetectedKey = null;
        this.lastDetectedInfo = null;
        this.schedulePoll();
    }

    /**
     * Stop monitoring.
     */
    async stop(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Return the last detected approval button info.
     */
    getLastDetectedInfo(): ApprovalInfo | null {
        return this.lastDetectedInfo;
    }

    /** Schedule the next poll */
    private schedulePoll(): void {
        if (!this.isRunning) return;
        this.pollTimer = setTimeout(async () => {
            await this.poll();
            if (this.isRunning) {
                this.schedulePoll();
            }
        }, this.pollIntervalMs);
    }

    /**
     * Single poll iteration with multi-context search
     */
    async poll(): Promise<void> {
        try {
            const rawContexts = typeof this.cdpService.getContexts === 'function' ? this.cdpService.getContexts() : [];
            const contexts = Array.isArray(rawContexts) ? rawContexts : [];
            const primaryId = typeof this.cdpService.getPrimaryContextId === 'function' ? this.cdpService.getPrimaryContextId() : null;
            const targetContexts = primaryId !== null
                ? [{ id: primaryId }, ...contexts.filter(c => c && c.id !== primaryId)]
                : (contexts.length > 0 ? contexts : [{ id: null }]);

            let info: ApprovalInfo | null = null;
            for (const ctx of targetContexts) {
                try {
                    const callParams: Record<string, unknown> = {
                        expression: DETECT_APPROVAL_SCRIPT,
                        returnByValue: true,
                        awaitPromise: false,
                    };
                    if (ctx.id !== null) {
                        callParams.contextId = ctx.id;
                    }
                    const result = await this.cdpService.call('Runtime.evaluate', callParams);
                    const val = result?.result?.value;
                    if (val) {
                        info = val as ApprovalInfo;
                        break;
                    }
                } catch {
                    // Try next context
                }
            }

            if (info) {
                const key = `${info.approveText}::${info.description}`;
                if (key !== this.lastDetectedKey) {
                    this.lastDetectedKey = key;
                    this.lastDetectedInfo = info;
                    Promise.resolve(this.onApprovalRequired(info)).catch((err) => {
                        logger.error('[ApprovalDetector] onApprovalRequired callback failed:', err);
                    });
                }
            } else {
                const wasDetected = this.lastDetectedKey !== null;
                this.lastDetectedKey = null;
                this.lastDetectedInfo = null;
                if (wasDetected && this.onResolved) {
                    this.onResolved();
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes('WebSocket is not connected') || message.includes('WebSocket disconnected')) {
                return;
            }
            logger.error('[ApprovalDetector] Error during polling:', error);
        }
    }

    /**
     * Select a specific option in an interactive question modal
     */
    async selectOption(optionIndexOrText: number | string): Promise<boolean> {
        try {
            const script = buildSelectAndSubmitScript(optionIndexOrText);
            const result = await this.runEvaluateScript(script);
            return result?.ok === true;
        } catch (error) {
            logger.error('[ApprovalDetector] Error selecting option:', error);
            return false;
        }
    }

    /**
     * Click the approve button with the specified text via CDP.
     */
    async approveButton(buttonText?: string): Promise<boolean> {
        if (this.lastDetectedInfo?.isQuestionModal) {
            return this.selectOption(1);
        }
        const text = buttonText ?? this.lastDetectedInfo?.approveText ?? 'Allow';
        return this.clickButton(text);
    }

    /**
     * Select "Allow This Conversation / Always Allow".
     */
    async alwaysAllowButton(): Promise<boolean> {
        if (this.lastDetectedInfo?.isQuestionModal) {
            const alwaysOpt = this.lastDetectedInfo.options?.find(o => /always|всегда/i.test(o.text));
            if (alwaysOpt) {
                return this.selectOption(alwaysOpt.index);
            }
            return this.selectOption(1);
        }

        const directCandidates = [
            this.lastDetectedInfo?.alwaysAllowText,
            'Allow This Conversation',
            'Allow This Chat',
            'この会話を許可',
            'Always Allow',
            '常に許可',
        ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

        for (const candidate of directCandidates) {
            if (await this.clickButton(candidate)) return true;
        }

        const expanded = await this.runEvaluateScript(EXPAND_ALWAYS_ALLOW_MENU_SCRIPT);
        if (expanded?.ok !== true) {
            return false;
        }

        for (let i = 0; i < 5; i++) {
            for (const candidate of directCandidates) {
                if (await this.clickButton(candidate)) return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 120));
        }

        return false;
    }

    /**
     * Click the deny button with the specified text via CDP.
     */
    async denyButton(buttonText?: string): Promise<boolean> {
        if (this.lastDetectedInfo?.isQuestionModal) {
            if (await this.clickButton('Skip')) return true;
            return this.selectOption(this.lastDetectedInfo?.options?.length || 5);
        }
        const text = buttonText ?? this.lastDetectedInfo?.denyText ?? 'Deny';
        return this.clickButton(text);
    }

    /**
     * Internal click handler
     */
    private async clickButton(buttonText: string): Promise<boolean> {
        try {
            const result = await this.runEvaluateScript(buildClickScript(buttonText));
            return result?.ok === true;
        } catch (error) {
            logger.error('[ApprovalDetector] Error while clicking button:', error);
            return false;
        }
    }

    /**
     * Execute Runtime.evaluate across contexts
     */
    private async runEvaluateScript(expression: string): Promise<any> {
        const rawContexts = typeof this.cdpService.getContexts === 'function' ? this.cdpService.getContexts() : [];
        const contexts = Array.isArray(rawContexts) ? rawContexts : [];
        const primaryId = typeof this.cdpService.getPrimaryContextId === 'function' ? this.cdpService.getPrimaryContextId() : null;
        const targetContexts = primaryId !== null
            ? [{ id: primaryId }, ...contexts.filter(c => c && c.id !== primaryId)]
            : (contexts.length > 0 ? contexts : [{ id: null }]);

        for (const ctx of targetContexts) {
            try {
                const callParams: Record<string, unknown> = {
                    expression,
                    returnByValue: true,
                    awaitPromise: false,
                };
                if (ctx.id !== null) {
                    callParams.contextId = ctx.id;
                }
                const result = await this.cdpService.call('Runtime.evaluate', callParams);
                const val = result?.result?.value;
                if (val !== undefined && val !== null) {
                    if (typeof val === 'object' && val.ok === false && targetContexts.length > 1) {
                        continue;
                    }
                    return val;
                }
            } catch {
                // Try next context
            }
        }
        return null;
    }

    /** Returns whether monitoring is currently active */
    isActive(): boolean {
        return this.isRunning;
    }
}
