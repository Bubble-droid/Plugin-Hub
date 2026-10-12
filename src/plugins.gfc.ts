import type {
  AppGFC,
  PluginApisGFC,
} from '@vendor/gfc/src/assets/globalMethods';

declare global {
  var Plugins: PluginApisGFC;

  interface PluginExposed {
    onSubscribe?: (
      proxies: Recordable[],
      subscription: AppGFC.Subscription,
    ) => MaybePromise<Recordable[]>;
    onGenerate?: (
      config: Recordable,
      profile: AppGFC.Profile,
    ) => MaybePromise<Recordable>;
    onBeforeCoreStart?: (
      config: Recordable,
      profile: AppGFC.Profile,
    ) => MaybePromise<Recordable>;
  }

  type PluginMetadata = AppGFC.Plugin;

  type EsmPlugin = (Plugin: PluginMetadata) => MaybePromise<PluginExposed>;
}
