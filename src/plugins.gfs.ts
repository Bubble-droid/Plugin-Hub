import type { PluginApis } from '@vendor/gfs/src/assets/globalMethods';

import type { SingBox } from './types';

declare global {
  var Plugins: PluginApis;

  interface PluginExposed {
    onSubscribe?: (
      proxies: SingBox.Outbound[],
      subscription: App.Subscription,
    ) => MaybePromise<SingBox.Outbound[]>;
    onGenerate?: (
      config: SingBox.Config,
      profile: App.Profile,
    ) => MaybePromise<SingBox.Config>;
    onBeforeCoreStart?: (
      config: SingBox.Config,
      profile: App.Profile,
    ) => MaybePromise<SingBox.Config>;
    onBeforeCoreStop?: () => MaybePromise<PluginStatus>;
  }

  type PluginMetadata = App.Plugin;

  type EsmPlugin = (Plugin: PluginMetadata) => MaybePromise<PluginExposed>;
}
