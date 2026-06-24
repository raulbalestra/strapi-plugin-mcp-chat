import fs from 'node:fs';
import path from 'node:path';
import { validateManifest, type Manifest } from './manifest';
import { generateAll } from './generate';
import { writeApis, requestReload, type WriteResult } from './write';
export { requestReload };
import { seedContent, type SeedResult } from './seed';
import { linkFrontend, type LinkResult } from './link';
import { FRONTEND_BASE_PORT } from './runner';
import { grantPublicRead, type PermissionsResult } from './permissions';
import { type LinkContext } from './adapters';
import { apiUid } from './generate';

/**
 * Orquestrador da provisão.
 *
 * O ponto delicado: depois de gravar os schema.json, a Strapi precisa
 * REINICIAR para reconhecer os novos content-types — e só DEPOIS dá pra semear
 * e ligar o preview (que dependem dos types existindo). Como o reload derruba o
 * contexto atual, dividimos em dois momentos:
 *
 *  1. stageProvision()  — valida, grava src/api, escreve um marcador "pendente"
 *     que sobrevive ao restart e dispara o reload.
 *  2. runPendingProvision() — roda no bootstrap após o restart: lê o marcador,
 *     semeia + linka, apaga o marcador. Idempotente (sem marcador = no-op).
 */

const MARKER_DIR = '.mcp-chat';
const MARKER_FILE = 'pending-provision.json';
const DONE_FILE = 'last-provision.json';

interface PendingMarker {
  manifest: Manifest;
  frontendDir: string;
  strapiAppDir: string;
  context: LinkContext;
}

/** Resumo da última provisão concluída — lido pela UI para anunciar "preview pronto". */
export interface ProvisionDone {
  name: string;
  framework: string;
  frontendDir: string;
  contentTypes: string[];
  previewUrl: string;
  seedCreated: { uid: string; count: number }[];
  linkErrors: string[];
  finishedAt: string;
}

function markerPath(strapiAppDir: string): string {
  return path.join(strapiAppDir, MARKER_DIR, MARKER_FILE);
}

function donePath(strapiAppDir: string): string {
  return path.join(strapiAppDir, MARKER_DIR, DONE_FILE);
}

export interface ProvisionStatus {
  /** há uma provisão agendada aguardando o pós-restart. */
  pending: boolean;
  /** resumo da última provisão concluída (null se nunca houve). */
  done: ProvisionDone | null;
}

/** Lido pelo endpoint de status: a UI faz polling disto após o upload. */
export function getProvisionStatus(strapiAppDir: string): ProvisionStatus {
  const pending = fs.existsSync(markerPath(strapiAppDir));
  let done: ProvisionDone | null = null;
  try {
    const dp = donePath(strapiAppDir);
    if (fs.existsSync(dp)) done = JSON.parse(fs.readFileSync(dp, 'utf8'));
  } catch {
    /* ignore */
  }
  return { pending, done };
}

export interface StageInput {
  rawManifest: unknown;
  /** src/api absoluto. */
  apiRoot: string;
  /** pasta do frontend já instalado. */
  frontendDir: string;
  /** raiz da app Strapi. */
  strapiAppDir: string;
  context: LinkContext;
  dryRun?: boolean;
}

export interface StageResult {
  ok: boolean;
  validation: { ok: boolean; errors?: string[] };
  write?: WriteResult;
  staged: boolean;
  willReload: boolean;
  errors: string[];
}

