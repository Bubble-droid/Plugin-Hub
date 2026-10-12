import type { CoreApiConnectionsData } from '@/types/kernel.js'
import type { SingBoxConfig } from '@/types/sing-box.js'
import { type Component, type PropType } from 'vue'

interface TrafficSummary {
  up: number
  down: number
}

interface WithTraffic {
  up: number
  down: number
}

interface WithHits extends WithTraffic {
  hits: number
}

type ClientDimensionMap = Record<string, WithHits>

interface ClientsEntry extends WithHits {
  domains: ClientDimensionMap
  nodes: ClientDimensionMap
  processes: ClientDimensionMap
  rules: ClientDimensionMap
  tags: ClientDimensionMap
}

interface StatsDetails {
  domains: Record<string, WithHits>
  roots: Record<string, WithHits>
  nodes: Record<string, WithTraffic>
  processes: Record<string, WithTraffic>
  rules: Record<string, WithHits>
  tags: Record<string, WithTraffic>
  pivot_node_domain: Record<string, Record<string, WithTraffic>>
  pivot_tag_node: Record<string, Record<string, WithTraffic>>
  log_levels?: Record<string, number>
  dns_types?: Record<string, number>
  dns_domains?: Record<string, { hits: number; types: Record<string, number> }>
  dns_ip_kinds?: { 'fake-ip': number; 'real-ip': number }
  clients: Record<string, ClientsEntry>
}

interface StatsData {
  summary: TrafficSummary
  details: StatsDetails
}

interface MonthlyData extends StatsData {
  daily: Record<string, StatsData>
}

interface StoreState {
  currentMonth: string
  data: MonthlyData | null
  tagsConfig: Record<string, string[]>
  lastConnections: Record<string, { download: number; upload: number }>
  unregs: (() => void)[]
}

// Router types
interface RouterRequest {
  url: string
  method: string
  headers: Record<string, string>
  body: string
  // augmented
  params?: Record<string, string>
  query?: Record<string, string>
}

interface RouterResponse {
  end: (status: number, headers: Record<string, string>, body: string, options?: { Mode: 'Binary' | 'Text' }) => void
  // augmented
  json?: (code: number, data: unknown) => void
}

interface RouteMeta {
  description?: Record<'zh' | 'en', string> | Record<string, string>
  examples?: Record<string, string>
}

type RouteHandler = (req: RouterRequest, res: RouterResponse, params: Record<string, string>) => MaybePromise<void>

const PATH = 'data/third/traffic-statistics'
const TAGS_FILE = PATH + '/tags.json'
const DataVersion = '-v1'

window[Plugin.id] = window[Plugin.id] ?? {
  state: {
    currentMonth: '',
    data: null,
    tagsConfig: {},
    lastConnections: {},
    unregs: []
  }
}

const store = window[Plugin.id]!.state

// =============================
// Helpers
// =============================

const getRootDomain = (host?: string): string | undefined => {
  if (!host) return host
  let hostname = host.split(':')[0]!.replace(/[[\]]/g, '')
  hostname = hostname.replace(/\.$/, '')
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || !hostname.includes('.')) return hostname
  const parts = hostname.split('.')
  if (parts.length <= 2) return hostname
  const secondToLast = parts[parts.length - 2]!.toLowerCase()
  const last = parts[parts.length - 1]!.toLowerCase()
  const commonSecondLevel = ['com', 'co', 'net', 'org', 'gov', 'edu', 'ac']
  if (last.length === 2 && commonSecondLevel.includes(secondToLast)) {
    return parts.slice(-3).join('.')
  }
  return parts.slice(-2).join('.')
}

const createEmptyStats = (): StatsData => ({
  summary: { up: 0, down: 0 },
  details: {
    domains: {},
    roots: {},
    nodes: {},
    processes: {},
    rules: {},
    tags: {},
    pivot_node_domain: {},
    pivot_tag_node: {},
    log_levels: {},
    dns_types: {},
    dns_domains: {},
    dns_ip_kinds: { 'fake-ip': 0, 'real-ip': 0 },
    clients: {}
  }
})

const ensureBasePath = async () => {
  if (!(await Plugins.FileExists(PATH).catch(() => false))) {
    await Plugins.MakeDir(PATH)
  }
}

const initMonthlyData = async () => {
  await ensureBasePath()
  const month = Plugins.formatDate(Date.now(), 'YYYY-MM')
  const content = await Plugins.ReadFile(`${PATH}/${month}${DataVersion}.json`).catch(() => JSON.stringify({ ...createEmptyStats(), daily: {} }))
  store.data = JSON.parse(content) as MonthlyData
  if (!('daily' in store.data)) (store.data as MonthlyData).daily = {} as Record<string, StatsData>
  store.currentMonth = month
  // load tags if exists
  store.tagsConfig = await Plugins.ReadFile(TAGS_FILE)
    .then((c) => JSON.parse(c) as Record<string, string[]>)
    .catch(() => ({}))
}

const saveMonthlyData = async () => {
  if (!store.data) return
  const path = `${PATH}/${store.currentMonth}${DataVersion}.json`
  await Plugins.WriteFile(path, JSON.stringify(store.data))
}

interface UpdateInfo {
  node: string
  fqdn: string
  root: string | undefined
  process: string
  rule: string
  tags: string[]
  clientIP?: string
}

const updateStats = (target: StatsData | null, diffUp: number, diffDown: number, isNew: boolean, info: UpdateInfo) => {
  if (!target) return
  const { node, fqdn, root, process, rule, tags, clientIP } = info
  target.summary.up += diffUp
  target.summary.down += diffDown

  const d = target.details
  const maps: [Record<string, WithHits | WithTraffic>, string, boolean][] = [
    [d.domains, fqdn, true],
    [d.roots, root ?? 'unknown', true],
    [d.nodes, node, false],
    [d.processes, process, false],
    [d.rules, rule, true]
  ]

  maps.forEach(([map, key, hasHits]) => {
    map[key] ??= { up: 0, down: 0, ...(hasHits ? { hits: 0 } : {}) }
    ;(map[key] as WithTraffic).up += diffUp
    ;(map[key] as WithTraffic).down += diffDown
    if (isNew && hasHits) (map[key] as WithHits).hits += 1
  })

  // 客户端统计
  if (clientIP) {
    d.clients[clientIP] ??= {
      up: 0,
      down: 0,
      hits: 0,
      domains: {},
      nodes: {},
      processes: {},
      rules: {},
      tags: {}
    }

    const c = d.clients[clientIP]
    c.up += diffUp
    c.down += diffDown
    if (isNew) c.hits += 1

    // 客户端下的子维度
    const subDimensions: [ClientDimensionMap, string][] = [
      [c.domains, fqdn],
      [c.nodes, node],
      [c.processes, process],
      [c.rules, rule]
    ]
    subDimensions.forEach(([map, key]) => {
      map[key] ??= { up: 0, down: 0, hits: 0 }
      map[key].up += diffUp
      map[key].down += diffDown
      if (isNew) map[key].hits += 1
    })

    // 标签分布
    tags.forEach((tag) => {
      c.tags[tag] ??= { up: 0, down: 0, hits: 0 }
      c.tags[tag].up += diffUp
      c.tags[tag].down += diffDown
      if (isNew) c.tags[tag].hits += 1
    })
  }

  // 全局标签与透视
  tags.forEach((tag) => {
    d.tags[tag] ??= { up: 0, down: 0 }
    d.tags[tag].up += diffUp
    d.tags[tag].down += diffDown
    d.pivot_tag_node[tag] ??= {}
    d.pivot_tag_node[tag][node] ??= { up: 0, down: 0 }
    d.pivot_tag_node[tag][node].up += diffUp
    d.pivot_tag_node[tag][node].down += diffDown
  })

  d.pivot_node_domain[node] ??= {}
  d.pivot_node_domain[node][fqdn] ??= { up: 0, down: 0 }
  d.pivot_node_domain[node][fqdn].up += diffUp
  d.pivot_node_domain[node][fqdn].down += diffDown
}

