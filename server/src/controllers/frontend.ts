import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { stageProvision, getProvisionStatus } from '../provision/orchestrate';
import { inferManifest } from '../provision/infer';
import { startFrontend, getRunStatus } from '../provision/runner';
import { integrateFrontend } from '../provision/integrate';
import { validateManifest } from '../provision/manifest';
import type { LinkContext } from '../provision/adapters';

/**
 * Controller de provisão de frontend. Fluxo em DUAS etapas para o cenário
 * Figma/Lovable (frontend sem manifest):
 *
 *  1) analyze: recebe o .zip → extrai para a pasta irmã → se houver
 *     strapi.manifest.json usa ele, SENÃO infere via IA a partir do código.
 *     Devolve o manifest proposto para o usuário REVISAR. Não cria nada ainda.
 *  2) provision: recebe o manifest confirmado (possivelmente editado) → grava no
 *     projeto → cria content-types + agenda seed/link → reinicia a Strapi.
 *
 * Segurança: dev-only (escrita de schema é dev-only), proteção contra zip-slip,
 * destino aditivo (não sobrescreve pasta existente) e o frontendDir da etapa 2 é
 * validado para ficar dentro da pasta-pai da app Strapi. Nunca executa o código.
 */

const MANIFEST_NAME = 'strapi.manifest.json';

function ensureInside(base: string, target: string): boolean {
  const n = path.normalize(target);
  return n === base || n.startsWith(base + path.sep);
}

/** normaliza um nome livre para o formato kebab exigido pelo manifest. */
function toKebab(input: string): string {
  const s = (input || 'frontend')
    .toLowerCase()
    .replace(/\.zip$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[^a-z]+/, '');
  return s || 'frontend';
}

function devOnly(ctx: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    ctx.badRequest(
      'A provisão de frontend só funciona em desenvolvimento (geração de content-types é dev-only).'
    );
    return false;
  }
  return true;
}

