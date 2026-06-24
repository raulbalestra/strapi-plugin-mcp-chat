<p align="center">
  <img src="./assets/logo.png" alt="MCP Chat" width="120" height="120" />
</p>

<h1 align="center">strapi-plugin-mcp-chat</h1>

> AI chat inside the **Strapi 5** admin that actually **reads and edits your content** — including fields nested in **components and dynamic zones** — through **MCP**. Comes with **voice** (speech-to-text / text-to-speech) and a **side-by-side live preview** of your frontend.

Ask in plain language ("change the homepage hero title to …") and the assistant finds the text across all content-types, edits it, and publishes — then reloads the preview on the very page you were looking at.

[![npm](https://img.shields.io/npm/v/strapi-plugin-mcp-chat.svg)](https://www.npmjs.com/package/strapi-plugin-mcp-chat)
[![license](https://img.shields.io/npm/l/strapi-plugin-mcp-chat.svg)](./LICENSE)

https://github.com/raulbalestra/strapi-plugin-mcp-chat

---

## Features

- 🤖 **AI chat in the admin** — a floating widget on every screen + a full-page view. Runs an agent loop on the OpenAI Chat Completions API.
- ✏️ **Edits real content via MCP + Document Service** — `buscar_texto` finds a phrase across **all** content-types, single types, **components and dynamic zones** (recursive); `editar_campo` updates it (preserving the other components); `publicar` publishes.
- 📝 **Draft-first by default** — the AI edits **drafts** and does **not** publish unless you ask (or flip the **Auto-publish** toggle). Pair it with the preview's **Draft / Live** switch to review unpublished changes before they go to production. See [Draft-first editing & previewing drafts](#draft-first-editing--previewing-drafts).
- 🎙️ **Voice** — record a request (Whisper STT) and hear replies (OpenAI TTS).
- 👁️ **Side-by-side preview panel** — the plugin's own docked iframe that shrinks the admin and shows your frontend; reloads after each edit and **stays on the same page + scroll position** (with the optional preview bridge below). This is a custom panel, *not* Strapi's official Live Preview (which is a Growth/Enterprise feature) — it works on any plan, including Community, and complements the official Preview if you have it configured.
- 🖥️ **Optional browser control** — if a [Playwright MCP](https://github.com/microsoft/playwright-mcp) server is reachable, the agent can drive a real browser to verify changes.
- 🧱 **Frontend provisioning** — upload your frontend (Next.js or TanStack Start) with a `strapi.manifest.json`; the plugin validates it, creates all content-types, seeds content and wires the preview. The manifest can also be **inferred from the code** (incl. data arrays hardcoded inside components → collection types), and provisioning then **auto-connects the frontend to Strapi via live REST fetch** (generates a data layer + rewires components, with a hardcoded fallback). Never runs code from the upload — it acts only on the validated manifest.
- 🌍 **Translate every page to any language** — create locales and translate all localized content via Strapi 5's native i18n, with **no length limits and no context blowups** (see below).
- 🌐 **Fully bilingual (PT / EN)** — both the AI prompts/voice *and* the plugin's own admin pages, switchable with one click (the choice is shared across the chat and the menu pages).
- 🎓 **Built-in onboarding tour** — a first-run mini-course (re-openable any time via **❓ Tour**) walks new users through chat, editing, live preview, provisioning and translation.

## What makes MCP Chat unique

MCP Chat is built on Strapi 5's **native MCP server** and focuses on letting an assistant
**operate your content end-to-end** — find text anywhere (including fields nested in
components and dynamic zones), edit it as a draft, publish it, and translate it — while you
watch the result in a **live preview right next to the editor**.

A few things that set it apart:

- 👁️ **Docked, side-by-side live preview** that follows the exact page you're editing and
  can show **drafts** before they're published — on any plan, including Community.
- 🧱 **Frontend provisioning** from a `strapi.manifest.json` (Next.js / TanStack Start): the
  plugin infers the content model, creates the content-types, seeds the data and wires the
  preview for you.
- 📝 **Draft-first & safe**: edits go to drafts and nothing is published until you say so.
- ✏️ **Operates content in place**: finds and edits text nested in components and dynamic
  zones, then publishes — not just generating text into a single field.
- 🎙️ **Voice** (speech-to-text + text-to-speech) and a **bilingual** UI/prompts (PT / EN).

It's a complement to the rest of Strapi's AI ecosystem, not a replacement — reach for it
when you want the "chat that edits your content with a live preview" workflow.

## Requirements

- **Strapi `>= 5.47.0`** — required for the built-in [native MCP server](https://docs.strapi.io/cms/features/strapi-mcp-server) that this plugin consumes.
- An **OpenAI API key** (used server-side only).

## Install

```bash
npm install strapi-plugin-mcp-chat
# or pull the latest unreleased code straight from GitHub:
# npm install github:raulbalestra/strapi-plugin-mcp-chat
```

> Or just try the ready-to-run [Launchpad demo](https://github.com/raulbalestra/launchpad-mcp-chat) (the plugin is vendored there).

### 1. Enable this plugin

`config/plugins.ts` (or `.js`):

```ts
export default () => ({
  'mcp-chat': {
    enabled: true,
  },
});
```

On `register()`, the plugin registers its content tools (`mcp_chat_buscar_texto`,
`mcp_chat_editar_campo`, `mcp_chat_publicar`) into Strapi's native MCP server via
`strapi.ai.mcp.registerTool`. The in-admin chat calls the same functions in-process —
**no admin token or HTTP round-trip needed for the chat to work.**

### 2. Raise the body size limit + allow the preview iframe

The chat can send a screenshot of your screen (base64) in the request body, so the
default ~100 kb limit must be raised. If you use the live preview, also allow the
frontend origin to be framed. `config/middlewares.ts`:

```ts
export default [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'frame-src': ["'self'", process.env.CLIENT_URL],
          'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io'],
          'media-src': ["'self'", 'data:', 'blob:'],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  { name: 'strapi::body', config: { jsonLimit: '15mb', formLimit: '15mb', textLimit: '15mb' } },
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
```

### 3. Environment variables

```bash
# Required — the chat and voice features fail without it.
OPENAI_API_KEY=sk-...

# Optional.
OPENAI_CHAT_MODEL=gpt-4o                       # default: gpt-4o
PLAYWRIGHT_MCP_URL=http://localhost:8931/mcp   # enables browser control
STRAPI_ADMIN_URL=http://localhost:1337/admin   # used by browser control
CLIENT_URL=http://localhost:3000               # frontend origin (for the preview iframe CSP)
```

> **The OpenAI key lives only in the server `.env`** and is never exposed to the
> browser. The chat endpoints require an authenticated admin session.

### 4. (Optional) Expose the tools to external MCP clients

The plugin always registers its tools; if you also enable Strapi's native MCP server,
those tools become available to **external MCP clients** (e.g. Cursor) at
`/mcp`. In `config/server.ts`:

```ts
export default ({ env }) => ({
  // ...your existing server config
  mcp: { enabled: true }, // serves /mcp (Streamable HTTP, Admin-token authenticated)
});
```

External clients authenticate with an **Admin token** (Settings → Admin Tokens); the
MCP session is scoped to that token's permissions. The in-admin chat does **not** need
this — it's only for letting other AI clients use the same tools.

### 5. Rebuild & run

```bash
npm run build && npm run develop
```

The floating chat appears on every admin screen, and **MCP Chat** is added to the menu.
Set your frontend URL once in the preview panel's address bar — it's remembered in `localStorage`.

## Optional: live-preview bridge (stay on the page + keep scroll)

The preview iframe is cross-origin, so the admin can't see where you navigated inside
it. Drop this tiny client component into **your frontend** and it will (a) report the
current URL to the admin so reloads return to the same page, and (b) save/restore the
scroll position per page. For **Next.js**, create `components/preview-bridge.tsx`:

```tsx
'use client';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

export function PreviewBridge() {
  const pathname = usePathname();
  useEffect(() => {
    if (typeof window === 'undefined' || window.self === window.top) return; // only inside an iframe
    const key = `preview-scroll:${pathname}`;
    try { window.parent.postMessage({ type: 'preview:location', href: window.location.href }, '*'); } catch {}
    const saved = sessionStorage.getItem(key);
    if (saved != null) {
      const y = parseInt(saved, 10) || 0;
      [0, 60, 180, 400, 800].forEach((t) => setTimeout(() => window.scrollTo(0, y), t));
    }
    const save = () => { try { sessionStorage.setItem(key, String(window.scrollY)); } catch {} };
    window.addEventListener('scroll', save, { passive: true });
    window.addEventListener('beforeunload', save);
    return () => { save(); window.removeEventListener('scroll', save); window.removeEventListener('beforeunload', save); };
  }, [pathname]);
  return null;
}
```

Then render `<PreviewBridge />` once in your root layout. The same idea works in any
framework — just post `{ type: 'preview:location', href: location.href }` to `window.parent`.

## Draft-first editing & previewing drafts

Strapi's Draft & Publish lets editors stage changes before they go live. MCP Chat
respects that:

- **The AI edits drafts, never auto-publishes.** `editar_campo` always writes the
  **draft** version. By default the agent stops there and tells you it saved a draft —
  it only calls `publicar` when you explicitly ask ("publish this", "make it live") or
  when you turn **Auto-publish ON** in the chat toolbar. The setting is remembered
  (`localStorage` `mcp-chat-autopublish`, default off).
- **Content-types without Draft & Publish are handled correctly.** Draft & Publish is per content-type and off by default; `publish()` only exists when it's enabled (calling it otherwise throws, per the Strapi 5 docs). When a type has no Draft & Publish, the edit *is* the live value — so the plugin skips publishing (no error) and the assistant tells you the change is already live.
- **Preview the draft before publishing.** The preview panel has a **📝 Draft / 🌐 Live**
  toggle. In **Draft** it reloads the frontend with `?preview=1`; provisioned frontends
  read that flag and fetch `status=draft` from the Content API, so you see unpublished
  changes exactly as they'll look — without publishing. Flip to **Live** to compare with
  what's currently public.

**Draft preview contract (for custom / non-provisioned frontends):** when the iframe URL
carries `?preview=1` (or `?status=draft`), fetch Strapi with `status: 'draft'` and an API
token that can read drafts (`STRAPI_API_TOKEN`). Provisioned frontends get this wired
automatically via the generated data layer (`src/lib/strapi.ts` + `src/hooks/useStrapi.ts`),
which reads the `?preview=1`/`?status=draft` flag from the URL. Note: draft fetching keys off
the URL on the **client**, so with SSR the first server render may show published content
until hydration — fine for preview, but don't rely on it for production rendering.

## How it works

```
register() ─► strapi.ai.mcp.registerTool ─► native MCP server (/mcp)
                 mcp_chat_buscar_texto / _editar_campo / _publicar
                 (also available to external MCP clients, e.g. Cursor)

Admin (floating chat / full page)
  └─ POST /mcp-chat/message ─► chat service (agent loop, OpenAI)
        ├─ content tools  ─► same functions, called IN-PROCESS (no HTTP, no token)
        │     buscar_texto  → deep, recursive search (components + dynamic zones), returns a `path`
        │     editar_campo  → edits the field at that `path`, re-saving the whole top attribute
        │     publicar      → publishes the entry
        └─ (optional) browser_* ─► Playwright MCP
  └─ POST /mcp-chat/stt · /mcp-chat/tts ─► Whisper / OpenAI TTS
```

The plugin **extends** Strapi's native MCP server: in `register()` it calls
`strapi.ai.mcp.registerTool` to add its deep search/edit/publish tools, so any MCP
client gets them. The same functions are shared with the in-admin chat, which calls
them in-process — so the chat needs no admin token and no HTTP round-trip.

`buscar_texto` returns matches with a `path` like `["dynamic_zone", 0, "heading"]`.
`editar_campo` takes that same `path`, deep-fetches the entry, mutates the leaf, and
writes the whole top-level attribute back — keeping component `id`s (so they're updated
in place, not recreated) and reducing media/relations to ids.

> **Note:** `blocks`-type rich text is intentionally **not** edited (it's structured JSON);
> string / text / richtext fields at any depth are.

## Frontend provisioning

### Step-by-step (from the admin)

> Prerequisites: the plugin installed & enabled, `OPENAI_API_KEY` set, and Strapi
> running in **`develop`** (schema generation is dev-only). See [Install](#install).

1. **Zip your frontend** and keep the folder at the top of the archive
   (e.g. `frontend/…`). You can include a `strapi.manifest.json` at its root, or let
   the plugin infer one from the code. Exclude `node_modules` (the plugin installs deps
   when it runs the dev server).
2. In the admin, open **MCP Chat** in the left menu → **Provision frontend**.
3. **Upload the `.zip`** → click **Analyze project**. The plugin extracts it to a sibling
   folder and proposes a `strapi.manifest.json` (existing one, or inferred from the code —
   including data arrays inside components → collection types).
4. **Review the manifest** (edit if you want) → click **Provision**.
5. Strapi **restarts** and then, automatically: creates the content-types, **seeds** the
   content, opens **public read**, wires the **preview** (admin CSP + `CLIENT_URL`), and
   **wires the frontend to Strapi via live REST fetch**. Don't close the page — it polls
   until done.
6. Click the **🖼 Preview** button on the floating chat. The plugin boots your frontend's
   dev server and shows it docked next to the admin — now reading content from Strapi.
   Toggle **📝 Draft / 🌐 Live** to preview unpublished changes.
7. Edit with the **chat** ("change the hero title to …") or in the Content Manager → the
   preview reloads and reflects it. Drafts stay drafts until you publish (or turn on
   Auto-publish).

> No `strapi.manifest.json` and no `OPENAI_API_KEY`? Provisioning still models the loose
> UI text as single-types and wires the preview, but it can't infer data collections or
> rewire components without the key. Add the key for the full "upload → live" flow.

### Under the hood

Bring a "blessed-stack" frontend (Next.js or TanStack Start) carrying a
`strapi.manifest.json`. The plugin **never executes code from the upload** — it
reads and validates the manifest (Zod) and, from it, provisions the backend:

```
upload  →  validate manifest  →  extract to ../<frontend>
        →  generate src/api/**/schema.json (additive)  →  Strapi restarts
        →  seed content (Document Service)  →  grant public read
        →  wire .env + types + preview (admin.ts + CSP + CLIENT_URL)
        →  wire frontend to Strapi (live REST fetch)
```

Safety rails: schema generation runs **only in `develop`** (a Content-Type
Builder limitation); generation is **additive** (never drops/alters an existing
type); the frontend always lands in a **sibling folder**, never inside Strapi's
`src/`. Ready-to-use starters live in [`starters/`](./starters). The manifest can
also be **inferred from the frontend code** (e.g. Figma/Lovable exports) — including
data arrays hardcoded inside components, which are modeled as collection types (a
deterministic guard drops any value that isn't found verbatim in the source, so the
AI can only transcribe, never invent).

### Live-fetch wiring (the frontend becomes "live")

The last step connects the frontend to Strapi by **live REST fetch** (not a
snapshot), so editing in Strapi reflects in the page:

- Generates a tiny, dependency-free **data layer** in the frontend —
  `src/lib/strapi.ts` (REST helpers, flat — no `populate`/nesting, light calls) and
  `src/hooks/useStrapi.ts` (`useSection` / `useCollection`, preview/draft aware).
- **Rewires the components** to read from Strapi with a **hardcoded fallback**
  (`{c.field ?? "original text"}`), leaving icons/assets/layout untouched.
- **Safe by construction:** every rewritten file is syntax-validated (esbuild, with one
  retry) and backed up as `.bak`; on any doubt the file is left as-is, so the frontend
  never fails to compile because of the plugin. It **only writes inside the frontend
  folder — never touches Strapi.**
- Runs automatically after provisioning, and is also exposed as `POST
  /mcp-chat/frontend/wire`. It's **idempotent** (components already wired are skipped).

> **Needs `OPENAI_API_KEY`** for the two AI steps (inferring collections + rewiring
> components). Without the key, provisioning still creates the text single-types and
> generates the data layer, but **does not rewire the components** (the frontend stays
> hardcoded).

## Translation (i18n)

Ask the chat to translate and it creates the locales and translates every
localized field, using Strapi 5's **native i18n** — without the two failure modes
of typical translation plugins:

- **Long text doesn't overflow** — each value is split per paragraph (a giant
  paragraph falls back to sentences) under a token budget, translated chunk by
  chunk and reassembled in order, so a field of any size works.
- **Many locales don't blow up** — each locale is an **independent, resumable
  pass** (idempotent locale creation + per-locale upsert), so 10, 30, 50
  languages run in sequence without accumulating context.

Tools (in the chat and via the native MCP server): `criar_locale`,
`listar_locales`, `traduzir`, `habilitar_i18n`, plus a `locale` option on
`editar_campo`/`publicar`. In a manifest, mark `localized: true` on the
content-type and the fields to translate; the generator emits
`pluginOptions.i18n.localized` at both the content-type and attribute level.
Validated end-to-end against a real Strapi 5 (14 locales, long multi-chunk text
and translation inside repeatable components).

## Strapi 5 conventions

The plugin follows the documented Strapi 5 plugin APIs:

- **Server** — the entry (`server/src/index.ts`) exports the documented shape
  (`register` / `bootstrap` / `destroy` / `config` / `controllers` / `services` / `routes`).
  Routes are declared with `type: 'admin'`, so the chat/STT/TTS endpoints require an
  authenticated admin session.
- **MCP** — tools are **defined** as pure objects with a local typed `defineTool` helper
  (`server/src/mcp/define.ts`) and **registered from an array** via
  `strapi.ai.mcp.registerTool` during `register()`, using `z` from `@strapi/utils` for the
  schemas and `auth.policies` (content-manager read/update/publish) for RBAC. The
  `defineTool`/`defineResource`/`definePrompt` identity functions infer each handler's
  `args` from its input schema (no `any`) and keep the definitions side-effect-free —
  mirroring the direction of Strapi's [PR #26603](https://github.com/strapi/strapi/pull/26603)
  (`ai.mcp.defineTool` + the `import { ai } from "@strapi/strapi"` namespace). When that API
  ships stable, migrating is a one-line import swap; until then the plugin stays on the
  released `registerTool` so it runs on any Strapi ≥ 5.47 (no experimental build required).
- **Admin** — `register()` uses only documented APIs (`app.addMenuLink`, `app.registerPlugin`).

One intentional deviation: the **global floating chat** is mounted via its own React root
in `bootstrap()`. Strapi's documented injection zones are Content-Manager-specific, and there
is no official zone for an admin-wide overlay — so this is the only way to render a widget on
every screen. It's isolated and idempotent (guarded by an element id) and contained to that
single spot.

## Security

- The OpenAI key is read from the server environment only.
- Chat / STT / TTS routes are admin-authenticated.
- The registered MCP tools enforce `auth.policies` (content-manager read/update/publish).
  When exposed to external MCP clients, the session is scoped to the connecting Admin
  token's permissions — scope the token to only what those clients should change.
- The agent can edit and publish content — give the plugin only to trusted editors.

## Reliability — never degrades or breaks the host Strapi

This plugin is built to be a good citizen: installing it must never slow down or take
down the host app. Concrete guarantees:

- **Can't crash boot.** `register()` degrades gracefully if the native MCP server / i18n /
  OpenAI key are absent (logs a warning, disables the feature). MCP tools register inside a
  per-tool `try/catch`, so a single bad tool can never abort the others or the boot.
  `destroy()` is best-effort.
- **Can't blank the admin.** The global overlay (floating chat + preview) mounts inside a
  React **error boundary** in its own root, after an SSR/double-mount guard; any render
  error just hides the overlay, leaving the Strapi admin fully intact. Lingering preview
  layout styles are reset on load, and screen/mic capture is stopped on unmount.
- **Provisioning is fail-safe.** Generated schemas are **validated before any file is
  written** (kind/attributes/known types/relation targets) and writes are **all-or-nothing**
  — a malformed manifest can never leave Strapi with a broken, unbootable schema. Generation
  stays additive (never touches existing types), dev-only, with hardened zip-slip protection.
- **Won't become a bottleneck.** Every outbound call (OpenAI, MCP) has a **timeout** so a
  slow upstream can't hold a request open; recursive content search has depth caps and a
  result cap; tool outputs are size-capped before going back to the model.

## License

[MIT](./LICENSE) © Raul Balestra