// =============================
// Kernel Event Handlers
// =============================

const handleConnections = async (data: CoreApiConnectionsData) => {
  const connections = data.connections ?? []
  const now = new Date()
  const month = Plugins.formatDate(now.getTime(), 'YYYY-MM')

  // 跨月切换
  if (month !== store.currentMonth) {
    await saveMonthlyData()
    await initMonthlyData()
  }

  const day = String(now.getDate())
  const currentIDs = new Set<string>()

  if (!store.data!.daily[day]) store.data!.daily[day] = createEmptyStats()
  const dayData = store.data!.daily[day]

  for (const conn of connections) {
    const { id, download, upload, chains, metadata, rule } = conn
    currentIDs.add(id)
    const prev = store.lastConnections[id] ?? { download: 0, upload: 0 }
    const diffDown = download - prev.download
    const diffUp = upload - prev.upload

    if (diffDown > 0 || diffUp > 0) {
      let clientIP: string = metadata?.sourceIP ?? 'unknown'
      if (clientIP.startsWith('fdfe') || clientIP.startsWith('172.18.')) clientIP = '127.0.0.1'

      const host = metadata?.host ?? metadata?.destinationIP ?? 'unknown'
      const info: UpdateInfo = {
        node: chains?.[0] ?? 'DIRECT',
        fqdn: host,
        root: getRootDomain(host) ?? 'unknown',
        process: metadata?.processPath ?? 'system',
        rule: rule || 'Match',
        tags: store.tagsConfig[getRootDomain(host) ?? ''] ?? store.tagsConfig[host] ?? [],
        clientIP
      }
      const isNew = prev.download === 0
      updateStats(store.data, diffUp, diffDown, isNew, info)
      updateStats(dayData, diffUp, diffDown, isNew, info)
    }
    store.lastConnections[id] = { download, upload }
  }
  for (const id in store.lastConnections) {
    if (!currentIDs.has(id)) Reflect.deleteProperty(store.lastConnections, id)
  }
}

const handleLogs = (data: { type?: string; payload?: string }) => {
  if (!store.data) return
  const now = new Date()
  const day = String(now.getDate())
  store.data.daily[day] ??= createEmptyStats()
  const dayData = store.data.daily[day]

  // 日志级别
  const type = data.type ?? 'unknown'
  const updateLogType = (target: StatsData) => {
    target.details.log_levels ??= {}
    target.details.log_levels[type] = (target.details.log_levels[type] ?? 0) + 1
  }
  updateLogType(store.data)
  updateLogType(dayData)

  // DNS 解析
  let dnsInfo: { dnsType: string; domain: string; result: string } | null = null
  const payload = data.payload ?? ''
  const dnsMatch = /\[DNS\](?:\s+cache\s+hit)?\s+([^\s]+)\s+-->\s+\[(.*?)\]\s+([A-Z0-9]+)/i.exec(payload)
  if (dnsMatch) {
    const domain = dnsMatch[1]!.replace(/\.$/, '')
    const results = dnsMatch[2]!.trim().split(/\s+/)
    const dnsType = dnsMatch[3]!.toUpperCase()
    dnsInfo = { domain, dnsType, result: results[0] ?? '' }
  } else if (payload.includes('dns: exchanged')) {
    const legacyMatch = /dns: exchanged\s+([A-Z0-9]+)\s+([^\s]+)\s+\d+\s+IN\s+[A-Z0-9]+\s+([^\s]+)/i.exec(payload)
    if (legacyMatch) {
      dnsInfo = {
        dnsType: legacyMatch[1]!.toUpperCase(),
        domain: legacyMatch[2]!.replace(/\.$/, ''),
        result: legacyMatch[3]!
      }
    }
  }

  if (dnsInfo) {
    const { dnsType, domain, result } = dnsInfo
    const updateDnsStats = (target: StatsData) => {
      const d = target.details
      d.dns_types ??= {}
      d.dns_domains ??= {}
      d.dns_ip_kinds ??= { 'fake-ip': 0, 'real-ip': 0 }
      d.dns_types[dnsType] = (d.dns_types[dnsType] ?? 0) + 1
      d.dns_domains[domain] ??= { hits: 0, types: {} }
      d.dns_domains[domain].hits += 1
      d.dns_domains[domain].types[dnsType] = (d.dns_domains[domain].types[dnsType] ?? 0) + 1
      if ((dnsType === 'A' || dnsType === 'AAAA') && result) {
        const isFake = result.startsWith('198.18.') || result.toLowerCase().startsWith('fc00') || result.toLowerCase().startsWith('fd00')
        const kind = isFake ? 'fake-ip' : 'real-ip'
        d.dns_ip_kinds[kind] = (d.dns_ip_kinds[kind] || 0) + 1
      }
    }
    updateDnsStats(store.data)
    updateDnsStats(dayData)
  }
}

// =============================
// REST Router
// =============================

class Router {
  public routes: {
    method: string
    regex: RegExp
    keys: string[]
    metadata?: RouteMeta
    handler: RouteHandler
    path: string
  }[] // for docs
  public middlewares: ((req: RouterRequest, res: RouterResponse) => MaybePromise<boolean>)[]

  constructor() {
    this.routes = []
    this.middlewares = [this.bodyParser()]
  }

  public use(middleware: (req: RouterRequest, res: RouterResponse) => MaybePromise<boolean>) {
    this.middlewares.push(middleware)
  }

  public register(method: string, path: string, metadata: RouteMeta, handler: RouteHandler) {
    const keys: string[] = []
    const [pathname = ''] = path.split('?')
    const segments = pathname.split('/').map((segment) => {
      if (segment.startsWith(':')) {
        const key = segment.slice(1)
        keys.push(key)
        return '([^\\/]+)'
      }
      return this.escapeRegex(segment)
    })
    const regexPath = segments.join('/')
    const regex = new RegExp(`^${regexPath}$`)
    this.routes.push({ method, regex, keys, metadata, handler, path: pathname })
  }

  public get(path: string, metadata: RouteMeta, handler: RouteHandler) {
    this.register('GET', path, metadata, handler)
  }
  public post(path: string, metadata: RouteMeta, handler: RouteHandler) {
    this.register('POST', path, metadata, handler)
  }
  public put(path: string, metadata: RouteMeta, handler: RouteHandler) {
    this.register('PUT', path, metadata, handler)
  }
  public delete(path: string, metadata: RouteMeta, handler: RouteHandler) {
    this.register('DELETE', path, metadata, handler)
  }

  async match(req: RouterRequest, res: RouterResponse) {
    res.json = (code: number, data: unknown) => {
      res.end(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, JSON.stringify(data))
    }

    for (const middleware of this.middlewares) {
      const next = await middleware(req, res)
      if (!next) return
    }

    const { method } = req
    const urlObj = new URL(req.url, 'http://localhost')
    const pathname = urlObj.pathname
    const query: Record<string, string> = Object.fromEntries(urlObj.searchParams)

    for (const route of this.routes) {
      if (route.method !== method) continue
      const match = pathname.match(route.regex)
      if (!match) continue
      const params = route.keys.reduce<Record<string, string>>((acc, key, index) => {
        acc[key] = decodeURIComponent(match[index + 1]!)
        return acc
      }, {})
      req.params = params
      req.query = query
      try {
        await route.handler(req, res, params)
      } catch (error) {
        res.json(500, error instanceof Error ? error.message : String(error))
      }
      return
    }

    res.json(404, 'Not Found')
  }

