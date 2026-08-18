import { InlineKeyboard } from 'grammy';
import { t } from '../utils/i18n';
import { SessionListItem, SidebarSessionItem } from '../services/chatSessionService';
import { escapeHtml } from '../utils/telegramFormatter';

export const SESSION_SELECT_ID = 'session_select';
const MAX_SELECT_OPTIONS = 25;

declare global {
    var chatSwitchMap: Map<string, { id?: string; title: string }> | undefined;
}

global.chatSwitchMap = global.chatSwitchMap || new Map();

export function isSessionSelectId(customId: string): boolean {
    return customId.startsWith(SESSION_SELECT_ID + ':') || customId === SESSION_SELECT_ID;
}

export function buildSessionPickerUI(
    sessions: SessionListItem[],
): { text: string; keyboard: InlineKeyboard } {
    if (sessions.length === 0) {
        return {
            text: `<b>🔗 Join Session</b>\n\n${t('No sessions found in the Antigravity side panel.')}`,
            keyboard: new InlineKeyboard(),
        };
    }

    const text = `<b>🔗 Join Session</b>\n\n` +
        t(`Select a session to join (${sessions.length} found)`);

    const keyboard = new InlineKeyboard();
    const pageItems = sessions.slice(0, MAX_SELECT_OPTIONS);

    for (let i = 0; i < pageItems.length; i++) {
        const session = pageItems[i];
        const label = session.isActive
            ? `✅ ${session.title.slice(0, 40)}`
            : session.title.slice(0, 40);
        const key = `s_${i}_` + Math.random().toString(36).slice(2, 6);
        global.chatSwitchMap?.set(key, { title: session.title });
        if (global.chatSwitchMap && global.chatSwitchMap.size > 100) {
            const firstKey = global.chatSwitchMap.keys().next().value;
            if (firstKey) global.chatSwitchMap.delete(firstKey);
        }
        keyboard.text(label, `switch_chat:${key}`).row();
    }

    return { text, keyboard };
}

export function buildChatsListUI(
    sessions: SidebarSessionItem[],
    page = 0,
    pageSize = 5
): { text: string; keyboard: InlineKeyboard } {
    if (!sessions || sessions.length === 0) {
        return {
            text: `💬 <b>Project Chats</b>\n\nNo chat sessions found. Use /new to start a new chat.`,
            keyboard: new InlineKeyboard().text('➕ New Chat', 'new_chat_btn'),
        };
    }

    const totalPages = Math.max(1, Math.ceil(sessions.length / pageSize));
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = currentPage * pageSize;
    const pageSessions = sessions.slice(startIndex, startIndex + pageSize);

    let text = `💬 <b>Project Chats (${sessions.length})</b>\n`;
    text += `<i>Page ${currentPage + 1} of ${totalPages}</i>\n\n`;

    const keyboard = new InlineKeyboard();

    for (let i = 0; i < pageSessions.length; i++) {
        const s = pageSessions[i];
        const globalIdx = startIndex + i;
        const isActive = !!s.isSelected;
        const icon = isActive ? '👉 ' : '• ';
        const mark = isActive ? ' <b>(Current)</b>' : '';
        
        text += `${icon}${escapeHtml(s.title)}${mark}\n`;

        const key = `c_${globalIdx}_` + (s.id ? s.id.slice(0, 8) : Math.random().toString(36).slice(2, 6));
        global.chatSwitchMap?.set(key, { id: s.id, title: s.title });
        if (global.chatSwitchMap && global.chatSwitchMap.size > 100) {
            const firstKey = global.chatSwitchMap.keys().next().value;
            if (firstKey) global.chatSwitchMap.delete(firstKey);
        }

        const btnLabel = isActive ? `✅ ${s.title}` : s.title;
        const safeBtnLabel = btnLabel.length > 36 ? btnLabel.slice(0, 33) + '...' : btnLabel;
        keyboard.text(safeBtnLabel, `switch_chat:${key}`).row();
    }

    // Pagination controls row
    if (totalPages > 1) {
        if (currentPage > 0) {
            keyboard.text('⬅️ Prev', `chats_page:${currentPage - 1}`);
        } else {
            keyboard.text('▪️', 'chats_noop');
        }

        keyboard.text(`📄 ${currentPage + 1}/${totalPages}`, 'chats_noop');

        if (currentPage < totalPages - 1) {
            keyboard.text('Next ➡️', `chats_page:${currentPage + 1}`);
        } else {
            keyboard.text('▪️', 'chats_noop');
        }
        keyboard.row();
    }

    // Actions row
    keyboard.text('➕ New Chat', 'new_chat_btn')
            .text('🔄 Refresh', `refresh_chats_btn:${currentPage}`).row();

    return { text, keyboard };
}
