/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
/* eslint-disable @typescript-eslint/only-throw-error */
import type { LogData } from '@/types/clash-api.js'
import type { ApiMethod, ApiParams, ApiResponse, ChatId, Integer, PickOptionalParams } from '@/types/telegram.js'
import type { BotCommand, CallbackQuery, Chat, InlineKeyboardButton, InlineKeyboardMarkup, Message, MessageEntity, Update, User } from '@grammyjs/types'
import type { MaybePromise, Recordable, ToUppercaseKeys } from 'devs/types/utils.js'

const Plugin = {} as unknown as ThisPlugin

type PluginId = 'plugin-gui-bot-controller'

interface ThisPlugin extends AppPlugin, PluginConfiguration {
  id: PluginId
}

declare global {
  interface Window {
    [Plugin.id]: PluginState
  }
}

interface PluginState {
  bot?: TelegramBot | undefined
  isStarting?: boolean
}

interface PluginConfiguration {
  work_mode: (typeof WORK_MODE)[keyof typeof WORK_MODE]
  bot_token: string | undefined
  polling_timeout: string | undefined
  webhook_url: string | undefined
  webhook_listen: string | undefined
  webhook_port: string | undefined
  webhook_token: string | undefined
  drop_updates: boolean
  user_id: string | undefined
  auto_start: boolean
}

interface Config extends ToUppercaseKeys<Omit<PluginConfiguration, 'polling_timeout' | 'webhook_port' | 'user_id'>> {
  POLLING_TIMEOUT: number | undefined
  WEBHOOK_PORT: number | undefined
  USER_ID: number | undefined
}

interface RequestOptions {
  Timeout?: number
  Insecure?: boolean
  Redirect?: boolean
}

type UpdateType = (typeof ALL_UPDATE_TYPES)[number]

type UpdateHandler = (ctx: UpdateContext, done: () => void) => MaybePromise

interface Command extends BotCommand {
  action: (ctx: UpdateContext) => MaybePromise
}

interface Callback extends Pick<CallbackQuery, 'data'> {
  action: (ctx: UpdateContext) => MaybePromise
}

type CommandType = (typeof COMMANDS)[number]['command']
type CallbackButtonType = (typeof CALLBACKS)[number]['data']

window[Plugin.id] = (window[Plugin.id] as PluginState | undefined) || {}

const KERNEL_TYPE = Plugins.APP_TITLE.includes('SingBox') ? 'sing-box' : 'mihomo'

const CONFIG = {
  WORK_MODE: Plugin.work_mode,
  BOT_TOKEN: Plugin.bot_token || undefined,
  POLLING_TIMEOUT: Number(Plugin.polling_timeout || 30),
  WEBHOOK_URL: Plugin.webhook_url || undefined,
  WEBHOOK_LISTEN: Plugin.webhook_listen || '0.0.0.0',
  WEBHOOK_PORT: Plugin.webhook_port ? Number(Plugin.webhook_port) : undefined,
  WEBHOOK_TOKEN: Plugin.webhook_token || undefined,
  DROP_UPDATES: Plugin.drop_updates,
  USER_ID: Plugin.user_id ? Number(Plugin.user_id) : undefined,
  AUTO_START: Plugin.auto_start
} as const satisfies Config

const WORK_MODE = { POLLING: 'polling', WEBHOOK: 'webhook' } as const

const TEXT_MIME_TYPE = 'text/plain; charset=utf-8'

const ALL_UPDATE_TYPES = [
  'message',
  'callback_query',
  'edited_message',
  'channel_post',
  'edited_channel_post',
  'business_connection',
  'business_message',
  'edited_business_message',
  'deleted_business_messages',
  'inline_query',
  'chosen_inline_result',
  'shipping_query',
  'pre_checkout_query',
  'purchased_paid_media',
  'poll',
  'poll_answer',
  'my_chat_member',
  'chat_join_request',
  'chat_boost',
  'removed_chat_boost',
  'chat_member',
  'message_reaction',
  'message_reaction_count'
] as const

const STORES = {
  Env: Plugins.useEnvStore(),
  App: Plugins.useAppStore(),
  AppSettings: Plugins.useAppSettingsStore(),
  KernelApi: Plugins.useKernelApiStore(),
  Plugins: Plugins.usePluginsStore(),
  Rulesets: Plugins.useRulesetsStore(),
  Subscribes: Plugins.useSubscribesStore(),
  Profiles: Plugins.useProfilesStore(),
  ScheduledTask: Plugins.useScheduledTasksStore()
}

