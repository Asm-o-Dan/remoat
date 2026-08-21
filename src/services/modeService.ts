import { t } from "../utils/i18n";

/**
 * Available execution modes for Antigravity IDE:
 * - default: Standard balanced mode
 * - full_machine: Full autonomous access to system tools & environment
 * - turbo: High-speed streaming response mode
 */
export const AVAILABLE_MODES = ['default', 'full_machine', 'turbo'] as const;

/** Mode display name mapping */
export const MODE_DISPLAY_NAMES: Record<string, string> = {
    default: '⚙️ Default',
    full_machine: '💻 Full Machine',
    turbo: '🚀 Turbo Mode',
};

/** Mode description mapping */
export const MODE_DESCRIPTIONS: Record<string, string> = {
    default: t('Default — Стандартный сбалансированный режим'),
    full_machine: t('Full Machine — Полный доступ к терминалу и инструментам разработки'),
    turbo: t('Turbo Mode — Высокоскоростной режим быстрых ответов'),
};

/** Antigravity UI display name mapping (internal name -> UI display name) */
export const MODE_UI_NAMES: Record<string, string> = {
    default: 'Default',
    full_machine: 'Full Machine',
    turbo: 'Turbo',
};

/** Reverse mapping from UI display name -> internal name */
export const MODE_UI_NAME_REVERSE: Record<string, string> = {
    default: 'default',
    'full machine': 'full_machine',
    fullmachine: 'full_machine',
    turbo: 'turbo',
    fast: 'turbo',
    plan: 'default',
    planning: 'default',
};

/** Default execution mode */
export const DEFAULT_MODE: Mode = 'default';

/** Mode type definition */
export type Mode = typeof AVAILABLE_MODES[number];

/** Mode set result type definition */
export interface ModeSetResult {
    success: boolean;
    mode?: Mode;
    error?: string;
}

/**
 * Service class for managing execution modes.
 * Handles mode switching via the /mode command.
 */
export class ModeService {
    private currentMode: Mode = DEFAULT_MODE;

    /**
     * Get the current execution mode
     */
    public getCurrentMode(): Mode {
        return this.currentMode;
    }

    /**
     * Switch execution mode
     * @param modeName Mode name to set (case-insensitive)
     */
    public setMode(modeName: string): ModeSetResult {
        if (!modeName || modeName.trim() === '') {
            return {
                success: false,
                error: t('⚠️ Mode name not specified. Available modes: ') + AVAILABLE_MODES.join(', '),
            };
        }

        const raw = modeName.trim().toLowerCase();
        const mapped = MODE_UI_NAME_REVERSE[raw] || raw;
        const normalized = mapped as Mode;

        if (!AVAILABLE_MODES.includes(normalized)) {
            return {
                success: false,
                error: t(`⚠️ Invalid mode "${modeName}". Available modes: ${AVAILABLE_MODES.join(', ')}`),
            };
        }

        this.currentMode = normalized;
        return {
            success: true,
            mode: this.currentMode,
        };
    }

    /**
     * Get the list of available modes
     */
    public getAvailableModes(): readonly string[] {
        return AVAILABLE_MODES;
    }
}
