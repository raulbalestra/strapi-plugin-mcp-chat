import type { Manifest } from './manifest';
import { apiUid } from './generate';

/**
 * Seed: popula o conteúdo declarado em `manifest.seed` usando o Document Service
 * da Strapi 5 (a API correta no v5 — nada de entityService legado).
 *
 * Roda DEPOIS do restart, quando os content-types já existem. Princípios:
 *  - Idempotente: só semeia se ainda estiver VAZIO. Re-rodar não duplica.
 *  - Aditivo: nunca apaga nem altera conteúdo existente.
 *  - Publica por padrão (status 'published') para o frontend já enxergar o
 *    conteúdo — mas só se o type tiver draftAndPublish; senão cria direto.
 *  - Cobre collectionType (vários) e singleType (a única entrada).
 */

export interface SeedResult {
  ok: boolean;
  created: { uid: string; count: number }[];
  skipped: { uid: string; reason: string }[];
  errors: string[];
}

export async function seedContent(
  strapi: any,
  manifest: Manifest
): Promise<SeedResult> {
  const result: SeedResult = {
    ok: false,
    created: [],
    skipped: [],
    errors: [],
  };

  if (!manifest.seed?.length) {
    result.ok = true;
    return result;
  }

  // índice singularName -> definição da content-type (para saber kind/D&P)
  const byName = new Map(
    manifest.contentTypes.map((ct) => [ct.singularName, ct])
  );

  for (const group of manifest.seed) {
    const uid = apiUid(group.singularName);
    const def = byName.get(group.singularName);

    if (!def) {
      result.skipped.push({
        uid,
        reason: 'singularName não consta em contentTypes',
      });
      continue;
    }

    if (!strapi.contentTypes?.[uid]) {
      result.skipped.push({
        uid,
        reason: 'content-type ainda não registrada (faltou restart?)',
      });
      continue;
    }

    // cria uma entrada e publica (publish() é o passo confiável na 5.47.1;
    // create({status:'published'}) não publica de fato nesta versão).
    const createOne = async (data: any) => {
      const doc = await strapi.documents(uid).create({ data });
      if (def.draftAndPublish && doc?.documentId) {
        await strapi.documents(uid).publish({ documentId: doc.documentId });
      }
    };

    try {
      if (def.kind === 'singleType') {
        // single type: só a primeira entrada; pula se já existir conteúdo.
        const current = await strapi.documents(uid).findFirst();
        if (current) {
          result.skipped.push({ uid, reason: 'single type já tem conteúdo' });
          continue;
        }
        if (group.entries[0]) {
          await createOne(group.entries[0]);
          result.created.push({ uid, count: 1 });
        }
        continue;
      }

      // collection: idempotente — só semeia se vazia
      const existing = await strapi.documents(uid).findMany({ limit: 1 });
      if (Array.isArray(existing) && existing.length > 0) {
        result.skipped.push({ uid, reason: 'coleção já tem conteúdo' });
        continue;
      }
      // resiliente: uma entrada ruim não derruba as outras
      let count = 0;
      let failed = 0;
      for (const data of group.entries) {
        try {
          await createOne(data);
          count++;
        } catch (e: any) {
          failed++;
          if (failed === 1) result.errors.push(`seed ${uid} (entrada): ${e?.message ?? e}`);
        }
      }
      result.created.push({ uid, count });
      if (failed) result.skipped.push({ uid, reason: `${failed} entrada(s) falharam` });
    } catch (e: any) {
      result.errors.push(`seed ${uid}: ${e?.message ?? e}`);
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}
