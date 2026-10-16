# Repository Guidelines

## Project Structure & Module Organization

The repository distributes plugins for the GUI.for.Cores clients. New and migrated plugins are authored
in TypeScript under `src/`, then transpiled into the tracked `plugins/` distribution directory. Most
existing plugins still live as standalone JavaScript directly under `plugins/`; treat those files as both
source and distribution.

Authored source:

- `src/plugins/Generic/` - cross-client plugins.
- `src/plugins/Extra/` - additional cross-client plugins, compiled into `plugins/Extra/` and type-checked by `src/tsconfig.generic.json`.
- `src/plugins/GFC/` - GUI.for.Clash plugins.
- `src/plugins/GFS/` - GUI.for.SingBox plugins.
- `src/plugins.ts`, `src/plugins.generic.ts`, `src/plugins.gfc.ts`, and `src/plugins.gfs.ts` declare the host globals (`Plugins`, `Vue`, `PluginExposed`, ...) and shared plugin types.
- `src/types/` holds shared type definitions (Clash, SingBox, Telegram, utilities).
- `src/tsconfig.generic.json`, `src/tsconfig.gfc.json`, and `src/tsconfig.gfs.json` are the per-target TypeScript projects; the root `tsconfig.json` references them plus `tsconfig.node.json`, all extending `tsconfig.base.json`.

Distribution (tracked, loaded by clients):

- `plugins/Generic/`, `plugins/Extra/`, `plugins/GFC/`, and `plugins/GFS/` contain the plugin scripts.
- `plugins/generic.json`, `plugins/gfc.json`, `plugins/gfs.json`, and `plugins/nsfw.json` are the plugin catalogs; maintain them by hand. A source directory and its catalog need not share a name: plugins under `plugins/Extra/` are listed in `plugins/nsfw.json` (group `NSFW`). Before editing, confirm which catalog references a plugin by searching for its `id` across `plugins/*.json`.
- `plugins/Resources/` stores HTML, shortcuts, and other assets used by plugin scripts.
- `plugins.d.ts` declares the host APIs available to JavaScript plugins; `jsconfig.json` enables editor type checking.

Other directories:

- `dist/` is generated build output (gitignored).
- `app-data/` is gitignored and holds symlinks to the local test clients' data directories (for example `app-data/gui-for-singbox` -> the SingBox build's `data`), so app-side files such as `data/third/plugin-ui-dev-helper/plugin-ui-template.html` can be edited from inside this repository.
- `archives/` contains retired plugin sources kept for reference.
- `vendor/` contains the client frontends as Git submodules (excluded from formatting and search).

Keep the TypeScript source, the generated JavaScript in `plugins/`, the catalog entry, and any resources aligned. Use names such as `plugin-example-name.ts` (or `plugin-example-name.js` for legacy plugins) and matching catalog IDs such as `plugin-example-name`.

## Local Development Environment

