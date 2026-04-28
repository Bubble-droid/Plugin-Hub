import type {
  DnsExtraPropertyMap,
  DnsHostsPredefined,
  DnsRule,
  DnsRules,
  DnsServerUnionType,
  InboundExtraPropertyMap,
  InboundUnionType,
  OutboundExtraPropertyMap,
  OutboundUnionType,
  RouteRule,
  RulesetType,
  RulesetUnionType,
  SingBoxConfig
} from '@/types/sing-box.js'
import type { Evaluate, ExtractAndEnsureDefined, ExtractWithKey } from '@/types/utils.js'
import type { Subscription } from '@gui-for-singbox/types/app.js'
import type { default_rule_with_metadata } from '@typebox/rule.js'
import type { listable, resolver } from '@typebox/types.js'

type TRouteOptions = Omit<Extract<Exclude<RouteRule, { type: unknown } | { outbound: unknown }>, { action: 'route-options' }>, 'action'>

interface PluginStates {
  subscribeId: string
  subscribeName: string
  proxyTagToId: Map<string, string>
  inboundTagToId: Map<string, string>
  outboundTagToId: Map<string, string>
  rulesetTagToId: Map<string, string>
  dnsServerTagToId: Map<string, string>
}

type BaseRules = Evaluate<Pick<default_rule_with_metadata<string, string>, Exclude<RuleType, 'ip_accept_any' | 'inline' | 'outbound' | 'InsertionPoint'>>>

type FilterModeType = (typeof FilterMode)[keyof typeof FilterMode]
type Filtered<O extends object, T extends object, M extends FilterModeType> = Evaluate<
  M extends typeof FilterMode.Include ? Pick<O, Extract<keyof O, keyof T>> : Omit<O, Extract<keyof O, keyof T>>
>

/** @type {EsmPlugin} */
export default (Plugin: PluginMetadata): PluginExposed => {
  const appStore = Plugins.useAppStore()
  /* 触发器 手动触发 */
  const onRun = async () => {
    openUI()
  }

  /* 触发器 APP就绪后 */
  const onReady = async () => {
    appStore.addCustomActions('profiles_header', {
      id: Plugin.id,
      component: 'Button',
      componentProps: {
        type: 'link',
        onClick: openUI
      },
      componentSlots: {
        default: '导入配置'
      }
    })
  }

  const openUI = () => {
    const { h, defineComponent } = Vue

    const component = defineComponent({
      template: `
    <div class="flex flex-col gap-4">
      <Card>
        <div class="text-12" style="line-height: 1.6;">
          <div class="mb-8">
            <span class="font-bold text-primary">格式要求：</span>
            <span>此插件仅支持导入 <b>sing-box v1.12.0</b> 及以上版本的配置。</span>
          </div>

          <div class="mb-8">
            <div class="font-bold text-primary mb-4">工作原理：</div>
            <p class="mb-4 opacity-80">
              如果你的配置中包含 GUI 尚未支持的设置项，插件将采取<b>动态生成脚本</b>的方式处理：
            </p>
            <ul class="list-disc pl-20 opacity-80 mb-4">
              <li>
                对于尚未支持的端点、入站和 DNS 服务器，插件会创建同名的<b>占位项</b>。
                <div class="mt-2 text-11 italic opacity-90">
                  * 注：端点占位项将同步在<b>入站</b>与<b>出站</b>中创建。
                </div>
                <div class="mt-2">
                  为了脚本能正确还原配置，<span style="color: #ff4d4f;">请勿删除这些占位项</span>，它们将在运行时被脚本替换为原始配置。
                </div>
              </li>
              <li>
                其他<b>尚未支持</b>的字段同样会在运行时通过脚本自动<b>还原</b>。
              </li>
            </ul>
            <p class="opacity-80">
              在大多数情况下，GUI 最终生成的运行时配置将与你导入的原始配置<b>保持一致</b>。
            </p>
          </div>
        </div>
      </Card>

      <div class="flex gap-12 mt-2">
        <Button type="primary" @click="importLocalConfig" icon="file" class="flex-1">
          从文件导入
        </Button>
        <Button type="primary" @click="importRemoteConfig" icon="link" class="flex-1">
          从链接导入
        </Button>
      </div>
    </div>
    `,

      setup() {
        return {
          importLocalConfig,
          importRemoteConfig
        }
      }
    })

    const modal = Plugins.modal(
      {
        title: '配置导入帮助',
        width: '420px',
        submit: false,
        cancelText: '关闭',
        maskClosable: true,
        afterClose: () => {
          modal.destroy()
        }
      },
      {
        default: () => h(component),
        action: () => h('div', { class: 'mr-auto text-12 opacity-60' }, '注：如果看不懂以上说明，建议使用快速开始。')
      }
    )

    modal.open()
  }

  /* 导入本地配置 */
  const importLocalConfig = async () => {
    const files = await selectFile({ multiple: true, accept: '.json, application/json' })
    if (!files) {
      Plugins.message.warn('未选择任何文件')
      return
    }

    Plugins.message.info(`开始解析 ${files.length} 个文件...`)
    const fileList = Array.from(files)
    const results = await Promise.allSettled(fileList.map(readJson))

    for (const [i, result] of results.entries()) {
      const fileName = fileList[i]!.name
      if (result.status === 'fulfilled') {
        try {
          const importer = new ConfigImporter(result.value, fileName)
          await importer.process()
          Plugins.message.info(`文件 "${fileName}" 导入成功`)
        } catch (err) {
          Plugins.message.error(`文件 "${fileName}" 导入失败: ${(err as { message?: string }).message ?? String(err)}`)
        }
      } else {
        Plugins.message.error((result.reason as { message?: string }).message ?? (result.reason as string))
      }
    }
  }

  /* 导入远程配置 */
  const importRemoteConfig = () => {
    const { h, ref, computed, defineComponent } = Vue

    const component = defineComponent({
      template: `
    <div class="flex flex-col gap-4">
      <div>
        <div class="text-14 opacity-80 mb-4">请输入链接（每行一个）：</div>
        <textarea
          v-model="remoteUrls"
          class="w-full p-8 rounded border outline-none resize-none font-mono text-14 box-border"
          style="height: 120px; background: transparent; color: inherit; border-color: var(--el-border-color); box-sizing: border-box;"
          placeholder="https://example.com/config.json"
        ></textarea>
      </div>

      <div class="flex justify-end mt-2">
          <Button type="primary" @click="handleImport" :loading="importing" icon="play">
          {{ importBtnText }}
        </Button>
      </div>
    </div>
    `,

      setup() {
        const remoteUrls = ref('')
        const importing = ref(false)

        const urlCount = computed(() => {
          return remoteUrls.value.split('\n').filter((u) => u.trim().length > 0).length
        })

        const importBtnText = computed(() => {
          return urlCount.value > 0 ? `导入 (${urlCount.value})` : '开始导入'
        })

        const handleImport = async () => {
          const urls = remoteUrls.value.split('\n').flatMap((u) => {
            const clean = u.trim()
            return clean.length > 0 ? [clean] : []
          })

          if (urls.length === 0) {
            Plugins.message.warn('未输入任何链接')
            return
          }

          importing.value = true
          try {
            const failCount = await processRemoteImport(urls)
            if (failCount === 0) {
              modal.close()
            }
          } finally {
            importing.value = false
          }
        }

        return {
          remoteUrls,
          importing,
          importBtnText,
          handleImport
        }
      }
    })

    const modal = Plugins.modal(
      {
        title: '批量导入 URL',
        width: '420px',
        submit: false,
        cancelText: '关闭',
        maskClosable: false,
        afterClose: () => {
          modal.destroy()
        }
      },
      {
        default: () => h(component),
        action: () => h('div', { class: 'mr-auto text-12 opacity-60' }, '注：请确保导入来源可信')
      }
    )

    modal.open()
  }

  return { onRun, onReady }
}