  private bodyParser() {
    return (req: RouterRequest, _res: RouterResponse) => {
      // try decode base64/json body
      const contentType = (req.headers['Content-Type'] ?? req.headers['content-type'] ?? '').toLowerCase()
      const raw = req.body || ''
      if (!raw) return true
      const tryParse = (text: string): unknown => {
        try {
          return JSON.parse(text)
        } catch {
          return text
        }
      }
      // best-effort base64 detection
      const maybeBase64 = /^[A-Za-z0-9+/=\r\n]+$/.test(raw) && raw.length % 4 === 0
      if (maybeBase64) {
        try {
          // prefer Plugins.base64Decode if exists
          const decoded = Plugins.base64Decode(raw)

          req.body = tryParse(decoded) as string
          return true
        } catch {
          // ignore
        }
      }
      if (contentType.includes('application/json')) {
        req.body = tryParse(raw) as string
      }
      return true
    }
  }

  private escapeRegex(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

// =============================
// REST API Register
// =============================

const normalizeMonthKey = (month?: string) => month?.replace(/\.json$/i, '').replace(new RegExp(`${DataVersion}$`), '') ?? ''

const Utils = {
  paginate<T>(data: T[], pageNum: number, pageSize: number) {
    pageNum = Math.max(1, pageNum)
    pageSize = Math.max(1, pageSize)
    const total = data.length
    const startIndex = (pageNum - 1) * pageSize
    const endIndex = startIndex + pageSize
    return { pageNum, pageSize, total, list: data.slice(startIndex, endIndex) }
  },
  compareValues(a: unknown, b: unknown) {
    if (a == null && b == null) return 0
    if (a == null) return 1
    if (b == null) return -1

    const normalizeNumeric = (value: unknown) => {
      if (typeof value === 'number') return value
      if (typeof value === 'bigint') return Number(value)
      if (typeof value === 'boolean') return value ? 1 : 0
      if (typeof value === 'string' && value.trim() !== '') {
        const numeric = Number(value)
        if (!Number.isNaN(numeric)) return numeric
      }
      return null
    }

    const numericA = normalizeNumeric(a)
    const numericB = normalizeNumeric(b)
    if (numericA != null && numericB != null) return numericA - numericB

    const textA = typeof a === 'string' ? a : JSON.stringify(a)
    const textB = typeof b === 'string' ? b : JSON.stringify(b)
    return textA.localeCompare(textB, 'zh-CN', { numeric: true, sensitivity: 'base' })
  },
  sortByField<T extends Record<string, unknown>>(arr: T[], field: string, order: 'asc' | 'desc' = 'desc') {
    return [...arr].sort((a, b) => {
      const result = Utils.compareValues(a[field], b[field])
      return order === 'asc' ? result : -result
    })
  },
  paginateAndSort<T extends Record<string, unknown>>(list: T[], query: Record<string, unknown>) {
    const { sort, pageNum = 1, pageSize = 10, order } = query
    const normalizedOrder = order === 'asc' ? 'asc' : 'desc'
    const sorted = sort ? Utils.sortByField(list, sort as string, normalizedOrder) : [...list]
    return Utils.paginate(sorted, Number(pageNum), Number(pageSize))
  },
  empty(query: Record<string, unknown>) {
    return {
      pageNum: Number(query['pageNum'] ?? 1),
      pageSize: Number(query['pageSize'] ?? 10),
      total: 0,
      list: []
    }
  },
  mergeStatsData(target: StatsData, source: StatsData) {
    const mergeValue = (targetValue: unknown, sourceValue: unknown): unknown => {
      if (typeof targetValue === 'number' && typeof sourceValue === 'number') return targetValue + sourceValue
      if (targetValue == null) return Plugins.deepClone(sourceValue)
      if (sourceValue == null) return targetValue
      if (Array.isArray(targetValue) || Array.isArray(sourceValue)) return targetValue
      if (typeof targetValue === 'object' && typeof sourceValue === 'object') {
        const next = targetValue as Record<string, unknown>
        Object.entries(sourceValue as Record<string, unknown>).forEach(([key, value]) => {
          next[key] = mergeValue(next[key], value)
        })
        return next
      }
      return sourceValue
    }

    mergeValue(target.summary as unknown, source.summary as unknown)
    mergeValue(target.details as unknown, source.details as unknown)
    return target
  },
  hasStatsData(stats: StatsData | null | undefined) {
    const hasPositiveValue = (value: unknown): boolean => {
      if (typeof value === 'number') return value > 0
      if (!value || typeof value !== 'object') return false
      return Object.values(value as Record<string, unknown>).some((item) => hasPositiveValue(item))
    }

    if (!stats) return false
    return stats.summary.up > 0 || stats.summary.down > 0 || hasPositiveValue(stats.details)
  },
  async getMonthKeys() {
    try {
      const files = await Plugins.ReadDir(PATH)
      return Array.from(new Set(files.filter((f) => f.name.endsWith('.json') && f.name !== 'tags.json').map((f) => normalizeMonthKey(f.name))))
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a))
    } catch {
      return [] as string[]
    }
  },
  async readMonthData(month?: string): Promise<MonthlyData | null> {
    const normalizedMonth = normalizeMonthKey(month)
    if (!normalizedMonth || normalizedMonth === store.currentMonth) {
      return store.data ? Plugins.deepClone(store.data) : null
    }

    try {
      const content = await Plugins.ReadFile(`${PATH}/${normalizedMonth}${DataVersion}.json`)
      return JSON.parse(content) as MonthlyData
    } catch {
      return null
    }
  },
  getMonthDayKeys(monthData: MonthlyData | null | undefined) {
    if (!monthData?.daily) return [] as string[]
    return Object.entries(monthData.daily)
      .filter(([, stats]) => Utils.hasStatsData(stats))
      .map(([day]) => day)
      .sort((a, b) => Number(a) - Number(b))
  },
  async getAvailableDays(month?: string) {
    const normalizedMonth = normalizeMonthKey(month)
    if (normalizedMonth === 'all') {
      const mergedDays = new Set<string>()
      const months = await Utils.getMonthKeys()
      for (const monthKey of months) {
        const monthData = await Utils.readMonthData(monthKey)
        Utils.getMonthDayKeys(monthData).forEach((day) => mergedDays.add(day))
      }
      return Array.from(mergedDays).sort((a, b) => Number(a) - Number(b))
    }

    const monthData = await Utils.readMonthData(normalizedMonth || store.currentMonth)
    return Utils.getMonthDayKeys(monthData)
  },
  async getAllMonthsData(day?: string): Promise<StatsData | null> {
    try {
      const months = await Utils.getMonthKeys()
      const merged = createEmptyStats()
      let hasMergedData = false
      for (const month of months) {
        const monthData = await Utils.readMonthData(month)
        if (!monthData) continue
        const target = day ? (monthData.daily[day] ?? null) : monthData
        if (!Utils.hasStatsData(target)) continue
        Utils.mergeStatsData(merged, target!)
        hasMergedData = true
      }
      return hasMergedData ? merged : null
    } catch {
      return null
    }
  },
  async getTargetData(query: Record<string, string> | undefined): Promise<StatsData | null> {
    const { day } = query ?? ({} as Record<string, string>)
    const month = normalizeMonthKey(query?.['month'])
    if (month === 'all') {
      return Utils.getAllMonthsData(day)
    }

    const targetMonthData = await Utils.readMonthData(month || store.currentMonth)
    if (!targetMonthData) return null
    const target = day ? targetMonthData.daily[day] : targetMonthData
    return Utils.hasStatsData(target) ? (target ?? null) : null
  },
  async getAvailableClientIps(query: Record<string, string> | undefined) {
    const target = await Utils.getTargetData(query)
    if (!target) return [] as string[]
    return Object.keys(target.details.clients).sort((a, b) => Utils.compareValues(a, b))
  }
}

