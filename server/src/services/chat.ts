/**
 * Serviço de chat: roda um loop de agente com a API da OpenAI (Chat Completions).
 *
 * Ferramentas da IA:
 *  - CONTEÚDO (in-process, via Document Service): `buscar_texto` acha onde uma
 *    palavra está (inclusive aninhada em componentes/dynamic zones), `editar_campo`
 *    troca o valor pelo `path`, `publicar` publica. São as MESMAS funções
 *    registradas no MCP nativo da Strapi (server/src/mcp.ts) — aqui chamadas
 *    direto, sem HTTP nem token.
 *  - BROWSER (opcional): Playwright MCP, só se PLAYWRIGHT_MCP_URL existir.
 *
 * Suporta entrada multimodal (frame da tela vai como imagem) e idioma (pt | en).
 * Usa OPENAI_API_KEY. Modelo via OPENAI_CHAT_MODEL (default gpt-4o).
 */

import { McpClient } from '../mcp-client';
import { createContentTools, openAiToolSpecs } from '../content-tools';
import { enableI18n } from '../provision/enable-i18n';

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

Ferramentas de conteúdo:
- buscar_texto({termo}): procura uma palavra ou frase em TODOS os content-types, single types, COMPONENTES e DYNAMIC ZONES (recursivo, por substring). Retorna uma lista; cada item tem uid, documentId, "path" (caminho até o campo, ex.: ["dynamic_zone",2,"heading"]), campo e valor_atual. Use SEMPRE isto primeiro — NÃO peça ao usuário onde está, ache sozinho. Busque um trecho distintivo e NÃO inclua rótulos que o preview adiciona, como "(Draft)"/"(Rascunho)".
- editar_campo({uid, documentId, path, novo_valor}): troca o valor de um campo (salva como rascunho). Passe o "path" EXATAMENTE como veio de buscar_texto.
- publicar({uid, documentId}): publica a entrada, deixando a mudança visível no site.

Fluxo padrão quando o usuário pede uma mudança no site (por texto, voz ou mostrando a tela):
1. Use buscar_texto com um trecho distintivo do texto a alterar (sem rótulos de status).
2. Se houver mais de um resultado, escolha o mais provável pelo contexto (e diga qual escolheu); se ambíguo de verdade, pergunte.
3. editar_campo passando o mesmo uid, documentId e path do resultado, com o novo valor.
4. publicar a entrada.
5. Confirme em 1 frase o que foi alterado e publicado (content-type, campo, antes → depois).

Ferramentas de tradução / idiomas (i18n):
- listar_locales(): mostra os idiomas configurados e o default.
- criar_locale({code}): cria um idioma (code ISO, ex.: "pt-BR"). Idempotente.
- traduzir({target_locales, source_locale?, uid?, documentId?, publish?}): traduz o conteúdo localizado para um ou MAIS idiomas. Cria os locales se faltarem, traduz campo a campo (textos longos são divididos e remontados — não estoura) e publica. Sem uid/documentId, traduz TODAS as páginas.
- habilitar_i18n({uid, campos?}): liga a tradução numa content-type que ainda não é localizada (a Strapi reinicia).

Fluxo quando o usuário pede tradução (ex.: "traduza o site para pt-BR e espanhol"):
1. Chame traduzir com target_locales (lista de códigos). Não precisa criar o locale antes — traduzir já cria.
2. Se traduzir responder que a content-type não é localizada, chame habilitar_i18n nela (avise que a Strapi vai reiniciar) e peça para o usuário repetir após o restart.
3. Confirme em 1 frase: idiomas, quantos documentos e campos foram traduzidos/publicados (use o resumo retornado, não despeje o conteúdo).

Se o usuário compartilhar a tela, uma imagem é anexada à última mensagem — use-a para entender exatamente o que ele está vendo e qual texto quer trocar.

Seja objetivo e acionável. Responda SEMPRE em português.`,
  en: `You are an assistant embedded in this project's Strapi 5 admin. You are NOT just a guide: you can actually EDIT and PUBLISH content through your tools.