const FilterMode = { Include: 'include', Exclude: 'exclude' } as const

const RequestMethod = {
  Get: 'GET',
  Post: 'POST',
  Delete: 'DELETE',
  Put: 'PUT',
  Head: 'HEAD',
  Patch: 'PATCH'
} as const

const LogLevel = {
  Trace: 'trace',
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
  Fatal: 'fatal',
  Panic: 'panic'
} as const

const ClashMode = {
  Global: 'global',
  Rule: 'rule',
  Direct: 'direct'
} as const

const TunStack = {
  System: 'system',
  GVisor: 'gvisor',
  Mixed: 'mixed'
} as const

const RulesetType = {
  Inline: 'inline',
  Local: 'local',
  Remote: 'remote'
} as const

const RulesetFormat = {
  Source: 'source',
  Binary: 'binary'
} as const

const Inbound = {
  Mixed: 'mixed',
  Socks: 'socks',
  Http: 'http',
  Tun: 'tun'
} as const

const Outbound = {
  Direct: 'direct',
  Block: 'block',
  Selector: 'selector',
  Urltest: 'urltest'
} as const

const BuiltOutboundType = {
  BuiltIn: 'Built-in',
  Subscription: 'Subscription'
} as const

const RuleType = {
  Inbound: 'inbound',
  Network: 'network',
  Protocol: 'protocol',
  Domain: 'domain',
  DomainSuffix: 'domain_suffix',
  DomainKeyword: 'domain_keyword',
  DomainRegex: 'domain_regex',
  SourceIPCidr: 'source_ip_cidr',
  IPCidr: 'ip_cidr',
  SourcePort: 'source_port',
  SourcePortRange: 'source_port_range',
  Port: 'port',
  PortRange: 'port_range',
  ProcessName: 'process_name',
  ProcessPath: 'process_path',
  ProcessPathRegex: 'process_path_regex',
  RuleSet: 'rule_set',
  IpIsPrivate: 'ip_is_private',
  ClashMode: 'clash_mode',
  IpAcceptAny: 'ip_accept_any',
  // GUI
  Inline: 'inline'
} as const

const RuleAction = {
  Route: 'route',
  RouteOptions: 'route-options',
  Reject: 'reject',
  HijackDNS: 'hijack-dns',
  Sniff: 'sniff',
  Resolve: 'resolve',
  Predefined: 'predefined'
} as const

const RuleActionReject = {
  Default: 'default',
  Drop: 'drop',
  Reply: 'reply'
} as const

const DnsServer = {
  Local: 'local',
  Hosts: 'hosts',
  Tcp: 'tcp',
  Udp: 'udp',
  Tls: 'tls',
  Https: 'https',
  Quic: 'quic',
  H3: 'h3',
  Dhcp: 'dhcp',
  FakeIP: 'fakeip'
} as const

const Strategy = {
  Default: 'default',
  PreferIPv4: 'prefer_ipv4',
  PreferIPv6: 'prefer_ipv6',
  IPv4Only: 'ipv4_only',
  IPv6Only: 'ipv6_only'
} as const

const SubscribeType = {
  Http: 'Http',
  Local: 'File',
  Manual: 'Manual'
} as const

const DefaultTunAddress = ['172.18.0.1/30', 'fdfe:dcba:9876::1/126']

const DefaultTestURL = 'https://www.gstatic.com/generate_204'

const DefaultExcludeProtocols = 'direct|reject|selector|urltest|block|dns|shadowsocksr'

const DefaultSubscribeScript = `const onSubscribe = async (proxies, subscription) => {\n  return { proxies, subscription }\n}`

const DefaultLog: ILog = {
  disabled: false,
  level: LogLevel.Info,
  output: '',
  timestamp: false
}

const DefaultExperimental: IExperimental = {
  clash_api: {
    external_controller: '127.0.0.1:20123',
    external_ui: '',
    external_ui_download_url: '',
    external_ui_download_detour: '',
    secret: '',
    default_mode: ClashMode.Rule,
    access_control_allow_origin: [],
    access_control_allow_private_network: false
  },
  cache_file: {
    enabled: true,
    path: 'cache.db',
    cache_id: '',
    store_fakeip: false,
    store_rdrc: false,
    rdrc_timeout: '7d'
  }
}

const DefaultInboundListen: InboundListen = {
  listen: '127.0.0.1',
  listen_port: 20120,
  tcp_fast_open: false,
  tcp_multi_path: false,
  udp_fragment: false
}

const DefaultInboundTun: NonNullable<IInbound['tun']> = {
  interface_name: '',
  address: DefaultTunAddress,
  mtu: 0,
  auto_route: true,
  strict_route: false,
  route_address: [],
  route_exclude_address: [],
  endpoint_independent_nat: false,
  stack: TunStack.Mixed
}

