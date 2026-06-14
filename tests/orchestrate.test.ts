import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  stageProvision,
  runPendingProvision,
  getProvisionStatus,
} from '../server/src/provision/orchestrate';

/**
 * Testa o orquestrador da fase 4: stageProvision (valida + grava content-types +
 * marcador + reload) e runPendingProvision (seed + link no pós-restart,
 * idempotente). Usa stubs leves de Strapi; o seed real já foi provado na fase 3.
 * Precisa de NODE_ENV=development (guard dev-only do writer).
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

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpchat-orch-'));
  const apiRoot = path.join(tmp, 'src', 'api');
  fs.mkdirSync(apiRoot, { recursive: true });
  const frontendDir = path.join(tmp, 'front');
  fs.mkdirSync(frontendDir, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'config'), { recursive: true });

  let reloaded = false;
  const strapi: any = { reload: () => { reloaded = true; } };

  const r = stageProvision(strapi, {
    rawManifest: raw,
    apiRoot,
    frontendDir,
    strapiAppDir: tmp,
    context: { strapiUrl: 'http://localhost:1337' },
  });
  ok(r.ok, 'stage ok: ' + r.errors.join(','));
  ok(r.validation.ok, 'validation ok');
  ok(r.staged, 'staged (marcador escrito)');
  ok(r.willReload, 'willReload');
  ok(!reloaded, 'stageProvision NAO chama reload (deferido ao controller)');
  ok(fs.existsSync(path.join(apiRoot, 'produto', 'content-types', 'produto', 'schema.json')), 'schema produto');
  ok(fs.existsSync(path.join(apiRoot, 'categoria', 'content-types', 'categoria', 'schema.json')), 'schema categoria');

  const mp = path.join(tmp, '.mcp-chat', 'pending-provision.json');
  ok(fs.existsSync(mp), 'marcador existe');
  const marker = JSON.parse(fs.readFileSync(mp, 'utf8'));
  ok(marker.frontendDir === frontendDir, 'marcador frontendDir');
  ok(marker.manifest.name === 'loja-exemplo', 'marcador manifest');

  // status antes de concluir: pending=true, done=null
  const st0 = getProvisionStatus(tmp);
  ok(st0.pending === true && st0.done === null, 'status: pending sem done antes de rodar');

  // runPendingProvision: seed via stub + link real, apaga marcador
  const stubStrapi: any = { documents: () => ({ count: async () => 0, create: async (x: any) => x }) };
  const rp = await runPendingProvision(stubStrapi, tmp);
  ok(rp.ran, 'runPending rodou');
  ok(!fs.existsSync(mp), 'marcador apagado apos rodar');
  ok(rp.link && rp.link.errors.length === 0, 'link rodou: ' + JSON.stringify(rp.link?.errors));
  ok(fs.existsSync(path.join(frontendDir, 'strapi-types.ts')), 'types gerados pelo link');
  ok(fs.existsSync(path.join(frontendDir, '.env.local')), 'env gerado pelo link');

  // status apos concluir: pending=false, done preenchido (a UI anuncia "pronto")
  const st1 = getProvisionStatus(tmp);
  ok(st1.pending === false, 'status: pending=false apos concluir');
  ok(!!st1.done, 'status: done preenchido');
  ok(st1.done?.name === 'loja-exemplo', 'status.done.name');
  ok(Array.isArray(st1.done?.contentTypes) && st1.done!.contentTypes.includes('api::produto.produto'), 'status.done.contentTypes');
  ok(typeof st1.done?.previewUrl === 'string' && st1.done!.previewUrl.startsWith('http'), 'status.done.previewUrl');

  // 2a chamada: sem marcador = no-op
  const rp2 = await runPendingProvision(stubStrapi, tmp);
  ok(!rp2.ran, 'runPending no-op sem marcador (idempotente)');

  // dry-run: nao escreve marcador nem reload
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mcpchat-orch2-'));
  fs.mkdirSync(path.join(tmp2, 'src', 'api'), { recursive: true });
  let reloaded2 = false;
  const dr = stageProvision(
    { reload: () => { reloaded2 = true; } },
    {
      rawManifest: raw,
      apiRoot: path.join(tmp2, 'src', 'api'),
      frontendDir,
      strapiAppDir: tmp2,
      context: { strapiUrl: 'http://localhost:1337' },
      dryRun: true,
    }
  );
  ok(dr.ok, 'dry-run ok');
  ok(!dr.staged && !dr.willReload && !reloaded2, 'dry-run nao grava marcador nem reload');
  ok(!fs.existsSync(path.join(tmp2, '.mcp-chat', 'pending-provision.json')), 'dry-run sem marcador');

  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(tmp2, { recursive: true, force: true });
  console.log(`\norchestrate.test: ${pass} passaram, ${fail} falharam`);
  process.exit(fail ? 1 : 0);
})();
