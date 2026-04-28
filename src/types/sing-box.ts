import type { schema } from '@typebox/schema.js'
import type { UnpackArray } from './utils.js'

export type SingBoxConfig = schema

export type InboundUnionType = NonNullable<UnpackArray<SingBoxConfig['inbounds']>>
export type OutboundUnionType = NonNullable<UnpackArray<SingBoxConfig['outbounds']>>

export type RouteRule = UnpackArray<NonNullable<NonNullable<SingBoxConfig['route']>['rules']>>

export type RulesetType = NonNullable<SingBoxConfig['route']>['rule_set']
export type RulesetUnionType = NonNullable<UnpackArray<RulesetType>>

export type DnsRules = NonNullable<SingBoxConfig['dns']>['rules']
export type DnsRule = NonNullable<UnpackArray<DnsRules>>

export type DnsServerType = NonNullable<SingBoxConfig['dns']>['servers']
export type DnsServerUnionType = NonNullable<UnpackArray<DnsServerType>>

export type DnsHostsPredefined = Extract<DnsServerUnionType, { type: 'hosts' }>['predefined']

/**
 * 泛型额外属性映射接口 (Generic Map Interface)
 * 这是一个高阶接口，用于消除 Inbound/Outbound/Dns 中 Map 定义的冗余逻辑。
 *
 * @template U - 属性值的联合类型 (The Union type of all possible property objects)
 */
export interface TypedExtraPropertyMap<U> extends Map<string, U> {
  /**
   * 获取值：默认返回联合类型，支持手动泛型断言
   */
  get<V extends U = U>(key: string): V | undefined

  /**
   * 设置值：利用 TypeScript 结构化类型系统，自动推断并约束 value 必须是 U 的子集
   */
  set<V extends U>(key: string, value: V): this
}

// Inbound 特有的 Flatten 逻辑
type FlattenInbound<T extends InboundType> = Extract<IInbound, Record<T, unknown>>[T] extends infer R
  ? R extends IInbound['mixed']
    ? Omit<R, 'listen'> & InboundListen
    : R
  : never

type PureInboundExtraProperties<T extends InboundType> = Omit<Extract<InboundUnionType, { type: T }>, keyof FlattenInbound<T> | 'type' | 'tag'>

// 全量联合类型
type InboundExtraValueUnion = PureInboundExtraProperties<InboundType>

// 使用泛型接口定义最终 Map
export type InboundExtraPropertyMap = TypedExtraPropertyMap<InboundExtraValueUnion>

type PureOutboundExtraProperties<T extends OutboundType> = Omit<Extract<OutboundUnionType, { type: T }>, keyof IOutbound | 'type' | 'tag'>

type OutboundExtraValueUnion = PureOutboundExtraProperties<OutboundType>

// 使用泛型接口定义最终 Map
export type OutboundExtraPropertyMap = TypedExtraPropertyMap<OutboundExtraValueUnion>

/**
 * 提取纯净的 DNS 额外属性
 * 逻辑：DNS Server 通常由 'type', 'tag' 和具体配置组成。
 * 如果你有 IDnsServer 基础接口，可以像 Outbound 那样加入到 Omit 中。
 * 目前默认剔除 'type' 和 'tag'。
 */
type PureDnsExtraProperties<T extends DNSServer> = Omit<
  Extract<DnsServerUnionType, { type: T }>,
  'type' | 'tag' // 如果有基础接口 IDnsServer，改为: keyof IDnsServer | 'type' | 'tag'
>

// DNS 额外属性值的全量联合类型
type DnsExtraValueUnion = PureDnsExtraProperties<DNSServer>

// 使用泛型接口定义最终 Map
export type DnsExtraPropertyMap = TypedExtraPropertyMap<DnsExtraValueUnion>