const DefaultOutbound: IOutbound = {
  id: '',
  tag: '',
  type: Outbound.Selector,
  outbounds: [],
  interrupt_exist_connections: false,
  url: DefaultTestURL,
  interval: '3m',
  tolerance: 50,
  include: '',
  exclude: '',
  icon: '',
  hidden: false
}

const DefaultRouteRule: IRule = {
  id: '',
  type: RuleType.RuleSet,
  enable: true,
  payload: '',
  invert: false,
  action: RuleAction.Route,
  outbound: '',
  sniffer: [],
  strategy: Strategy.Default,
  server: ''
}

const DefaultRuleSet: IRuleSet = {
  id: '',
  type: RulesetType.Local,
  tag: '',
  format: RulesetFormat.Binary,
  url: '',
  download_detour: '',
  update_interval: '',
  rules: '',
  path: ''
}

const DefaultRouteGeneral: Omit<IRoute, 'rule_set' | 'rules'> = {
  auto_detect_interface: true,
  default_interface: '',
  final: '',
  find_process: false,
  default_domain_resolver: {
    server: '',
    client_subnet: ''
  }
}

const DefaultDnsServer: IDNSServer = {
  id: '',
  tag: '',
  type: DnsServer.Local,
  detour: '',
  domain_resolver: '',
  server: '',
  server_port: '',
  path: '',
  interface: '',
  inet4_range: '',
  inet6_range: '',
  hosts_path: [],
  predefined: {}
}

const DefaultDnsRule: IDNSRule = {
  id: '',
  type: RuleType.RuleSet,
  enable: true,
  payload: '',
  action: RuleAction.Route,
  invert: false,
  server: '',
  strategy: Strategy.Default,
  disable_cache: false,
  client_subnet: ''
}

const DefaultDnsGeneral: Omit<IDNS, 'servers' | 'rules'> = {
  disable_cache: false,
  disable_expire: false,
  independent_cache: false,
  client_subnet: '',
  final: '',
  strategy: Strategy.Default
}

const RouteOptions: TRouteOptions = {
  override_address: '',
  override_port: 0,
  network_strategy: 'default',
  fallback_delay: '300ms',
  udp_disable_domain_unmapping: false,
  udp_connect: false,
  udp_timeout: '10s',
  tls_fragment: false,
  tls_fragment_fallback_delay: '500ms',
  tls_record_fragment: false
}

const PredefinedOptions: Pick<Extract<DnsRule, { action: 'predefined' }>, 'rcode' | 'answer' | 'ns' | 'extra'> = {
  rcode: 'NOERROR',
  answer: [],
  ns: [],
  extra: []
} as const

const DefaultMixin = (): IMixin => ({
  priority: 'mixin',
  format: 'json',
  config: '{}'
})

const DefaultScript = (): IScript => ({
  code: `const onGenerate = async (config) => {\n  return config\n}`
})

const DefaultGuiProfile = (): IProfile => ({
  id: generateId(),
  name: '',
  log: structuredClone(DefaultLog),
  experimental: structuredClone(DefaultExperimental),
  inbounds: [],
  outbounds: [],
  route: {
    rule_set: [],
    rules: [],
    ...structuredClone(DefaultRouteGeneral)
  },
  dns: {
    servers: [],
    rules: [],
    ...structuredClone(DefaultDnsGeneral)
  },
  mixin: DefaultMixin(),
  script: DefaultScript()
})

const createPlaceholderInbound = (id: string, tag: string): IInbound => ({
  id,
  tag,
  type: 'mixed',
  mixed: {
    listen: { ...DefaultInboundListen },
    users: []
  },
  enable: true
})

const createPlaceholderOutbound = (id: string, tag: string): IOutbound => ({
  ...DefaultOutbound,
  id,
  tag,
  type: 'direct'
})

const createPlaceholderDnsServer = (id: string, tag: string): IDNSServer => ({
  ...DefaultDnsServer,
  id,
  tag,
  type: 'local'
})

const getKeys = <T extends object>(obj: T): (keyof T)[] => {
  return Object.keys(obj) as (keyof T)[]
}

const getValues = <T extends object>(obj: T): T[keyof T][] => {
  return Object.values(obj) as T[keyof T][]
}

const hasOwn = <T extends object, K extends string>(obj: T, key: K): obj is ExtractAndEnsureDefined<T, K> => {
  if (!Object.hasOwn(obj, key)) return false
  return (obj as Record<PropertyKey, unknown>)[key] !== undefined
}

const invertObject = <T extends Record<PropertyKey, PropertyKey>>(obj: T | undefined): { [K in keyof T as T[K]]: K } => {
  if (!obj) return {} as { [K in keyof T as T[K]]: K }
  const inverted = Object.entries(obj).map(([key, value]) => [value, key])
  return Object.fromEntries(inverted) as { [K in keyof T as T[K]]: K }
}

const filterProps = <O extends object, T extends object, M extends FilterModeType>(sourceObj: O, templateObj: T, mode: M): Filtered<O, T, M> => {
  if (typeof sourceObj !== 'object') {
    return {} as Filtered<O, T, M>
  }

  const filtered = Object.entries(sourceObj).filter(([key]) => {
    const hasKey = hasOwn(templateObj, key)
    return mode === FilterMode.Include ? hasKey : !hasKey
  })

  return Object.fromEntries(filtered) as Filtered<O, T, M>
}

const ensureArray = <T>(value: listable<T> | undefined): T[] => {
  if (!value) return []
  return Array.isArray(value) ? [...value] : [value]
}

const stringifyJson = (value: object | undefined) => {
  if (!value) return ''
  return JSON.stringify(value, null, 2)
}

const mapToRecord = <K extends string, V>(map: Map<K, V>): Record<K, V> => {
  if (!map.size) return {} as Record<K, V>
  return Object.fromEntries(map) as Record<K, V>
}

const generateId = () => Plugins.sampleID()

const inferRuleSetFormat = (rs: RulesetUnionType): RuleSetFormat => {
  if (rs.type === RulesetType.Remote) {
    return SOURCE_SUFFIX_REGEX.test(new URL(rs.url).pathname) ? RulesetFormat.Source : RulesetFormat.Binary
  } else if (rs.type === RulesetType.Local) {
    return SOURCE_SUFFIX_REGEX.test(rs.path) ? RulesetFormat.Source : RulesetFormat.Binary
  }
  return RulesetFormat.Binary
}

