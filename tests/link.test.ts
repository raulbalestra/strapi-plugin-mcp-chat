import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateManifest } from '../server/src/provision/manifest';
import { linkFrontend, buildPreviewConfig } from '../server/src/provision/link';
import { generateTypes } from '../server/src/provision/types-gen';
import { getAdapter } from '../server/src/provision/adapters';

/**
 * Testa a camada de "link" da fase 4 (adapters / link / types-gen / preview)
 * de forma pura — sem precisar de uma Strapi viva, só do manifest de exemplo.
 * Caminho do manifest vem por env (MANIFEST) para sobreviver ao bundle.
 */

const raw = JSON.parse(fs.readFileSync(process.env.MANIFEST!, 'utf8'));
let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) pass++;
  else {
    fail++;
    console.log('  FAIL:', m);
  }
};

const v = validateManifest(raw);
ok(v.ok, 'manifest valida');
if (!v.ok) {
  console.log(v.errors);
  process.exit(1);
}
const m = v.data;

// adapters
const nextA = getAdapter('next');
ok(nextA.envFileName === '.env.local', 'next env file');
const tsA = getAdapter('tanstack');
ok(tsA.envFileName === '.env', 'tanstack env file');
const env = nextA.buildEnv({ strapiUrl: 'http://localhost:1337', apiToken: 'tok', previewSecret: 'sec' });
ok(env.NEXT_PUBLIC_STRAPI_URL === 'http://localhost:1337', 'next public url');
ok(env.STRAPI_API_TOKEN === 'tok' && !('NEXT_PUBLIC_STRAPI_API_TOKEN' in env), 'token nao publico');

// types
const types = generateTypes(m);
ok(types.includes('export interface Produto {'), 'interface Produto');
ok(types.includes('titulo: string;'), 'titulo required nao-opcional');
ok(types.includes('descricao?: string;'), 'descricao opcional');
ok(types.includes('capa?: StrapiMedia;'), 'capa media single');
ok(types.includes('categoria?: Categoria;'), 'relacao manyToOne -> obj unico');
ok(types.includes('documentId: string;'), 'documentId presente');

// preview config
const pv = buildPreviewConfig(m);
ok(pv.includes('"api::produto.produto": "/produtos/:slug"'), 'preview route produto');
ok(pv.includes('preview:') && pv.includes('handler('), 'handler de preview');

// linkFrontend num dir temp
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpchat-link-'));
const frontendDir = path.join(tmp, 'front');
fs.mkdirSync(frontendDir, { recursive: true });
const strapiAppDir = path.join(tmp, 'strapi');
fs.mkdirSync(path.join(strapiAppDir, 'config'), { recursive: true });
fs.writeFileSync(path.join(frontendDir, '.env.local'), 'EXISTING=1\n', 'utf8');
// middlewares.ts padrão do starter (strapi::security como string) → deve ser patchado
fs.writeFileSync(
  path.join(strapiAppDir, 'config', 'middlewares.ts'),
  `export default [\n  'strapi::logger',\n  'strapi::errors',\n  'strapi::security',\n  'strapi::cors',\n];\n`,
  'utf8'
);

const r = linkFrontend(m, { frontendDir, strapiAppDir, context: { strapiUrl: 'http://localhost:1337' } });
ok(r.ok, 'link ok: ' + r.errors.join(','));
const envContent = fs.readFileSync(path.join(frontendDir, '.env.local'), 'utf8');
ok(envContent.includes('EXISTING=1'), 'env preserva existente');
ok(envContent.includes('NEXT_PUBLIC_STRAPI_URL='), 'env adiciona var nova');
ok(fs.existsSync(path.join(frontendDir, 'strapi-types.ts')), 'types escritos');
ok(r.previewAction === 'created', 'preview created (sem admin.ts previo): ' + r.previewAction);
ok(fs.existsSync(path.join(strapiAppDir, 'config', 'admin.ts')), 'admin.ts criado');
ok(fs.existsSync(path.join(strapiAppDir, 'config', 'mcp-chat-preview.ts')), 'modulo de preview escrito');
ok(fs.existsSync(path.join(strapiAppDir, '.env')), 'backend .env criado');
ok(fs.readFileSync(path.join(strapiAppDir, '.env'), 'utf8').includes('CLIENT_URL='), 'CLIENT_URL no backend .env');
// CSP: middlewares patchado com frame-src para o iframe do preview
ok(r.cspAction === 'patched', 'csp patched: ' + r.cspAction);
const mw = fs.readFileSync(path.join(strapiAppDir, 'config', 'middlewares.ts'), 'utf8');
ok(mw.includes("'frame-src'") && mw.includes('127.0.0.1:*'), 'middlewares tem frame-src liberado');
ok(mw.includes('strapi::cors'), 'middlewares preserva demais entradas');
// idempotente: 2a passada não duplica
const rCsp2 = linkFrontend(m, { frontendDir, strapiAppDir, context: { strapiUrl: 'http://localhost:1337' } });
ok(rCsp2.cspAction === 'already', 'csp idempotente: ' + rCsp2.cspAction);

// simula um admin.ts pré-existente do usuário e re-linka: deve MESCLAR (não sidecar).
fs.writeFileSync(
  path.join(strapiAppDir, 'config', 'admin.ts'),
  `export default ({ env }) => ({ auth: { secret: env('ADMIN_JWT_SECRET') }, flags: { nps: true } });\n`,
  'utf8'
);
const r2 = linkFrontend(m, { frontendDir, strapiAppDir, context: { strapiUrl: 'http://localhost:1337' } });
ok(r2.previewAction === 'merged', 'preview merged com admin.ts existente: ' + r2.previewAction);
ok(fs.existsSync(path.join(strapiAppDir, 'config', 'admin.base.ts')), 'admin original preservado em admin.base.ts');
ok(fs.readFileSync(path.join(strapiAppDir, 'config', 'admin.base.ts'), 'utf8').includes("flags: { nps: true }"), 'admin.base preserva config do usuario');
ok(fs.readFileSync(path.join(strapiAppDir, 'config', 'admin.ts'), 'utf8').includes('mcp-chat:preview-merged'), 'admin.ts wrapper tem marcador');
ok(!fs.existsSync(path.join(strapiAppDir, 'config', 'admin.mcp-chat-preview.ts')), 'sidecar morto NAO existe');
ok(r2.envAdded.length === 0, 'env frontend idempotente 2a passada');

// 3a passada: marcador presente -> idempotente (não mexe no admin.ts nem re-preserva).
const adminAfter2 = fs.readFileSync(path.join(strapiAppDir, 'config', 'admin.ts'), 'utf8');
const r3 = linkFrontend(m, { frontendDir, strapiAppDir, context: { strapiUrl: 'http://localhost:1337' } });
ok(r3.previewAction === 'merged', 'idempotente: segue merged');
ok(fs.readFileSync(path.join(strapiAppDir, 'config', 'admin.ts'), 'utf8') === adminAfter2, 'admin.ts inalterado na 3a passada');

// preview default "/" para singleType sem rota declarada
const pvDefault = buildPreviewConfig(m, 'tanstack');
ok(pvDefault.includes("?? '/'"), 'rota default / no handler');
ok(pvDefault.includes("preview: '1'"), 'SPA: monta URL direta com ?preview=1');
const pvNext = buildPreviewConfig(m, 'next');
ok(pvNext.includes('/api/preview?'), 'Next: usa rota de draft mode /api/preview');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nlink.test: ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