function registerStatsApi(router: Router) {
  router.get('/v1/stats/overview', { description: { zh: '实时统计概览' } }, async (req, res) => {
    const target = await Utils.getTargetData(req.query ?? {})
    res.json?.(200, {
      month_summary: target?.summary ?? null,
      current_month: normalizeMonthKey(req.query?.['month']) || store.currentMonth,
      current_day: req.query?.['day'] ?? ''
    })
  })

  router.get(
    '/v1/stats/rank/:dimension',
    {
      description: {
        zh: '按维度统计: domains,roots,nodes,processes,rules,tags,log_levels,dns_types,dns_domains,dns_ip_kinds,clients'
      },
      examples: {
        域名访问量排行: '/v1/stats/rank/domains?sort=hits',
        根域名访问量排行: '/v1/stats/rank/roots?sort=hits',
        节点下行流量排行: '/v1/stats/rank/nodes?sort=down',
        进程上行流量排行: '/v1/stats/rank/processes?sort=up',
        规则匹配次数排行: '/v1/stats/rank/rules?sort=hits',
        DNS解析域名排行: '/v1/stats/rank/dns_domains?sort=hits',
        日志级别分布: '/v1/stats/rank/log_levels',
        DNS类型统计: '/v1/stats/rank/dns_types',
        FakeIP和RealIP: '/v1/stats/rank/dns_ip_kinds',
        客户端排行: '/v1/stats/rank/clients'
      }
    },
    async (req, res, { dimension }) => {
      const target = await Utils.getTargetData(req.query ?? {})
      if (!target?.details[dimension as keyof StatsDetails]) return res.json?.(200, Utils.empty(req.query ?? {}))
      const origin = target.details[dimension as keyof StatsDetails] as Record<string, unknown>
      const list = Object.entries(origin).map(([name, val]) => {
        if (typeof val === 'number') return { name, count: val }
        return { name, ...(val as Record<string, unknown>) }
      })
      res.json?.(200, Utils.paginateAndSort(list, req.query ?? {}))
    }
  )

  router.get('/v1/stats/clients/:ip', { description: { zh: '按客户端查询: ip' } }, async (req, res, { ip }) => {
    const target = await Utils.getTargetData(req.query ?? {})
    if (!target?.details.clients[ip!]) {
      res.end(404, {}, `Client not found: ${ip}`)
      return
    }
    res.json?.(200, target)
  })

  router.get('/v1/stats/clients/:ip/:dimension', { description: { zh: '按客户端和维度查询: ip dimension' } }, async (req, res, { ip, dimension }) => {
    const target = await Utils.getTargetData(req.query ?? {})
    if (!target?.details.clients[ip!]?.[dimension as keyof ClientsEntry]) return res.json?.(200, Utils.empty(req.query ?? {}))
    const origin = target.details.clients[ip!]?.[dimension as keyof ClientsEntry] as Record<string, unknown>
    const list = Object.entries(origin).map(([name, val]) => {
      if (typeof val === 'number') return { name, count: val }
      return { name, ...(val as Record<string, unknown>) }
    })
    res.json?.(200, Utils.paginateAndSort(list, req.query ?? {}))
  })

  router.get('/v1/stats/pivot/:type/:key', { description: { zh: '透视查询: 按节点/标签' } }, async (req, res, { type, key }) => {
    const target = await Utils.getTargetData(req.query ?? {})
    if (!target) return res.json?.(200, Utils.empty(req.query ?? {}))
    const pivotField = type === 'node' ? 'pivot_node_domain' : 'pivot_tag_node'
    const detailData = target.details[pivotField][key!]
    if (!detailData) return res.json?.(404, 'No Data')
    const list = Object.entries(detailData).map(([name, val]) => ({ name, ...val }))
    res.json?.(200, Utils.paginateAndSort(list, req.query ?? {}))
  })

  router.get('/v1/stats/history/months', {}, async (_req, res) => {
    res.json?.(200, await Utils.getMonthKeys())
  })
}

function registerTagsApi(router: Router) {
  router.get('/v1/tags', {}, (_req, res) => res.json?.(200, store.tagsConfig))
  router.post('/v1/tags', {}, async (req, res) => {
    const payload = req.body || {}
    const data =
      typeof payload === 'string'
        ? (() => {
            try {
              return JSON.parse(payload) as Record<string, string[]>
            } catch {
              return {}
            }
          })()
        : payload
    store.tagsConfig = Plugins.deepAssign(store.tagsConfig, data)
    await Plugins.WriteFile(TAGS_FILE, JSON.stringify(store.tagsConfig))
    res.json?.(200, 'OK')
  })
}

// =============================
// Lifecycle & Server
// =============================

const Start = async (params = Plugin) => {
  console.log(`[${Plugin.name}] Start()`)
  const router = new Router()
  registerStatsApi(router)
  registerTagsApi(router)
  router.get('/v1/docs/json', {}, (_req, res) =>
    res.json?.(
      200,
      router.routes.map((r) => ({ method: r.method, path: r.path, metadata: r.metadata }))
    )
  )

  await Plugins.StartServer(params.ApiAddress, Plugin.id, async (req, res) => router.match(req, res))
  registerHandler()
  return 1
}

const Stop = async () => {
  console.log(`[${Plugin.name}] Stop()`)
  await saveMonthlyData()
  await Plugins.StopServer(Plugin.id)
  unRegisterHandler()
  return 2
}

const registerHandler = () => {
  const kernel = Plugins.useKernelApiStore()
  store.unregs.push(kernel.onConnections(handleConnections))
  store.unregs.push(kernel.onLogs(handleLogs))
  store.unregs.push(
    kernel.onTraffic((_data) => {
      /*  */
    })
  )
  store.unregs.push(
    kernel.onMemory((_data) => {
      /*  */
    })
  )
}

const unRegisterHandler = () => {
  store.unregs.forEach((u) => {
    u()
  })
  store.unregs = []
}

export const onBeforeCoreStart = async (config: Recordable) => {
  // 提升日志等级以收集更多信息（仅 SingBox）
  if (Plugins.APP_TITLE.includes('SingBox')) (config as SingBoxConfig).log!.level = 'debug'
  return config
}

export const onReady = async () => {
  await initMonthlyData()
  await Stop().catch((err: unknown) => {
    console.log(`[${Plugin.name}] onReady: Stop()`, err)
  })
  await Start().catch((err: unknown) => {
    console.log(`[${Plugin.name}] onReady: Start()`, err)
  })
  return 1
}

export const onShutdown = async () => {
  await Stop().catch((err: unknown) => {
    console.log(`[${Plugin.name}] onShutdown: Stop()`, err)
  })
  return 2
}

export const onReload = async () => {
  await saveMonthlyData()
}

// =============================
// Modern UI (Vue3 + UnoCSS)
// =============================

