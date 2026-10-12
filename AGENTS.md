# Repository Guidelines

## Project Structure & Module Organization

Repo distributes plugins for GUI.for.Cores clients. Author new and migrated plugins in TypeScript under `src/`, transpiled into tracked `plugins/` distribution. Most legacy plugins are standalone JavaScript directly under `plugins/`; those files are both source and distribution.

Authored source:

- `src/plugins/Generic/` - cross-client plugins.
- `src/plugins/Extra/` - additional cross-client plugins, compiled into `plugins/Extra/`, type-checked by `src/tsconfig.generic.json`.
- `src/plugins/GFC/` - GUI.for.Clash plugins.
- `src/plugins/GFS/` - GUI.for.SingBox plugins.
- `src/plugins.ts`, `src/plugins.generic.ts`, `src/plugins.gfc.ts`, `src/plugins.gfs.ts` declare host globals (`Plugins`, `Vue`, `PluginExposed`, ...) and shared plugin types.
- `src/types/` - shared type definitions (Clash, SingBox, Telegram, utilities).
- `src/tsconfig.generic.json`, `src/tsconfig.gfc.json`, `src/tsconfig.gfs.json` - per-target TypeScript projects; root `tsconfig.json` references them plus `tsconfig.node.json`, all extending `tsconfig.base.json`.

Distribution (tracked, loaded by clients):

- `plugins/Generic/`, `plugins/Extra/`, `plugins/GFC/`, `plugins/GFS/` - plugin scripts.
- `plugins/generic.json`, `plugins/gfc.json`, `plugins/gfs.json`, `plugins/nsfw.json` - plugin catalogs, maintained by hand. Source directory and catalog need not share name: plugins under `plugins/Extra/` are listed in `plugins/nsfw.json` (group `NSFW`). Before editing, confirm which catalog references a plugin by searching its `id` across `plugins/*.json`.
- `plugins/Resources/` - HTML, shortcuts, other assets used by plugin scripts.
- `plugins.d.ts` declares host APIs for JavaScript plugins; `jsconfig.json` enables editor type checking.

Other directories:

- `dist/` - generated build output (gitignored).
- `.client-data/` - gitignored, symlinks to local test clients' data directories (example `.client-data/gui-for-singbox` -> the SingBox build's `data`), so app-side files such as `data/third/plugin-ui-dev-helper/plugin-ui-template.html` can be edited from inside this repo.
- `.archives/` - retired plugin sources kept for reference.
- `vendor/` - client frontends as Git submodules (excluded from formatting and search).

Keep TypeScript source, generated JavaScript in `plugins/`, catalog entry, resources aligned. Use names like `plugin-example-name.ts` (or `plugin-example-name.js` for legacy) and matching catalog IDs like `plugin-example-name`.

## Local Development Environment

