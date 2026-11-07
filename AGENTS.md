# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Wealth Management — personal wealth management app for a private owner (personal assets and SCI companies). Rental management (biens, baux, loyers) is the first domain; the app is meant to grow to other kinds of assets. Tauri 2 shell + Angular 22 frontend + SQLite, targeting desktop, Android and iOS. The codebase (identifiers, comments, UI, commit-worthy text) is in **French**; keep new code consistent with it (`creer`, `obtenir`, `lister`, `bail`, `echeance`, …).

## Commands

pnpm monorepo (`pnpm@12`, Node ≥ 22.13 — `node:sqlite` is required by the db tests).

```bash
pnpm install
pnpm dev                 # Tauri desktop app (starts `ng serve` on :1420 via beforeDevCommand)
pnpm build               # Tauri release bundle
pnpm web:build           # Angular build only
pnpm android:dev / ios:dev   # mobile (run android:init / ios:init once first)
pnpm test                # vitest in packages/core and packages/db
pnpm typecheck           # tsc --noEmit in every package (app uses tsconfig.app.json)

# Single package / single test
pnpm --filter @wealth-management/db test
pnpm --filter @wealth-management/core exec vitest run test/core.test.ts -t "nom du test"
```

The Angular app cannot run in a plain browser: `BaseDeDonnees.initialiser()` refuses to start outside Tauri because SQLite is only reachable through `@tauri-apps/plugin-sql`.

## Architecture

Three workspace packages, consumed as TypeScript source (`exports: ./src/index.ts`, no build step):

