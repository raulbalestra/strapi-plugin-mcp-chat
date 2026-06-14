import fs from 'node:fs';
import path from 'node:path';
import type { Manifest } from './manifest';
import { adapterForManifest, type LinkContext } from './adapters';
import { generateTypes } from './types-gen';
import { apiUid } from './generate';

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
  previewAction: 'created' | 'sidecar' | 'skipped';
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

/**
 * Gera o conteúdo de config/admin.ts com o Preview configurado: mapeia cada uid
 * para a rota de preview declarada no manifest e monta a URL com o slug do doc.
 */
export function buildPreviewConfig(manifest: Manifest): string {
  const routes: Record<string, string> = {};
  for (const ct of manifest.contentTypes) {
    if (ct.preview?.route) routes[apiUid(ct.singularName)] = ct.preview.route;
  }
  const routesJson = JSON.stringify(routes, null, 2);

  return `// Preview gerado pelo mcp-chat a partir do strapi.manifest.json.
// Mapa uid -> rota do frontend (placeholders :campo são preenchidos pelo doc).
const PREVIEW_ROUTES: Record<string, string> = ${routesJson};

export default ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  apiToken: { salt: env('API_TOKEN_SALT') },
  transfer: { token: { salt: env('TRANSFER_TOKEN_SALT') } },
  preview: {
    enabled: true,
    config: {
      allowedOrigins: [env('CLIENT_URL', 'http://localhost:3000')],
      async handler(uid: string, { documentId, locale, status }: any) {
        const route = PREVIEW_ROUTES[uid];
        if (!route) return null;
        const doc = await strapi.documents(uid as any).findOne({ documentId, locale });
        if (!doc) return null;
        // substitui :campo pelos valores do documento (ex.: :slug)
        const pathname = route.replace(/:([a-zA-Z0-9_]+)/g, (_m, f) =>
          encodeURIComponent(String((doc as any)[f] ?? ''))
        );
        const clientUrl = env('CLIENT_URL', 'http://localhost:3000');
        const secret = env('PREVIEW_SECRET', '');
        const qs = new URLSearchParams({ secret, status: status ?? 'draft', path: pathname });
        return \`\${clientUrl}/api/preview?\${qs.toString()}\`;
      },
    },
  },
});
`;
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

  // 3) config de Preview (não-destrutivo)
  try {
    const adminPath = path.join(opts.strapiAppDir, 'config', 'admin.ts');
    const content = buildPreviewConfig(manifest);
    if (fs.existsSync(adminPath)) {
      // não sobrescreve config existente: escreve sidecar e reporta
      result.previewFile = 'config/admin.mcp-chat-preview.ts';
      const sidecar = path.join(opts.strapiAppDir, 'config', 'admin.mcp-chat-preview.ts');
      if (!opts.dryRun) fs.writeFileSync(sidecar, content, 'utf8');
      result.previewAction = 'sidecar';
    } else {
      if (!opts.dryRun) {
        fs.mkdirSync(path.dirname(adminPath), { recursive: true });
        fs.writeFileSync(adminPath, content, 'utf8');
      }
      result.previewAction = 'created';
    }
  } catch (e: any) {
    result.errors.push(`preview: ${e?.message ?? e}`);
  }

  result.ok = result.errors.length === 0;
  return result;
}
