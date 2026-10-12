import type { PluginApis } from '@vendor/gfc/src/assets/globalMethods';

declare global {
  var Plugins: PluginApis;

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
