import type { RuleSet } from '@upstream/gui-for-singbox/stores/rulesets.ts'
import type { Subscription } from '@upstream/gui-for-singbox/types/app.js'
import type { CoreApiConfig, CoreApiConnectionsData, CoreApiProxy } from '@upstream/gui-for-singbox/types/kernel.js'

declare global {
  interface Plugins {
    useKernelApiStore(): KernelApiStore<IProfile, CoreApiConfig, CoreApiProxy, CoreApiConnectionsData>
    useRulesetsStore(): RulesetsStore<RuleSet>
    useSubscribesStore(): SubscribesStore<Subscription>
    useProfilesStore(): ProfilesStore<IProfile>
  }

  interface PluginExposed {
    onSubscribe?: OnSubscribeHook<RawProxy[], Subscription>
    onGenerate?: OnGenerateHook<Recordable, IProfile>
    onBeforeCoreStart?: OnBeforeCoreStartHook<Recordable, IProfile>
  }
}

interface RawProxy {
  [x: string]: any
  type: string
  tag: string
}