This repository is developed with [pnpm](https://pnpm.io) on a recent Node.js runtime. Install pnpm and Node.js before contributing, then run `pnpm install`; it installs the toolchain, registers the Husky `pre-commit` hook, and runs `git submodule update --init --recursive` through the `prepare` script.

- Two Git submodules provide the client frontends used for typing:
  - `vendor/gui-for-clash` - GUI.for.Clash, branch `plugins-api-export`.
  - `vendor/gui-for-singbox` - GUI.for.SingBox, branch `plugins-api-export`.
- If the submodules are missing or stale, run `pnpm sub:init` or `pnpm sub:update`.
- Open `Plugin-Hub.code-workspace` in VS Code so the oxc formatter/linter and the TypeScript project references are used.
- Agent skills are pinned in `skills-lock.json` and installed under `.agents/skills/` (gitignored).

## Plugin Authoring

Writing, refactoring, or reviewing a plugin - its entry and lifecycle, catalog metadata and
configuration, triggers and handlers, and its UI (native components, utility styling, modals,
hot-reload) - is covered by the bundled **`plugin-best-practices`** skill (installed under
`.agents/skills/`). Load that skill before touching plugin code: it is the single source of truth for
plugin conventions. Where the skill and this repository differ, the repository-level constraints here
and the vendored clients win.

That skill describes the single-file JavaScript form the clients load. In this repository, author new
and migrated plugins in TypeScript under `src/plugins/**` and let `pnpm produce` emit the tracked
`plugins/**` artifacts (see **Project Structure** and **Build, Test, and Development Commands**); do not
hand-write the generated `plugins/**` files.

Plugin code runs in the host's **WebView, not Node.js**: `require`, `process`, `fs`, `path`,
`child_process`, `Buffer`, `__dirname`, and other Node built-ins are unavailable, and all file, network,
and process I/O goes through the `Plugins.*` APIs. The vendored frontends are the source of truth for the
runtime, not the `plugins.d.ts` / `src/plugins*.ts` quick references:

- `vendor/gui-for-clash/frontend/` and `vendor/gui-for-singbox/frontend/` - the two clients' runtime,
  stores, components, and styles (one plugin spec applies to both).
- API surface: `frontend/src/assets/globalMethods.ts` and the modules it imports (`@/bridge`, `@/utils`,
  `@/stores`, ...).
- Components: `frontend/src/components/components.d.ts`, with sources under `frontend/src/components/`;
  icon names in `frontend/src/components/Icon/icons.ts`.
- Styling: utility classes from `frontend/src/assets/styles/utilities/*.less`; shared layout classes
  (`form-item`, `form-action`, `rotation`) from `frontend/src/assets/styles/custom.less`.

The skill's helper scripts (`scripts/fetch-host-refs.mjs`, `scripts/link-host-data.mjs`) are for
workspaces that do not carry the host sources; this repository already vendors them, so read `vendor/`
instead of fetching.

## Build, Test, and Development Commands

Use pnpm because `pnpm-lock.yaml` is committed.

- `pnpm install` bootstraps the toolchain and enables Husky (see **Local Development Environment**).
- `pnpm build` transpiles `src/plugins/` to `dist/` with `detype` (types stripped, no bundling).
- `pnpm produce` transpiles `src/plugins/` into the tracked `plugins/` distribution directory.
- `pnpm lint` runs the fix pipelines in sequence: `lint:oxlint` (`oxlint --fix --fix-suggestions src/`) then `lint:eslint` (`eslint --fix --cache src/`).
- `pnpm format` runs `format:oxfmt` (`oxfmt src/`) and `format:prettier` (`prettier --ignore-unknown --write plugins/`) in parallel.
- `pnpm exec tsc -b` type-checks all project references.
- Check without modifying before submitting: `pnpm exec tsc -b`, `pnpm exec oxlint src/`, `pnpm exec oxfmt --check src/`, `pnpm exec eslint src/`, and `pnpm exec prettier --check plugins/`.

There is no local development server, so load or add the changed plugin through a supported client to exercise it. `pnpm build` and `pnpm produce` transpile **all** of `src/plugins/`, so they can rewrite generated files you did not intend to touch; run `git status` afterwards and revert unrelated regeneration drift before committing. The Husky `pre-commit` hook runs `lint-staged`, applying oxlint/eslint/oxfmt to staged `src/**/*.ts` and Prettier to staged `plugins/**/*{js,json}`.

## Coding Style & Naming Conventions

Authored plugins are modern TypeScript that transpiles to the JavaScript the clients load; legacy plugins
are plain JavaScript under `plugins/`. Both target the host's WebView (no Node.js APIs - see
**Plugin Authoring**) and the APIs declared in `plugins.d.ts`. Follow the host's lifecycle names such as
`onRun`, keep cleanup logic paired with installation or system changes, and write catalog JSON with
two-space indentation and stable, kebab-case IDs.

Formatting and linting are split by directory:

- `src/` is formatted by **oxfmt** (`.oxfmtrc.json`): two-space indentation, semicolons, single quotes, an 80-column print width, and trailing commas. It is linted by **oxlint** (`.oxlintrc.json`) and **eslint** (`eslint.config.js`, typescript-eslint typed rules).
- `plugins/` (generated artifacts and legacy `.js`) is formatted by **Prettier** (`.prettierrc.json`): two-space indentation, **no** semicolons, single quotes, a 160-column print width, and no trailing commas.
- `.editorconfig` sets LF endings, UTF-8, two-space indentation, and trims trailing whitespace except in Markdown.

oxlint enforces kebab-case/lowercase filenames, forbids import cycles and barrel files, and treats correctness/performance issues as errors.

Declare functions and method properties with arrow functions (`const foo = () => {}`, `foo: () => {}`); only special class methods are exempt (for example `constructor`, `get`/`set`, generators, or methods that need `super`). The official changelog example uses method shorthand for handlers - functionally equivalent, but not the local convention.

Because `src/` is checked by strict, type-aware rules, a few habits prevent most lint failures: initialize `let` bindings on declaration; build strings with template literals instead of `+`; avoid nested ternaries (use `if`/`else`); narrow values to primitives before `String(value)` (never stringify a non-primitive `unknown`); and start comments with a capital letter. Run `pnpm exec oxlint src/` and `pnpm exec eslint src/` until both are clean.

Do not dynamically inject external JavaScript or CSS. Keep plugin data within the app's `data/` directory: temporary files under `data/.cache`, bundled third-party tools and shared modules under `data/third/<plugin-id>/`, and remove or restore on uninstall whatever setup created. Avoid reading unrelated private user directories.

## Testing Guidelines

No automated test framework or coverage threshold is configured. Before submitting, run the no-modify checks listed in **Build, Test, and Development Commands**, and ensure edited JSON parses. For any plugin authored in `src/`, run `pnpm produce` so the tracked `plugins/**` artifact matches, then confirm the intended files appear in `git diff`. A few pre-existing `tsc` errors from vendored `.vue` resolution may remain; ensure your edits add none in the files you touched. Then reproduce the change through a supported client and manually test each declared trigger, menu, configuration field, and uninstall path. Verify referenced resource paths and raw GitHub URLs exactly match repository casing.

## Commit & Pull Request Guidelines

Recent history uses short imperative subjects, commonly `Update plugin-gui-agent`. Prefer `Add plugin-name`, `Update plugin-name`, or `Fix plugin-name: brief reason`; keep each commit focused. Ensure `pnpm install` has initialized Husky, or run the checks manually.

PRs should explain the user-visible change, identify affected clients, list manual verification steps, and link related issues. Include screenshots or recordings for UI changes. Whenever plugin metadata or versions change, update the relevant catalog entry.
