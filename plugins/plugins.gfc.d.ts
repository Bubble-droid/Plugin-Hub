import type { ProfileType } from '@upstream/gui-for-clash/stores/profiles.ts'
import type { RuleSet } from '@upstream/gui-for-clash/stores/rulesets.ts'
import type { Subscription } from '@upstream/gui-for-clash/types/app.js'
import type { CoreApiConfig, CoreApiConnectionsData, CoreApiProxy } from '@upstream/gui-for-clash/types/kernel.js'

declare global {
  interface Plugins {
    useKernelApiStore(): KernelApiStore<ProfileType, CoreApiConfig, CoreApiProxy, CoreApiConnectionsData>
    useRulesetsStore(): RulesetsStore<RuleSet>
    useSubscribesStore(): SubscribesStore<Subscription>
    useProfilesStore(): ProfilesStore<ProfileType>
  }
  interface PluginExposed {
    onSubscribe?: OnSubscribeHook<RawProxy[], Subscription>
    onGenerate?: OnGenerateHook<Recordable, ProfileType>
    onBeforeCoreStart?: OnBeforeCoreStartHook<Recordable, ProfileType>
  }
}

interface RawProxy {
  [x: string]: any
  type: string
  name: string
}
