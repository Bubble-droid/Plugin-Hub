// oxlint-disable typescript/no-duplicate-type-constituents
import type {
  AppGFC,
  PluginApisGFC,
} from '@vendor/gfc/src/assets/globalMethods';
import type {
  AppGFS,
  PluginApisGFS,
} from '@vendor/gfs/src/assets/globalMethods';

declare global {
  var Plugins: PluginApisGFS | PluginApisGFC;

  interface PluginExposed {
    onSubscribe?: (
      proxies: Recordable[],
      subscription: AppGFS.Subscription | AppGFC.Subscription,
    ) => MaybePromise<Recordable[]>;
    onGenerate?: (
      config: Recordable,
      profile: AppGFS.Profile | AppGFC.Profile,
    ) => MaybePromise<Recordable>;
    onBeforeCoreStart?: (
      config: Recordable,
      profile: AppGFS.Profile | AppGFC.Profile,
    ) => MaybePromise<Recordable>;
  }

  type PluginMetadata = AppGFS.Plugin | AppGFC.Plugin;

  type EsmPlugin = (Plugin: PluginMetadata) => MaybePromise<PluginExposed>;
}
