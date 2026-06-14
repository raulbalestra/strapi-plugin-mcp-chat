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

import { translateText } from './translate';

const TEXTUAL = ['string', 'text', 'richtext'];

export type EditarCampoArgs = {
  uid: string;
  documentId: string;
  path?: (string | number)[];
  campo?: string;
  novo_valor: string;
  /** Grava numa versão de locale específica (i18n). Omitido = locale default. */
  locale?: string;
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

  const editarCampo = async ({ uid, documentId, path, campo, novo_valor, locale }: EditarCampoArgs) => {
    const p = Array.isArray(path) && path.length ? path : campo ? [campo] : null;
    if (!p) return { erro: 'informe "path" (array) ou "campo"' };
    const attributes = strapi.contentTypes?.[uid]?.attributes || {};
    const topAttr = p[0] as string;
    const ad = attributes[topAttr];
    // `locale` só entra no payload quando informado — sem ele o Document Service
    // usa o locale default, preservando 100% o comportamento anterior.
    const loc = locale ? { locale } : {};

    // Campo simples no topo → update direto.
    if (p.length === 1 && ad && TEXTUAL.includes(ad.type)) {
      const updated = await strapi
        .documents(uid)
        .update({ documentId, ...loc, data: { [topAttr]: novo_valor } });
      return { ok: true, uid, documentId: updated?.documentId || documentId, path: p, novo_valor, locale };
    }

    // Campo aninhado → busca profunda, muta no caminho, sanitiza e regrava o
    // atributo de topo inteiro (preservando os outros componentes).
    const populate = buildPopulate(attributes);
    const entry = await strapi.documents(uid).findOne({ documentId, status: 'draft', ...loc, populate });
    if (!entry) return { erro: 'entrada não encontrada' };
    let cur: any = entry;
    for (let i = 0; i < p.length - 1; i++) {
      if (cur == null) break;
      cur = cur[p[i] as any];
    }
    if (cur == null) return { erro: `caminho inválido: ${p.join('.')}` };
    cur[p[p.length - 1] as any] = novo_valor;
    const data = { [topAttr]: sanitizeAttr(entry[topAttr], ad) };
    const updated = await strapi.documents(uid).update({ documentId, ...loc, data });
    return { ok: true, uid, documentId: updated?.documentId || documentId, path: p, novo_valor, locale };
  };

  const publicar = async ({
    uid,
    documentId,
    locale,
  }: {
    uid: string;
    documentId: string;
    /** Locale a publicar; "*" publica todos os locales disponíveis. */
    locale?: string;
  }) => {
    await strapi.documents(uid).publish({ documentId, ...(locale ? { locale } : {}) });
    return { ok: true, uid, documentId, status: 'published', locale };
  };

  // ── i18n: locales ─────────────────────────────────────────────────────────
  const i18nLocalesSvc = () => strapi.plugin?.('i18n')?.service?.('locales');
  const isoLocalesSvc = () => strapi.plugin?.('i18n')?.service?.('iso-locales');

  const listarLocales = async () => {
    const svc = i18nLocalesSvc();
    if (!svc) return { erro: 'plugin i18n indisponível' };
    const def = await svc.getDefaultLocale();
    const all = (await svc.find()) || [];
    return {
      default: def,
      locales: all.map((l: any) => ({ code: l.code, name: l.name, isDefault: l.code === def })),
    };
  };

  const criarLocale = async ({ code, name }: { code: string; name?: string }) => {
    const svc = i18nLocalesSvc();
    const iso = isoLocalesSvc();
    if (!svc || !iso) return { erro: 'plugin i18n indisponível' };
    const wanted = String(code || '').trim();
    if (!wanted) return { erro: 'informe o "code" do locale (ex.: "pt-BR")' };
    // Anti-alucinação: só aceita códigos da lista ISO oficial do próprio i18n.
    const list: { code: string; name: string }[] = iso.getIsoLocales();
    const match = list.find((l) => l.code.toLowerCase() === wanted.toLowerCase());
    if (!match) return { erro: `código de locale inválido: "${wanted}" (não está na lista ISO do Strapi)` };
    // Idempotente: se já existe, não recria.
    const existing = await svc.findByCode(match.code);
    if (existing) return { ok: true, code: match.code, name: existing.name, existed: true };
    const created = await svc.create({ code: match.code, name: name || match.name });
    return { ok: true, code: created.code, name: created.name, existed: false };
  };

  // ── i18n: tradução (o diferencial) ─────────────────────────────────────────
  type TransfCtx = { apiKey: string; src: string; tgt: string; bump: (chunks: number) => void };

  // Traduz E sanitiza um valor de atributo em uma só passada (espelha
  // sanitizeAttr, mas assíncrono e traduzindo os textos). Texto → traduzido;
  // componente/dz → recursivo; mídia/relação → id(s); escalar → cópia.
  const translateAttrValue = async (value: any, a: any, ctx: TransfCtx): Promise<any> => {
    if (value == null) return value;
    if (TEXTUAL.includes(a.type)) {
      const { text, chunks } = await translateText(ctx.apiKey, value, ctx.src, ctx.tgt, a.type);
      ctx.bump(chunks);
      return text;
    }
    if (a.type === 'component' && a.component) {
      const sub = attrsOf(a.component);
      return a.repeatable && Array.isArray(value)
        ? Promise.all(value.map((it) => translateNodeSanitized(it, sub, ctx)))
        : translateNodeSanitized(value, sub, ctx);
    }
    if (a.type === 'dynamiczone' && Array.isArray(value)) {
      return Promise.all(
        value.map(async (it) => ({
          __component: it.__component,
          ...(await translateNodeSanitized(it, attrsOf(it.__component), ctx)),
        }))
      );
    }
    return sanitizeAttr(value, a);
  };
  const translateNodeSanitized = async (node: any, attributes: Record<string, any>, ctx: TransfCtx): Promise<any> => {
    if (node == null) return node;
    const out: any = {};
    if (node.id != null) out.id = node.id;
    for (const [name, a] of Object.entries(attributes) as any[]) {
      if (node[name] === undefined) continue;
      out[name] = await translateAttrValue(node[name], a, ctx);
    }
    return out;
  };

  const isLocalizedCT = (ct: any) => ct?.pluginOptions?.i18n?.localized === true;
  const isLocalizedAttr = (a: any) => a?.pluginOptions?.i18n?.localized === true;

  const traduzir = async ({
    target_locales,
    source_locale,
    uid,
    documentId,
    publish = true,
  }: {
    target_locales: string | string[];
    source_locale?: string;
    uid?: string;
    documentId?: string;
    publish?: boolean;
  }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return { erro: 'OPENAI_API_KEY não configurada no .env do Strapi.' };
    const svc = i18nLocalesSvc();
    const iso = isoLocalesSvc();
    if (!svc || !iso) return { erro: 'plugin i18n indisponível' };

    const targets = (Array.isArray(target_locales) ? target_locales : [target_locales]).filter(Boolean);
    if (!targets.length) return { erro: 'informe target_locales (ex.: ["pt-BR","es"])' };

    const src = source_locale || (await svc.getDefaultLocale());
    const cts = (apiContentTypes() as any[]).filter(
      (ct) => isLocalizedCT(ct) && (!uid || ct.uid === uid)
    );
    if (!cts.length) {
      return {
        erro: uid
          ? `content-type "${uid}" não é localizada (i18n desligado). Habilite i18n nos campos antes de traduzir.`
          : 'nenhuma content-type localizada encontrada. Habilite i18n (pluginOptions.i18n.localized) nos campos a traduzir.',
      };
    }

    const isoList: { code: string; name: string }[] = iso.getIsoLocales();
    const nameOf = (code: string) =>
      isoList.find((l) => l.code.toLowerCase() === code.toLowerCase())?.name || code;

    const por_locale: any[] = [];
    // Dor 2: um passe INDEPENDENTE por locale. Nada acumula entre eles → resumível.
    for (const rawTgt of targets) {
      const created = await criarLocale({ code: rawTgt });
      if ((created as any).erro) {
        por_locale.push({ locale: rawTgt, erro: (created as any).erro });
        continue;
      }
      const tgt = (created as any).code as string;
      let documentos = 0;
      let campos = 0;
      let chunks = 0;
      let publicados = 0;

      for (const ct of cts) {
        const attributes = ct.attributes || {};
        const populate = buildPopulate(attributes);
        let res: any;
        try {
          res = await strapi
            .documents(ct.uid)
            .findMany({ status: 'draft', locale: src, populate, limit: 1000 });
        } catch {
          continue;
        }
        let entries: any[] = Array.isArray(res) ? res : res ? [res] : [];
        if (documentId) entries = entries.filter((e) => e.documentId === documentId);

        for (const e of entries) {
          const ctx: TransfCtx = {
            apiKey,
            src: nameOf(src),
            tgt: nameOf(tgt),
            bump: (c) => {
              campos += 1;
              chunks += c;
            },
          };
          const data: any = {};
          for (const [name, a] of Object.entries(attributes) as any[]) {
            if (!isLocalizedAttr(a)) continue; // só campos localizados; resto é compartilhado
            if (e[name] == null) continue;
            data[name] = await translateAttrValue(e[name], a, ctx);
          }
          if (!Object.keys(data).length) continue;
          // upsert idempotente da versão do locale
          await strapi.documents(ct.uid).update({ documentId: e.documentId, locale: tgt, data });
          documentos += 1;
          if (publish) {
            await strapi.documents(ct.uid).publish({ documentId: e.documentId, locale: tgt });
            publicados += 1;
          }
        }
      }
      por_locale.push({ locale: tgt, documentos, campos, chunks, publicados });
    }

    // Só números — nunca o conteúdo traduzido → não estoura o contexto do chat.
    return { ok: true, source: src, por_locale };
  };

  return { buscarTexto, editarCampo, publicar, listarLocales, criarLocale, traduzir };
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
        'Altera o valor de um campo (salva como rascunho). Use o "path" retornado por buscar_texto para campos aninhados; para campo simples no topo, pode usar "campo". Passe "locale" para gravar numa versão de idioma específica.',
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
          locale: { type: 'string', description: 'opcional; código do locale (ex.: "pt-BR")' },
        },
        required: ['uid', 'documentId', 'novo_valor'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'publicar',
      description: 'Publica a entrada (torna a alteração visível no site público). Passe "locale" para publicar um idioma específico, ou "*" para todos.',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string' },
          documentId: { type: 'string' },
          locale: { type: 'string', description: 'opcional; código do locale ou "*" para todos' },
        },
        required: ['uid', 'documentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'listar_locales',
      description: 'Lista os locales (idiomas) configurados no Strapi e qual é o default.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'criar_locale',
      description:
        'Cria um locale (idioma) no Strapi. O "code" precisa ser um código ISO válido (ex.: "pt-BR", "es", "fr"). Idempotente: se já existir, não recria.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'código ISO do locale, ex.: "pt-BR"' },
          name: { type: 'string', description: 'opcional; nome exibido (default = nome ISO)' },
        },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'traduzir',
      description:
        'Traduz o conteúdo localizado para um ou mais idiomas. Cria os locales se preciso, traduz campo a campo (textos longos são divididos e remontados — nunca estoura) e publica. Sem uid/documentId, traduz TODAS as content-types localizadas (todas as páginas). Funciona para muitos locales de uma vez.',
      parameters: {
        type: 'object',
        properties: {
          target_locales: {
            type: 'array',
            items: { type: 'string' },
            description: 'lista de códigos de destino, ex.: ["pt-BR","es","fr"]',
          },
          source_locale: { type: 'string', description: 'idioma de origem; default = locale default do Strapi' },
          uid: { type: 'string', description: 'opcional; restringe a uma content-type (ex.: api::home.home)' },
          documentId: { type: 'string', description: 'opcional; restringe a um documento' },
          publish: { type: 'boolean', description: 'publicar após traduzir (default true)' },
        },
        required: ['target_locales'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'habilitar_i18n',
      description:
        'Habilita i18n (tradução) numa content-type JÁ existente que ainda não é localizada: marca a CT e seus campos textuais como localizados. Necessário antes de traduzir conteúdo provisionado sem i18n. Edita o schema e a Strapi reinicia (em desenvolvimento).',
      parameters: {
        type: 'object',
        properties: {
          uid: { type: 'string', description: 'ex.: api::home.home' },
          campos: {
            type: 'array',
            items: { type: 'string' },
            description: 'opcional; campos a localizar (default = todos os textuais)',
          },
        },
        required: ['uid'],
      },
    },
  },
];