/* 格式化 Hosts 服务器的 Predefined 属性 */
const formatHostsPredefined = (predefinedObject: DnsHostsPredefined): Recordable<string> => {
  if (!predefinedObject) return {}

  const formatted = Object.entries(predefinedObject).map(([domain, ips]) => {
    const ipStr = typeof ips === 'string' ? ips : ips.join(',')
    return [domain, ipStr]
  })

  return Object.fromEntries(formatted) as Recordable<string>
}

const normalizeClashMode = <T extends RouteRule>(rule: T): T => {
  const normalized = structuredClone(rule)
  if (hasOwn(normalized, 'clash_mode')) {
    normalized.clash_mode = normalized.clash_mode.toLowerCase()
  }
  if (hasOwn(normalized, 'rules')) {
    normalized.rules = normalized.rules.map((rule) => {
      if (hasOwn(rule, 'clash_mode')) {
        return {
          ...rule,
          clash_mode: rule.clash_mode.toLowerCase()
        }
      }
      return rule
    })
  }
  return normalized
}

const SOURCE_SUFFIX_REGEX = /\.json[c5]?$/
const BASE_RULES = invertObject(RuleType) as unknown as BaseRules

/* 将原始配置解析为 GUI 格式 */
class ConfigParser {
  private guiProfile: IProfile = DefaultGuiProfile()

  private rawConfig: SingBoxConfig
  private states: PluginStates

  private scriptProcessSegments: string[] = []

  constructor(rawConfig: SingBoxConfig, states: PluginStates) {
    this.rawConfig = rawConfig
    this.states = states
  }

  public process(fileName: string): IProfile {
    this.guiProfile.name = `${fileName.replace(SOURCE_SUFFIX_REGEX, '')}-profile`
    this.refreshTagToIdMaps()
    this.processEndpoints()
    this.parseInbounds()
    this.parseOutbounds()
    this.parseGeneral()
    this.parseDnsServers()
    this.parseRuleSets()
    this.parseRoute()
    this.parseDns()
    this.processExtraFields()
    this.composeProcessScript()
    return this.guiProfile
  }

  private refreshTagToIdMaps() {
    const { inbounds, outbounds, route, dns } = this.rawConfig
    const { inboundTagToId, outboundTagToId, rulesetTagToId, dnsServerTagToId } = this.states

    const tagToIdTasks = [
      [inbounds, inboundTagToId],
      [outbounds, outboundTagToId],
      [route?.rule_set, rulesetTagToId],
      [dns?.servers, dnsServerTagToId]
    ] as [{ tag: string }[] | undefined, Map<string, string>][]

    for (const [items, idMap] of tagToIdTasks) {
      if (!items?.length) continue
      for (const item of items) {
        idMap.set(item.tag, generateId())
      }
    }
  }

  private processEndpoints() {
    const { endpoints: rawEndpoints } = this.rawConfig
    if (!rawEndpoints?.length) return

    for (const { tag } of rawEndpoints) {
      const id = generateId()

      this.states.inboundTagToId.set(tag, id)
      this.states.outboundTagToId.set(tag, id)

      this.guiProfile.inbounds.push(createPlaceholderInbound(id, tag))
      this.guiProfile.outbounds.push(createPlaceholderOutbound(id, tag))
    }

    const endpointsProcessing = `
config.endpoints = ${stringifyJson(rawEndpoints)};
const isNotEndpoint = (item) => !config.endpoints.some((ep) => ep.tag === item.tag);
config.inbounds = config.inbounds.filter(isNotEndpoint);
config.outbounds = config.outbounds.filter(isNotEndpoint);
`

    this.appendScriptSegment(endpointsProcessing)
  }

  /* 解析入站设置 */
  private parseInbounds() {
    const { inbounds: rawInbounds } = this.rawConfig
    if (!rawInbounds?.length) return

    const extraInbounds = new Map<string, Exclude<InboundUnionType, { type: InboundType }>>()
    const inboundExtProps: InboundExtraPropertyMap = new Map()

    const supportedInbounds = getValues(Inbound)
    const isSupportedInbound = <T extends InboundUnionType>(ib: T): ib is Extract<T, { type: InboundType }> => {
      return supportedInbounds.includes(ib.type as InboundType)
    }

    const parsedInbounds = rawInbounds.map((ib): IInbound => {
      const { tag, type } = ib

      const inboundBase = {
        id: this.getInboundId(tag),
        tag,
        type,
        enable: true
      } as IInbound

      if (!isSupportedInbound(ib)) {
        extraInbounds.set(tag, ib)
        return createPlaceholderInbound(inboundBase.id, tag)
      }

      if (type === Inbound.Tun) {
        const { route_address, route_exclude_address, address } = ib
        const { type, tag, ...tunExtProps } = filterProps(ib, DefaultInboundTun, FilterMode.Exclude)
        if (getKeys(tunExtProps).length > 0) inboundExtProps.set(tag, tunExtProps)

        return {
          ...inboundBase,
          tun: {
            ...DefaultInboundTun,
            ...filterProps(ib, DefaultInboundTun, FilterMode.Include),
            route_address: ensureArray(route_address),
            route_exclude_address: ensureArray(route_exclude_address),
            address: ensureArray(address)
          }
        }
      } else {
        const { users } = ib
        const { type, tag, ...otherExtProps } = filterProps(ib, { ...DefaultInboundListen, users }, FilterMode.Exclude)
        if (getKeys(otherExtProps).length > 0) inboundExtProps.set(tag, otherExtProps)

        return {
          ...inboundBase,
          [type as 'mixed']: {
            listen: {
              ...DefaultInboundListen,
              ...filterProps(ib, DefaultInboundListen, FilterMode.Include)
            },
            users: users?.map((u) => `${u.username}:${u.password}`) ?? []
          }
        }
      }
    })

    this.guiProfile.inbounds.push(...parsedInbounds)

    if (!extraInbounds.size && !inboundExtProps.size) return

    const inboundsProcessing = `
const extraInboundsMap = ${stringifyJson(mapToRecord(extraInbounds))};
const inboundExtPropsMap = ${stringifyJson(mapToRecord(inboundExtProps))};
config.inbounds = config.inbounds.map((ib) => {
  const tag = ib.tag;
  const extInbound = extraInboundsMap[tag];
  const extProps = inboundExtPropsMap[tag];
  if (extInbound) {
    return extInbound;
  }
  if (extProps) {
    return {
      ...ib,
      ...extProps,
    };
  }
  return ib;
});
`

    this.appendScriptSegment(inboundsProcessing)
  }

