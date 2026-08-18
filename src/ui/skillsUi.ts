import { InlineKeyboard } from 'grammy';
import { escapeHtml } from '../utils/telegramFormatter';

export interface AgentSkill {
    name: string;
    label: string;
    description: string;
    prompt: string;
}

export const AVAILABLE_SKILLS: AgentSkill[] = [
    {
        name: 'summary',
        label: '📝 Summary & Status',
        description: 'Кратко опиши текущий контекст чата, выполненные задачи и статус.',
        prompt: 'Опиши кратко, что мы делаем в этом чате, какие задачи уже решены и какой текущий статус.'
    },
    {
        name: 'debug-detective',
        label: '🔍 Debug Detective',
        description: 'Анализ багов, логов и ошибок с поиском первопричины.',
        prompt: '/debug-detective Проанализируй ошибки, найди причину и предложи фикс.'
    },
    {
        name: 'multi-critic-review',
        label: '🛡️ Multi-Critic Review',
        description: 'Глубокое 4-факторное ревью кода (Security, Performance, Arch, Correctness).',
        prompt: '/multi-critic-review Проведи комплексное мульти-критик ревью кода.'
    },
    {
        name: 'diagram-architect',
        label: '📐 Diagram Architect',
        description: 'Генерация архитектурных схем и диаграмм в Mermaid.',
        prompt: '/diagram-architect Построй архитектурную схему текущей системы.'
    },
    {
        name: 'project-planner',
        label: '📋 Project Planner',
        description: 'Декомпозиция задач, критерии приемки и планирование roadmap.',
        prompt: '/project-planner Составь подробный план реализации текущей задачи.'
    },
    {
        name: 'iterative-dev-loop',
        label: '🔄 Iterative Dev Loop',
        description: 'Автономный цикл: План -> Реализация -> Тесты -> Ревью.',
        prompt: '/iterative-dev-loop Запусти автономный цикл разработки задачи.'
    },
    {
        name: 'test-suite-generator',
        label: '🧪 Test Generator',
        description: 'Создание юнит- и интеграционных тестов для кодовой базы.',
        prompt: '/test-suite-generator Напиши тесты для текущего функционала.'
    },
    {
        name: 'code-refactor-pro',
        label: '✨ Code Refactor',
        description: 'Рефакторинг без изменения логики, устранение запахов кода.',
        prompt: '/code-refactor-pro Проведи безопасный рефакторинг кода.'
    },
    {
        name: 'deep-research-analyst',
        label: '🔬 Deep Research',
        description: 'Глубокое исследование темы, сравнение библиотек и архитектур.',
        prompt: '/deep-research-analyst Проведи исследование и составь сравнение подходов.'
    },
    {
        name: 'spreadsheet-data-wizard',
        label: '📊 Data Wizard',
        description: 'Анализ и трансформация данных из Excel и CSV файлов.',
        prompt: '/spreadsheet-data-wizard Проанализируй таблицу и выведи инсайты.'
    }
];

export function buildSkillsUI(page = 0, pageSize = 5): { text: string; keyboard: InlineKeyboard } {
    const totalPages = Math.max(1, Math.ceil(AVAILABLE_SKILLS.length / pageSize));
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = currentPage * pageSize;
    const pageSkills = AVAILABLE_SKILLS.slice(startIndex, startIndex + pageSize);

    let text = `⚡ <b>Antigravity Agent Skills (${AVAILABLE_SKILLS.length})</b>\n`;
    text += `<i>Page ${currentPage + 1} of ${totalPages}</i>\n\n`;
    text += `Выберите скилл для быстрого запуска в текущем чате:\n\n`;

    for (const skill of pageSkills) {
        text += `• <b>${escapeHtml(skill.label)}</b>\n`;
        text += `   └ <i>${escapeHtml(skill.description)}</i>\n\n`;
    }

    const keyboard = new InlineKeyboard();

    for (const skill of pageSkills) {
        keyboard.text(skill.label, `skill_view:${skill.name}`).row();
    }

    // Pagination row
    if (totalPages > 1) {
        if (currentPage > 0) {
            keyboard.text('⬅️ Prev', `skills_page:${currentPage - 1}`);
        } else {
            keyboard.text('▪️', 'skills_noop');
        }

        keyboard.text(`📄 ${currentPage + 1}/${totalPages}`, 'skills_noop');

        if (currentPage < totalPages - 1) {
            keyboard.text('Next ➡️', `skills_page:${currentPage + 1}`);
        } else {
            keyboard.text('▪️', 'skills_noop');
        }
        keyboard.row();
    }

    return { text, keyboard };
}

export function buildSkillDetailUI(skillName: string): { text: string; keyboard: InlineKeyboard } {
    const skill = AVAILABLE_SKILLS.find(s => s.name === skillName) || AVAILABLE_SKILLS[0];
    let text = `⚡ <b>Skill: ${escapeHtml(skill.label)}</b>\n\n`;
    text += `<b>Описание:</b>\n${escapeHtml(skill.description)}\n\n`;
    text += `<b>Промпт по умолчанию:</b>\n<code>${escapeHtml(skill.prompt)}</code>\n\n`;
    text += `Нажмите <b>🚀 Run Now</b> для отправки агенту или отправьте свой текст сообщением.`;

    const keyboard = new InlineKeyboard()
        .text('🚀 Run Now', `skill_run:${skill.name}`).row()
        .text('⬅️ Back to Skills', 'skills_page:0').row();

    return { text, keyboard };
}

export async function sendSkillsUI(
    sendFn: (text: string, keyboard: InlineKeyboard) => Promise<void>,
    page = 0
): Promise<void> {
    const payload = buildSkillsUI(page);
    await sendFn(payload.text, payload.keyboard);
}
