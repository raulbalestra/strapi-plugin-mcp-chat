/**
 * Ferramentas de conteúdo (Document Service) — a "carne" do plugin.
 *
 * Mesma implementação usada em DOIS lugares:
 *  1. registrada no MCP NATIVO da Strapi (server/src/mcp.ts → strapi.ai.mcp),
 *     ficando disponível para qualquer cliente MCP (Cursor, etc.);
 *  2. chamada in-process pelo chat do admin (server/src/services/chat.ts).
 *
 * Diferencial em relação às tools genéricas do MCP: busca/edição RECURSIVA de
 * texto aninhado em componentes e dynamic zones, devolvendo um `path` que a
 * edição aplica preservando os demais componentes.
 */

const TEXTUAL = ['string', 'text', 'richtext'];

export type EditarCampoArgs = {
  uid: string;
  documentId: string;
  path?: (string | number)[];
  campo?: string;
  novo_valor: string;
};

export function createContentTools(strapi: any) {
  const apiContentTypes = () =>
    Object.values(strapi.contentTypes as Record<string, any>).filter((ct: any) =>
      ct.uid?.startsWith('api::')
    );

  // Schema de atributos de um content-type OU componente, pelo uid.
  const attrsOf = (uid: string): Record<string, any> =>
    (strapi.contentTypes?.[uid]?.attributes ||
      strapi.components?.[uid]?.attributes ||
      {}) as Record<string, any>;

  // Populate profundo: components (simples/repetíveis), dynamic zones (com `on`
  // por componente) e mídia/relações. `seen` evita recursão infinita.
  const buildPopulate = (attributes: Record<string, any>, seen = new Set<string>()): any => {
    const populate: any = {};
    for (const [name, a] of Object.entries(attributes) as any[]) {
      if (a.type === 'component' && a.component) {
        const sub = seen.has(a.component)
          ? {}
          : buildPopulate(attrsOf(a.component), new Set(seen).add(a.component));
        populate[name] = Object.keys(sub).length ? { populate: sub } : true;
      } else if (a.type === 'dynamiczone') {
        const on: any = {};
        for (const comp of a.components || []) {
          const sub = seen.has(comp)
            ? {}
            : buildPopulate(attrsOf(comp), new Set(seen).add(comp));
          on[comp] = Object.keys(sub).length ? { populate: sub } : true;
        }
        populate[name] = { on };
      } else if (a.type === 'media' || a.type === 'relation') {
        populate[name] = true;
      }
    }
    return populate;
  };

  const walkFind = (
    node: any,
    attributes: Record<string, any>,
    basePath: (string | number)[],
    needle: string,
    collect: (path: (string | number)[], campo: string, valor: string) => void
  ) => {
    if (!node || typeof node !== 'object') return;
    for (const [name, a] of Object.entries(attributes) as any[]) {
      const v = node[name];
      if (v == null) continue;
      const path = [...basePath, name];
      if (TEXTUAL.includes(a.type)) {
        if (typeof v === 'string' && v.toLowerCase().includes(needle)) {
          collect(path, name, v);
        }
      } else if (a.type === 'component' && a.component) {
        const sub = attrsOf(a.component);
        if (a.repeatable && Array.isArray(v)) {
          v.forEach((item, i) => walkFind(item, sub, [...path, i], needle, collect));
        } else {
          walkFind(v, sub, path, needle, collect);
        }
      } else if (a.type === 'dynamiczone' && Array.isArray(v)) {
        v.forEach((item, i) => {
          if (item?.__component) {
            walkFind(item, attrsOf(item.__component), [...path, i], needle, collect);
          }
        });
      }
    }
  };

  const buscarTexto = async (termo: string) => {
    const needle = String(termo || '').toLowerCase().trim();
    if (!needle) return { erro: 'termo vazio' };
    const matches: any[] = [];
    for (const ct of apiContentTypes() as any[]) {
      const attributes = ct.attributes || {};
      const populate = buildPopulate(attributes);
      let entries: any[] = [];
      try {
        const res = await strapi
          .documents(ct.uid)
          .findMany({ status: 'draft', populate, limit: 200 });
        entries = Array.isArray(res) ? res : res ? [res] : [];
      } catch {
        continue;
      }
      for (const e of entries) {
        walkFind(e, attributes, [], needle, (path, campo, valor) => {
          matches.push({
            uid: ct.uid,
            tipo: ct.info?.displayName || ct.uid,
            documentId: e.documentId,
            path,
            campo,
            valor_atual: valor.length > 300 ? valor.slice(0, 300) + '…' : valor,
          });
        });
      }
    }
    return { total: matches.length, resultados: matches };
  };

  // Converte um nó populado de volta a forma gravável: preserva `id` (p/ Strapi
  // atualizar o componente no lugar), mídia/relações viram id(s).
  const sanitizeNode = (node: any, attributes: Record<string, any>): any => {
    if (node == null) return node;
    const out: any = {};
    if (node.id != null) out.id = node.id;
    for (const [name, a] of Object.entries(attributes) as any[]) {
      const v = node[name];
      if (v === undefined) continue;
      out[name] = sanitizeAttr(v, a);
    }
    return out;
  };
  const sanitizeAttr = (value: any, a: any): any => {
    if (value == null) return value;
    if (a.type === 'component' && a.component) {
      const sub = attrsOf(a.component);
      return a.repeatable && Array.isArray(value)
        ? value.map((it) => sanitizeNode(it, sub))
        : sanitizeNode(value, sub);
    }
    if (a.type === 'dynamiczone' && Array.isArray(value)) {
      return value.map((it) => ({
        __component: it.__component,
        ...sanitizeNode(it, attrsOf(it.__component)),
      }));
    }
    if (a.type === 'media') {
      return Array.isArray(value) ? value.map((m) => m?.id).filter(Boolean) : value?.id ?? null;
    }
    if (a.type === 'relation') {
      return Array.isArray(value) ? value.map((r) => r?.id).filter(Boolean) : value?.id ?? null;
    }
    return value;
  };

  const editarCampo = async ({ uid, documentId, path, campo, novo_valor }: EditarCampoArgs) => {
    const p = Array.isArray(path) && path.length ? path : campo ? [campo] : null;
    if (!p) return { erro: 'informe "path" (array) ou "campo"' };
    const attributes = strapi.contentTypes?.[uid]?.attributes || {};
    const topAttr = p[0] as string;
    const ad = attributes[topAttr];

    // Campo simples no topo → update direto.
    if (p.length === 1 && ad && TEXTUAL.includes(ad.type)) {
      const updated = await strapi
        .documents(uid)
        .update({ documentId, data: { [topAttr]: novo_valor } });
      return { ok: true, uid, documentId: updated?.documentId || documentId, path: p, novo_valor };
    }

    // Campo aninhado → busca profunda, muta no caminho, sanitiza e regrava o
    // atributo de topo inteiro (preservando os outros componentes).
    const populate = buildPopulate(attributes);
    const entry = await strapi.documents(uid).findOne({ documentId, status: 'draft', populate });
    if (!entry) return { erro: 'entrada não encontrada' };
    let cur: any = entry;
    for (let i = 0; i < p.length - 1; i++) {
      if (cur == null) break;
      cur = cur[p[i] as any];
    }
    if (cur == null) return { erro: `caminho inválido: ${p.join('.')}` };
    cur[p[p.length - 1] as any] = novo_valor;
    const data = { [topAttr]: sanitizeAttr(entry[topAttr], ad) };
    const updated = await strapi.documents(uid).update({ documentId, data });
    return { ok: true, uid, documentId: updated?.documentId || documentId, path: p, novo_valor };
  };

  const publicar = async ({ uid, documentId }: { uid: string; documentId: string }) => {
    await strapi.documents(uid).publish({ documentId });
    return { ok: true, uid, documentId, status: 'published' };
  };

  return { buscarTexto, editarCampo, publicar };
}