  /* 解析出站设置 */
  private parseOutbounds() {
    const { outbounds: rawOutbounds } = this.rawConfig
    if (!rawOutbounds?.length) return

    const { subscribeId, subscribeName, proxyTagToId } = this.states
    const outboundExtProps: OutboundExtraPropertyMap = new Map()

    const parsedOutbounds = (rawOutbounds as Extract<OutboundUnionType, { type: OutboundType }>[]).map((ob): IOutbound => {
      const { type, tag } = ob
      if (type === Outbound.Selector || type === Outbound.Urltest) {
        const outboundGroup: IOutbound = {
          ...DefaultOutbound,
          ...filterProps(
            ob as Extract<OutboundUnionType, { type: 'urltest' }>,
            DefaultOutbound as Omit<IOutbound, 'id' | 'include' | 'exclude'>,
            FilterMode.Include
          ),
          id: this.getOutboundId(tag),
          outbounds: []
        }

        const groupExtProps = filterProps(
          ob as Extract<OutboundUnionType, { type: 'urltest' }>,
          DefaultOutbound as Omit<IOutbound, 'id' | 'include' | 'exclude'>,
          FilterMode.Exclude
        )
        if (getKeys(groupExtProps).length > 0) outboundExtProps.set(tag, groupExtProps)

        outboundGroup.outbounds = ob.outbounds.flatMap((tag): IProxy[] => {
          const outId = this.getOutboundId(tag)
          const proxyId = this.getProxyId(tag)

          // 引用的是一个内置出站
          if (outId) return [{ id: outId, tag, type: BuiltOutboundType.BuiltIn }]
          // 引用的是订阅中的节点
          if (proxyId) return [{ id: proxyId, tag, type: subscribeId }]
          return []
        })

        // 如果出站引用了订阅中的所有节点，则简化为引用整个订阅
        const referencedProxyTags = new Set(
          outboundGroup.outbounds.flatMap((o) => {
            if (o.type !== subscribeId) return []
            return [o.tag]
          })
        )

        if (referencedProxyTags.size === proxyTagToId.size) {
          for (const pTag of proxyTagToId.keys()) {
            if (!referencedProxyTags.has(pTag)) return outboundGroup
          }

          const nonProxyOutbounds = outboundGroup.outbounds.filter((o) => o.type !== subscribeId)
          outboundGroup.outbounds = [{ id: subscribeId, tag: subscribeName, type: BuiltOutboundType.Subscription }, ...nonProxyOutbounds]
        }

        return outboundGroup
      } else {
        if (type === Outbound.Direct) {
          const directExtProps = filterProps(ob, { type, tag }, FilterMode.Exclude)
          if (getKeys(directExtProps).length > 0) outboundExtProps.set(tag, directExtProps)
        }

        return {
          ...DefaultOutbound,
          id: this.getOutboundId(tag),
          tag,
          type
        }
      }
    })

    this.guiProfile.outbounds.push(...parsedOutbounds)

    if (!outboundExtProps.size) return

    const outboundsProcessing = `
const outboundExtPropsMap = ${stringifyJson(mapToRecord(outboundExtProps))};
config.outbounds = config.outbounds.map((ob) => {
  const extProps = outboundExtPropsMap[ob.tag];
  if (extProps) {
    return {
      ...ob,
      ...extProps,
    };
  }
  return ob;
});
`

    this.appendScriptSegment(outboundsProcessing)
  }

  /* 解析通用设置 */
  private parseGeneral() {
    const { log: rawLog, experimental: rawExperimental } = this.rawConfig

    if (rawLog) {
      this.guiProfile.log = { ...DefaultLog, ...(rawLog as ILog) }
    }

    if (!rawExperimental) return

    const { clash_api: rawClashApi, cache_file: rawCacheFile } = rawExperimental

    if (rawClashApi) {
      this.guiProfile.experimental.clash_api = {
        ...DefaultExperimental.clash_api,
        ...rawClashApi,
        default_mode: rawClashApi.default_mode?.toLowerCase() ?? ClashMode.Rule,
        access_control_allow_origin: ensureArray(rawClashApi.access_control_allow_origin),
        external_ui_download_detour: this.getOutboundId(rawClashApi.external_ui_download_detour)
      }
    }

    if (rawCacheFile) {
      this.guiProfile.experimental.cache_file = {
        ...DefaultExperimental.cache_file,
        ...rawCacheFile
      }
      if (rawCacheFile.rdrc_timeout) {
        const rdrcTimeoutOverride = `
config.experimental.cache_file.rdrc_timeout = '${rawCacheFile.rdrc_timeout}';
`
        this.appendScriptSegment(rdrcTimeoutOverride)
      }
    }
  }

