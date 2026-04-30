import type * as GFCProfile from '@upstream/gui-for-clash/stores/profiles.ts'
import type * as GFCRuleset from '@upstream/gui-for-clash/stores/rulesets.ts'
import type * as GFCApp from '@upstream/gui-for-clash/types/app.js'
import type * as GFCKernel from '@upstream/gui-for-clash/types/kernel.js'
import type * as GFSRuleset from '@upstream/gui-for-singbox/stores/rulesets.ts'
import type * as GFSApp from '@upstream/gui-for-singbox/types/app.js'
import type * as GFSKernel from '@upstream/gui-for-singbox/types/kernel.js'

declare global {
  interface Plugins {
    useKernelApiStore(): KernelApiStore<AnyProfile, AnyCoreApiConfig, AnyCoreApiProxy, AnyCoreApiConnectionsData>
    useRulesetsStore(): RulesetsStore<AnyRuleSet>
    useSubscribesStore(): SubscribesStore<AnySubscription>
    useProfilesStore(): ProfilesStore<AnyProfile>
  }

  interface PluginExposed {
    onSubscribe?: OnSubscribeHook<AnyProxy[], AnySubscription>
    onGenerate?: OnGenerateHook<Recordable, AnyProfile>
    onBeforeCoreStart?: OnBeforeCoreStartHook<Recordable, AnyProfile>
  }
}

type Prettify<T> = { [P in keyof T]: T[P] } & {}
type Overwrite<T, U> = Prettify<Omit<T, keyof U> & U>
type DeepSoftMerge<A, B> = A extends any[]
  ? B extends any[]
    ? DeepSoftMerge<A[number], B[number]>[]
    : A | B
  : A extends object
    ? B extends object
      ? Prettify<
          { [K in Extract<keyof A, keyof B>]: DeepSoftMerge<A[K], B[K]> } & { [K in Exclude<keyof A, keyof B>]?: A[K] } & {
            [K in Exclude<keyof B, keyof A>]?: B[K]
          }
        >
      : A | B
    : A | B

type AnyCoreApiConfig = DeepSoftMerge<GFSKernel.CoreApiConfig, GFCKernel.CoreApiConfig>
type AnyCoreApiProxy = DeepSoftMerge<GFSKernel.CoreApiProxy, GFCKernel.CoreApiProxy>
type AnyCoreApiConnectionsData = DeepSoftMerge<GFSKernel.CoreApiConnectionsData, GFCKernel.CoreApiConnectionsData>

type AnyProfile = DeepSoftMerge<IProfile, GFCProfile.ProfileType>

type AnySubscription = Overwrite<
  DeepSoftMerge<GFSApp.Subscription, GFCApp.Subscription>,
  {
    readonly updating?: boolean
  }
>

type AnyRuleSet = Overwrite<
  DeepSoftMerge<GFSRuleset.RuleSet, GFCRuleset.RuleSet>,
  {
    readonly updating?: boolean
  }
>

interface AnyProxy {
  [x: string]: any
  type: string
  tag?: string
  name?: string
}
