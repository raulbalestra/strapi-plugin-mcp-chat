import fs from 'node:fs';
import path from 'node:path';
import type { Manifest } from './manifest';
import { adapterForManifest, type LinkContext } from './adapters';
import { generateTypes } from './types-gen';
import { apiUid } from './generate';
import { FRONTEND_BASE_PORT } from './runner';

/**
 * Link: conecta o frontend já instalado à Strapi.
 *  1. Escreve o .env do framework (aditivo: nunca sobrescreve valor existente).
 *  2. Gera os tipos TS a partir do manifest.
 *  3. Gera a config de Preview da Strapi (handler que mapeia uid -> rota do front).
 *
 * Tudo aditivo e idempotente. Caminhos validados para ficarem dentro dos dirs
 * informados.
 */

export interface LinkOptions {
  /** pasta do frontend já instalado. */
  frontendDir: string;
  /** pasta raiz da app Strapi (onde fica config/). */
  strapiAppDir: string;
  context: LinkContext;
  dryRun?: boolean;
}

export interface LinkResult {
  ok: boolean;
  envFile: string;
  envAdded: string[];
  envPreserved: string[];
  typesFile: string;
  previewFile: string;
  previewAction: 'created' | 'merged' | 'skipped';
  /** vars adicionadas ao .env do BACKEND (CLIENT_URL/PREVIEW_SECRET). */
  backendEnvAdded: string[];
  /** ação no config/middlewares (CSP frame-src para o iframe do preview). */
  cspAction: 'patched' | 'already' | 'manual' | 'skipped';
  errors: string[];
}

// ---------------------------------------------------------------------------
// .env (merge aditivo)
// ---------------------------------------------------------------------------

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function mergeEnv(
  existing: string,
  next: Record<string, string>
): { content: string; added: string[]; preserved: string[] } {
  const current = parseEnv(existing);
  const added: string[] = [];
  const preserved: string[] = [];
  const extra: string[] = [];

  for (const [k, v] of Object.entries(next)) {
    if (k in current) {
      preserved.push(k); // respeita o que o usuário já tem
    } else {
      added.push(k);
      extra.push(`${k}=${v}`);
    }
  }

  let content = existing;
  if (extra.length) {
    const block =
      '\n# adicionado pelo mcp-chat (link)\n' + extra.join('\n') + '\n';
    content = existing.trimEnd() + '\n' + block;
  }
  return { content, added, preserved };
}

// ---------------------------------------------------------------------------
// config de Preview da Strapi
// ---------------------------------------------------------------------------

// marca que o config/admin.ts já tem o preview do mcp-chat mesclado (idempotência).
const PREVIEW_MARKER = 'mcp-chat:preview-merged';
const PREVIEW_MODULE = 'mcp-chat-preview';

/**
 * Gera o MÓDULO de preview (config/mcp-chat-preview.ts): default-exporta o
 * fragmento { preview: {...} } do config/admin, com o handler que mapeia uid ->
 * rota do frontend. É 100% owned pelo gerador (sempre reescrito).
 *
 * Decisões importantes:
 *  - Rota DEFAULT "/" para qualquer type sem rota declarada — assim o botão
 *    Preview SEMPRE tem URL (singleTypes de uma landing page caem aqui).
 *  - URL por framework: SPA (Vite/TanStack) abre a página direta com query;
 *    Next usa a convenção /api/preview (draft mode).
 */