  /* 解析 DNS 服务器 */
  private parseDnsServers() {
    const rawDnsServers = this.rawConfig.dns?.servers
    if (!rawDnsServers?.length) return

    const extraDnsServers = new Map<string, Exclude<ExtractWithKey<DnsServerUnionType, 'type'>, { type: DNSServer }>>()
    const dnsServerExtProps: DnsExtraPropertyMap = new Map()

    const supportedServers = getValues(DnsServer)
    const isSupportedDnsServer = <T extends ExtractWithKey<DnsServerUnionType, 'type'>>(ds: T): ds is Extract<T, { type: DNSServer }> => {
      return supportedServers.includes(ds.type as Exclude<DNSServer, 'tailscale'>)
    }

    const parsedDnsServers = rawDnsServers.flatMap((ds): IDNSServer[] => {
      if (!hasOwn(ds, 'type')) return []
      const tag = ds.tag

      if (!isSupportedDnsServer(ds)) {
        extraDnsServers.set(tag, ds)
        return [createPlaceholderDnsServer(this.getDnsServerId(tag), tag)]
      }

      let dnsExtProps = filterProps(
        ds as Extract<DnsServerUnionType, { type: 'https' }>,
        DefaultDnsServer as Omit<IDNSServer, 'id' | 'hosts_path' | 'predefined' | 'interface' | 'inet4_range' | 'inet6_range' | 'domain_resolver'>,
        FilterMode.Exclude
      )
      if (hasOwn(ds, 'domain_resolver') && typeof ds.domain_resolver === 'object' && getKeys(ds.domain_resolver).length > 1) {
        dnsExtProps = { ...dnsExtProps, domain_resolver: ds.domain_resolver }
      }
      if (getKeys(dnsExtProps).length > 0) dnsServerExtProps.set(tag, dnsExtProps)

      return [
        {
          ...DefaultDnsServer,
          ...filterProps(
            ds as Extract<DnsServerUnionType, { type: 'https' }>,
            DefaultDnsServer as Omit<IDNSServer, 'id' | 'hosts_path' | 'predefined' | 'interface' | 'inet4_range' | 'inet6_range'>,
            FilterMode.Include
          ),
          id: this.getDnsServerId(ds.tag),
          detour: hasOwn(ds, 'detour') ? this.getOutboundId(ds.detour) : '',
          domain_resolver: hasOwn(ds, 'domain_resolver') ? this.getDomainResolverId(ds.domain_resolver) : '',
          server_port: hasOwn(ds, 'server_port') ? String(ds.server_port) : '',
          hosts_path: ds.type === DnsServer.Hosts ? ensureArray(ds.path) : [],
          predefined: ds.type === DnsServer.Hosts ? formatHostsPredefined(ds.predefined) : {},
          path: DnsServer.Https === ds.type || DnsServer.H3 === ds.type ? (ds.path ?? '') : ''
        }
      ]
    })

    this.guiProfile.dns.servers.push(...parsedDnsServers)

    if (!extraDnsServers.size && !dnsServerExtProps.size) return

    const dnsServersProcessing = `
const extraDnsServersMap = ${stringifyJson(mapToRecord(extraDnsServers))};
const dnsServerExtPropsMap = ${stringifyJson(mapToRecord(dnsServerExtProps))};
config.dns.servers = config.dns.servers.map((ds) => {
  const tag = ds.tag;
  const extDnsServer = extraDnsServersMap[tag];
  const extProps = dnsServerExtPropsMap[tag];
  if (extDnsServer) {
    return extDnsServer;
  }
  if (extProps) {
    return {
      ...ds,
      ...extProps,
    };
  }
  return ds;
});
    `

    this.appendScriptSegment(dnsServersProcessing)
  }

  /* 解析规则集 */
  private parseRuleSets() {
    const rawRuleSets = this.rawConfig.route?.rule_set
    if (!rawRuleSets?.length) return

    const parsedRuleSet = rawRuleSets.map((rs): IRuleSet => {
      return {
        ...DefaultRuleSet,
        ...rs,
        id: this.getRuleSetId(rs.tag),
        rules: rs.type === RulesetType.Inline ? stringifyJson(rs.rules) : '',
        download_detour: rs.type === RulesetType.Remote ? this.getOutboundId(rs.download_detour) : '',
        format: inferRuleSetFormat(rs)
      }
    })

    this.guiProfile.route.rule_set.push(...parsedRuleSet)
  }

  /* 解析路由设置 */
  private parseRoute() {
    const { route: rawRoute } = this.rawConfig
    if (!rawRoute) return

    this.parseRouteRules(rawRoute.rules)

    this.guiProfile.route = {
      ...this.guiProfile.route,
      ...filterProps(rawRoute, DefaultRouteGeneral, FilterMode.Include),
      final: this.getOutboundId(rawRoute.final),
      default_domain_resolver: {
        ...DefaultRouteGeneral.default_domain_resolver,
        server: this.getDomainResolverId(rawRoute.default_domain_resolver)
      }
    }

    let routeExtProps = filterProps(
      rawRoute,
      { ...DefaultRouteGeneral, rules: [], rule_set: [] } as Omit<IRoute, 'default_domain_resolver'>,
      FilterMode.Exclude
    )
    if (typeof rawRoute.default_domain_resolver === 'object' && getKeys(rawRoute.default_domain_resolver).length > 1) {
      routeExtProps = { ...routeExtProps, default_domain_resolver: rawRoute.default_domain_resolver }
    }

    if (!getKeys(routeExtProps).length) return

    const routeProcessing = `
const routeExtProps = ${stringifyJson(routeExtProps)};
config.route = {
  ...config.route,
  ...routeExtProps,
};
`

    this.appendScriptSegment(routeProcessing)
  }

  /* 解析 DNS 设置 */
  private parseDns() {
    const { dns: rawDns } = this.rawConfig
    if (!rawDns) return

    this.parseDnsRules(rawDns.rules)

    this.guiProfile.dns = {
      ...this.guiProfile.dns,
      ...filterProps(rawDns, DefaultDnsGeneral, FilterMode.Include),
      final: this.getDnsServerId(rawDns.final)
    }

    const dnsExtProps = filterProps(rawDns, { ...DefaultDnsGeneral, servers: [], rules: [] }, FilterMode.Exclude)
    if (!getKeys(dnsExtProps).length) return

    const dnsProcessing = `
const dnsExtProps = ${stringifyJson(dnsExtProps)};
config.dns = {
  ...config.dns,
  ...dnsExtProps,
};
`
    this.appendScriptSegment(dnsProcessing)
  }

  private processExtraFields() {
    const { ntp, certificate, services, experimental } = this.rawConfig
    if (ntp) {
      const ntpAppend = `
config.ntp = ${stringifyJson(ntp)};
`
      this.appendScriptSegment(ntpAppend)
    }

    if (certificate) {
      const certificateAppend = `
config.certificate = ${stringifyJson(certificate)};
`
      this.appendScriptSegment(certificateAppend)
    }

    if (services) {
      const servicesAppend = `
config.services = ${stringifyJson(services)};
`
      this.appendScriptSegment(servicesAppend)
    }

    if (experimental?.v2ray_api) {
      const v2rayApiAppend = `
config.experimental.v2ray_api = ${stringifyJson(experimental.v2ray_api)};
`
      this.appendScriptSegment(v2rayApiAppend)
    }
  }