- **`packages/core` (`@wealth-management/core`)** — pure domain layer (only dependency: `zod`): zod schemas in `schemas.ts` are the single source of entity types (`z.output`) and validation rules (booleans are `Bool = 0 | 1` to mirror SQLite), select options/labels (`libelles.ts`), date helpers on ISO strings (`dates.ts`), money (`montants.ts`: rounding, `formatEuro`, amounts in words), rent logic (`loyers.ts`: monthly schedule with prorated first/last month, IRL revision, legal deposit cap), and document generators (`documents/`: lease contract, quittance / reçu partiel, avis d'échéance). Generators return a `PdfDocument` — a minimal pdfmake-compatible type defined in `pdf-types.ts` — so core never depends on pdfmake.
- **`packages/db` (`@wealth-management/db`)** — SQLite schema, migrations and repositories, independent of the driver through the `SqlDriver` interface (`execute` / `select` with positional `?` params). `ouvrirDepot(driver)` runs migrations then returns a `Depot` bundling all repositories. `Table<S>` in `crud.ts` is the generic CRUD base, built on an entity's zod `XxxSaisieSchema`: its keys are the column whitelist (guards against column-name injection) and every write is validated — `modifier` validates the patch merged with the existing row so cross-field rules apply. Invalid data throws `ErreurValidation` (readable French message). `valeurSql` normalizes `''`/`undefined` → `NULL`, booleans → 0/1.
- **`apps/wealth-management` (`@wealth-management/app`)** — Angular standalone app (signals, lazy-loaded routes, one route set per entity: liste / nouveau / `:id` / `:id/modifier`) plus the Tauri project in `src-tauri/`. `src/app/` is organised by **bounded context**, never by technical kind — there is no `shared/` or `features/` folder:
  - `patrimoine/` (sociétés + associés, biens, `adresse.champs.ts`, `patrimoine.routes.ts`), `location/` (locataires, baux + garants / fin de bail, `BadgeStatutBail`, `location.routes.ts`), `loyers/` (page loyers, `paiement-form`, `revision-form`, `BadgeStatutEcheance`), `pilotage/` (tableau de bord), `parametres/`.
  - Each entity folder holds its pages, sub-forms and its fiche description (`xxx.champs.ts`). Code tied to a domain concept lives in that context, even when another context reuses it (e.g. `bien-detail` imports `BadgeStatutBail` from `location/baux`).
  - `infrastructure/` — technical adapters: `base-de-donnees.service.ts` (SQLite via Tauri), `documents.service.ts` (pdfmake + save dialog), `brouillons.service.ts`.
  - `ui/` — domain-free presentation building blocks only: `icone`, `vide`, `formats.pipe`, `notifications.service`, `route` (`idRoute`), `fiche/` (`app-fiche` + `Champ` type), `formulaire/saisie.ts`. Anything that knows about a bail, a bien, a statut… does not belong here.

Key cross-cutting points:

- **Zod schemas** (`packages/core/src/schemas.ts`): per entity, `XxxSaisieSchema` (input, no id/timestamps, cross-field rules via `superRefine` so it stays a `ZodObject`) and `XxxSchema` (row = saisie + id + timestamps); types are `z.output<typeof XxxSchema>`. Optional fields are `nullable().default(null)` and blank strings become `null`. zod is configured once there (French locale, `jitless` because the CSP forbids `new Function`). When adding a column: add it to the schema (types, validation and column whitelist follow), the migration, and the form `Champ[]`.
- **Migrations** (`packages/db/src/migrations.ts`): append a new `{ version, nom, instructions[] }` entry to `MIGRATIONS`; never edit applied ones. Statements run one by one **without a transaction** (the Tauri SQL plugin pool doesn't guarantee one). Applied versions are tracked in `_migrations`. When adding a table, also add it to `TABLES_EXPORT` in `apps/wealth-management/src/app/infrastructure/base-de-donnees.service.ts` (JSON backup).
- **Échéances are derived data**: `LoyersRepo.synchroniser` regenerates a lease's monthly échéances from `calculerEcheances`; `synchroniserTout(aujourdhui())` runs at every app start, and `recalculer` is used after lease changes / IRL revisions. Payments (`paiement`) attach to échéances.
- **Rust side is intentionally thin** (`src-tauri/src/lib.rs`): it only registers the `sql`, `dialog` and `fs` plugins. All business logic lives in TypeScript. File writes are limited by `capabilities/default.json` to `$DOCUMENT`, `$DOWNLOAD`, `$DESKTOP`; the CSP in `tauri.conf.json` is strict (`script-src 'self'`).
- **Forms use Signal Forms (`@angular/forms/signals`), one dedicated form per page** — no generic form component. Each form declares its own model (strings for inputs/selects, booleans for checkboxes, never `null`), initialised with `linkedSignal` from a `resource`, binds controls with `[formField]`, and validates through the core zod schema: `schemaModele(versSaisie, XxxSaisieSchema)` + `validateStandardSchema(p, SCHEMA.validation)`; `submit()` then persists `SCHEMA.parse(model())`. Conditional fields use the `hidden()` rule and `versSaisie` nulls them out. Helpers (`texte`, `textes`, `sansVides`, `nombre`, `bool`, `<app-erreur>`) are in `ui/formulaire/saisie.ts`. Sub-forms of detail pages are small dedicated components (`associe-form`, `garant-form`, `paiement-form`, `fin-bail-form`, `revision-form`). Accessibility conventions: import `AccessibiliteChamp` (from `saisie.ts`) next to `FormField` — Signal Forms sets no ARIA, the directive adds `aria-invalid` + `aria-describedby` → the `<app-erreur>` message; required fields get `aria-required="true"` alongside the visual `*`; numeric/money inputs are `type="text"` with `inputmode="decimal|numeric"` (never `type="number"`: WebKit rejects the French decimal comma) and `nombre()` accepts `,` and spaces; forms about third parties (tenants, guarantors, properties, companies) carry `autocomplete="off"`, only `parametres` (the landlord's own identity) uses autofill tokens. Read-only detail pages use `ui/fiche/fiche.component.ts` driven by the entity's `Champ[]` in its own `xxx.champs.ts`.
- **Data loading uses `resource()`** (repositories return Promises); derive with `computed`, use `linkedSignal` for derived-but-editable state, and call `.reload()` after a mutation instead of re-fetching by hand. No `effect` to sync state.
- **Styles**: `src/styles.css` only `@import`s the shared partials in `src/styles/` (tokens, base, layout, buttons, badges/filters, KPI, tables, forms) — classes used by several screens. Styles specific to one component live next to it via `styleUrl` (emulated encapsulation): `app.css` (shell, nav, notifications), `tableau-de-bord.css`, `loyers.css`, `bail-detail.css`, `bail-form.css`, `fiche.component.css`. Colors are written in `oklch()`.
  - Global partials are imported into cascade layers declared in `styles.css` (`@layer base, mise-en-page, composants;`); component styles are unlayered, so they always win over global ones — no specificity battles.
  - Light/dark theme: every color token in `tokens.css` is a single `light-dark(clair, sombre)` value (`:root { color-scheme: light dark }`); no `prefers-color-scheme` blocks. Derived shades use relative color syntax (`oklch(from … calc(l + 0.05) c h)`) on raw tokens (`--primaire-clair` / `--primaire-sombre`).
  - Global partials use native CSS nesting (esbuild lowers it). Component CSS files stay flat.
  - `.carte` and `form.imbrique` are size containers (`container-type: inline-size`): `.grille-champs` and `.fiche` switch layout with `@container`, not viewport `@media`.
  - Focus: a global `:focus-visible` ring; hover states use `:hover:not(:disabled)`; motion is wrapped in `prefers-reduced-motion: no-preference`; use `dvh` not `vh`.
  - Scrollable `.tableau` wrappers need `tabindex="0" role="region" aria-label="…"`; their `thead` is sticky.
  - Rows that open a detail page use `<tr appLigneCliquable>` (`ui/ligne-cliquable.ts`) with a real `<a [routerLink]>` in a cell — never `[routerLink]` on the `<tr>`.
  - Headings: one `<h1>` per page, card/section titles are `<h2>` (styled like the old `h3`). Toggle buttons expose `aria-pressed` (filters) or `aria-expanded` + `aria-controls` (panels, expandable rows); repeated row buttons get a contextual `aria-label` that starts with the visible text. `ul.liste` needs `role="list"` (WebKit drops list semantics with `list-style: none`). Charts are `aria-hidden` with a `.visuellement-masque` data table alternative.
  - The notification zone is a `popover="manual"` opened once at startup (top layer); toasts enter with `@starting-style` and leave with `animate.leave`. The mobile nav drawer uses `aria-expanded`, Escape, `inert` on the rest of the page, and `visibility: hidden` when closed.
- **PDF export**: `infrastructure/documents.service.ts` lazy-loads pdfmake, renders a `PdfDocument` from core, then saves via the Tauri dialog + fs plugins.

## Browser Support

The UI only runs inside Tauri webviews, never in an arbitrary browser:

- Windows: WebView2 (evergreen Chromium). Android: Android System WebView (Chromium, updated through the Play Store). Linux: WebKitGTK.
- macOS / iOS: WKWebView, whose version is tied to the OS — this is the limiting engine.

**Policy:** target **WebKit / Safari ≥ 18.4 (macOS 15.4, iOS 18.4)** and current Chromium. Anything Baseline at that level is used **without fallback or polyfill** (`light-dark()`, popover, `@starting-style`, relative color syntax, container queries, CSS nesting, `:has()`, `dvh`, `inert`). Newer features (e.g. `accent-color` before Safari 26.2, scroll-driven animations, `sibling-index()`) are allowed only as progressive enhancement: the UI must stay correct and accessible without them, with no extra fallback code beyond ~20 lines and no new dependency. No Firefox target.

## Testing

Tests live only in `packages/core/test` and `packages/db/test` (vitest). DB tests run the real migrations and repositories against an in-memory `node:sqlite` database wrapped in a `SqlDriver` adapter (`driverMemoire()` in `depot.test.ts`) — reuse that pattern rather than mocking. The Angular app has no test suite; verify it with `pnpm typecheck`.

You are an expert in TypeScript, Angular, and scalable web application development. You write functional, maintainable, performant, and accessible code following Angular and TypeScript best practices.

## TypeScript Best Practices

- Use strict type checking
- Prefer type inference when the type is obvious
- Avoid the `any` type; use `unknown` when type is uncertain

## Angular Best Practices

- Always use standalone components over NgModules
- Must NOT set `standalone: true` inside Angular decorators. It's the default in Angular v20+.
- Do NOT set `changeDetection: ChangeDetectionStrategy.OnPush` explicitly. `OnPush` is the default in Angular v22+.
- Use signals for state management
- Implement lazy loading for feature routes
- Do NOT use the `@HostBinding` and `@HostListener` decorators. Put host bindings inside the `host` object of the `@Component` or `@Directive` decorator instead
- Use `NgOptimizedImage` for all static images.
  - `NgOptimizedImage` does not work for inline base64 images.

## Accessibility Requirements

- It MUST pass all AXE checks.
- It MUST follow all WCAG AA minimums, including focus management, color contrast, and ARIA attributes.

## Components

- Keep components small and focused on a single responsibility
- Use `input()` and `output()` functions instead of decorators
- Use `model()` for two-way bound properties with `[(prop)]` syntax instead of pairing `input()` with `output()`
- Use `computed()` for derived state
- Use `linkedSignal()` for state derived from multiple reactive sources that must stay synchronized
- Prefer inline templates for small components
- Prefer Signal Forms (`@angular/forms/signals`) for new forms. They are stable in Angular v22+ and provide signal-based state, type-safe field access, and schema-based validation
- When not using Signal Forms, prefer Reactive forms instead of Template-driven ones
- Do NOT use `ngClass`, use `class` bindings instead
- Do NOT use `ngStyle`, use `style` bindings instead
- Do NOT import `CommonModule`, import only the directives and pipes the template uses, such as `AsyncPipe` or `DatePipe`
- When using external templates/styles, use paths relative to the component TS file.

## State Management

- Use signals for local component state
- Use `computed()` for derived state
- Keep state transformations pure and predictable
- Do NOT use `mutate` on signals, use `update` or `set` instead

## Templates

- Keep templates simple and avoid complex logic
- Use native control flow (`@if`, `@for`, `@switch`) instead of `*ngIf`, `*ngFor`, `*ngSwitch`
- Use the async pipe to handle observables
- Do not assume globals like (`new Date()`) are available.

## Services

- Design services around a single responsibility
- Use the `providedIn: 'root'` option for singleton services
- Prefer the `@Service` decorator over `@Injectable({providedIn: 'root'})` for new singleton services (Angular v22+)
- Use the `inject()` function instead of constructor injection

## Skills

The `angular-developer` skill (`.claude/skills/`) is installed for Angular guidance — use it when writing Angular code.