export function buildPreviewConfig(
  manifest: Manifest,
  framework: string = manifest.framework
): string {
  const routes: Record<string, string> = {};
  for (const ct of manifest.contentTypes) {
    // rota declarada quando há página de detalhe; senão a raiz da app.
    routes[apiUid(ct.singularName)] = ct.preview?.route ?? '/';
  }
  const routesJson = JSON.stringify(routes, null, 2);
  const isNext = framework === 'next';

  // ramo de montagem da URL final, por framework.
  const urlBranch = isNext
    ? `        // Next.js: rota de draft mode que seta o cookie e redireciona p/ \`path\`.
        const qs = new URLSearchParams({ secret, status: status ?? 'draft', path: pathname });
        return \`\${clientUrl}/api/preview?\${qs.toString()}\`;`
    : `        // SPA (Vite/TanStack): abre a página direta; o front lê ?preview/status.
        const qs = new URLSearchParams({ preview: '1', status: status ?? 'draft', secret });
        return \`\${clientUrl}\${pathname}?\${qs.toString()}\`;`;

  return `// Preview gerado pelo mcp-chat a partir do strapi.manifest.json (framework: ${framework}).
// Mapa uid -> rota do frontend (placeholders :campo são preenchidos pelo doc).
// Este arquivo é mesclado em config/admin.ts — não precisa editá-lo à mão.
const PREVIEW_ROUTES: Record<string, string> = ${routesJson};

export default ({ env }: { env: any }) => ({
  preview: {
    enabled: true,
    config: {
      allowedOrigins: [env('CLIENT_URL', 'http://localhost:3000')],
      async handler(uid: string, { documentId, locale, status }: any) {
        const route = PREVIEW_ROUTES[uid] ?? '/';
        const clientUrl = env('CLIENT_URL', 'http://localhost:3000');
        const secret = env('PREVIEW_SECRET', '');

        // só busca o doc se a rota tiver placeholders (ex.: :slug) a preencher.
        let pathname = route;
        if (pathname.includes(':')) {
          const doc = await strapi.documents(uid as any).findOne({ documentId, locale });
          if (!doc) return null;
          pathname = pathname.replace(/:([a-zA-Z0-9_]+)/g, (_m, f) =>
            encodeURIComponent(String((doc as any)[f] ?? ''))
          );
        }

${urlBranch}
      },
    },
  },
});
`;
}

/** admin.ts auto-contido (quando o projeto ainda não tem um). */
function buildStandaloneAdmin(): string {
  return `// ${PREVIEW_MARKER} — admin.ts gerado pelo mcp-chat (preview incluído).
import previewConfig from './${PREVIEW_MODULE}';

export default ({ env }: { env: any }) => ({
  auth: { secret: env('ADMIN_JWT_SECRET') },
  apiToken: { salt: env('API_TOKEN_SALT') },
  transfer: { token: { salt: env('TRANSFER_TOKEN_SALT') } },
  secrets: { encryptionKey: env('ENCRYPTION_KEY') },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
  ...previewConfig({ env }),
});
`;
}

/**
 * Wrapper que PRESERVA o admin existente (movido p/ admin.base.ts) e mescla o
 * preview por cima. Como o admin é mesclado e não substituído, qualquer config
 * do usuário (auth, flags, custom) continua valendo.
 */
function buildAdminWrapper(): string {
  return `// ${PREVIEW_MARKER} — preview do mcp-chat mesclado sobre o admin original.
// Sua config original está preservada em ./admin.base — edite lá, não aqui.
import base from './admin.base';
import previewConfig from './${PREVIEW_MODULE}';

export default (ctx: any) => {
  const b = typeof base === 'function' ? (base as any)(ctx) : (base ?? {});
  return { ...b, ...previewConfig(ctx) };
};
`;
}