  private composeProcessScript() {
    const compositeScript = this.scriptProcessSegments.join('\n\n')
    this.guiProfile.script.code = `const onGenerate = async (config) => {\n  ${compositeScript}\n  return config\n}`
  }

  /* 解析路由规则 */
  private parseRouteRules(rawRouteRules: RouteRule[] | undefined) {
    if (!rawRouteRules?.length) return

    const parsedRouteRules = rawRouteRules.map((rule): IRule => {
      const id = generateId()
      const { action, invert } = rule

      const ruleBase: IRule = {
        ...DefaultRouteRule,
        id,
        action: (action ?? 'route') as RuleAction,
        invert: invert ?? false
      }

      switch (action) {
        case RuleAction.RouteOptions: {
          const routeOptions = filterProps(rule, RouteOptions, FilterMode.Include)
          const rest = filterProps(rule, RouteOptions, FilterMode.Exclude) as RouteRule
          return {
            ...ruleBase,
            ...this.parseMatchRule(rest),
            outbound: stringifyJson(routeOptions)
          }
        }
        case RuleAction.Reject: {
          const { method, ...rest } = rule
          return {
            ...ruleBase,
            ...this.parseMatchRule(rest),
            outbound: method ?? RuleActionReject.Default
          }
        }
        case RuleAction.HijackDNS: {
          return {
            ...ruleBase,
            ...this.parseMatchRule(rule)
          }
        }
        case RuleAction.Sniff: {
          const { sniffer, ...rest } = rule
          return {
            ...ruleBase,
            ...this.parseMatchRule(rest),
            sniffer: ensureArray(sniffer)
          }
        }
        case RuleAction.Resolve: {
          const { strategy, server, ...rest } = rule
          return {
            ...ruleBase,
            ...this.parseMatchRule(rest as RouteRule),
            strategy: strategy ?? Strategy.Default,
            server: this.getDnsServerId(server)
          }
        }

        default: {
          const { outbound, ...rest } = rule
          return {
            ...ruleBase,
            ...this.parseMatchRule(rest as RouteRule),
            outbound: this.getOutboundId(outbound)
          }
        }
      }
    })

    this.guiProfile.route.rules.push(...parsedRouteRules)
  }

  /* 解析 DNS 规则 */
  private parseDnsRules(rawDnsRules: DnsRules) {
    if (!rawDnsRules?.length) return

    const parsedDnsRules = rawDnsRules.map((rule): IDNSRule => {
      const id = generateId()
      const { action, invert } = rule

      const ruleBase: IDNSRule = {
        ...DefaultDnsRule,
        id,
        action: (action as DnsRuleAction) ?? 'route',
        invert: invert ?? false
      }

      switch (action) {
        case RuleAction.RouteOptions: {
          const { disable_cache, rewrite_ttl, client_subnet, ...rest } = rule
          return {
            ...ruleBase,
            ...this.parseMatchRule(rest as RouteRule),
            disable_cache: disable_cache ?? false,
            client_subnet: client_subnet ?? '',
            server: rewrite_ttl ? stringifyJson({ rewrite_ttl }) : '{}'
          }
        }
        case RuleAction.Reject: {
          const { method, ...rest } = rule
          return {
            ...ruleBase,
            ...this.parseMatchRule(rest as RouteRule),
            server: method ?? RuleActionReject.Default
          }
        }
        case RuleAction.Predefined: {
          const predefined = filterProps(rule, PredefinedOptions, FilterMode.Include)
          const rest = filterProps(rule, PredefinedOptions, FilterMode.Exclude)

          return {
            ...ruleBase,
            ...this.parseMatchRule(rest as unknown as RouteRule),
            server: stringifyJson(predefined)
          }
        }

        default: {
          const { server, strategy, disable_cache, client_subnet, ...rest } = rule as unknown as IDNSRule
          return {
            ...ruleBase,
            ...this.parseMatchRule(rest as unknown as RouteRule),
            server: this.getDnsServerId(server),
            strategy: strategy ?? Strategy.Default,
            disable_cache: disable_cache ?? false,
            client_subnet: client_subnet ?? ''
          }
        }
      }
    })

    this.guiProfile.dns.rules.push(...parsedDnsRules)
  }

  /* 解析规则的匹配条件部分 */
  private parseMatchRule(rule: RouteRule): {
    type: RuleType
    payload: string
  } {
    const { action, invert, ...rest } = rule
    const normalizedRule = normalizeClashMode(rest as RouteRule)
    const baseRules = filterProps(normalizedRule, BASE_RULES, FilterMode.Include) as BaseRules
    const baseRuleKeys = getKeys(baseRules)
    const extraRuleKeys = getKeys(filterProps(normalizedRule, BASE_RULES, FilterMode.Exclude))

    // 当只有一个支持的类型时，视为简单规则
    if (baseRuleKeys.length === 1 && extraRuleKeys.length === 0) {
      const type = baseRuleKeys[0]!
      let payload = baseRules[type]

      switch (type) {
        case RuleType.RuleSet:
          {
            payload = ensureArray(baseRules.rule_set)
              .map((tag) => [this.getRuleSetId(tag)])
              .join(',')
          }
          break
        case RuleType.Inbound: {
          const inboundList = ensureArray(baseRules.inbound)
          if (inboundList.length > 1) {
            return {
              type: RuleType.Inline,
              payload: stringifyJson({ inbound: inboundList })
            }
          }
          payload = this.getInboundId(inboundList[0])
          break
        }
        case RuleType.ClashMode: {
          if (!getValues(ClashMode).includes(baseRules.clash_mode as (typeof ClashMode)[keyof typeof ClashMode])) {
            return {
              type: RuleType.Inline,
              payload: stringifyJson({ clash_mode: baseRules.clash_mode })
            }
          }
          break
        }
        default:
          if (Array.isArray(payload)) {
            payload = payload.join(',')
          }
      }

      return { type, payload: typeof payload !== 'string' ? String(payload) : payload }
    }

    // 其他所有情况（0个或多个类型，或不支持的类型）都视为内联规则
    return {
      type: RuleType.Inline,
      payload: stringifyJson(normalizedRule)
    }
  }

  private appendScriptSegment(segment: string) {
    this.scriptProcessSegments.push(segment.trim())
  }

  private getDomainResolverId(resolver: string | resolver<string> | undefined): string {
    return typeof resolver === 'string' ? this.getDnsServerId(resolver) : this.getDnsServerId(resolver?.server)
  }

