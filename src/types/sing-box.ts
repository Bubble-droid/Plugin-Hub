import type { typebox } from '@zhexin/typebox';

import type { UnpackArray } from '@/types/utils';
import type {
  action as RAction,
  default_rule as RDefaultRule,
  logical_rule as RLogicalRule,
} from '@zhexin/typebox/route';

import type {
  action as DAction,
  default_rule as DDefaultRule,
  logical_rule as DLogicalRule,
} from '@zhexin/typebox/dns';

type ItemOf<T> = UnpackArray<NonNullable<T>>;

type Discriminated<T> = Extract<T, { type: unknown }>;

type ByType<
  Union extends { type?: unknown },
  T extends NonNullable<Union['type']>,
> = Extract<Union, { type?: T }>;

type ByAction<
  Union extends { action?: unknown },
  A extends NonNullable<Union['action']>,
> = Extract<Union, { action?: A }>;

type TypeBox = Required<
  typebox<
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string
  >
>;

export type Config = {
  [K in keyof TypeBox]?: TypeBox[K] extends readonly unknown[]
    ? ItemOf<TypeBox[K]>[]
    : TypeBox[K];
};

export type Log = NonNullable<Config['log']>;
export type Ntp = NonNullable<Config['ntp']>;
export type Experimental = NonNullable<Config['experimental']>;
export type Certificate = NonNullable<Config['certificate']>;
export type Route = NonNullable<Config['route']>;
export type Dns = NonNullable<Config['dns']>;

// Inbound
export type Inbound = ItemOf<Config['inbounds']>;
export type InboundOf<T extends Inbound['type']> = ByType<Inbound, T>;

// Outbound
export type Outbound = Discriminated<ItemOf<Config['outbounds']>>;
export type OutboundOf<T extends Outbound['type']> = ByType<Outbound, T>;

// Endpoint
export type Endpoint = Discriminated<ItemOf<Config['endpoints']>>;
export type EndpointOf<T extends Endpoint['type']> = ByType<Endpoint, T>;

// DNS Server
export type DnsServer = Discriminated<ItemOf<Dns['servers']>>;
export type DnsServerOf<T extends DnsServer['type']> = ByType<DnsServer, T>;

// DNS Rule
export type DnsRule = ItemOf<Dns['rules']>;
export type DnsDefaultRule = DDefaultRule<
  string,
  string,
  string,
  string,
  string
>;
export type DnsLogicalRule = DLogicalRule<
  string,
  string,
  string,
  string,
  string
>;
export type DnsRuleAction = DAction<string, string>;
export type DnsRuleActionOf<A extends NonNullable<DnsRuleAction['action']>> =
  ByAction<DnsRuleAction, A>;

// RuleSet
export type RuleSet = ItemOf<Route['rule_set']>;
export type RuleSetOf<T extends RuleSet['type']> = ByType<RuleSet, T>;

// Route Rule
export type RouteRule = ItemOf<Route['rules']>;
export type RouteDefaultRule = RDefaultRule<string, string, string>;
export type RouteLogicalRule = RLogicalRule<string, string, string, string>;
export type RouteRuleAction = RAction<string, string>;
export type RouteRuleActionOf<
  A extends NonNullable<RouteRuleAction['action']>,
> = ByAction<RouteRuleAction, A>;

// Service
export type Service = ItemOf<Config['services']>;
export type ServiceOf<T extends Service['type']> = ByType<Service, T>;

// Certificate Provider
export type CertificateProvider = ItemOf<Config['certificate_providers']>;
export type CertificateProviderOf<T extends CertificateProvider['type']> =
  ByType<CertificateProvider, T>;

// Network Namespace
export type NetworkNameSpace = ItemOf<Config['network_namespaces']>;
export type NetworkNameSpaceOf<
  T extends NonNullable<NetworkNameSpace['type']>,
> = ByType<NetworkNameSpace, T>;

export type Dns01Challenge = NonNullable<
  CertificateProviderOf<'acme'>['dns01_challenge']
>;

export type HttpClient = ItemOf<Config['http_clients']>;

export type Http2 = Pick<
  Extract<HttpClient, { version: 3 }>,
  | 'idle_timeout'
  | 'keep_alive_period'
  | 'stream_receive_window'
  | 'connection_receive_window'
  | 'max_concurrent_streams'
>;

export type Quic = Pick<
  Extract<HttpClient, { version: 3 }>,
  'initial_packet_size' | 'disable_path_mtu_discovery'
> &
  Http2;

export type DomainResolver = NonNullable<
  OutboundOf<'direct'>['domain_resolver']
>;

export type Listen = Omit<InboundOf<'redirect'>, 'tag' | 'type'>;

export type Dialer = Omit<OutboundOf<'direct'>, 'tag' | 'type'>;

export type UdpNat = Pick<
  EndpointOf<'wireguard'>,
  'udp_timeout' | 'udp_mapping' | 'udp_filtering' | 'udp_nat_max'
>;

export type OutboundTls = NonNullable<OutboundOf<'http'>['tls']>;

export type InboundTls = NonNullable<InboundOf<'http'>['tls']>;