/** Lê a porta de dev do frontend (Vite) do config; null se não achar. */
export function detectFrontendPort(frontendDir: string): number | null {
  for (const f of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs']) {
    try {
      const c = fs.readFileSync(path.join(frontendDir, f), 'utf8');
      const m = c.match(/port\s*:\s*(\d{2,5})/);
      if (m) return parseInt(m[1], 10);
    } catch {
      /* ignore */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CSP do admin: liberar frame-src para o iframe do preview
// ---------------------------------------------------------------------------

const CSP_MARKER = 'mcp-chat:csp-frame';

/** Bloco strapi::security com frame-src liberado para o dev server do preview. */
function securityBlock(): string {
  return `  // ${CSP_MARKER} — libera o frame-src p/ o admin embutir o preview do frontend
  // (dev server local em qualquer porta). Sem isto a CSP padrão (default-src 'self')
  // bloqueia o iframe e o preview fica em branco.
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:', 'http:'],
          'frame-src': ["'self'", 'http://localhost:*', 'http://127.0.0.1:*'],
          'img-src': ["'self'", 'data:', 'blob:', 'market-assets.strapi.io'],
          'media-src': ["'self'", 'data:', 'blob:'],
          upgradeInsecureRequests: null,
        },
      },
    },
  },`;
}

/**
 * Garante que o config/middlewares tenha frame-src liberado p/ o preview.
 * Não-destrutivo e idempotente:
 *  - já tem o marcador → 'already';
 *  - tem o `'strapi::security'` string padrão → troca pelo bloco com frame-src → 'patched';
 *  - já é um objeto custom de security → 'manual' (não mexe; reporta p/ o usuário ajustar).
 */
function patchSecurityMiddleware(strapiAppDir: string, dryRun?: boolean): LinkResult['cspAction'] {
  const configDir = path.join(strapiAppDir, 'config');
  const file = ['middlewares.ts', 'middlewares.js'].find((f) =>
    fs.existsSync(path.join(configDir, f))
  );
  if (!file) return 'skipped';
  const p = path.join(configDir, file);
  const content = fs.readFileSync(p, 'utf8');

  if (content.includes(CSP_MARKER) || content.includes("'frame-src'")) return 'already';

  // troca a entrada string padrão pelo bloco objeto (cobre o starter do Strapi).
  // O bloco já vem com indentação de 2 espaços, igual ao array do starter.
  const m = content.match(/^[ \t]*['"]strapi::security['"]\s*,/m);
  if (!m) return 'manual'; // já customizado de outra forma → não arrisca
  const next = content.replace(m[0], securityBlock());
  if (!dryRun) fs.writeFileSync(p, next, 'utf8');
  return 'patched';
}

// ---------------------------------------------------------------------------
// orquestração do link
// ---------------------------------------------------------------------------

function ensureInside(base: string, target: string): boolean {
  const n = path.normalize(target);
  return n === base || n.startsWith(base + path.sep);
}

export function linkFrontend(
  manifest: Manifest,
  opts: LinkOptions
): LinkResult {
  const adapter = adapterForManifest(manifest);
  const result: LinkResult = {
    ok: false,
    envFile: adapter.envFileName,
    envAdded: [],
    envPreserved: [],
    typesFile: 'strapi-types.ts',
    previewFile: 'config/admin.ts',
    previewAction: 'skipped',
    backendEnvAdded: [],
    cspAction: 'skipped',
    errors: [],
  };

  if (!path.isAbsolute(opts.frontendDir) || !path.isAbsolute(opts.strapiAppDir)) {
    result.errors.push('frontendDir e strapiAppDir devem ser absolutos');
    return result;
  }

  // 1) .env (aditivo)
  try {
    const envPath = path.join(opts.frontendDir, adapter.envFileName);
    if (!ensureInside(opts.frontendDir, envPath)) throw new Error('env fora do frontendDir');
    const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    const vars = adapter.buildEnv(opts.context);
    const { content, added, preserved } = mergeEnv(existing, vars);
    result.envAdded = added;
    result.envPreserved = preserved;
    if (!opts.dryRun && added.length) fs.writeFileSync(envPath, content, 'utf8');
  } catch (e: any) {
    result.errors.push(`env: ${e?.message ?? e}`);
  }

  // 2) tipos TS (regenerado sempre — arquivo é totalmente owned pelo gerador)
  try {
    const typesPath = path.join(opts.frontendDir, result.typesFile);
    if (!ensureInside(opts.frontendDir, typesPath)) throw new Error('types fora do frontendDir');
    if (!opts.dryRun) fs.writeFileSync(typesPath, generateTypes(manifest), 'utf8');
  } catch (e: any) {
    result.errors.push(`types: ${e?.message ?? e}`);
  }

  // 3) config de Preview — merge REAL no config/admin.ts (não sidecar morto).
  try {
    const configDir = path.join(opts.strapiAppDir, 'config');
    if (!ensureInside(opts.strapiAppDir, configDir)) throw new Error('config fora do strapiAppDir');

    const adminPath = path.join(configDir, 'admin.ts');
    const adminBasePath = path.join(configDir, 'admin.base.ts');
    const modulePath = path.join(configDir, `${PREVIEW_MODULE}.ts`);

    if (!opts.dryRun) {
      fs.mkdirSync(configDir, { recursive: true });
      // 3a) módulo de preview — sempre (re)escrito (owned pelo gerador).
      fs.writeFileSync(modulePath, buildPreviewConfig(manifest, adapter.framework), 'utf8');
      // limpa o sidecar morto de versões antigas, se existir.
      try {
        fs.unlinkSync(path.join(configDir, 'admin.mcp-chat-preview.ts'));
      } catch {
        /* não existia */
      }
    }
    result.previewFile = `config/${PREVIEW_MODULE}.ts`;

    if (!fs.existsSync(adminPath)) {
      // 3b) sem admin.ts: cria um auto-contido já com o preview.
      if (!opts.dryRun) fs.writeFileSync(adminPath, buildStandaloneAdmin(), 'utf8');
      result.previewAction = 'created';
    } else {
      const adminContent = fs.readFileSync(adminPath, 'utf8');
      if (!adminContent.includes(PREVIEW_MARKER)) {
        // 3c) admin.ts do usuário: preserva em admin.base.ts e troca por wrapper.
        if (!opts.dryRun) {
          if (!fs.existsSync(adminBasePath)) {
            fs.writeFileSync(adminBasePath, adminContent, 'utf8');
          }
          fs.writeFileSync(adminPath, buildAdminWrapper(), 'utf8');
        }
      }
      // se já tinha o marcador, só o módulo (3a) foi atualizado — idempotente.
      result.previewAction = 'merged';
    }
  } catch (e: any) {
    result.errors.push(`preview: ${e?.message ?? e}`);
  }

  // 4) .env do BACKEND: CLIENT_URL (origem do iframe + allowedOrigins) e, se houver,
  //    PREVIEW_SECRET. Aditivo: nunca sobrescreve o que o usuário já definiu.
  //
  // CRÍTICO: o preview NATIVO do Strapi usa CLIENT_URL, e ele PRECISA bater com a
  // porta onde o runner sobe o dev server. O runner ignora o vite.config e usa
  // FRONTEND_BASE_PORT — então CLIENT_URL tem que apontar pra ESSA porta, não pra
  // porta do vite.config (senão o preview nativo abre uma porta morta).
  try {
    const clientUrl =
      opts.context.frontendUrl || `http://localhost:${FRONTEND_BASE_PORT}`;
    const backendVars: Record<string, string> = { CLIENT_URL: clientUrl };
    if (opts.context.previewSecret) backendVars.PREVIEW_SECRET = opts.context.previewSecret;

    const backendEnvPath = path.join(opts.strapiAppDir, '.env');
    if (ensureInside(opts.strapiAppDir, backendEnvPath)) {
      const existing = fs.existsSync(backendEnvPath) ? fs.readFileSync(backendEnvPath, 'utf8') : '';
      const { content, added } = mergeEnv(existing, backendVars);
      result.backendEnvAdded = added;
      if (!opts.dryRun && added.length) fs.writeFileSync(backendEnvPath, content, 'utf8');
    }
  } catch (e: any) {
    result.errors.push(`backend env: ${e?.message ?? e}`);
  }

  // 5) CSP do admin: libera frame-src p/ o iframe do preview (senão fica em branco).
  try {
    result.cspAction = patchSecurityMiddleware(opts.strapiAppDir, opts.dryRun);
    if (result.cspAction === 'manual') {
      result.errors.push(
        'CSP: config/middlewares já tem strapi::security customizado — adicione manualmente ' +
          "frame-src 'self' http://localhost:* http://127.0.0.1:* para o preview embutir o frontend."
      );
    }
  } catch (e: any) {
    result.errors.push(`csp: ${e?.message ?? e}`);
  }

  result.ok = result.errors.length === 0;
  return result;
}
