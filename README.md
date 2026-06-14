# strapi-plugin-mcp-chat

> AI chat inside the **Strapi 5** admin that actually **reads and edits your content** — including fields nested in **components and dynamic zones** — through **MCP**. Comes with **voice** (speech-to-text / text-to-speech) and a **side-by-side live preview** of your frontend.

Ask in plain language ("change the homepage hero title to …") and the assistant finds the text across all content-types, edits it, and publishes — then reloads the preview on the very page you were looking at.

https://github.com/raulbalestra/strapi-plugin-mcp-chat

---

## Features

- 🤖 **AI chat in the admin** — a floating widget on every screen + a full-page view. Runs an agent loop on the OpenAI Chat Completions API.
- ✏️ **Edits real content via MCP + Document Service** — `buscar_texto` finds a phrase across **all** content-types, single types, **components and dynamic zones** (recursive); `editar_campo` updates it (preserving the other components); `publicar` publishes.
- 🎙️ **Voice** — record a request (Whisper STT) and hear replies (OpenAI TTS).
- 👁️ **Side-by-side preview panel** — the plugin's own docked iframe that shrinks the admin and shows your frontend; reloads after each edit and **stays on the same page + scroll position** (with the optional preview bridge below). This is a custom panel, *not* Strapi's official Live Preview (which is a Growth/Enterprise feature) — it works on any plan, including Community, and complements the official Preview if you have it configured.
- 🖥️ **Optional browser control** — if a [Playwright MCP](https://github.com/microsoft/playwright-mcp) server is reachable, the agent can drive a real browser to verify changes.
- 🧱 **Frontend provisioning** — upload your frontend (Next.js or TanStack Start) with a `strapi.manifest.json`; the plugin validates it, creates all content-types, seeds content and wires the preview. Never runs code from the upload — it acts only on the validated manifest.
- 🌍 **Translate every page to any language** — create locales and translate all localized content via Strapi 5's native i18n, with **no length limits and no context blowups** (see below).
- 🌐 Bilingual UI/prompts (PT / EN).

## Requirements

- **Strapi `>= 5.47.0`** — required for the built-in [native MCP server](https://docs.strapi.io/cms/features/strapi-mcp-server) that this plugin consumes.
- An **OpenAI API key** (used server-side only).

## Install

```bash
# Straight from GitHub (not on npm yet):
npm install github:raulbalestra/strapi-plugin-mcp-chat
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

Bring a "blessed-stack" frontend (Next.js or TanStack Start) carrying a
`strapi.manifest.json`. The plugin **never executes code from the upload** — it
reads and validates the manifest (Zod) and, from it, provisions the backend:

```
upload  →  validate manifest  →  extract to ../<frontend>
        →  generate src/api/**/schema.json (additive)  →  Strapi restarts
        →  seed content (Document Service)  →  wire .env + types + preview
```

Safety rails: schema generation runs **only in `develop`** (a Content-Type
Builder limitation); generation is **additive** (never drops/alters an existing
type); the frontend always lands in a **sibling folder**, never inside Strapi's
`src/`. Ready-to-use starters live in [`starters/`](./starters). The manifest can
also be **inferred from the frontend code** (e.g. Figma/Lovable exports).

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
- **MCP** — tools are registered with `strapi.ai.mcp.registerTool` during `register()`
  (the documented extension point), using `z` from `@strapi/utils` for the schemas and
  `auth.policies` (content-manager read/update/publish) for RBAC. They're organized in a
  modular `server/src/mcp/` (one file per tool in `tools/`, aggregated and looped) following
  the structure from [Paul Bratslavsky's MCP tool-extension example](https://github.com/PaulBratslavsky/strapi-mcp-demo-and-tool-extension).
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

## License

[MIT](./LICENSE) © Raul Balestra
