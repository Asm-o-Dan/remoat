import { Bot, Context } from 'grammy';
import { Update } from '@grammyjs/types';

export interface CapturedMessage {
    chatId: number | string;
    text: string;
    parseMode?: string;
    replyMarkup?: any;
    messageId: number;
    isEdit?: boolean;
    photo?: any;
    caption?: string;
    document?: any;
}

export interface CapturedToast {
    callbackQueryId: string;
    text?: string;
    showAlert?: boolean;
}

/**
 * In-Memory Telegram Simulator Harness for end-to-end testing of Remoat bot.
 * Intercepts all bot.api outgoing calls and generates real Telegram updates.
 */
export class TelegramSimulator {
    public readonly bot: Bot<Context>;
    public messages: CapturedMessage[] = [];
    public edits: CapturedMessage[] = [];
    public toasts: CapturedToast[] = [];

    private nextMessageId = 1000;
    private nextCallbackId = 5000;
    public defaultChatId = 12345678;
    public defaultUserId = 999888;
    public defaultUsername = 'test_user';

    constructor(bot: Bot<Context>) {
        this.bot = bot;
        this.setupApiInterceptor();
    }

    private setupApiInterceptor() {
        // Intercept outgoing API calls using grammY transformer middleware
        this.bot.api.config.use(async (prev, method, payload, signal) => {
            if (method === 'sendMessage') {
                const msgId = ++this.nextMessageId;
                const msg: CapturedMessage = {
                    chatId: (payload as any).chat_id,
                    text: (payload as any).text,
                    parseMode: (payload as any).parse_mode,
                    replyMarkup: (payload as any).reply_markup,
                    messageId: msgId,
                };
                this.messages.push(msg);
                return {
                    ok: true,
                    result: {
                        message_id: msgId,
                        chat: { id: (payload as any).chat_id, type: 'private' },
                        date: Math.floor(Date.now() / 1000),
                        text: (payload as any).text,
                    },
                } as any;
            }

            if (method === 'editMessageText') {
                const edit: CapturedMessage = {
                    chatId: (payload as any).chat_id,
                    text: (payload as any).text,
                    parseMode: (payload as any).parse_mode,
                    replyMarkup: (payload as any).reply_markup,
                    messageId: (payload as any).message_id,
                    isEdit: true,
                };
                this.edits.push(edit);
                this.messages.push(edit);
                return {
                    ok: true,
                    result: {
                        message_id: (payload as any).message_id,
                        chat: { id: (payload as any).chat_id, type: 'private' },
                        date: Math.floor(Date.now() / 1000),
                        text: (payload as any).text,
                    },
                } as any;
            }

            if (method === 'answerCallbackQuery') {
                const toast: CapturedToast = {
                    callbackQueryId: (payload as any).callback_query_id,
                    text: (payload as any).text,
                    showAlert: (payload as any).show_alert,
                };
                this.toasts.push(toast);
                return { ok: true, result: true } as any;
            }

            if (method === 'sendPhoto') {
                const msgId = ++this.nextMessageId;
                const msg: CapturedMessage = {
                    chatId: (payload as any).chat_id,
                    text: (payload as any).caption || '',
                    caption: (payload as any).caption,
                    photo: (payload as any).photo,
                    messageId: msgId,
                };
                this.messages.push(msg);
                return {
                    ok: true,
                    result: {
                        message_id: msgId,
                        chat: { id: (payload as any).chat_id, type: 'private' },
                        date: Math.floor(Date.now() / 1000),
                        photo: [{ file_id: 'photo_123', width: 100, height: 100 }],
                    },
                } as any;
            }

            // Fallback mock for other methods (setMyCommands, getMe, etc.)
            if (method === 'getMe') {
                return {
                    ok: true,
                    result: {
                        id: 111222333,
                        is_bot: true,
                        first_name: 'RemoatTestBot',
                        username: 'remoat_test_bot',
                        can_join_groups: true,
                        can_read_all_group_messages: true,
                        supports_inline_queries: false,
                    },
                } as any;
            }

            return { ok: true, result: true } as any;
        });
    }