export default {
  /** Etapa 1: extrai e descobre/infere o manifest (sem criar nada). */
  async analyze(ctx: any) {
    const strapi = ctx.strapi ?? (global as any).strapi;
    if (!devOnly(ctx)) return;

    // 1) arquivo enviado
    const files = ctx.request.files || {};
    const file = files.frontend || files.file || Object.values(files)[0];
    if (!file) return ctx.badRequest('Envie o .zip do frontend no campo "frontend".');
    const filepath = (file as any).filepath || (file as any).path;
    if (!filepath) return ctx.badRequest('Arquivo inválido.');
    const originalName = (file as any).originalFilename || (file as any).name || 'frontend';

    // 2) abre o zip
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(fs.readFileSync(filepath));
    } catch (e: any) {
      return ctx.badRequest(`Zip inválido: ${e?.message ?? e}`);
    }

    // detecta um prefixo de pasta raiz comum (ex.: "meu-app/") para achatar
    const entryNames = Object.keys(zip.files);
    const manifestEntry = entryNames.find(
      (p) => path.basename(p) === MANIFEST_NAME && !zip.files[p].dir
    );
    let rootPrefix = '';
    if (manifestEntry) {
      rootPrefix = manifestEntry.slice(0, manifestEntry.length - MANIFEST_NAME.length);
    } else {
      // se TODO mundo compartilha a mesma primeira pasta, usa-a como prefixo
      const tops = new Set(
        entryNames.filter((n) => n.includes('/')).map((n) => n.slice(0, n.indexOf('/') + 1))
      );
      if (tops.size === 1) rootPrefix = [...tops][0];
    }

    // nome do destino: nome do arquivo enviado (kebab)
    const name = toKebab(originalName);
    const strapiAppDir: string = strapi.dirs.app.root;
    const frontendDir = path.resolve(strapiAppDir, '..', name);

    // 3) destino aditivo
    if (fs.existsSync(frontendDir) && fs.readdirSync(frontendDir).length > 0) {
      return ctx.badRequest(
        `A pasta de destino já existe e não está vazia: ${frontendDir}. Renomeie o .zip ou remova a pasta.`
      );
    }

    // 4) extrai (com proteção contra zip-slip)
    try {
      fs.mkdirSync(frontendDir, { recursive: true });
      for (const entryName of entryNames) {
        const entry = zip.files[entryName];
        const rel =
          rootPrefix && entryName.startsWith(rootPrefix)
            ? entryName.slice(rootPrefix.length)
            : entryName;
        if (!rel) continue;
        const dest = path.join(frontendDir, rel);
        if (!ensureInside(frontendDir, dest)) {
          throw new Error(`entrada perigosa no zip bloqueada: ${entryName}`);
        }
        if (entry.dir) {
          fs.mkdirSync(dest, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.writeFileSync(dest, await entry.async('nodebuffer'));
        }
      }
    } catch (e: any) {
      return ctx.internalServerError(`Falha ao extrair: ${e?.message ?? e}`);
    }

    // 5) acha ou INFERE o manifest a partir do código
    const inf = await inferManifest(strapi, frontendDir, { name });

    ctx.body = {
      ok: inf.ok,
      frontendDir,
      inferred: inf.inferred,
      framework: inf.framework,
      filesAnalyzed: inf.filesAnalyzed,
      // manifest cru (mesmo se inválido, para o usuário revisar/editar)
      manifest: inf.rawManifest ?? inf.manifest ?? null,
      warnings: inf.warnings,
      errors: inf.errors,
      message: inf.ok
        ? inf.inferred
          ? 'Manifest inferido a partir do código. Revise e confirme para provisionar.'
          : 'Manifest encontrado no projeto. Revise e confirme para provisionar.'
        : 'Não foi possível obter um manifest válido. Edite-o abaixo e tente provisionar.',
    };
  },

  /** Etapa 2: provisiona a partir do manifest confirmado. */
  async provision(ctx: any) {
    const strapi = ctx.strapi ?? (global as any).strapi;
    if (!devOnly(ctx)) return;

    const body = ctx.request.body || {};
    const rawManifest = body.manifest;
    const frontendDir: string = body.frontendDir;
    if (!rawManifest) return ctx.badRequest('Envie o "manifest".');
    if (!frontendDir || !path.isAbsolute(frontendDir)) {
      return ctx.badRequest('frontendDir ausente ou inválido.');
    }

    const strapiAppDir: string = strapi.dirs.app.root;
    const apiRoot: string = strapi.dirs.app.api;
    const parent = path.resolve(strapiAppDir, '..');

    // segurança: frontendDir tem que ser uma pasta irmã já existente
    if (!ensureInside(parent, frontendDir) || frontendDir === parent) {
      return ctx.badRequest('frontendDir fora da pasta permitida.');
    }
    if (!fs.existsSync(frontendDir)) {
      return ctx.badRequest('frontendDir não existe (rode a análise primeiro).');
    }

    // valida o manifest confirmado
    const v = validateManifest(rawManifest);
    if (!v.ok) {
      return ctx.badRequest({ message: 'Manifest inválido', errors: v.errors });
    }

    // persiste o manifest no projeto (fica versionável e reaproveitável)
    try {
      fs.writeFileSync(
        path.join(frontendDir, MANIFEST_NAME),
        JSON.stringify(v.data, null, 2),
        'utf8'
      );
    } catch (e: any) {
      return ctx.internalServerError(`Não foi possível gravar o manifest: ${e?.message ?? e}`);
    }

    const port = strapi.config.get('server.port', 1337);
    const context: LinkContext = { strapiUrl: `http://localhost:${port}` };

    const staged = stageProvision(strapi, {
      rawManifest: v.data,
      apiRoot,
      frontendDir,
      strapiAppDir,
      context,
    });

    if (!staged.ok) {
      return ctx.badRequest({
        message: 'Provisão falhou',
        validation: staged.validation,
        errors: staged.errors,
      });
    }

    ctx.body = {
      ok: true,
      frontendDir,
      contentTypes: staged.write?.written.filter((f) => f.endsWith('schema.json')).length ?? 0,
      skipped: staged.write?.skipped ?? [],
      willReload: staged.willReload,
      message: staged.willReload
        ? 'Provisão agendada. A Strapi vai reiniciar e então criar o conteúdo e ligar o preview.'
        : 'Nenhuma content-type nova (já existiam).',
    };

    // NÃO chamamos strapi.reload() aqui: a provisão é dev-only e, em `develop`, o
    // próprio file watcher da Strapi reinicia ao detectar os novos schema.json.
    // Disparar um reload manual junto causava um DOUBLE restart e matava o worker
    // (EPIPE) na 5.48. O watcher cuida do restart; o pós-restart roda no bootstrap.
  },

  /** Status da provisão — a UI faz polling após confirmar. */
  status(ctx: any) {
    const strapi = ctx.strapi ?? (global as any).strapi;
    ctx.body = getProvisionStatus(strapi.dirs.app.root);
  },

  /**
   * Roda o dev server do frontend provisionado. A UI chama isto ao ligar o
   * preview pela 1ª vez após o upload. Sem body, usa o último provisionado.
   */
  async run(ctx: any) {
    const strapi = ctx.strapi ?? (global as any).strapi;
    if (!devOnly(ctx)) return;

    const body = ctx.request.body || {};
    let dir: string = body.dir;
    let url: string = body.url;
    if (!dir || !url) {
      const st = getProvisionStatus(strapi.dirs.app.root);
      if (st.done) {
        dir = dir || st.done.frontendDir;
        url = url || st.done.previewUrl;
      }
    }
    if (!dir || !url) {
      return ctx.badRequest('Nenhum frontend provisionado para rodar.');
    }

    // segurança: só dentro da pasta-pai da app
    const parent = path.resolve(strapi.dirs.app.root, '..');
    if (!ensureInside(parent, dir) || !fs.existsSync(dir)) {
      return ctx.badRequest('Pasta do frontend inválida.');
    }

    ctx.body = await startFrontend(strapi, { dir, url });
  },

  /** Status do dev server do frontend (polling da UI). */
  runStatus(ctx: any) {
    ctx.body = getRunStatus();
  },

  /**
   * Religa o frontend ao Strapi por SNAPSHOT: regenera o(s) arquivo(s) de dados
   * com o conteúdo do Strapi, mantendo nomes de export e imagens originais.
   * Usa o último provisionado por padrão.
   */
  async integrate(ctx: any) {
    const strapi = ctx.strapi ?? (global as any).strapi;
    if (!devOnly(ctx)) return;

    const body = ctx.request.body || {};
    let frontendDir: string = body.frontendDir;
    if (!frontendDir) {
      const st = getProvisionStatus(strapi.dirs.app.root);
      frontendDir = st.done?.frontendDir || '';
    }
    if (!frontendDir) return ctx.badRequest('Nenhum frontend provisionado.');

    const parent = path.resolve(strapi.dirs.app.root, '..');
    if (!ensureInside(parent, frontendDir) || !fs.existsSync(frontendDir)) {
      return ctx.badRequest('Pasta do frontend inválida.');
    }

    // lê o manifest persistido no projeto
    let manifest: any;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(frontendDir, MANIFEST_NAME), 'utf8'));
    } catch {
      return ctx.badRequest('Manifest do projeto não encontrado (rode a provisão primeiro).');
    }
    const v = validateManifest(manifest);
    if (!v.ok) return ctx.badRequest({ message: 'Manifest inválido', errors: v.errors });

    ctx.body = await integrateFrontend(strapi, { frontendDir, manifest: v.data });
  },
};
