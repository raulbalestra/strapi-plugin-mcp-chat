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

const r = linkFrontend(m, { frontendDir, strapiAppDir, context: { strapiUrl: 'http://localhost:1337' } });
ok(r.ok, 'link ok: ' + r.errors.join(','));
const envContent = fs.readFileSync(path.join(frontendDir, '.env.local'), 'utf8');
ok(envContent.includes('EXISTING=1'), 'env preserva existente');
ok(envContent.includes('NEXT_PUBLIC_STRAPI_URL='), 'env adiciona var nova');
ok(fs.existsSync(path.join(frontendDir, 'strapi-types.ts')), 'types escritos');
ok(r.previewAction === 'created', 'preview created (sem admin.ts previo): ' + r.previewAction);
ok(fs.existsSync(path.join(strapiAppDir, 'config', 'admin.ts')), 'admin.ts criado');

// 2a passada: admin.ts existe -> sidecar; env idempotente
const r2 = linkFrontend(m, { frontendDir, strapiAppDir, context: { strapiUrl: 'http://localhost:1337' } });
ok(r2.previewAction === 'sidecar', 'preview sidecar na 2a passada: ' + r2.previewAction);
ok(fs.existsSync(path.join(strapiAppDir, 'config', 'admin.mcp-chat-preview.ts')), 'sidecar escrito');
ok(r2.envAdded.length === 0, 'env idempotente 2a passada');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nlink.test: ${pass} passaram, ${fail} falharam`);
process.exit(fail ? 1 : 0);