export const onRun = async () => {
  const { defineComponent, ref, reactive, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue

  type RankItem = { name: string } & Partial<WithHits & WithTraffic> & { count?: number } & Record<string, unknown>
  interface PageResp<T> {
    pageNum: number
    pageSize: number
    total: number
    list: T[]
  }

  const emptyPage = <T>(): PageResp<T> => ({ pageNum: 1, pageSize: 10, total: 0, list: [] })
  const normalizeBase = (addr: string) => (/^https?:\/\//i.test(addr) ? addr : `http://${addr}`)
  const base = normalizeBase(Plugin.ApiAddress)
  const stringifyQueryValue = (value: unknown) => {
    if (value == null || value === '') return null
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      return String(value)
    }
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return JSON.stringify(value)
    if (typeof value === 'object') return JSON.stringify(value)
    return null
  }
  const qs = (obj: Record<string, unknown>) =>
    Object.keys(obj).length
      ? (() => {
          const p = new URLSearchParams()
          Object.entries(obj).forEach(([key, value]) => {
            const queryValue = stringifyQueryValue(value)
            if (queryValue == null) return
            p.append(key, queryValue)
          })
          const s = p.toString()
          return s ? `?${s}` : ''
        })()
      : ''
  const get = async <T = unknown>(url: string) => {
    const { status, body } = await Plugins.Requests({ method: 'GET', url, autoTransformBody: true })
    if (status >= 400) {
      throw new Error(typeof body === 'string' ? body : JSON.stringify(body))
    }
    return body as T
  }
  const formatBytes = (value?: number) => Plugins.formatBytes(value ?? 0)
  const getErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

  type SortOrder = 'asc' | 'desc'
  interface SortableColumn {
    key: string
    title: string
    align?: 'center' | 'left' | 'right'
    minWidth?: string
    customRender?: ({ record }: { record: RankItem }) => unknown
  }
  interface SortableState {
    sort: string
    order: SortOrder
  }

  const dimensionLabels = {
    domains: '完整域名',
    roots: '根域名',
    nodes: '节点',
    processes: '进程',
    rules: '规则',
    tags: '标签',
    clients: '客户端',
    log_levels: '日志级别',
    dns_types: 'DNS 记录类型',
    dns_domains: 'DNS 查询域名',
    dns_ip_kinds: 'IP 类型'
  } as const
  const pivotTypeLabels: Record<string, string> = { node: '按节点', tag: '按标签' }
  const overviewTitleMap: Record<string, { traffic: string; month: string }> = {
    all: { traffic: '全部月份', month: '全部月份' },
    current: { traffic: '本月', month: '当前月份' },
    selected: { traffic: '所选月份', month: '统计月份' },
    day: { traffic: '所选日期', month: '统计日期' }
  }

  const buildSortableColumns = (columns: SortableColumn[], sortableState: SortableState) =>
    columns.map((column) => ({
      ...column,
      title: sortableState.sort === column.key ? `${column.title}${sortableState.order === 'desc' ? ' ↓' : ' ↑'}` : column.title,
      customRender: column.customRender == null ? undefined : ({ record }: { record: RankItem }) => column.customRender?.({ record })
    }))

  const useTableSortBridge = (
    rootRef: { value: HTMLElement | null },
    getColumns: () => { key: string }[],
    emit: (event: 'sort-change', key: string) => void
  ) => {
    const bindHeaderClicks = async () => {
      await nextTick()
      const columns = getColumns()
      const headers = rootRef.value?.querySelectorAll('th')
      headers?.forEach((header, index) => {
        const column = columns[index]
        if (!column) return
        const node = header as HTMLElement
        node.dataset['sortKey'] = column.key
        node.style.cursor = 'pointer'
        node.onclick = () => {
          emit('sort-change', column.key)
        }
      })
    }

    onMounted(() => {
      void bindHeaderClicks()
    })
    onBeforeUnmount(() => {
      rootRef.value?.querySelectorAll('th').forEach((header) => {
        ;(header as HTMLElement).onclick = null
        ;(header as HTMLElement).style.cursor = ''
      })
    })

    return { bindHeaderClicks }
  }

  const OverviewCards = defineComponent({
    props: {
      overview: Object as PropType<{
        month_summary: TrafficSummary | null
        current_month: string
        current_day?: string
      } | null>,
      loading: Boolean,
      error: { type: String, default: '' }
    },
    template: `
      <div class="flex flex-wrap gap-4 md:gap-6">
        <Card class="min-h-126 flex-1 min-w-220">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-12 opacity-70 mb-8">{{ trafficTitle }}上行</div>
              <div class="text-24 font-700 leading-none">{{ loading ? '--' : formatBytes(overview?.month_summary?.up) }}</div>
            </div>
            <div class="h-40 w-40 rounded-12 flex items-center justify-center bg-[var(--card-active-bg)] text-[var(--primary-color)]">
              ↑
            </div>
          </div>
        </Card>
        <Card class="min-h-126 flex-1 min-w-220">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-12 opacity-70 mb-8">{{ trafficTitle }}下行</div>
              <div class="text-24 font-700 leading-none">{{ loading ? '--' : formatBytes(overview?.month_summary?.down) }}</div>
            </div>
            <div class="h-40 w-40 rounded-12 flex items-center justify-center bg-[var(--card-active-bg)] text-[var(--primary-color)]">
              ↓
            </div>
          </div>
        </Card>
        <Card class="min-h-126 flex-1 min-w-220">
          <div class="flex items-start justify-between gap-4">
            <div>
              <div class="text-12 opacity-70 mb-8">{{ rangeTitle }}</div>
              <div class="text-24 font-700 leading-none">{{ loading ? '--' : rangeValue }}</div>
            </div>
            <div class="h-40 w-40 rounded-12 flex items-center justify-center bg-[var(--card-active-bg)] text-[var(--primary-color)]">
              <Icon icon="overview" />
            </div>
          </div>
          <div v-if="error" class="mt-12 text-12 text-[var(--error-color,#ef4444)]">{{ error }}</div>
        </Card>
      </div>
    `,
    setup(props) {
      const viewMode = computed(() => {
        if (props.overview?.current_month === 'all') return 'all'
        if (props.overview?.current_day) return 'day'
        if (props.overview?.current_month) return props.overview.current_month === store.currentMonth ? 'current' : 'selected'
        return 'current'
      })
      const trafficTitle = computed(() => overviewTitleMap[viewMode.value]?.traffic)
      const rangeTitle = computed(() => overviewTitleMap[viewMode.value]?.month)
      const rangeValue = computed(() => {
        if (props.overview?.current_month === 'all') return '全部'
        if (props.overview?.current_day) return `${props.overview.current_month}-${props.overview.current_day}`
        return props.overview?.current_month ?? '-'
      })
      return { formatBytes, trafficTitle, rangeTitle, rangeValue }
    }
  })

  const RankTable = defineComponent({
    props: {
      state: {
        type: Object as PropType<{
          dimension: string
          sort: string
          order: SortOrder
          pageNum: number
          pageSize: number
        }>,
        required: true
      },
      data: { type: Object as PropType<PageResp<RankItem>>, required: true },
      dimensions: { type: Array as PropType<{ label: string; value: string }[]>, required: true },
      loading: Boolean,
      error: { type: String, default: '' }
    },
    emits: ['refresh', 'sort-change'],
    template: `
      <div class="flex flex-col gap-4">
        <Card>
          <div class="mb-4 flex flex-wrap items-center gap-12">
            <div class="shrink-0">
              <Select v-model="state.dimension" :options="dimensions" />
            </div>
            <div class="ml-auto shrink-0">
              <Button type="text" icon="refresh" @click="$emit('refresh')">刷新</Button>
            </div>
          </div>
          <div v-if="loading" class="flex items-center justify-center py-32 opacity-70 gap-8">
            <Icon icon="loading" class="animate-spin" />
            <span>加载中...</span>
          </div>
          <div v-else-if="error" class="py-24 text-14 text-[var(--error-color,#ef4444)]">{{ error }}</div>
          <template v-else>
            <div ref="tableRef">
              <Table v-if="data.list.length" :data-source="data.list" :columns="columns" />
              <Empty v-else />
            </div>
            <div v-if="data.total > 0" class="mt-4 flex justify-end">
              <Pagination v-model:current="state.pageNum" :total="data.total" :pageSize="state.pageSize" />
            </div>
          </template>
        </Card>
      </div>
    `,
    setup(props, { emit }) {
      const baseColumns: SortableColumn[] = [
        { key: 'name', title: '名称', minWidth: '220px' },
        { key: 'down', title: '下行', align: 'right', customRender: ({ record }) => formatBytes(record.down) },
        { key: 'up', title: '上行', align: 'right', customRender: ({ record }) => formatBytes(record.up) },
        { key: 'hits', title: '次数', align: 'right' }
      ]
      const tableRef = ref<HTMLElement | null>(null)
      const columns = computed(() => buildSortableColumns(baseColumns, props.state))
      const { bindHeaderClicks } = useTableSortBridge(tableRef, () => baseColumns, emit)
      watch([columns, () => props.data.list], () => {
        void bindHeaderClicks()
      })
      return { columns, tableRef }
    }
  })

  const DistTable = defineComponent({
    props: {
      state: {
        type: Object as PropType<{
          dimension: string
          sort: string
          order: SortOrder
          pageNum: number
          pageSize: number
        }>,
        required: true
      },
      data: { type: Object as PropType<PageResp<RankItem>>, required: true },
      dimensions: { type: Array as PropType<{ label: string; value: string }[]>, required: true },
      loading: Boolean,
      error: { type: String, default: '' }
    },
    emits: ['refresh', 'sort-change'],
    template: `
      <Card>
        <div class="mb-4 flex flex-wrap items-center gap-12">
          <div class="shrink-0">
            <Select v-model="state.dimension" :options="dimensions" />
          </div>
          <div class="ml-auto shrink-0">
            <Button type="text" icon="refresh" @click="$emit('refresh')">刷新</Button>
          </div>
        </div>
        <div v-if="loading" class="flex items-center justify-center py-32 opacity-70 gap-8">
          <Icon icon="loading" class="animate-spin" />
          <span>加载中...</span>
        </div>
        <div v-else-if="error" class="py-24 text-14 text-[var(--error-color,#ef4444)]">{{ error }}</div>
        <template v-else>
          <div ref="tableRef">
            <Table v-if="data.list.length" :data-source="data.list" :columns="columns" />
            <Empty v-else />
          </div>
          <div v-if="data.total > 0" class="mt-4 flex justify-end">
            <Pagination v-model:current="state.pageNum" :total="data.total" :pageSize="state.pageSize" />
          </div>
        </template>
      </Card>
    `,
    setup(props, { emit }) {
      const tableRef = ref<HTMLElement | null>(null)
      const baseColumns = computed<SortableColumn[]>(() => [
        { key: 'name', title: '名称', minWidth: '220px' },
        {
          key: props.state.dimension === 'dns_domains' ? 'hits' : 'count',
          title: props.state.dimension === 'dns_domains' ? '次数' : '数量',
          align: 'right'
        }
      ])
      const columns = computed(() => buildSortableColumns(baseColumns.value, props.state))
      const { bindHeaderClicks } = useTableSortBridge(tableRef, () => baseColumns.value, emit)
      watch([baseColumns, columns, () => props.data.list], () => {
        void bindHeaderClicks()
      })
      return { columns, tableRef }
    }
  })

  const ClientExplorer = defineComponent({
    props: {
      state: {
        type: Object as PropType<{
          ip: string
          dimension: string
          sort: string
          order: SortOrder
          pageNum: number
          pageSize: number
        }>,
        required: true
      },
      data: { type: Object as PropType<PageResp<RankItem>>, required: true },
      dimensions: { type: Array as PropType<{ label: string; value: string }[]>, required: true },
      clientOptions: { type: Array as PropType<{ label: string; value: string }[]>, required: true },
      loading: Boolean,
      error: { type: String, default: '' }
    },
    emits: ['search', 'sort-change'],
    template: `
      <Card>
        <div class="mb-4 flex items-center gap-12">
          <div class="shrink-0 w-256 min-w-0">
            <Select v-model="state.ip" :options="clientOptions" placeholder="选择客户端 IP" autoSize />
          </div>
          <div class="flex-1 flex justify-center min-w-0">
            <div class="shrink-0 w-128 min-w-0">
              <Select v-model="state.dimension" :options="dimensions" autoSize />
            </div>
          </div>
          <div class="shrink-0 w-256 min-w-0 flex justify-end whitespace-nowrap">
            <Button type="primary" @click="$emit('search')">查询</Button>
          </div>
        </div>
        <div v-if="loading" class="flex items-center justify-center py-32 opacity-70 gap-8">
          <Icon icon="loading" class="animate-spin" />
          <span>加载中...</span>
        </div>
        <div v-else-if="error" class="py-24 text-14 text-[var(--error-color,#ef4444)]">{{ error }}</div>
        <template v-else>
          <div v-if="!state.ip.trim()" class="py-24 text-14 opacity-70">请选择客户端 IP 后查询。</div>
          <template v-else>
            <div ref="tableRef">
              <Table v-if="data.list.length" :data-source="data.list" :columns="columns" />
              <Empty v-else />
            </div>
            <div v-if="data.total > 0" class="mt-4 flex justify-end">
              <Pagination v-model:current="state.pageNum" :total="data.total" :pageSize="state.pageSize" />
            </div>
          </template>
        </template>
      </Card>
    `,
    setup(props, { emit }) {
      const baseColumns: SortableColumn[] = [
        { key: 'name', title: '名称', minWidth: '220px' },
        { key: 'down', title: '下行', align: 'right', customRender: ({ record }) => formatBytes(record.down) },
        { key: 'up', title: '上行', align: 'right', customRender: ({ record }) => formatBytes(record.up) },
        { key: 'hits', title: '次数', align: 'right' }
      ]
      const tableRef = ref<HTMLElement | null>(null)
      const columns = computed(() => buildSortableColumns(baseColumns, props.state))
      const { bindHeaderClicks } = useTableSortBridge(tableRef, () => baseColumns, emit)
      watch([columns, () => props.data.list], () => {
        void bindHeaderClicks()
      })
      return { columns, tableRef }
    }
  })

  const PivotExplorer = defineComponent({
    props: {
      state: {
        type: Object as PropType<{
          type: string
          key: string
          sort: string
          order: SortOrder
          pageNum: number
          pageSize: number
        }>,
        required: true
      },
      data: { type: Object as PropType<PageResp<RankItem>>, required: true },
      types: { type: Array as PropType<{ label: string; value: string }[]>, required: true },
      keysOptions: { type: Array as PropType<{ label: string; value: string }[]>, required: true },
      loading: Boolean,
      error: { type: String, default: '' }
    },
    emits: ['search', 'sort-change'],
    template: `
      <Card>
        <div class="mb-4 flex items-center gap-12">
          <div class="shrink-0 w-256 min-w-0">
            <Select v-model="state.type" :options="types" autoSize />
          </div>
          <div class="flex-1 flex justify-center min-w-0">
            <div class="shrink-0 w-256 min-w-0 flex justify-center">
              <Select v-model="state.key" :options="keysOptions" placeholder="选择键" autoSize />
            </div>
          </div>
          <div class="shrink-0 w-256 min-w-0 flex justify-end whitespace-nowrap">
            <Button type="primary" @click="$emit('search')">查询</Button>
          </div>
        </div>
        <div v-if="loading" class="flex items-center justify-center py-32 opacity-70 gap-8">
          <Icon icon="loading" class="animate-spin" />
          <span>加载中...</span>
        </div>
        <div v-else-if="error" class="py-24 text-14 text-[var(--error-color,#ef4444)]">{{ error }}</div>
        <template v-else>
          <div v-if="!state.key" class="py-24 text-14 opacity-70">请选择透视键后查询。</div>
          <template v-else>
            <div ref="tableRef">
              <Table v-if="data.list.length" :data-source="data.list" :columns="columns" />
              <Empty v-else />
            </div>
            <div v-if="data.total > 0" class="mt-4 flex justify-end">
              <Pagination v-model:current="state.pageNum" :total="data.total" :pageSize="state.pageSize" />
            </div>
          </template>
        </template>
      </Card>
    `,
    setup(props, { emit }) {
      const baseColumns: SortableColumn[] = [
        { key: 'name', title: '名称', minWidth: '220px' },
        { key: 'down', title: '下行', align: 'right', customRender: ({ record }) => formatBytes(record.down) },
        { key: 'up', title: '上行', align: 'right', customRender: ({ record }) => formatBytes(record.up) }
      ]
      const tableRef = ref<HTMLElement | null>(null)
      const columns = computed(() => buildSortableColumns(baseColumns, props.state))
      const { bindHeaderClicks } = useTableSortBridge(tableRef, () => baseColumns, emit)
      watch([columns, () => props.data.list], () => {
        void bindHeaderClicks()
      })
      return { columns, tableRef }
    }
  })

  const Panel = defineComponent({
    template: `
      <div class="min-h-full w-full bg-[var(--bg-color)] text-[var(--text-color)]">
        <div class="flex flex-col gap-4 p-4 md:p-6">
          <Card>
            <div class="flex items-center justify-center gap-16">
              <div class="w-[25%] min-w-128">
                <Select v-model="filters.month" :options="monthOptions" style="width:100%;" />
              </div>
              <div class="w-[25%] min-w-128">
                <Select v-model="filters.day" :options="dayOptions" style="width:100%;" />
              </div>
            </div>
          </Card>

          <Tabs v-model:activeKey="activeTab" :items="tabItems" tabPosition="top" />
        </div>
      </div>
    `,
    setup() {
      const activeTab = ref('overview')
      const currentDay = String(new Date().getDate())
      const monthOptions = ref([{ label: '当月', value: '' }] as { label: string; value: string }[])
      const dayOptions = ref([{ label: '当日', value: currentDay }] as { label: string; value: string }[])
      const clientOptions = ref([] as { label: string; value: string }[])
      const filters = reactive({ month: '', day: currentDay })
      const rankState = reactive({
        dimension: 'domains',
        sort: 'hits',
        order: 'desc' as SortOrder,
        pageNum: 1,
        pageSize: 10
      })
      const distState = reactive({
        dimension: 'log_levels',
        sort: 'count',
        order: 'desc' as SortOrder,
        pageNum: 1,
        pageSize: 10
      })
      const clientState = reactive({
        ip: '',
        dimension: 'domains',
        sort: 'hits',
        order: 'desc' as SortOrder,
        pageNum: 1,
        pageSize: 10
      })
      const pivotState = reactive({
        type: 'node',
        key: '',
        sort: 'down',
        order: 'desc' as SortOrder,
        pageNum: 1,
        pageSize: 10
      })

      const overview = ref<{
        month_summary: TrafficSummary | null
        current_month: string
        current_day?: string
      } | null>(null)
      const rankData = ref(emptyPage())
      const distData = ref(emptyPage())
      const clientData = ref(emptyPage())
      const pivotData = ref(emptyPage())
      const pivotKeys = ref<{ label: string; value: string }[]>([])

      const loading = reactive({ overview: false, rank: false, dist: false, client: false, pivot: false })
      const errors = reactive({ overview: '', rank: '', dist: '', client: '', pivot: '' })

      const rankDims = ['domains', 'roots', 'nodes', 'processes', 'rules', 'tags', 'clients'].map((value) => ({
        label: dimensionLabels[value as keyof typeof dimensionLabels],
        value
      }))
      const distDims = ['log_levels', 'dns_types', 'dns_domains', 'dns_ip_kinds'].map((value) => ({
        label: dimensionLabels[value as keyof typeof dimensionLabels],
        value
      }))
      const clientDims = ['domains', 'nodes', 'processes', 'rules', 'tags'].map((value) => ({
        label: dimensionLabels[value as keyof typeof dimensionLabels],
        value
      }))
      const pivotTypes = ['node', 'tag'].map((value) => ({ label: pivotTypeLabels[value], value }))
      const pivotTypeMap: Record<string, string> = { node: 'nodes', tag: 'tags' }

      const scopedQuery = (extra?: Record<string, unknown>) => ({ month: filters.month, day: filters.day, ...extra })

      const runTask = async <T>(key: keyof typeof loading, loader: () => Promise<T>, onSuccess: (value: T) => void, fallback?: () => void) => {
        loading[key] = true
        errors[key] = ''
        try {
          const result = await loader()
          onSuccess(result)
        } catch (error) {
          errors[key] = getErrorMessage(error)
          fallback?.()
        } finally {
          loading[key] = false
        }
      }

      const refreshMonths = async () => {
        const months = await Utils.getMonthKeys()
        monthOptions.value = [
          { label: '当月', value: '' },
          { label: '全部', value: 'all' },
          ...months.filter((month) => month !== store.currentMonth).map((month) => ({ label: month, value: month }))
        ]
      }

      const refreshDays = async () => {
        const days = await Utils.getAvailableDays(filters.month || store.currentMonth)
        dayOptions.value = [
          { label: '整月', value: '' },
          ...(days.includes(currentDay) ? [{ label: '当日', value: currentDay }] : []),
          ...days.filter((day) => day !== currentDay).map((day) => ({ label: `${day} 日`, value: day }))
        ]
        if (filters.day && !dayOptions.value.some((item) => item.value === filters.day)) {
          filters.day = ''
        }
      }

      const refreshClientOptions = async () => {
        const ips = await Utils.getAvailableClientIps(scopedQuery({ day: filters.day || undefined }))
        clientOptions.value = ips.map((ip) => ({ label: ip, value: ip }))
        if (clientState.ip && !clientOptions.value.some((item) => item.value === clientState.ip)) {
          clientState.ip = ''
        }
      }

      const refreshOverview = async () => {
        await runTask(
          'overview',
          () => get<{ month_summary: TrafficSummary | null; current_month: string; current_day?: string }>(`${base}/v1/stats/overview${qs(scopedQuery())}`),
          (value) => {
            overview.value = value
          }
        )
      }

      const refreshRank = async () => {
        await runTask(
          'rank',
          () => get<PageResp<RankItem>>(`${base}/v1/stats/rank/${rankState.dimension}${qs(scopedQuery(rankState))}`),
          (value) => {
            rankData.value = value
          },
          () => {
            rankData.value = emptyPage()
          }
        )
      }

      const refreshDist = async () => {
        await runTask(
          'dist',
          () => get<PageResp<RankItem>>(`${base}/v1/stats/rank/${distState.dimension}${qs(scopedQuery(distState))}`),
          (value) => {
            distData.value = value
          },
          () => {
            distData.value = emptyPage()
          }
        )
      }

      const refreshClient = async () => {
        if (!clientState.ip.trim()) {
          errors.client = ''
          clientData.value = emptyPage()
          return
        }
        await runTask(
          'client',
          async () => {
            const query = scopedQuery(clientState)
            await get(`${base}/v1/stats/clients/${encodeURIComponent(clientState.ip)}${qs(query)}`)
            return get<PageResp<RankItem>>(`${base}/v1/stats/clients/${encodeURIComponent(clientState.ip)}/${clientState.dimension}${qs(query)}`)
          },
          (value) => {
            clientData.value = value
          },
          () => {
            clientData.value = emptyPage()
          }
        )
      }

      const refreshPivotKeys = async () => {
        try {
          const response = await get<PageResp<RankItem>>(
            `${base}/v1/stats/rank/${pivotTypeMap[pivotState.type]}${qs(scopedQuery({ sort: 'down', order: 'desc', pageNum: 1, pageSize: 50 }))}`
          )
          pivotKeys.value = response.list.map((item) => ({ label: item.name, value: item.name }))
          if (!pivotKeys.value.some((item) => item.value === pivotState.key)) {
            pivotState.key = ''
          }
        } catch {
          pivotKeys.value = []
          pivotState.key = ''
        }
      }

      const loadPivot = async () => {
        if (!pivotState.key) {
          errors.pivot = ''
          pivotData.value = emptyPage()
          return
        }
        await runTask(
          'pivot',
          () => get<PageResp<RankItem>>(`${base}/v1/stats/pivot/${pivotState.type}/${encodeURIComponent(pivotState.key)}${qs(scopedQuery(pivotState))}`),
          (value) => {
            pivotData.value = value
          },
          () => {
            pivotData.value = emptyPage()
          }
        )
      }

      const refreshAll = async () => {
        await Promise.all([refreshOverview(), refreshRank(), refreshDist(), refreshClientOptions(), refreshPivotKeys()])
        await refreshClient()
        await loadPivot()
      }

      const toggleSort = (state: SortableState, defaultSort: string, key: string) => {
        if (state.sort === key) {
          state.order = state.order === 'desc' ? 'asc' : 'desc'
          return
        }
        state.sort = key || defaultSort
        state.order = 'desc'
      }

      watch(
        () => filters.month,
        async () => {
          await refreshDays()
        }
      )
      watch([() => filters.month, () => filters.day], async () => {
        rankState.pageNum = 1
        distState.pageNum = 1
        clientState.pageNum = 1
        pivotState.pageNum = 1
        await refreshAll()
      })
      watch([() => rankState.dimension, () => rankState.sort, () => rankState.order], async () => {
        rankState.pageNum = 1
        await refreshRank()
      })
      watch(
        () => rankState.pageNum,
        async () => {
          await refreshRank()
        }
      )
      watch(
        () => distState.dimension,
        async (dimension) => {
          distState.sort = dimension === 'dns_domains' ? 'hits' : 'count'
          distState.order = 'desc'
          distState.pageNum = 1
          await refreshDist()
        }
      )
      watch([() => distState.sort, () => distState.order], async () => {
        distState.pageNum = 1
        await refreshDist()
      })
      watch(
        () => distState.pageNum,
        async () => {
          await refreshDist()
        }
      )
      watch(
        () => clientState.dimension,
        async () => {
          clientState.pageNum = 1
          clientState.sort = 'hits'
          clientState.order = 'desc'
          if (clientState.ip.trim()) await refreshClient()
        }
      )
      watch([() => clientState.sort, () => clientState.order], async () => {
        clientState.pageNum = 1
        if (clientState.ip.trim()) await refreshClient()
      })
      watch(
        () => clientState.pageNum,
        async () => {
          if (clientState.ip.trim()) await refreshClient()
        }
      )
      watch(
        () => clientState.ip,
        () => {
          clientState.pageNum = 1
          errors.client = ''
        }
      )
      watch(
        () => pivotState.type,
        async () => {
          pivotState.pageNum = 1
          pivotState.sort = 'down'
          pivotState.order = 'desc'
          await refreshPivotKeys()
          if (pivotState.key) await loadPivot()
        }
      )
      watch([() => pivotState.sort, () => pivotState.order], async () => {
        pivotState.pageNum = 1
        if (pivotState.key) await loadPivot()
      })
      watch(
        () => pivotState.pageNum,
        async () => {
          if (pivotState.key) await loadPivot()
        }
      )
      watch(
        () => pivotState.key,
        () => {
          pivotState.pageNum = 1
          errors.pivot = ''
        }
      )

      const tabItems = computed(() =>
        [
          {
            key: 'overview',
            tab: '概览',
            component: OverviewCards,
            props: { overview: overview.value, loading: loading.overview, error: errors.overview }
          },
          {
            key: 'rank',
            tab: '维度排行',
            component: RankTable,
            props: {
              state: rankState,
              data: rankData.value,
              dimensions: rankDims,
              loading: loading.rank,
              error: errors.rank,
              onRefresh: refreshRank,
              onSortChange: (key: string) => {
                toggleSort(rankState, 'hits', key)
              }
            }
          },
          {
            key: 'dist',
            tab: '分布统计',
            component: DistTable,
            props: {
              state: distState,
              data: distData.value,
              dimensions: distDims,
              loading: loading.dist,
              error: errors.dist,
              onRefresh: refreshDist,
              onSortChange: (key: string) => {
                toggleSort(distState, distState.dimension === 'dns_domains' ? 'hits' : 'count', key)
              }
            }
          },
          {
            key: 'client',
            tab: '客户端明细',
            component: ClientExplorer,
            props: {
              state: clientState,
              data: clientData.value,
              dimensions: clientDims,
              clientOptions: clientOptions.value,
              loading: loading.client,
              error: errors.client,
              onSearch: refreshClient,
              onSortChange: (key: string) => {
                toggleSort(clientState, 'hits', key)
              }
            }
          },
          {
            key: 'pivot',
            tab: '透视查询',
            component: PivotExplorer,
            props: {
              state: pivotState,
              data: pivotData.value,
              types: pivotTypes,
              keysOptions: pivotKeys.value,
              loading: loading.pivot,
              error: errors.pivot,
              onSearch: loadPivot,
              onSortChange: (key: string) => {
                toggleSort(pivotState, 'down', key)
              }
            }
          }
        ].map((item) => ({
          key: item.key,
          tab: item.tab,
          component: defineComponent({ render: () => Vue.h(item.component as Component, item.props) })
        }))
      )

      onMounted(async () => {
        await refreshMonths()
        await refreshDays()
        if (!dayOptions.value.some((item) => item.value === filters.day)) {
          filters.day = ''
        }
        await refreshAll()
      })

      return {
        activeTab,
        tabItems,
        filters,
        monthOptions,
        dayOptions
      }
    }
  })

  const modal = Plugins.modal({
    title: '流量统计面板',
    submit: false,
    cancelText: '关闭',
    width: '92',
    height: '92',
    afterClose: () => {
      modal.destroy()
    }
  })

  modal.setContent(Panel)
  modal.open()

  return 1
}
