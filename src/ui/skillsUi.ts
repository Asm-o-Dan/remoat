import { escapeHtml } from '../utils/telegramFormatter';
import { scanInstalledSkills, ScannedSkill } from '../services/skillsScanner';

export interface FormattedSkillsPayload {
    text: string;
    skills: ScannedSkill[];
}

/**
 * Builds a clean, tap-to-copy text representation of all installed Antigravity skills.
 * Formatted with <code>/${name}</code> for instant 1-tap clipboard copying in Telegram.
 */
export function buildSkillsText(workspacePath?: string): string {
    const skills = scanInstalledSkills(workspacePath);

    if (skills.length === 0) {
        return `⚡ <b>Antigravity Skills</b>\n\nNo installed skills found in ~/.gemini/config/skills.`;
    }

    let text = `⚡ <b>Antigravity Agent Skills (${skills.length})</b>\n\n`;
    text += `<i>Нажмите на команду, чтобы скопировать её в буфер обмена:</i>\n\n`;

    for (const skill of skills) {
        text += `• <code>/${escapeHtml(skill.name)}</code>\n`;
        text += `   └ <i>${escapeHtml(skill.description)}</i>\n\n`;
    }

    return text.trim();
}

/**
 * Sends the dynamic skills catalog as tap-to-copy text.
 */
export async function sendSkillsUI(
    sendFn: (text: string) => Promise<void>,
    workspacePath?: string
): Promise<void> {
    const text = buildSkillsText(workspacePath);
    await sendFn(text);
}
