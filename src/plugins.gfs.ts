import type {
  AppGFS,
  PluginApisGFS,
} from '@vendor/gfs/src/assets/globalMethods';

import type { SingBox } from './types';

declare global {
  var Plugins: PluginApisGFS;

  interface PluginExposed {
    onSubscribe?: (
      proxies: SingBox.Outbound[],
      subscription: AppGFS.Subscription,
    ) => MaybePromise<SingBox.Outbound[]>;
    onGenerate?: (
      config: SingBox.Config,
      profile: AppGFS.Profile,
    ) => MaybePromise<SingBox.Config>;
    onBeforeCoreStart?: (
      config: SingBox.Config,
      profile: AppGFS.Profile,
    ) => MaybePromise<SingBox.Config>;
  }

  type PluginMetadata = AppGFS.Plugin;

  type EsmPlugin = (Plugin: PluginMetadata) => MaybePromise<PluginExposed>;
}