const MESSAGES = {
  info: (kernelVersion: string) => {
    const { appName, appVersion, os, arch } = STORES.Env.env
    const { running, config, proxies } = STORES.KernelApi
    const groups = [
      ...Object.values(proxies).filter((p) => ['Selector', 'URLTest'].includes(p.type) && p.name !== 'GLOBAL'),
      ...(proxies.GLOBAL ? [proxies.GLOBAL] : [])
    ].map((g) => `  · ${g.name} -> ${g.now || 'None'} (${g.history[0]?.delay ?? '0'} ms)`)

    return `
· 操作系统：${os} (${arch})
· GUI客户端：${appName} (${appVersion})
· 内核版本：${kernelVersion}
· 内核状态：${running ? '运行中' : '已停止'}
· 工作模式：${config.mode ?? 'Unknown'}
· 代理组：
${groups.join('\n')}

未完待续...
  `.trim()
  }
}

const COMMANDS = [
  {
    command: 'start',
    description: '开始',
    action: async (ctx) => {
      const kernelVersion = await getLocalKernelVersion()
      const alphaKernelVersion = await getLocalKernelVersion(true)
      const text = MESSAGES.info(`${kernelVersion} / ${alphaKernelVersion} (Alpha)`)
      const inlineKeyboard = getInlineKeyboards([
        [
          {
            text: '刷新数据',
            callback_data: 'refresh'
          }
        ],
        [
          {
            text: '切换工作模式',
            callback_data: 'switch_mode'
          }
        ],
        [
          {
            text: '下载内核日志',
            callback_data: 'download_logs'
          }
        ]
      ])
      if (ctx.callbackQuery) {
        await ctx.updateCallbackMessage(text, {
          reply_markup: inlineKeyboard
        })
      } else {
        await ctx.reply(text, {
          reply_markup: inlineKeyboard
        })
      }
    }
  }
] as const satisfies Command[]

const CALLBACKS = [
  {
    data: 'refresh',
    action: async (ctx) => {
      await COMMANDS.find((c) => c.command === ('start' as string))?.action(ctx)
    }
  },
  {
    data: 'switch_mode',
    action: async (ctx) => {
      const [, , modeToSwitch] = ctx.callbackQueryData.split('_')
      const { config } = STORES.KernelApi
      if (modeToSwitch && modeToSwitch !== config.mode) {
        await STORES.KernelApi.updateConfig('mode', modeToSwitch)
        config.mode = modeToSwitch
      }
      const switchButtons = getInlineKeyboards(
        config['mode-list']?.map((mode) => [
          {
            text: mode === config.mode ? `${mode} ✅` : mode,
            callback_data: `switch_mode_${mode}`
          }
        ]) ?? [],
        true
      )
      await ctx.updateCallbackMessage('切换工作模式', {
        reply_markup: switchButtons
      })
    }
  },
  {
    data: 'download_logs',
    action: async (ctx) => {
      const logs = window[Plugin.id].bot?.logCollector.getLogs()
      if (!logs?.length) {
        await ctx.reply('暂无日志')
        return
      }
      const fileName = `${KERNEL_TYPE}_${getLocalTime(Date.now(), 'long')}.log`
      const logText = formatLogs(logs)
      const file = new File([logText], fileName, {
        type: 'text/plain'
      })
      await ctx.replyWithDocument(file)
    }
  },
  {
    data: 'back_info',
    action: async (ctx) => {
      await COMMANDS.find((c) => c.command === ('start' as string))?.action(ctx)
    }
  }
] as const satisfies Callback[]

/* 触发器 手动触发 */
export const onRun = async () => {
  return start()
}

/* 触发器 APP就绪后 */
export const onReady = async () => {
  if (!CONFIG.AUTO_START) return
  await start()
}

/* 触发器 核心启动后 */
export const onCoreStarted = () => {
  window[Plugin.id].bot?.logCollector.start()
}

/* 触发器 核心停止后 */
export const onCoreStopped = () => {
  window[Plugin.id].bot?.logCollector.destroy()
}

