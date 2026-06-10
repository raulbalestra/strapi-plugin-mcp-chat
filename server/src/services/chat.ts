/**
 * Serviço de chat: roda um loop de agente com a API da OpenAI (Chat Completions).
 *
 * Ferramentas disponíveis para a IA:
 *  - LEITURA (via MCP da própria instância): inspeciona content-types, componentes,
 *    serviços e info do Strapi.
 *  - ESCRITA (locais, via Document Service do Strapi): `buscar_texto` acha em qual
 *    content-type/single-type/campo está uma palavra; `editar_campo` troca o valor;
 *    `publicar` publica a entrada (deixa visível no site).
 *
 * Suporta entrada multimodal (frame da tela compartilhada vai como imagem) e
 * idioma configurável (pt | en) — afeta o prompt e o idioma das respostas.
 * Usa OPENAI_API_KEY. Modelo via OPENAI_CHAT_MODEL (default gpt-4o).
 */

import { McpClient } from '../mcp-client';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type Lang = 'pt' | 'en';
type ChatInput = {
  messages: ChatMessage[];
  image?: string | null;
  lang?: Lang;
  /** URL da página aberta no preview — contexto do "isso aqui". */
  previewUrl?: string | null;
};

const MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o';
const MAX_TURNS = 10;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const SYSTEM: Record<Lang, string> = {
  pt: `Você é um assistente embutido no admin do Strapi 5 deste projeto. Você NÃO é só um guia: você consegue EDITAR e PUBLICAR conteúdo de verdade através das ferramentas.

Ferramentas de LEITURA (MCP) descrevem content-types, componentes, serviços e info da instância — use para entender a estrutura.

Ferramentas de ESCRITA:
- buscar_texto({termo}): procura uma palavra ou frase em TODOS os content-types, single types, COMPONENTES e DYNAMIC ZONES (recursivo, por substring). Retorna uma lista; cada item tem uid, documentId, "path" (caminho até o campo, ex.: ["dynamic_zone",2,"heading"]), campo e valor_atual. Use SEMPRE isto primeiro — NÃO peça ao usuário onde está, ache sozinho. Busque um trecho distintivo e NÃO inclua rótulos que o preview adiciona, como "(Draft)"/"(Rascunho)".
- editar_campo({uid, documentId, path, novo_valor}): troca o valor de um campo (salva como rascunho). Passe o "path" EXATAMENTE como veio de buscar_texto.
- publicar({uid, documentId}): publica a entrada, deixando a mudança visível no site.

Fluxo padrão quando o usuário pede uma mudança no site (por texto, voz ou mostrando a tela):
1. Use buscar_texto com um trecho distintivo do texto a alterar (sem rótulos de status).
2. Se houver mais de um resultado, escolha o mais provável pelo contexto (e diga qual escolheu); se ambíguo de verdade, pergunte.
3. editar_campo passando o mesmo uid, documentId e path do resultado, com o novo valor.
4. publicar a entrada.
5. Confirme em 1 frase o que foi alterado e publicado (content-type, campo, antes → depois).

Se o usuário compartilhar a tela, uma imagem é anexada à última mensagem — use-a para entender exatamente o que ele está vendo e qual texto quer trocar.

Seja objetivo e acionável. Responda SEMPRE em português.`,
  en: `You are an assistant embedded in this project's Strapi 5 admin. You are NOT just a guide: you can actually EDIT and PUBLISH content through your tools.

READ tools (MCP) describe content-types, components, services and instance info — use them to understand the structure.

WRITE tools:
- buscar_texto({termo}): searches a word or phrase across ALL content-types, single types, COMPONENTS and DYNAMIC ZONES (recursive, substring). Returns a list; each item has uid, documentId, "path" (the path to the field, e.g. ["dynamic_zone",2,"heading"]), field and current value. ALWAYS use this first — do NOT ask the user where it is, find it yourself. Search a distinctive snippet and do NOT include labels the preview adds, like "(Draft)".
- editar_campo({uid, documentId, path, novo_valor}): replaces a field value (saved as draft). Pass the "path" EXACTLY as returned by buscar_texto.
- publicar({uid, documentId}): publishes the entry, making the change visible on the site.

Default flow when the user asks for a site change (by text, voice or by showing their screen):
1. Use buscar_texto with a distinctive snippet of the text to change (no status labels).
2. If there is more than one result, pick the most likely from context (and say which); if truly ambiguous, ask.
3. editar_campo passing the same uid, documentId and path from the result, with the new value.
4. publicar the entry.
5. Confirm in one sentence what was changed and published (content-type, field, before → after).

If the user shares their screen, an image is attached to the last message — use it to understand exactly what they see and which text they want to change.

Be concise and actionable. ALWAYS answer in English.`,
};