Content tools:
- buscar_texto({termo}): searches a word or phrase across ALL content-types, single types, COMPONENTS and DYNAMIC ZONES (recursive, substring). Returns a list; each item has uid, documentId, "path" (the path to the field, e.g. ["dynamic_zone",2,"heading"]), field and current value. ALWAYS use this first — do NOT ask the user where it is, find it yourself. Search a distinctive snippet and do NOT include labels the preview adds, like "(Draft)".
- editar_campo({uid, documentId, path, novo_valor}): replaces a field value (saved as draft). Pass the "path" EXACTLY as returned by buscar_texto.
- publicar({uid, documentId}): publishes the entry, making the change visible on the site.

Default flow when the user asks for a site change (by text, voice or by showing their screen):
1. Use buscar_texto with a distinctive snippet of the text to change (no status labels).
2. If there is more than one result, pick the most likely from context (and say which); if truly ambiguous, ask.
3. editar_campo passing the same uid, documentId and path from the result, with the new value.
4. publicar the entry.
5. Confirm in one sentence what was changed and published (content-type, field, before → after).

Translation / language tools (i18n):
- listar_locales(): shows configured languages and the default.
- criar_locale({code}): creates a language (ISO code, e.g. "pt-BR"). Idempotent.
- traduzir({target_locales, source_locale?, uid?, documentId?, publish?}): translates localized content into one or MORE languages. It creates missing locales, translates field by field (long text is split and reassembled — never overflows) and publishes. Without uid/documentId it translates ALL pages.
- habilitar_i18n({uid, campos?}): enables translation on a content-type that isn't localized yet (Strapi restarts).

Flow when the user asks for translation (e.g. "translate the site to pt-BR and Spanish"):
1. Call traduzir with target_locales (list of codes). No need to create the locale first — traduzir creates it.
2. If traduzir says the content-type isn't localized, call habilitar_i18n on it (warn that Strapi will restart) and ask the user to retry after the restart.
3. Confirm in one sentence: languages, how many documents and fields were translated/published (use the returned summary, don't dump the content).

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

    // ── Ferramentas de conteúdo (in-process; as MESMAS registradas no MCP nativo) ──
    const { buscarTexto, editarCampo, publicar, listarLocales, criarLocale, traduzir } =
      createContentTools(strapi);
    const LOCAL_TOOLS: Record<string, (args: any) => Promise<any>> = {
      buscar_texto: (a) => buscarTexto(a?.termo),
      editar_campo: (a) => editarCampo(a),
      publicar: (a) => publicar(a),
      listar_locales: () => listarLocales(),
      criar_locale: (a) => criarLocale(a),
      traduzir: (a) => traduzir(a),
      habilitar_i18n: async (a) => enableI18n({ strapi, uid: a?.uid, campos: a?.campos }),
    };
    const localToolSpecs = openAiToolSpecs;

    // ── Playwright MCP (CONTROLE DE BROWSER) — só se PLAYWRIGHT_MCP_URL existir ──
    const mcpByTool: Record<string, McpClient> = {};
    const mcpTools: any[] = [];
    if (process.env.PLAYWRIGHT_MCP_URL) {
      try {
        const client = new McpClient(process.env.PLAYWRIGHT_MCP_URL, 'playwright');
        await client.init();
        const list = await client.listTools();
        for (const t of list) {
          if (mcpByTool[t.name]) continue;
          mcpByTool[t.name] = client;
          mcpTools.push(t);
        }
        strapi.log.info(`[mcp-chat] MCP "playwright" ok: ${list.length} tools`);
      } catch (e: any) {
        strapi.log.warn(`[mcp-chat] MCP "playwright" indisponível: ${e?.message || e}`);
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
              if (['editar_campo', 'publicar', 'criar_locale', 'traduzir', 'habilitar_i18n'].includes(name))
                didWrite = true;
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
