# strapi-plugin-mcp-chat

> AI chat inside the **Strapi 5** admin that actually **reads and edits your content** — including fields nested in **components and dynamic zones** — through **MCP**. Comes with **voice** (speech-to-text / text-to-speech) and a **side-by-side live preview** of your frontend.

Ask in plain language ("change the homepage hero title to …") and the assistant finds the text across all content-types, edits it, and publishes — then reloads the preview on the very page you were looking at.

https://github.com/raulbalestra/strapi-plugin-mcp-chat

---

## Features

- 🤖 **AI chat in the admin** — a floating widget on every screen + a full-page view. Runs an agent loop on the OpenAI Chat Completions API.
- ✏️ **Edits real content via MCP + Document Service** — `buscar_texto` finds a phrase across **all** content-types, single types, **components and dynamic zones** (recursive); `editar_campo` updates it (preserving the other components); `publicar` publishes.
- 🎙️ **Voice** — record a request (Whisper STT) and hear replies (OpenAI TTS).
- 👁️ **Side-by-side live preview** — docked panel that shrinks the admin and shows your frontend; reloads after each edit and **stays on the same page + scroll position** (with the optional preview bridge below).
- 🖥️ **Optional browser control** — if a [Playwright MCP](https://github.com/microsoft/playwright-mcp) server is reachable, the agent can drive a real browser to verify changes.
- 🌐 Bilingual UI/prompts (PT / EN).

## Requirements

- **Strapi `^5`**
- An **MCP server** exposed by your Strapi instance — this plugin uses [`@sensinum/strapi-plugin-mcp`](https://www.npmjs.com/package/@sensinum/strapi-plugin-mcp) for that (the read side: it lets the AI inspect your content structure).
- An **OpenAI API key** (used server-side only).

## Install

```bash
npm install strapi-plugin-mcp-chat @sensinum/strapi-plugin-mcp
```

If you hit a peer-dependency mismatch on the MCP SDK, pin it in your app's `package.json`:

```json
{
  "overrides": {
    "@sensinum/strapi-plugin-mcp": {
      "@modelcontextprotocol/sdk": "1.18.0"
    }
  }
}
```

### 1. Enable the plugins

`config/plugins.ts` (or `.js`):

```ts
export default () => ({
  // MCP server of your own instance (read side).
  mcp: {
    enabled: true,
    config: {
      session: { type: 'memory' },
      allowedIPs: ['127.0.0.1', '::1'],
    },
  },
  // This plugin (chat + voice + preview).
  'mcp-chat': {
    enabled: true,
  },
});
```

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
OPENAI_CHAT_MODEL=gpt-4o                                   # default: gpt-4o
MCP_URL=http://localhost:1337/api/mcp/streamable           # your instance's MCP endpoint
PLAYWRIGHT_MCP_URL=http://localhost:8931/mcp               # enables browser control
STRAPI_ADMIN_URL=http://localhost:1337/admin               # used by browser control
CLIENT_URL=http://localhost:3000                           # frontend origin (for the preview iframe CSP)
```

> **The OpenAI key lives only in the server `.env`** and is never exposed to the
> browser. The chat endpoints require an authenticated admin session.

### 4. Rebuild & run

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
Admin (floating chat / full page)
  └─ POST /mcp-chat/message ─► chat service (agent loop, OpenAI)
        ├─ READ tools   ─► MCP server (@sensinum/strapi-plugin-mcp) — structure
        ├─ WRITE tools  ─► Strapi Document Service
        │     buscar_texto  → deep, recursive search (components + dynamic zones), returns a `path`
        │     editar_campo  → edits the field at that `path`, re-saving the whole top attribute
        │     publicar      → publishes the entry
        └─ (optional) browser_* ─► Playwright MCP
  └─ POST /mcp-chat/stt · /mcp-chat/tts ─► Whisper / OpenAI TTS
```

`buscar_texto` returns matches with a `path` like `["dynamic_zone", 0, "heading"]`.
`editar_campo` takes that same `path`, deep-fetches the entry, mutates the leaf, and
writes the whole top-level attribute back — keeping component `id`s (so they're updated
in place, not recreated) and reducing media/relations to ids.

> **Note:** `blocks`-type rich text is intentionally **not** edited (it's structured JSON);
> string / text / richtext fields at any depth are.

## Strapi 5 conventions

The plugin follows the documented Strapi 5 plugin APIs:

- **Server** — the entry (`server/src/index.ts`) exports the documented shape
  (`register` / `bootstrap` / `destroy` / `config` / `controllers` / `services` / `routes`).
  Routes are declared with `type: 'admin'`, so the chat/STT/TTS endpoints require an
  authenticated admin session.
- **Admin** — `register()` uses only documented APIs (`app.addMenuLink`, `app.registerPlugin`).

One intentional deviation: the **global floating chat** is mounted via its own React root
in `bootstrap()`. Strapi's documented injection zones are Content-Manager-specific, and there
is no official zone for an admin-wide overlay — so this is the only way to render a widget on
every screen. It's isolated and idempotent (guarded by an element id) and contained to that
single spot.

## Security

- The OpenAI key is read from the server environment only.
- Chat / STT / TTS routes are admin-authenticated.
- The agent can edit and publish content — give the plugin only to trusted editors,
  and keep `allowedIPs` tight on the MCP server in production.

## License

[MIT](./LICENSE) © Raul Balestra