const start = async () => {
  if (window[Plugin.id].isStarting) return
  window[Plugin.id].isStarting = true

  try {
    if (!CONFIG.BOT_TOKEN || !CONFIG.USER_ID) {
      throw '请先配置插件'
    }

    if (isNaN(CONFIG.USER_ID)) {
      throw '用户 ID 无效'
    }

    const isWebhookActivity = await isWebhookRunning()

    if (isWebhookActivity && !window[Plugin.id].bot) {
      await stop(true)
    }

    if (isWebhookActivity || window[Plugin.id].bot?.isPolling) {
      Plugins.message.info(`Bot 服务已在运行 (${CONFIG.WORK_MODE})`)
      return 1
    }

    if (!window[Plugin.id].bot) {
      const bot = new TelegramBot(CONFIG.BOT_TOKEN, CONFIG.USER_ID)
      window[Plugin.id].bot = bot

      COMMANDS.forEach((c) => {
        bot.command(c.command, async (ctx) => {
          await c.action(ctx)
        })
      })

      CALLBACKS.forEach((c) => {
        bot.callback(c.data, async (ctx) => {
          await ctx.api.answerCallbackQuery(ctx.callbackQueryId).catch((error: unknown) => {
            console.warn('Failed to answer callback query:', getErrorMessage(error))
          })
          await c.action(ctx)
        })
      })
    }

    const bot = window[Plugin.id].bot!

    await bot.api
      .setMyCommands(
        COMMANDS.map((c) => ({
          command: c.command,
          description: c.description
        })),
        {
          scope: {
            type: 'chat',
            chat_id: CONFIG.USER_ID
          }
        }
      )
      .catch((error: unknown) => {
        console.warn('Failed to set commands:', getErrorMessage(error))
      })

    await bot.api.deleteWebhook({
      drop_pending_updates: CONFIG.DROP_UPDATES
    })

    if (CONFIG.WORK_MODE === WORK_MODE.WEBHOOK) {
      if (!CONFIG.WEBHOOK_URL || !CONFIG.WEBHOOK_PORT || !CONFIG.WEBHOOK_TOKEN) {
        throw '请完整配置 Webhook 参数 (端口, URL, Token)'
      }
      await startWebhookServer(bot)
      await bot.api.setWebhook(`${CONFIG.WEBHOOK_URL}/webhook`, {
        drop_pending_updates: CONFIG.DROP_UPDATES,
        secret_token: CONFIG.WEBHOOK_TOKEN
      })
    } else {
      bot.startPolling({
        timeout: CONFIG.POLLING_TIMEOUT
      })
    }

    bot.logCollector.start()
  } catch (error) {
    await stop(true)
    throw `${CONFIG.WORK_MODE} 服务启动失败, ${getErrorMessage(error)}`
  } finally {
    window[Plugin.id].isStarting = false
  }

  Plugins.message.success(`Bot 服务已启动 (${CONFIG.WORK_MODE})`)
  return 1
}

const stop = async (silent = false) => {
  const bot = window[Plugin.id].bot
  try {
    const isWebhookActivity = await isWebhookRunning()
    if (!isWebhookActivity && !bot?.isPolling) {
      Plugins.message.info(`Bot 服务未在运行`)
      return 2
    }
    if (isWebhookActivity) {
      await stopWebhookServer()
    }
    bot?.stopPolling()
  } catch (error) {
    console.error('Error stopping service:', getErrorMessage(error))
  } finally {
    bot?.logCollector.destroy()
    window[Plugin.id].bot = undefined
  }
  if (!silent) Plugins.message.success(`Bot 服务已停止（${CONFIG.WORK_MODE}）`)
  return 2
}

const startWebhookServer = async (bot: TelegramBot) => {
  // eslint-disable-next-line @typescript-eslint/no-misused-promises, @typescript-eslint/require-await
  await Plugins.StartServer(`${CONFIG.WEBHOOK_LISTEN}:${CONFIG.WEBHOOK_PORT}`, Plugin.id, async (req, res) => {
    const { url, method, headers, body } = req
    if (method !== 'POST') {
      res.end(405, { 'Content-Type': TEXT_MIME_TYPE }, 'Method Not Allowed')
      return
    }
    if (url !== '/webhook') {
      res.end(404, { 'Content-Type': TEXT_MIME_TYPE }, 'Not Found')
      return
    }

    if (headers['X-Telegram-Bot-Api-Secret-Token'] !== CONFIG.WEBHOOK_TOKEN) {
      res.end(403, { 'Content-Type': TEXT_MIME_TYPE }, 'Forbidden')
      console.warn('Unauthorized webhook request')
      return
    }

    let update: Update
    try {
      update = JSON.parse(atob(body)) as unknown as Update
    } catch (error) {
      res.end(400, { 'Content-Type': TEXT_MIME_TYPE }, 'Bad Request')
      console.error('Invalid webhook request', getErrorMessage(error))
      return
    }

    res.end(200, { 'Content-Type': TEXT_MIME_TYPE }, 'OK')
    void bot.handleUpdate(update)
  })
}