/** Etapa 1: valida + grava content-types + agenda o pós-restart. */
export function stageProvision(strapi: any, input: StageInput): StageResult {
  const result: StageResult = {
    ok: false,
    validation: { ok: false },
    staged: false,
    willReload: false,
    errors: [],
  };

  const v = validateManifest(input.rawManifest);
  if (!v.ok) {
    result.validation = { ok: false, errors: v.errors };
    result.errors.push('manifest inválido');
    return result;
  }
  result.validation = { ok: true };

  const apis = generateAll(v.data);
  const write = writeApis(apis, { apiRoot: input.apiRoot, dryRun: input.dryRun });
  result.write = write;
  if (!write.ok) {
    result.errors.push(...write.errors);
    return result;
  }

  // grava o marcador para o pós-restart (seed + link)
  const marker: PendingMarker = {
    manifest: v.data,
    frontendDir: input.frontendDir,
    strapiAppDir: input.strapiAppDir,
    context: input.context,
  };
  if (!input.dryRun) {
    try {
      const mp = markerPath(input.strapiAppDir);
      fs.mkdirSync(path.dirname(mp), { recursive: true });
      fs.writeFileSync(mp, JSON.stringify(marker, null, 2), 'utf8');
      // limpa o resumo da provisão anterior: a UI faz polling por um NOVO.
      try {
        fs.unlinkSync(donePath(input.strapiAppDir));
      } catch {
        /* não existia, tudo bem */
      }
      result.staged = true;
    } catch (e: any) {
      result.errors.push(`marcador: ${e?.message ?? e}`);
      return result;
    }
  }

  result.ok = true;
  // só recarrega se houve content-type nova escrita (senão nada mudou).
  // O reload em si é disparado pelo controller DEPOIS de responder ao HTTP,
  // senão o restart mata a resposta em voo (a UI não saberia que deu certo).
  result.willReload = !input.dryRun && write.written.length > 0;
  return result;
}

export interface RunPendingResult {
  ran: boolean;
  seed?: SeedResult;
  link?: LinkResult;
  permissions?: PermissionsResult;
  errors: string[];
}

/** Etapa 2: roda no bootstrap após o restart. Idempotente. */
export async function runPendingProvision(
  strapi: any,
  strapiAppDir: string
): Promise<RunPendingResult> {
  const result: RunPendingResult = { ran: false, errors: [] };
  const mp = markerPath(strapiAppDir);
  if (!fs.existsSync(mp)) return result; // nada pendente

  let marker: PendingMarker;
  try {
    marker = JSON.parse(fs.readFileSync(mp, 'utf8'));
  } catch (e: any) {
    result.errors.push(`marcador ilegível: ${e?.message ?? e}`);
    return result;
  }

  result.ran = true;
  try {
    result.seed = await seedContent(strapi, marker.manifest);
  } catch (e: any) {
    result.errors.push(`seed: ${e?.message ?? e}`);
  }
  try {
    result.permissions = await grantPublicRead(strapi, marker.manifest);
    if (result.permissions.errors.length) {
      result.errors.push(...result.permissions.errors.map((e) => `perm: ${e}`));
    }
  } catch (e: any) {
    result.errors.push(`permissões: ${e?.message ?? e}`);
  }
  try {
    result.link = linkFrontend(marker.manifest, {
      frontendDir: marker.frontendDir,
      strapiAppDir: marker.strapiAppDir,
      context: marker.context,
    });
  } catch (e: any) {
    result.errors.push(`link: ${e?.message ?? e}`);
  }

  // grava o resumo de conclusão para a UI anunciar "preview pronto".
  try {
    // mesma porta do runner (onde o dev server realmente sobe), p/ o preview bater.
    const previewUrl =
      marker.context.frontendUrl || `http://localhost:${FRONTEND_BASE_PORT}`;
    const done: ProvisionDone = {
      name: marker.manifest.name,
      framework: marker.manifest.framework,
      frontendDir: marker.frontendDir,
      contentTypes: marker.manifest.contentTypes.map((c) => apiUid(c.singularName)),
      previewUrl,
      seedCreated: result.seed?.created ?? [],
      linkErrors: result.link?.errors ?? [],
      finishedAt: new Date().toISOString(),
    };
    const dp = donePath(strapiAppDir);
    fs.mkdirSync(path.dirname(dp), { recursive: true });
    fs.writeFileSync(dp, JSON.stringify(done, null, 2), 'utf8');
  } catch (e: any) {
    result.errors.push(`resumo: ${e?.message ?? e}`);
  }

  // remove o marcador para não repetir (idempotência entre restarts)
  try {
    fs.unlinkSync(mp);
  } catch {
    /* ignore */
  }
  return result;
}