/** Specs no formato de tools da OpenAI (usado pelo agent loop do chat). */
export const openAiToolSpecs = [
  {
    type: 'function',
    function: {
      name: 'buscar_texto',
      description:
        'Procura uma palavra/frase em TODOS os content-types, single types, COMPONENTES e DYNAMIC ZONES do Strapi (substring, recursivo). Cada resultado traz uid, documentId, "path" (ex.: ["dynamic_zone",2,"heading"]), campo e valor_atual. Passe esse "path" para editar_campo.',
      parameters: {
        type: 'object',
        properties: {
          termo: {
            type: 'string',
            description:
              'trecho distintivo do texto a localizar; NÃO inclua rótulos de status do preview, como "(Draft)"/"(Rascunho)"',
          },
        },
        required: ['termo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'editar_campo',
      description:
        'Altera o valor de um campo (salva como rascunho). Use o "path" retornado por buscar_texto para campos aninhados; para campo simples no topo, pode usar "campo".',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string' },
          documentId: { type: 'string' },
          path: {
            type: 'array',
            description: 'caminho até o campo, exatamente como veio de buscar_texto',
            items: { type: ['string', 'number'] },
          },
          campo: { type: 'string', description: 'alternativa ao path (campo simples no topo)' },
          novo_valor: { type: 'string' },
        },
        required: ['uid', 'documentId', 'novo_valor'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publicar',
      description: 'Publica a entrada (torna a alteração visível no site público).',
      parameters: {
        type: 'object',
        properties: { uid: { type: 'string' }, documentId: { type: 'string' } },
        required: ['uid', 'documentId'],
      },
    },
  },
];