Developed with [pnpm](https://pnpm.io) on recent Node.js. Install pnpm and Node.js, then run `pnpm install`; installs toolchain, registers Husky `pre-commit` hook, runs `pnpm run sub:init` via `prepare` script.

- Two Git submodules provide client frontends for typing, pinned to the upstream `GUI-for-Cores` repos on branch `main`, with a local patch applied on top:
  - `vendor/gui-for-clash` - GUI.for.Clash, patched by `patches/gui-for-clash-plugin-apis.patch`.
  - `vendor/gui-for-singbox` - GUI.for.SingBox, patched by `patches/gui-for-singbox-plugin-apis.patch`.
- The patches export `PluginApisGFC` / `PluginApisGFS` (typed shape of `window.Plugins`) and enumerated `AppGFC` / `AppGFS` namespaces (the ambient `App` namespace cannot be module-aliased, so its members are re-declared one by one) from `frontend/src/assets/globalMethods.ts`; `src/plugins.gfc.ts`, `src/plugins.gfs.ts`, and `src/plugins.generic.ts` import those names.
- Submodules missing: run `pnpm sub:init`, which goes through `scripts/init-submodules.mjs` and initializes only missing submodules — it never rewinds an already checked-out submodule, so the `prepare` script can safely call it on every `pnpm install`. To advance submodules to latest upstream `main`: `pnpm sub:update`. Both apply the patches through `scripts/apply-submodule-patches.mjs` (idempotent; `--reset` also discards local submodule changes first). `sub:update` first runs the patch script with `--clean` (`pnpm run sub:clean`) to restore the patched files to HEAD — `git submodule update --remote --rebase` refuses a dirty work tree — then re-applies the patches after the update. If it fails because upstream drifted past the patch base, apply the patch manually, regenerate with `git -C vendor/<client> diff > patches/<client>-plugin-apis.patch`, bump the gitlink, and commit both.
- Submodule work trees permanently carry uncommitted patch changes, so never commit inside them. `.gitmodules` sets `ignore = dirty` for both to keep `git status` quiet; this only hides work-tree dirt — gitlink (HEAD) changes still show as modified and remain committable.
- Open `Plugin-Hub.code-workspace` in VS Code so oxc formatter/linter and TypeScript project references are used.
- Agent skills pinned in `skills-lock.json`, installed under `.agents/skills/` (gitignored).

## Plugin Authoring

Plugin writing, refactoring, review - entry and lifecycle, catalog metadata and configuration, triggers and handlers, UI (native components, utility styling, modals, hot-reload) - covered by bundled **`plugin-best-practices`** skill (under `.agents/skills/`). Load that skill before touching plugin code: single source of truth for plugin conventions. Where skill and repo differ, repo-level constraints here and vendored clients win.

That skill describes the single-file JavaScript form clients load. In this repo, author new and migrated plugins in TypeScript under `src/plugins/**`, let `pnpm produce` emit tracked `plugins/**` artifacts (see **Project Structure** and **Build, Test, and Development Commands**); never hand-write generated `plugins/**` files.

Plugin code runs in host's **WebView, not Node.js**: `require`, `process`, `fs`, `path`, `child_process`, `Buffer`, `__dirname`, other Node built-ins unavailable; all file, network, process I/O goes through `Plugins.*` APIs. Vendored frontends are runtime source of truth, not the `plugins.d.ts` / `src/plugins*.ts` quick references:

- `vendor/gui-for-clash/frontend/` and `vendor/gui-for-singbox/frontend/` - two clients' runtime, stores, components, styles (one plugin spec applies to both).
- API surface: `frontend/src/assets/globalMethods.ts` and modules it imports (`@/bridge`, `@/utils`, `@/stores`, ...).
- Components: `frontend/src/components/components.d.ts`, sources under `frontend/src/components/`; icon names in `frontend/src/components/Icon/icons.ts`.
- Styling: utility classes from `frontend/src/assets/styles/utilities/*.less`; shared layout classes (`form-item`, `form-action`, `rotation`) from `frontend/src/assets/styles/custom.less`.

Skill helper scripts (`scripts/fetch-host-refs.mjs`, `scripts/link-host-data.mjs`) target workspaces without host sources; this repo already vendors them, read `vendor/` instead of fetching.

## Build, Test, and Development Commands

Use pnpm; `pnpm-lock.yaml` is committed.

- `pnpm install` bootstraps toolchain, enables Husky (see **Local Development Environment**).
- `pnpm build` transpiles `src/plugins/` to `dist/` with `detype` (types stripped, no bundling).
- `pnpm produce` transpiles `src/plugins/` into tracked `plugins/` distribution directory.
- `pnpm lint` runs fix pipelines in sequence: `lint:oxlint` (`oxlint --fix --fix-suggestions src/`) then `lint:eslint` (`eslint --fix --cache src/`).
- `pnpm format` runs `format:oxfmt` (`oxfmt src/`) and `format:prettier` (`prettier --ignore-unknown --write plugins/`) in parallel.
- **Never run `pnpm exec tsc -b` (or `tsc --build`) under any circumstances.** Strict compiler rules flood output with errors from `vendor/` submodules (vendored `.vue` resolution), drowning real diagnostics; rely on editor TypeScript service for type info instead.
- `pnpm hashes` recomputes `hash` (SHA-256 of file at `url`) of every catalog entry; run after changing any plugin script. `pnpm hashes:check` verifies them, runs in CI.
- Check without modifying before submitting: `pnpm exec oxlint src/`, `pnpm exec oxfmt --check src/`, `pnpm exec eslint src/`, `pnpm exec prettier --check plugins/`.
- `pnpm paths:check` scans plugin scripts for `env.basePath + '/data/...'` constructions, suggests `Plugins.AbsolutePath('data/...')` or relative `data/...` path instead.

No local development server: load or add changed plugin through a supported client to exercise it. `pnpm build` and `pnpm produce` transpile **all** of `src/plugins/`, so they can rewrite generated files not meant to be touched; run `git status` afterwards, revert unrelated regeneration drift before committing. Husky `pre-commit` hook runs `lint-staged`: oxlint/eslint/oxfmt on staged `src/**/*.ts`, Prettier on staged `plugins/**/*{js,json}`.

## Coding Style & Naming Conventions

Authored plugins are modern TypeScript transpiled to the JavaScript clients load; legacy plugins are plain JavaScript under `plugins/`. Both target host WebView (no Node.js APIs - see **Plugin Authoring**), APIs declared in `plugins.d.ts`. Follow host lifecycle names like `onRun`, pair cleanup logic with installation or system changes, write catalog JSON with two-space indentation and stable kebab-case IDs.

Formatting and linting split by directory:

- `src/` formatted by **oxfmt** (`.oxfmtrc.json`): two-space indentation, semicolons, single quotes, 80-column print width, trailing commas. Linted by **oxlint** (`.oxlintrc.json`) and **eslint** (`eslint.config.js`, typescript-eslint typed rules).
- `plugins/` (generated artifacts and legacy `.js`) formatted by **Prettier** (`.prettierrc.json`): two-space indentation, **no** semicolons, single quotes, 160-column print width, no trailing commas.
- `.editorconfig` sets LF endings, UTF-8, two-space indentation, trims trailing whitespace except in Markdown.

oxlint enforces kebab-case/lowercase filenames, forbids import cycles and barrel files, treats correctness/performance issues as errors.

Declare functions and method properties as arrow functions (`const foo = () => {}`, `foo: () => {}`); only special class methods exempt (example `constructor`, `get`/`set`, generators, methods needing `super`). Official changelog example uses method shorthand for handlers - functionally equivalent, not local convention.

Strict type-aware rules check `src/`; habits preventing most lint failures: initialize `let` bindings on declaration; build strings with template literals instead of `+`; avoid nested ternaries (use `if`/`else`); narrow values to primitives before `String(value)` (never stringify non-primitive `unknown`); start comments with capital letter. Run `pnpm exec oxlint src/` and `pnpm exec eslint src/` until both clean.

No dynamic injection of external JavaScript or CSS. Keep plugin data within app's `data/` directory: temp files under `data/.cache`, bundled third-party tools and shared modules under `data/third/<plugin-id>/`, remove or restore on uninstall whatever setup created. Avoid reading unrelated private user directories.

## Testing Guidelines

No automated test framework or coverage threshold. Before submitting, run no-modify checks listed in **Build, Test, and Development Commands**, ensure edited JSON parses. Plugin authored in `src/`: run `pnpm produce` so tracked `plugins/**` artifact matches, confirm intended files in `git diff`. A few pre-existing `tsc` errors from vendored `.vue` resolution may remain; ensure edits add none in touched files. Then reproduce change through a supported client, manually test each declared trigger, menu, configuration field, uninstall path. Verify referenced resource paths and raw GitHub URLs match repository casing exactly.

## Commit & Pull Request Guidelines

Recent history uses short imperative subjects, commonly `Update plugin-gui-agent`. Prefer `Add plugin-name`, `Update plugin-name`, or `Fix plugin-name: brief reason`; keep each commit focused. Ensure `pnpm install` initialized Husky, or run checks manually.

PRs explain user-visible change, identify affected clients, list manual verification steps, link related issues. Include screenshots or recordings for UI changes. Plugin metadata or versions changed: update relevant catalog entry.