    /**
     * Initialize bot info for in-memory execution without network polling.
     */
    public async init(): Promise<void> {
        await this.bot.init();
    }

    /**
     * Clear captured messages, edits, and toasts.
     */
    public clearHistory(): void {
        this.messages = [];
        this.edits = [];
        this.toasts = [];
    }

    /**
     * Send a text message or command from simulated user.
     */
    public async sendText(
        text: string,
        options: { chatId?: number | string; threadId?: number; isGroup?: boolean } = {}
    ): Promise<CapturedMessage[]> {
        const chatId = options.chatId ?? this.defaultChatId;
        const msgId = ++this.nextMessageId;

        const entities: any[] = [];
        if (text.startsWith('/')) {
            const cmdWord = text.split(/\s+/)[0];
            entities.push({
                type: 'bot_command',
                offset: 0,
                length: cmdWord.length,
            });
        }

        const update: Update = {
            update_id: Math.floor(Math.random() * 1000000),
            message: {
                message_id: msgId,
                from: {
                    id: this.defaultUserId,
                    is_bot: false,
                    first_name: 'Tester',
                    username: this.defaultUsername,
                },
                chat: {
                    id: typeof chatId === 'number' ? chatId : parseInt(chatId, 10) || 12345,
                    type: options.isGroup ? 'supergroup' : 'private',
                    title: options.isGroup ? 'Test Supergroup' : undefined,
                },
                date: Math.floor(Date.now() / 1000),
                text,
                entities: entities.length > 0 ? entities : undefined,
                message_thread_id: options.threadId,
            } as any,
        };

        const beforeCount = this.messages.length;
        await this.bot.handleUpdate(update);
        return this.messages.slice(beforeCount);
    }

    /**
     * Simulate clicking an inline keyboard button (CallbackQuery).
     */
    public async clickButton(
        callbackData: string,
        options: { messageId?: number; chatId?: number | string; threadId?: number } = {}
    ): Promise<{ messages: CapturedMessage[]; toast?: CapturedToast }> {
        const chatId = options.chatId ?? this.defaultChatId;
        const messageId = options.messageId ?? (this.messages.length > 0 ? this.messages[this.messages.length - 1].messageId : 1001);
        const queryId = `cb_${++this.nextCallbackId}`;

        const update: Update = {
            update_id: Math.floor(Math.random() * 1000000),
            callback_query: {
                id: queryId,
                from: {
                    id: this.defaultUserId,
                    is_bot: false,
                    first_name: 'Tester',
                    username: this.defaultUsername,
                },
                message: {
                    message_id: messageId,
                    chat: {
                        id: typeof chatId === 'number' ? chatId : parseInt(chatId, 10) || 12345,
                        type: 'private',
                    },
                    date: Math.floor(Date.now() / 1000),
                    text: 'Previous message text',
                } as any,
                chat_instance: 'test_instance',
                data: callbackData,
            },
        };

        const beforeMsgCount = this.messages.length;
        const beforeToastCount = this.toasts.length;

        await this.bot.handleUpdate(update);

        const newMessages = this.messages.slice(beforeMsgCount);
        const newToast = this.toasts.slice(beforeToastCount)[0];

        return { messages: newMessages, toast: newToast };
    }

    /**
     * Get the most recent message sent by the bot.
     */
    public getLastMessage(): CapturedMessage | undefined {
        return this.messages[this.messages.length - 1];
    }

    /**
     * Get the most recent message edit made by the bot.
     */
    public getLastEdit(): CapturedMessage | undefined {
        return this.edits[this.edits.length - 1];
    }

    /**
     * Get the most recent toast / callback notification.
     */
    public getLastToast(): CapturedToast | undefined {
        return this.toasts[this.toasts.length - 1];
    }
}