const stopWebhookServer = async () => {
  await Plugins.StopServer(Plugin.id)
}

const isWebhookRunning = async () => {
  return (await Plugins.ListServer()).includes(Plugin.id)
}

class TelegramBot {
  public isPolling = false
  public readonly api: TelegramBotApi
  public readonly logCollector = new LogCollector(1000)

  private pollOffset = 0
  private readonly updateRegistry = new Map<UpdateType, Set<UpdateHandler>>()
  private readonly userId: number

  constructor(token: string, userId: number) {
    this.api = new TelegramBotApi(token)
    this.userId = userId
  }

  public async handleUpdate(update: Update) {
    if (!update.message && !update.callback_query) return
    try {
      const ctx = new UpdateContext(update, this.api)
      if (ctx.chat.type !== 'private') return
      if (ctx.user.id !== this.userId) return
      await this.dispatch(ctx)
    } catch (error) {
      console.error('Error while handling update:', getErrorMessage(error))
    }
  }

  public startPolling(opts?: ApiParams<'getUpdates'>) {
    if (this.isPolling) return
    this.isPolling = true
    void this.pollLoop(opts)
  }

  public stopPolling() {
    this.isPolling = false
  }

  public on(type: UpdateType, handle: UpdateHandler) {
    if (!this.updateRegistry.has(type)) {
      this.updateRegistry.set(type, new Set())
    }
    this.updateRegistry.get(type)!.add(handle)
  }

  public command(name: CommandType, handle: UpdateHandler) {
    this.on('message', async (ctx, done) => {
      if (!ctx.isBotCommand || ctx.command?.name !== name) return
      await handle(ctx, done)
      done()
    })
  }

  public callback(pattern: CallbackButtonType | `${CallbackButtonType}_${string}}` | RegExp, handle: UpdateHandler) {
    this.on('callback_query', async (ctx, done) => {
      const data = ctx.callbackQueryData
      const isMatch = typeof pattern === 'string' ? data === pattern || data.startsWith(`${pattern}_`) : pattern.test(data)
      if (!isMatch) return
      await handle(ctx, done)
      done()
    })
  }

  private async pollLoop(opts?: ApiParams<'getUpdates'>) {
    while (this.isPolling) {
      if (window[Plugin.id].bot !== this) {
        console.error('Bot instance reference lost, stopping polling')
        this.isPolling = false
        return
      }
      try {
        const result = await this.api.getUpdates(
          {
            ...opts,
            offset: this.pollOffset
          },
          {
            ...(opts?.timeout && { Timeout: opts.timeout * 1000 * 1.5 })
          }
        )

        if (!result.ok) {
          console.error(`Polling error with code ${result.error_code}:`, result.description)
          await Plugins.sleep(3000)
          continue
        }

        if (result.result.length > 0) {
          for (const update of result.result) {
            this.pollOffset = update.update_id + 1
            void this.handleUpdate(update)
          }
        }
      } catch (error) {
        console.error('Network error while polling:', getErrorMessage(error))
        await Plugins.sleep(3000)
      }
    }
  }

  private async dispatch(ctx: UpdateContext) {
    const updateKeys = Object.keys(ctx.update) as UpdateType[]
    for (const key of updateKeys) {
      if (!ALL_UPDATE_TYPES.includes(key)) continue
      const handlers = this.updateRegistry.get(key)
      if (!handlers?.size) continue

      let propagationStopped = false
      const done = () => {
        propagationStopped = true
      }
      for (const handle of handlers) {
        if (propagationStopped as boolean) break
        try {
          await handle(ctx, done)
        } catch (error) {
          console.error('Handler perform failed:', getErrorMessage(error))
        }
      }
    }
  }
}

class TelegramBotApi {
  private readonly token: string

  constructor(token: string) {
    this.token = token
  }

  public getUpdates(opts?: ApiParams<'getUpdates'>, requestOpts?: RequestOptions) {
    return this.requestJson('getUpdates', opts, requestOpts)
  }

  public setWebhook(url: string, opts?: PickOptionalParams<'setWebhook'>) {
    return this.requestJson('setWebhook', { ...opts, url })
  }

  public deleteWebhook(opts?: PickOptionalParams<'deleteWebhook'>) {
    return this.requestJson('deleteWebhook', { ...opts })
  }

  public sendMessage(chat_id: ChatId, text: string, opts?: PickOptionalParams<'sendMessage'>) {
    return this.requestJson('sendMessage', {
      ...opts,
      chat_id,
      text
    })
  }