export default ({ strapi }: { strapi: any }) => ({
  async chat({ messages, image, lang = 'pt', previewUrl }: ChatInput) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY não configurada no .env do Strapi. Adicione e reinicie.'
      );
    }
    const language: Lang = lang === 'en' ? 'en' : 'pt';

    // ── Ferramentas de ESCRITA (Document Service do Strapi) ──────────────────
    const apiContentTypes = () =>
      Object.values(strapi.contentTypes as Record<string, any>).filter((ct: any) =>
        ct.uid?.startsWith('api::')
      );
    const TEXTUAL = ['string', 'text', 'richtext'];

    // Schema de atributos de um content-type OU componente, pelo uid.
    const attrsOf = (uid: string): Record<string, any> =>
      (strapi.contentTypes?.[uid]?.attributes ||
        strapi.components?.[uid]?.attributes ||
        {}) as Record<string, any>;

    // Monta populate profundo: components (simples/repetíveis), dynamic zones
    // (com `on` por componente) e mídia. `seen` evita recursão infinita.
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
          // Mídia e relações são populadas p/ preservá-las no round-trip de
          // escrita (são reduzidas a id(s) por sanitizeAttr na hora de gravar).
          populate[name] = true;
        }
      }
      return populate;
    };

    // Anda recursivamente no valor populado coletando campos textuais que casam
    // com a busca, guardando o `path` (ex.: ['dynamic_zone', 2, 'heading']).
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

    // Converte um nó populado de volta a uma forma gravável: preserva `id` (p/
    // Strapi atualizar o componente no lugar em vez de recriar), mídia/relações
    // viram id(s), e components/dynamic zones são tratados recursivamente.
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
        return Array.isArray(value)
          ? value.map((m) => m?.id).filter(Boolean)
          : value?.id ?? null;
      }
      if (a.type === 'relation') {
        return Array.isArray(value)
          ? value.map((r) => r?.id).filter(Boolean)
          : value?.id ?? null;
      }
      return value;
    };

    const editarCampo = async ({
      uid,
      documentId,
      path,
      campo,
      novo_valor,
    }: {
      uid: string;
      documentId: string;
      path?: (string | number)[];
      campo?: string;
      novo_valor: string;
    }) => {
      // Aceita `path` (array, p/ campos aninhados em components/dynamic zones)
      // ou `campo` (string, campo simples no topo — retrocompatível).
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

      // Campo aninhado → busca a entrada profunda, muta no caminho, sanitiza e
      // regrava o atributo de topo inteiro (preservando os outros componentes).
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

    const LOCAL_TOOLS: Record<string, (args: any) => Promise<any>> = {
      buscar_texto: (a) => buscarTexto(a?.termo),
      editar_campo: (a) => editarCampo(a),
      publicar: (a) => publicar(a),
    };

    const localToolSpecs = [
      {
        type: 'function',
        function: {
          name: 'buscar_texto',
          description:
            'Procura uma palavra/frase em TODOS os content-types, single types, COMPONENTES e DYNAMIC ZONES do Strapi (busca por substring, recursiva). Cada resultado traz uid, documentId, "path" (caminho até o campo, ex.: ["dynamic_zone",2,"heading"]), campo e valor_atual. Passe esse mesmo "path" para editar_campo.',
          parameters: {
            type: 'object',
            properties: { termo: { type: 'string', description: 'trecho distintivo do texto a localizar; NÃO inclua rótulos de status que o preview adiciona, como "(Draft)" ou "(Rascunho)"' } },
            required: ['termo'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'editar_campo',
          description:
            'Altera o valor de um campo de uma entrada (salva como rascunho). Use o "path" retornado por buscar_texto para campos aninhados em componentes/dynamic zones. Para um campo simples no topo, pode usar "campo".',
          parameters: {
            type: 'object',
            properties: {
              uid: { type: 'string' },
              documentId: { type: 'string' },
              path: {
                type: 'array',
                description:
                  'caminho até o campo, exatamente como veio de buscar_texto (ex.: ["dynamic_zone",2,"heading"]). Strings são nomes de campo; números são índices em arrays/dynamic zones.',
                items: { type: ['string', 'number'] },
              },
              campo: { type: 'string', description: 'alternativa ao path, só para campo simples no topo do content-type' },
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

    // ── Ferramentas de MCP (vários servidores) ───────────────────────────────
    // 1) Strapi MCP (LEITURA da estrutura) — sempre, na própria instância.
    // 2) Playwright MCP (CONTROLE DE BROWSER) — só se PLAYWRIGHT_MCP_URL existir.
    //    Roteamos cada tool para o client que a expôs via `mcpByTool`.
    const mcpByTool: Record<string, McpClient> = {};
    const mcpTools: any[] = [];

    const mcpSources: Array<{ url?: string; name: string }> = [
      { name: 'strapi' }, // URL default (MCP da própria Strapi)
    ];
    if (process.env.PLAYWRIGHT_MCP_URL) {
      mcpSources.push({ url: process.env.PLAYWRIGHT_MCP_URL, name: 'playwright' });
    }

    for (const src of mcpSources) {
      try {
        const client = new McpClient(src.url, src.name);
        await client.init();
        const list = await client.listTools();
        for (const t of list) {
          // Em colisão de nome, o primeiro client a registrar vence.
          if (mcpByTool[t.name]) continue;
          mcpByTool[t.name] = client;
          mcpTools.push(t);
        }
        strapi.log.info(`[mcp-chat] MCP "${src.name}" ok: ${list.length} tools`);
      } catch (e: any) {
        strapi.log.warn(
          `[mcp-chat] MCP "${src.name}" indisponível: ${e?.message || e}`
        );
      }
    }

    const tools: any[] = [
      ...localToolSpecs,
      ...mcpTools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || t.name,
          parameters: t.inputSchema || { type: 'object', properties: {} },
        },
      })),
    ];

    // Adendo de browser: só quando o Playwright MCP expôs suas tools.
    const hasBrowser = mcpTools.some((t) => String(t.name).startsWith('browser_'));
    // O navegador da IA opera o ADMIN DA STRAPI (o backend) — é onde o conteúdo
    // muda de verdade. Não é o iframe de preview do frontend.
    const adminBase = process.env.STRAPI_ADMIN_URL || 'http://localhost:1337/admin';
    const BROWSER_NOTE: Record<Lang, string> = {
      pt: `\n\nVocê também controla um navegador real via ferramentas browser_* (Playwright), apontado para o ADMIN DA STRAPI em ${adminBase} (o backend — é aqui que o conteúdo muda de verdade, NÃO no site público). Pode navegar (browser_navigate), clicar, digitar, rolar, tirar seus próprios screenshots (browser_take_screenshot) e inspecionar console/erros. Prefira sempre suas ferramentas diretas (buscar_texto/editar_campo/publicar) para alterar conteúdo; use o navegador para VERIFICAR no admin que a edição/publicação ficou correta, ou para fluxos da UI que as ferramentas diretas não cobrem.`,
      en: `\n\nYou also control a real browser via browser_* tools (Playwright), pointed at the STRAPI ADMIN at ${adminBase} (the backend — this is where content actually changes, NOT the public site). You can navigate (browser_navigate), click, type, scroll, take your own screenshots (browser_take_screenshot) and inspect console/errors. Always prefer your direct tools (buscar_texto/editar_campo/publicar) to change content; use the browser to VERIFY in the admin that the edit/publish landed, or for admin UI flows the direct tools don't cover.`,
    };
    const systemContent = SYSTEM[language] + (hasBrowser ? BROWSER_NOTE[language] : '');

    // ── Monta a conversa; anexa imagem da tela à última mensagem do usuário ──
    const convo: any[] = [{ role: 'system', content: systemContent }];
    const pageNote =
      previewUrl
        ? language === 'en'
          ? `\n\n[context: the user is viewing the page ${previewUrl} in the preview right now — assume "this/here" refers to what's on that page]`
          : `\n\n[contexto: o usuário está vendo a página ${previewUrl} no preview agora — assuma que "isso/aqui" se refere ao que está nessa página]`
        : '';
    messages.forEach((m, i) => {
      const isLastUser = i === messages.length - 1 && m.role === 'user';
      if (isLastUser) {
        const text = (m.content || '') + pageNote;
        if (image) {
          convo.push({
            role: 'user',
            content: [
              { type: 'text', text: text || '(veja minha tela)' },
              { type: 'image_url', image_url: { url: image } },
            ],
          });
        } else {
          convo.push({ role: 'user', content: text || m.content });
        }
      } else {
        convo.push({ role: m.role, content: m.content });
      }
    });

    const callOpenAI = async (body: any) => {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`OpenAI chat: ${await res.text()}`);
      return res.json() as Promise<any>;
    };

    // ── Loop de agente ────────────────────────────────────────────────────────
    let didWrite = false;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const data = await callOpenAI({
        model: MODEL,
        max_tokens: 2048,
        messages: convo,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
      });

      const msg = data.choices?.[0]?.message;
      if (!msg) throw new Error('OpenAI: resposta sem message.');
      convo.push(msg);

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const call of msg.tool_calls) {
          const name = call.function?.name;
          let content: string;
          try {
            const argsStr = call.function?.arguments || '{}';
            const args = argsStr ? JSON.parse(argsStr) : {};
            const local = LOCAL_TOOLS[name];
            const owner = mcpByTool[name];
            let r: any;
            if (local) {
              r = await local(args);
              if (name === 'editar_campo' || name === 'publicar') didWrite = true;
              strapi.log.info(`[mcp-chat] tool ${name} -> ${JSON.stringify(r).slice(0, 200)}`);
            } else if (owner) {
              r = await owner.callTool(name, args);
            } else {
              r = { erro: `tool ${name} indisponível` };
            }
            content = typeof r === 'string' ? r : JSON.stringify(r);
          } catch (e: any) {
            content = `Erro ao chamar a tool ${name}: ${e?.message || e}`;
          }
          convo.push({ role: 'tool', tool_call_id: call.id, content });
        }
        continue;
      }

      const text = (typeof msg.content === 'string' ? msg.content : '').trim();
      return {
        reply: text || '(sem resposta)',
        model: MODEL,
        lang: language,
        didWrite,
        toolsAvailable: tools.length,
      };
    }

    return {
      reply:
        language === 'en'
          ? '(agent turn limit reached)'
          : '(limite de turnos do agente atingido)',
      model: MODEL,
      lang: language,
      didWrite,
      toolsAvailable: tools.length,
    };
  },
});
