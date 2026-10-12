// oxlint-disable typescript/no-unnecessary-type-parameters
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/member-ordering */
import type * as VueModule from 'vue';

type Recordable<T = any> = Record<string, T>;

type MaybePromise<T> = T | Promise<T>;

interface AsyncFunctionConstructor {
  new <TArgs extends any[] = any[], TReturn = any>(
    ...args: string[]
  ): (...args: TArgs) => Promise<Awaited<TReturn>>;

  <TArgs extends any[] = any[], TReturn = any>(
    ...args: string[]
  ): (...args: TArgs) => Promise<Awaited<TReturn>>;

  readonly prototype: Function;
}

declare global {
  var Vue: typeof VueModule;
  var AsyncFunction: AsyncFunctionConstructor;
  var WailsInvoke: any;
  var wails: any;

  type PluginStatus = number | void;

  interface PluginExposed {
    onRun?: () => MaybePromise<PluginStatus>;
    onEnabled?: () => MaybePromise<PluginStatus>;
    onDisabled?: () => MaybePromise<PluginStatus>;
    onDispose?: () => MaybePromise<PluginStatus>;
    onInstall?: () => MaybePromise<PluginStatus>;
    onUninstall?: () => MaybePromise<PluginStatus>;
    onTrayUpdate?: (
      tray: Recordable,
      menus: Recordable,
    ) => MaybePromise<{ tray: Recordable; menus: Recordable }>;
    onStartup?: () => MaybePromise<PluginStatus>;
    onShutdown?: () => MaybePromise<PluginStatus>;
    onCoreStarted?: () => MaybePromise<PluginStatus>;
    onCoreStopped?: () => MaybePromise<PluginStatus>;
    onBeforeCoreStop?: () => MaybePromise<PluginStatus>;
    onReady?: () => MaybePromise<PluginStatus>;
    onReload?: () => MaybePromise<PluginStatus>;
    onTask?: () => MaybePromise<PluginStatus>;
    onConfigure?: (
      config: Recordable,
      old: Recordable,
    ) => MaybePromise<PluginStatus>;
  }
}