  public sendDocument(chat_id: ChatId, file: File, opts?: PickOptionalParams<'sendDocument'>) {
    return this.requestJson('sendDocument', {
      ...opts,
      chat_id,
      document: file
    })
  }

  public editMessageText(chat_id: ChatId, message_id: Integer, text: string, opts?: PickOptionalParams<'editMessageText'>) {
    return this.requestJson('editMessageText', {
      ...opts,
      chat_id,
      message_id,
      text
    })
  }

  public editMessageReplyMarkup(chat_id: ChatId, message_id: Integer, reply_markup: InlineKeyboardMarkup, opts?: PickOptionalParams<'editMessageReplyMarkup'>) {
    return this.requestJson('editMessageReplyMarkup', {
      ...opts,
      chat_id,
      message_id,
      reply_markup
    })
  }

  public deleteMessages(chat_id: ChatId, message_ids: Integer[]) {
    return this.requestJson('deleteMessages', { chat_id, message_ids })
  }

  public answerCallbackQuery(callback_query_id: string, opts?: PickOptionalParams<'answerCallbackQuery'>) {
    return this.requestJson('answerCallbackQuery', {
      ...opts,
      callback_query_id
    })
  }

  public setMyCommands(commands: BotCommand[], opts?: PickOptionalParams<'setMyCommands'>) {
    return this.requestJson('setMyCommands', {
      ...opts,
      commands
    })
  }

  private async requestJson<M extends ApiMethod>(method: M, params?: ApiParams<M>, requestOpts?: RequestOptions): Promise<ApiResponse<M>> {
    const apiUrl = this.getUrl(method)
    let response: { status: number; body: unknown } | undefined
    try {
      if (params) {
        const hasFile = Object.values(params).some((v) => v instanceof File || v instanceof Blob)
        if (hasFile) {
          const formData = this.makeFormData(params)
          response = await this.formDataRequest(apiUrl, formData)
        }
      }
      response ??= await this.jsonRequest(apiUrl, params, requestOpts)
    } catch (error) {
      throw new TelegramError('Network request failed', 'None', getErrorMessage(error))
    }

    if (response.status !== 200) {
      throw new TelegramError(`API Error with status ${response.status}`, response.body as string)
    }

    try {
      return JSON.parse(response.body as string) as ApiResponse<M>
    } catch (error) {
      throw new TelegramError('Invalid API response', response.body as string, getErrorMessage(error))
    }
  }

  private jsonRequest(url: string, params?: Recordable, requestOpts?: RequestOptions) {
    return Plugins.Requests({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      ...(params && {
        body: params as unknown as string
      }),
      ...(requestOpts && {
        options: requestOpts
      }),
      autoTransformBody: false
    })
  }

  private async formDataRequest(url: string, formData: FormData) {
    const response = await window.fetch(url, {
      method: 'POST',
      body: formData
    })
    return {
      status: response.status,
      body: await response.text()
    }
  }

  private makeFormData(params: Recordable): FormData {
    const formData = new FormData()
    for (const [key, value] of Object.entries(params)) {
      if (value instanceof File) {
        formData.append(key, value, value.name)
      } else if (value instanceof Blob) {
        formData.append(key, value, 'blob')
      } else if (typeof value === 'object' && value !== null) {
        formData.append(key, stringifyJson(value))
      } else {
        formData.append(key, stringifyJson(value))
      }
    }
    return formData
  }

  private getUrl(method: ApiMethod) {
    return `https://api.telegram.org/bot${this.token}/${method}`
  }
}

class UpdateContext {
  public readonly update: Update
  public readonly api: TelegramBotApi

  constructor(update: Update, api: TelegramBotApi) {
    this.update = update
    this.api = api
  }

  public get message(): Message {
    const message = this.callbackQuery?.message ?? this.update.message
    if (!message) {
      throw new TelegramError('Update missing message')
    }
    return message
  }

  public get callbackQuery() {
    return this.update.callback_query
  }

  public get callbackQueryId() {
    if (!this.callbackQuery) {
      throw new TelegramError('Callback query missing callback_query.id')
    }
    return this.callbackQuery.id
  }

  public get callbackQueryData() {
    if (!this.callbackQuery?.data) {
      throw new TelegramError('Callback query missing callback_query.data')
    }
    return this.callbackQuery.data
  }

  public get chat(): Chat {
    return this.message.chat
  }

