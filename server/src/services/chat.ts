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
  /**
   * Política de publicação. `false` (default) = modo RASCUNHO: o agente edita o
   * draft e NÃO publica, a menos que o usuário peça explicitamente. `true` =
   * auto-publicar após cada edição (comportamento "live" antigo).
   */
  autoPublish?: boolean;
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
3. editar_campo passando o mesmo uid, documentId e path do resultado, com o novo valor. Isso salva como RASCUNHO (não publica).
4. Decida se publica ou não conforme a POLÍTICA DE PUBLICAÇÃO indicada mais abaixo.
5. Confirme em 1 frase o que foi alterado (content-type, campo, antes → depois) e se ficou como rascunho ou foi publicado.

Ferramentas de tradução / idiomas (i18n):
- listar_locales(): mostra os idiomas configurados e o default.
- criar_locale({code}): cria um idioma (code ISO, ex.: "pt-BR"). Idempotente.
- traduzir({target_locales, source_locale?, uid?, documentId?, publish?}): traduz o conteúdo localizado para um ou MAIS idiomas. Cria os locales se faltarem, traduz campo a campo (textos longos são divididos e remontados — não estoura) e publica. Sem uid/documentId, traduz TODAS as páginas.
- habilitar_i18n({uid?, campos?}): liga a tradução em content-types ainda não localizadas (a Strapi reinicia). OMITA uid para habilitar em TODAS de uma vez. NUNCA adivinhe uids — para o site inteiro, sempre sem uid.

Fluxo quando o usuário pede tradução (ex.: "quero o site todo em pt-BR"):
1. Chame traduzir com target_locales (lista de códigos). Não precisa criar o locale antes — traduzir já cria.
2. Se traduzir disser que NENHUMA content-type é localizada (i18n desligado), chame habilitar_i18n SEM uid (habilita todas de uma vez), avise que a Strapi vai reiniciar e que é só repetir o pedido após o restart. NÃO chame habilitar_i18n uid por uid nem invente nomes.
3. Após o restart, ao repetir, traduzir funciona e localiza tudo.
4. Confirme em 1 frase: idiomas, quantos documentos e campos foram traduzidos/publicados (use o resumo retornado, não despeje o conteúdo).

Draft & Publish: cada resultado de buscar_texto traz "draftAndPublish". Se for false, aquele tipo NÃO tem rascunho no Strapi — a edição já é o conteúdo vivo e NÃO há o que publicar; nesse caso, ao confirmar, avise que "esse conteúdo não tem rascunho, a alteração já está no ar" e NÃO chame publicar.

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
3. editar_campo passing the same uid, documentId and path from the result, with the new value. This saves a DRAFT (does not publish).
4. Decide whether to publish based on the PUBLISH POLICY stated below.
5. Confirm in one sentence what was changed (content-type, field, before → after) and whether it stayed a draft or was published.

Translation / language tools (i18n):
- listar_locales(): shows configured languages and the default.
- criar_locale({code}): creates a language (ISO code, e.g. "pt-BR"). Idempotent.
- traduzir({target_locales, source_locale?, uid?, documentId?, publish?}): translates localized content into one or MORE languages. It creates missing locales, translates field by field (long text is split and reassembled — never overflows) and publishes. Without uid/documentId it translates ALL pages.
- habilitar_i18n({uid?, campos?}): enables translation on content-types not localized yet (Strapi restarts). OMIT uid to enable ALL at once. NEVER guess uids — for the whole site, always call it without uid.

Flow when the user asks for translation (e.g. "I want the whole site in pt-BR"):
1. Call traduzir with target_locales (list of codes). No need to create the locale first — traduzir creates it.
2. If traduzir says NO content-type is localized (i18n off), call habilitar_i18n WITHOUT uid (enables all at once), warn that Strapi will restart and that they just need to repeat the request after the restart. Do NOT call habilitar_i18n per-uid or invent names.
3. After the restart, repeating the request makes traduzir localize everything.
4. Confirm in one sentence: languages, how many documents and fields were translated/published (use the returned summary, don't dump the content).

Draft & Publish: each buscar_texto result includes "draftAndPublish". If it is false, that type has NO draft in Strapi — the edit IS the live content and there is nothing to publish; in that case, when confirming, warn that "this content has no draft, the change is already live" and do NOT call publicar.

If the user shares their screen, an image is attached to the last message — use it to understand exactly what they see and which text they want to change.

Be concise and actionable. ALWAYS answer in English.`,
};

export default ({ strapi }: { strapi: any }) => ({
  async chat({ messages, image, lang = 'pt', previewUrl, autoPublish = false }: ChatInput) {
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
    // ── Política de publicação (draft-first por padrão) ───────────────────────
    const PUBLISH_POLICY: Record<Lang, string> = {
      pt: autoPublish
        ? `\n\nPOLÍTICA DE PUBLICAÇÃO: AUTO-PUBLICAR está LIGADO. Depois de editar_campo, chame publicar para deixar a mudança no ar. Em traduzir, use publish:true (default).`
        : `\n\nPOLÍTICA DE PUBLICAÇÃO: MODO RASCUNHO (auto-publicar DESLIGADO). NÃO chame publicar a menos que o usuário peça explicitamente ("publica", "põe no ar", "publish"). Depois de editar_campo, PARE e avise que a alteração foi salva como RASCUNHO para revisão (ela já aparece no preview em modo rascunho, mas ainda não no site público). Em traduzir, passe publish:false. Se o usuário pedir para publicar, aí sim use publicar (ou traduzir com publish:true).`,
      en: autoPublish
        ? `\n\nPUBLISH POLICY: AUTO-PUBLISH is ON. After editar_campo, call publicar to make the change live. For traduzir, use publish:true (default).`
        : `\n\nPUBLISH POLICY: DRAFT MODE (auto-publish OFF). Do NOT call publicar unless the user explicitly asks ("publish", "make it live", "publica"). After editar_campo, STOP and tell them the change was saved as a DRAFT for review (it already shows in the preview when in draft mode, but not on the public site yet). For traduzir, pass publish:false. If the user asks to publish, then use publicar (or traduzir with publish:true).`,
    };
    const systemContent =
      SYSTEM[language] + (hasBrowser ? BROWSER_NOTE[language] : '') + PUBLISH_POLICY[language];

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
