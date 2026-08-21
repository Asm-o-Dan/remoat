import { InlineKeyboard } from 'grammy';
import { escapeHtml } from '../utils/telegramFormatter';
import { scanInstalledSkills, ScannedSkill } from '../services/skillsScanner';

export interface SkillsUiPayload {
    text: string;
    keyboard: InlineKeyboard;
    totalPages: number;
    currentPage: number;
}

export const SKILLS_PAGE_SIZE = 6;

/**
 * Builds a paginated, tap-to-copy text representation and inline pagination buttons for Antigravity skills.
 * Formatted with <code>/${name}</code> for instant 1-tap clipboard copying in Telegram.
 */
export function buildSkillsPayload(
    workspacePath?: string,
    page = 0,
    pageSize = SKILLS_PAGE_SIZE,
): SkillsUiPayload {
    const skills = scanInstalledSkills(workspacePath);

    if (skills.length === 0) {
        return {
            text: `⚡ <b>Antigravity Skills</b>\n\nСкиллы не найдены в ~/.gemini/config/skills.`,
            keyboard: new InlineKeyboard(),
            totalPages: 1,
            currentPage: 0,
        };
    }

    const totalPages = Math.max(1, Math.ceil(skills.length / pageSize));
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = currentPage * pageSize;
    const pageSkills = skills.slice(startIndex, startIndex + pageSize);

    let text = `⚡ <b>Antigravity Agent Skills (${skills.length})</b>\n`;
    text += `<i>Страница ${currentPage + 1} из ${totalPages}</i>\n\n`;
    text += `<i>Нажмите на команду, чтобы скопировать её в буфер:</i>\n\n`;

    for (const skill of pageSkills) {
        text += `• <code>/${escapeHtml(skill.name)}</code>\n`;
        text += `   └ <i>${escapeHtml(skill.description)}</i>\n\n`;
    }

    const keyboard = new InlineKeyboard();

    // Pagination row (only if more than 1 page)
    if (totalPages > 1) {
        if (currentPage > 0) {
            keyboard.text('⬅️ Назад', `skills_page:${currentPage - 1}`);
        } else {
            keyboard.text('▪️', 'noop');
        }

        keyboard.text(`📄 ${currentPage + 1}/${totalPages}`, `skills_page:${currentPage}`);

        if (currentPage < totalPages - 1) {
            keyboard.text('Вперед ➡️', `skills_page:${currentPage + 1}`);
        } else {
            keyboard.text('▪️', 'noop');
        }
    }

    return {
        text: text.trim(),
        keyboard,
        totalPages,
        currentPage,
    };
}

/**
 * Legacy/simple text generator (page 0 or full list).
 */
export function buildSkillsText(workspacePath?: string, page = 0, pageSize = SKILLS_PAGE_SIZE): string {
    return buildSkillsPayload(workspacePath, page, pageSize).text;
}

/**
 * Sends the dynamic skills catalog with pagination keyboard.
 */
export async function sendSkillsUI(
    sendFn: (text: string, keyboard?: InlineKeyboard) => Promise<void>,
    workspacePath?: string,
    page = 0,
): Promise<void> {
    const payload = buildSkillsPayload(workspacePath, page);
    await sendFn(payload.text, payload.keyboard);
}