  private getInboundId(tag: string | undefined): string {
    if (!tag) return ''
    return this.states.inboundTagToId.get(tag) ?? ''
  }

  private getOutboundId(tag: string | undefined): string {
    if (!tag) return ''
    return this.states.outboundTagToId.get(tag) ?? ''
  }

  private getRuleSetId(tag: string): string {
    return this.states.rulesetTagToId.get(tag) ?? ''
  }

  private getDnsServerId(tag: string | undefined): string {
    if (!tag) return ''
    return this.states.dnsServerTagToId.get(tag) ?? ''
  }

  private getProxyId(tag: string): string {
    return this.states.proxyTagToId.get(tag) ?? ''
  }
}

/* 导入 sing-box 的原始配置 */
class ConfigImporter {
  private config: SingBoxConfig
  private fileName: string
  private states: PluginStates = {
    subscribeId: '',
    subscribeName: '',
    proxyTagToId: new Map(),
    inboundTagToId: new Map(),
    outboundTagToId: new Map(),
    rulesetTagToId: new Map(),
    dnsServerTagToId: new Map()
  }

  constructor(config: SingBoxConfig, fileName: string) {
    this.config = config
    this.fileName = fileName
  }

  public async process() {
    await this.createSubscribe()
    await this.createProfile()
  }

  /* 创建 GUI 订阅 */
  private async createSubscribe() {
    const proxies = this.extractProxies()
    if (!proxies?.length) return

    const subscribesStore = Plugins.useSubscribesStore()
    const id = generateId()
    const name = `${this.fileName.replace(SOURCE_SUFFIX_REGEX, '')}-proxies`
    const path = `data/subscribes/${name}.json`

    this.states.subscribeId = id
    this.states.subscribeName = name

    await Plugins.WriteFile(path, stringifyJson(proxies))

    await subscribesStore.addSubscribe({
      id,
      name,
      path,
      type: SubscribeType.Manual,
      updateTime: 0,
      upload: 0,
      download: 0,
      total: 0,
      expire: 0,
      url: '',
      website: '',
      include: '',
      exclude: '',
      includeProtocol: '',
      excludeProtocol: DefaultExcludeProtocols,
      proxyPrefix: '',
      disabled: false,
      inSecure: false,
      requestMethod: RequestMethod.Get,
      requestTimeout: 15,
      header: { request: {}, response: {} },
      proxies: proxies.map((p) => ({ id: this.states.proxyTagToId.get(p.tag)!, tag: p.tag, type: p.type })),
      script: DefaultSubscribeScript
    } satisfies Subscription)
  }

  /* 创建 GUI 配置 */
  private async createProfile() {
    const profilesStore = Plugins.useProfilesStore()
    const parser = new ConfigParser(this.config, this.states)
    const guiProfile = parser.process(this.fileName)
    await profilesStore.addProfile(guiProfile)
  }

  /* 提取配置中的节点部分 */
  private extractProxies(): NonNullable<SingBoxConfig['outbounds']> | undefined {
    if (!this.config.outbounds?.length) {
      Plugins.message.warn('缺少出站配置，可能导致解析出错')
      return
    }

    const excludeTypes = DefaultExcludeProtocols.split('|')
    const proxies = this.config.outbounds.filter((o) => {
      if (excludeTypes.includes(o.type)) return false
      this.states.proxyTagToId.set(o.tag, generateId())
      return true
    })

    const builtOutbounds = getValues(Outbound)
    this.config.outbounds = this.config.outbounds.filter((o) => builtOutbounds.includes(o.type as OutboundType))

    return proxies
  }
}

/* 打开文件选择器 */
const selectFile = (options: { multiple?: boolean; accept?: string } = {}): Promise<FileList | null> => {
  return new Promise((resolve) => {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.style.display = 'none'
    fileInput.multiple = options.multiple ?? false
    fileInput.accept = options.accept ?? ''

    const cleanup = () => {
      window.removeEventListener('focus', onFocus)
      document.body.removeChild(fileInput)
    }

    const onFocus = () => {
      setTimeout(() => {
        if (fileInput.files?.length === 0) {
          resolve(null)
          cleanup()
        }
      }, 200)
    }

    fileInput.addEventListener('change', () => {
      resolve(fileInput.files && fileInput.files.length > 0 ? fileInput.files : null)
      cleanup()
    })

    window.addEventListener('focus', onFocus, { once: true })
    document.body.appendChild(fileInput)
    fileInput.click()
  })
}

/* 读取单个文件并解析 */
const readJson = (file: File): Promise<SingBoxConfig> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const data = event.target?.result
        resolve(JSON.parse(data as string) as SingBoxConfig)
      } catch (err) {
        reject(`文件 "${file.name}" 解析失败: ${(err as { message?: string }).message ?? String(err)}`)
      }
    }
    reader.onerror = () => {
      reject(`无法读取文件 "${file.name}"`)
    }
    reader.readAsText(file)
  })
}

/* 获取并解析远程文件 */
const fetchJson = async (url: string) => {
  try {
    const { body } = await Plugins.Requests({
      method: 'GET',
      url,
      headers: { 'User-Agent': 'sing-box' },
      autoTransformBody: false
    })
    return JSON.parse(body as string) as SingBoxConfig
  } catch (err) {
    throw `链接 "${url}" 解析失败: ${(err as { message?: string }).message ?? String(err)}`
  }
}

const processRemoteImport = async (urls: string[]) => {
  Plugins.message.info(`开始解析 ${urls.length} 个链接...`)
  const results = await Promise.allSettled(urls.map(fetchJson))

  let failCount = 0
  for (const [i, result] of results.entries()) {
    const url = urls[i]!
    if (result.status === 'fulfilled') {
      try {
        const host = new URL(url).hostname
        const importer = new ConfigImporter(result.value, host)
        await importer.process()
        Plugins.message.info(`链接 "${url}" 导入成功`)
      } catch (err) {
        failCount++
        Plugins.message.error(`链接 "${url}" 导入失败: ${(err as { message?: string }).message ?? String(err)}`)
      }
    } else {
      failCount++
      Plugins.message.error((result.reason as { message?: string }).message ?? (result.reason as string))
    }
  }
  return failCount
}