  public get user(): User {
    const user = this.callbackQuery?.from ?? this.message.from
    if (!user) {
      throw new TelegramError('Update missing user')
    }
    return user
  }

  public get text(): string | undefined {
    return this.message.text ?? this.message.caption
  }

  public get entities(): MessageEntity[] | undefined {
    return this.message.entities ?? this.message.caption_entities
  }

  public get hasCommandEntity(): boolean {
    return !!this.entities?.some((e) => e.type === 'bot_command')
  }

  public get command(): { name: CommandType; args: readonly string[] } | undefined {
    if (!this.hasCommandEntity || !this.text?.startsWith('/')) return
    const [rawCmd, ...args] = this.text.split(/\s+/)
    const name = rawCmd?.slice(1).split('@')[0]
    return COMMANDS.some((c) => c.command === name) ? { name: name as CommandType, args } : undefined
  }

  public get isBotCommand(): boolean {
    return !!this.command?.name
  }

  public reply(text: string, opts?: Omit<ApiParams<'sendMessage'>, 'text' | 'chat_id'>) {
    return this.api.sendMessage(this.chat.id, text, opts)
  }

  public replyWithDocument(file: File, opts?: Omit<ApiParams<'sendDocument'>, 'file' | 'chat_id'>) {
    return this.api.sendDocument(this.chat.id, file, opts)
  }

  public async updateCallbackMessage(text: string, opts?: Omit<ApiParams<'editMessageText'>, 'text' | 'chat_id' | 'message_id'>) {
    return this.api.editMessageText(this.chat.id, this.message.message_id, text, opts)
  }
}

class LogCollector {
  private readonly limit: number
  private readonly buffer: (LogData | null)[]
  private cursor = 0
  private count = 0
  private unregister: (() => void) | undefined

  constructor(limit: number) {
    this.limit = limit
    this.buffer = new Array<LogData | null>(limit).fill(null)
  }

  public getLogs(): LogData[] {
    if (this.count === 0) return []
    return (this.count < this.limit ? this.buffer.slice(0, this.count) : [...this.buffer.slice(this.cursor), ...this.buffer.slice(0, this.cursor)]) as LogData[]
  }

  public start() {
    if (!STORES.KernelApi.running || this.unregister) return
    this.clear()
    this.unregister = STORES.KernelApi.onLogs((data) => {
      ;(data as LogData).timestamp = Date.now()
      this.buffer[this.cursor] = data as LogData
      this.cursor = (this.cursor + 1) % this.limit
      if (this.count < this.limit) this.count++
    })
  }

  public destroy() {
    this.unregister?.()
    this.unregister = undefined
    this.clear()
  }

  private clear() {
    this.cursor = this.count = 0
    this.buffer.fill(null)
  }
}

const stringifyJson = (value: unknown) => {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  return JSON.stringify(value)
}

const getInlineKeyboards = (buttons: InlineKeyboardButton[][], hasBack = false): InlineKeyboardMarkup => {
  return {
    inline_keyboard: [
      ...buttons,
      ...(hasBack
        ? [
            [
              {
                text: '返回信息页',
                callback_data: 'back_info'
              }
            ]
          ]
        : [])
    ]
  }
}

const getErrorMessage = (error: unknown): string => {
  if (error instanceof TelegramError) {
    return `${error.message}\n${error.errorText ?? ''}\n${error.originalError ?? ''}`.trim()
  }
  return error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
}

const getLocalKernelVersion = async (isAlpha = false) => {
  try {
    const filename = await Plugins.getKernelFileName(isAlpha)
    const coreFilePath = `data/${KERNEL_TYPE}/${filename}`
    const res = await Plugins.Exec(coreFilePath, ['version'])
    return /version (\S+)/.exec(res)?.[1] || 'Unknown'
  } catch (error) {
    console.error('Kernel version get failed:', getErrorMessage(error))
    return 'Unknown'
  }
}

const getLocalTime = (timestamp: number, format: 'long' | 'short') => {
  return Plugins.formatDate(timestamp, format === 'long' ? 'YYYY-MM-DD_HH-mm-ss' : 'HH:mm:ss')
}

const formatLogs = (logs: LogData[]): string => {
  return logs.map((v, i) => `${i + 1}  ${getLocalTime(v.timestamp, 'short')}  ${v.type.toUpperCase()}  ${v.payload}`).join('\n')
}

class TelegramError extends Error {
  constructor(
    message: string,
    public readonly errorText?: string,
    public readonly originalError?: string
  ) {
    super(message)
    this.name = 'TelegramError'
  }
}
