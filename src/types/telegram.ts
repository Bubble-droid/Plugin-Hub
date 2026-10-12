import type {
  ApiResponse,
  BotCommand,
  Chat,
  InlineKeyboardMarkup,
  Message,
  Update,
  User,
  UserFromGetMe,
} from '@grammyjs/types';

/** Telegram Bot API 的统一响应结构。 */
export type TelegramApiResponse<T> = ApiResponse<T>;

/** 调用 Bot API 时使用的请求选项。 */
export interface TelegramRequestOptions {
  Timeout?: number;
}

/** 发送或编辑消息时附带的参数。 */
export interface TelegramReplyOptions {
  reply_markup?: InlineKeyboardMarkup;
}

/** 插件内部使用的 Bot API 精简封装。 */
export interface TelegramApi {
  getMe: () => Promise<UserFromGetMe>;
  getUpdates: (
    params: {
      offset: number;
      timeout: number;
      allowed_updates: readonly Exclude<keyof Update, 'update_id'>[];
    },
    options?: TelegramRequestOptions,
  ) => Promise<Update[]>;
  setMyCommands: (commands: BotCommand[], chatId?: number) => Promise<true>;
  deleteWebhook: (dropPendingUpdates: boolean) => Promise<true>;
  setWebhook: (
    url: string,
    secret: string,
    dropPendingUpdates: boolean,
  ) => Promise<true>;
  sendMessage: (
    chatId: number,
    text: string,
    options?: TelegramReplyOptions,
  ) => Promise<Message>;
  editMessageText: (
    chatId: number,
    messageId: number,
    text: string,
    options?: TelegramReplyOptions,
  ) => Promise<Message | true>;
  answerCallbackQuery: (id: string, text?: string) => Promise<true>;
  sendDocument: (
    chatId: number,
    content: string,
    fileName: string,
    caption?: string,
  ) => Promise<Message>;
}

/** 处理一条更新时使用的上下文。 */
export interface TelegramUpdateContext {
  chat: Chat;
  user: User;
  text: string;
  command: { name: string; args: string[] } | undefined;
  callbackData: string;
  isCallback: boolean;
  reply: (text: string, options?: TelegramReplyOptions) => Promise<void>;
  edit: (text: string, options?: TelegramReplyOptions) => Promise<void>;
  answer: (text?: string) => Promise<void>;
  replyDocument: (content: string, fileName: string) => Promise<void>;
}
