import type { Manifest } from './manifest';
import { apiUid } from './generate';

/**
 * Concede leitura pública (find / findOne) ao papel "public" para as content-types
 * recém-criadas — sem isso o frontend recebe 403 e o preview fica vazio. Faz parte
 * do "ligar o preview". É idempotente (não duplica permissões já existentes) e
 * só toca nas content-types do manifest (nunca mexe em outras).
 *
 * Single types expõem só `find`; collection types expõem `find` e `findOne`.
 */
export interface PermissionsResult {
  granted: string[];
  errors: string[];
}

export async function grantPublicRead(
  strapi: any,
  manifest: Manifest
): Promise<PermissionsResult> {
  const result: PermissionsResult = { granted: [], errors: [] };

  let publicRole: any;
  try {
    publicRole = await strapi
      .query('plugin::users-permissions.role')
      .findOne({ where: { type: 'public' } });
  } catch (e: any) {
    result.errors.push(`papel public: ${e?.message ?? e}`);
    return result;
  }
  if (!publicRole) {
    result.errors.push('papel "public" não encontrado (users-permissions ativo?)');
    return result;
  }

  for (const ct of manifest.contentTypes) {
    const uid = apiUid(ct.singularName);
    const actions = ct.kind === 'singleType' ? ['find'] : ['find', 'findOne'];
    for (const action of actions) {
      const actionId = `${uid}.${action}`;
      try {
        const existing = await strapi
          .query('plugin::users-permissions.permission')
          .findOne({ where: { action: actionId, role: publicRole.id } });
        if (!existing) {
          await strapi
            .query('plugin::users-permissions.permission')
            .create({ data: { action: actionId, role: publicRole.id } });
          result.granted.push(actionId);
        }
      } catch (e: any) {
        result.errors.push(`${actionId}: ${e?.message ?? e}`);
      }
    }
  }
  return result;
}
