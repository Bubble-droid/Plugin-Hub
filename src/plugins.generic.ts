import type { PluginApis as CPluginApis } from '@vendor/gfc/src/assets/globalMethods';
import type { PluginApis } from '@vendor/gfs/src/assets/globalMethods';

declare global {
  var Plugins: PluginApis | CPluginApis;

  interface PluginExposed {
    onSubscribe?: (
      proxies: Recordable[],
      subscription: App.Subscription,
    ) => MaybePromise<Recordable[]>;
    onGenerate?: (
      config: Recordable,
      profile: App.Profile,
    ) => MaybePromise<Recordable>;
    onBeforeCoreStart?: (
      config: Recordable,
      profile: App.Profile,
    ) => MaybePromise<Recordable>;
    onBeforeCoreStop?: () => MaybePromise<PluginStatus>;
  }

  type PluginMetadata = App.Plugin;

  type EsmPlugin = (Plugin: PluginMetadata) => MaybePromise<PluginExposed>;
}
