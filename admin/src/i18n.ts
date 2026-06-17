/**
 * i18n leve para as PÁGINAS DO PLUGIN no menu esquerdo (Home + Provisionar).
 *
 * Não usa o sistema de traduções do admin de propósito: estas páginas são
 * autossuficientes e o idioma é escolhido por um seletor próprio, persistido em
 * `localStorage` sob a MESMA chave do chat flutuante (`mcp-chat-lang`), para que
 * o plugin inteiro siga um único idioma. Default: inglês.
 */
import { useEffect, useState } from 'react';

export type Lang = 'pt' | 'en';

const LS_KEY = 'mcp-chat-lang';

export const getLang = (): Lang => {
  try {
    return (localStorage.getItem(LS_KEY) as Lang) === 'pt' ? 'pt' : 'en';
  } catch {
    return 'en';
  }
};

/** Hook: idioma atual + setter persistido + sincronização entre abas/componentes. */
export const useLang = (): [Lang, (l: Lang) => void] => {
  const [lang, setLangState] = useState<Lang>(getLang);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LS_KEY) setLangState(getLang());
    };
    // evento custom para sincronizar componentes na MESMA aba
    const onLocal = () => setLangState(getLang());
    window.addEventListener('storage', onStorage);
    window.addEventListener('mcp-chat-lang-change', onLocal);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('mcp-chat-lang-change', onLocal);
    };
  }, []);

  const setLang = (l: Lang) => {
    try { localStorage.setItem(LS_KEY, l); } catch { /* noop */ }
    setLangState(l);
    try { window.dispatchEvent(new Event('mcp-chat-lang-change')); } catch { /* noop */ }
  };

  return [lang, setLang];
};

type Dict = Record<string, string>;

export const STRINGS: Record<Lang, Dict> = {
  en: {
    // Home
    'home.title': 'MCP Chat',
    'home.subtitle': 'AI via MCP',
    'home.seeingScreen': '• seeing your screen',
    'home.voiceOn': '• voice ON',
    'home.voiceBtnOn': 'Voice: ON',
    'home.voiceBtnOff': 'Voice: OFF',
    'home.shareStop': 'Stop screen',
    'home.shareStart': 'Share screen',
    'home.provision': 'Provision frontend',
    'home.previewOn': 'Live Preview: ON',
    'home.previewOff': 'Live Preview: OFF',
    'home.empty': 'Type, speak (🎤) or share your screen. E.g.: “Which content-types exist?”.',
    'home.you': 'You',
    'home.ai': 'AI',
    'home.processing': 'Processing…',
    'home.rec': '🎤 Speak',
    'home.recStop': '⏹ Stop',
    'home.placeholder': 'Type… (Cmd/Ctrl+Enter sends)',
    'home.send': 'Send',
    'home.reload': 'Reload',
    'home.previewUrlLabel': 'Preview URL',
    'home.errShare': 'Could not start screen sharing.',
    'home.errMic': 'Could not access the microphone.',
    'home.errStt': 'Transcription error.',
    'home.errAudioEmpty': 'I could not understand the audio.',
    'home.errChat': 'Error talking to the AI.',
    'home.noReply': '(no reply)',
    'home.tour': '❓ Tour',
    'common.lang': '🌐 English',

    // Provision
    'prov.title': 'Provision frontend',
    'prov.subtitle': 'Upload your frontend .zip (Figma/Lovable, Next or TanStack) — the AI infers the content model, you review it, and the plugin creates everything in Strapi.',
    'prov.back': '← Back to chat',
    'prov.supported': 'Supported stacks',
    'prov.step1': '1. Choose the frontend .zip',
    'prov.step1desc': 'No strapi.manifest.json needed: if it is missing, the AI creates one by analyzing the code (e.g. src/data/*.ts).',
    'prov.selectFile': 'Select file…',
    'prov.noFile': 'No file selected',
    'prov.analyze': 'Analyze project',
    'prov.analyzing': 'Analyzing…',
    'prov.analyzingDesc': 'Reading the code and inferring the content model (content-types + seed)…',
    'prov.step2': '2. Review the content model',
    'prov.inferred': '🤖 Inferred by the AI',
    'prov.fromManifest': '✓ Project manifest',
    'prov.framework': 'framework',
    'prov.analyzed': 'Analyzed',
    'prov.editJson': 'Edit the JSON to adjust names, types or seeded content before creating.',
    'prov.provision': 'Provision',
    'prov.restart': 'Restart',
    'prov.provisioning': 'Provisioning…',
    'prov.provisioningTitle': 'Setting everything up — this takes a few seconds',
    'prov.provisioningDesc': 'Strapi is restarting to recognize the content-types, then it seeds content, opens public read access and wires the preview. Do not close this page.',
    'prov.invalidJson': 'The manifest is not valid JSON. Fix the syntax.',
    'prov.analyzeFail': 'Failed to analyze the project.',
    'prov.provisionFail': 'Provisioning failed.',
    'prov.analyzeWarn': 'Analysis warning:',
    'prov.doneTitle': '✅ All set! You can see the preview now.',
    'prov.typesCreated': 'Content-types created:',
    'prov.seeded': 'Seeded content:',
    'prov.frontendAt': 'Frontend at:',
    'prov.runFrontend': 'To see the preview, run the frontend (once):',
    'prov.relinkDesc': 'Relink the frontend to Strapi (snapshot): swaps the hardcoded data for Strapi data, keeping the images. Components do not change.',
    'prov.relink': 'Relink data to Strapi',
    'prov.relinking': 'Relinking…',
    'prov.open': 'Open',
    'prov.provisionAnother': 'Provision another',
    'prov.relinkOk': '✅ Relinked! Files updated: {files}. Reload the preview to see Strapi data. (Original saved as .bak.)',
    'prov.relinkFail': '⚠️ Could not relink: {err}.',
    'prov.relinkErr': 'Failed to relink.',
    'prov.noData': 'no data file',
  },
  pt: {
    // Home
    'home.title': 'MCP Chat',
    'home.subtitle': 'IA via MCP',
    'home.seeingScreen': '• vendo sua tela',
    'home.voiceOn': '• voz ON',
    'home.voiceBtnOn': 'Voz: ON',
    'home.voiceBtnOff': 'Voz: OFF',
    'home.shareStop': 'Parar tela',
    'home.shareStart': 'Compartilhar tela',
    'home.provision': 'Provisionar frontend',
    'home.previewOn': 'Live Preview: ON',
    'home.previewOff': 'Live Preview: OFF',
    'home.empty': 'Escreva, fale (🎤) ou compartilhe a tela. Ex.: “Quais content-types existem?”.',
    'home.you': 'Você',
    'home.ai': 'IA',
    'home.processing': 'Processando…',
    'home.rec': '🎤 Falar',
    'home.recStop': '⏹ Parar',
    'home.placeholder': 'Escreva… (Cmd/Ctrl+Enter envia)',
    'home.send': 'Enviar',
    'home.reload': 'Recarregar',
    'home.previewUrlLabel': 'URL do preview',
    'home.errShare': 'Não foi possível iniciar o compartilhamento de tela.',
    'home.errMic': 'Não foi possível acessar o microfone.',
    'home.errStt': 'Erro na transcrição.',
    'home.errAudioEmpty': 'Não consegui entender o áudio.',
    'home.errChat': 'Erro ao falar com a IA.',
    'home.noReply': '(sem resposta)',
    'home.tour': '❓ Tour',
    'common.lang': '🌐 PT-BR',

    // Provision
    'prov.title': 'Provisionar frontend',
    'prov.subtitle': 'Suba o .zip do seu frontend (Figma/Lovable, Next ou TanStack) — a IA infere o modelo de conteúdo, você revisa, e o plugin cria tudo no Strapi.',
    'prov.back': '← Voltar ao chat',
    'prov.supported': 'Stacks suportados',
    'prov.step1': '1. Escolha o .zip do frontend',
    'prov.step1desc': 'Não precisa de strapi.manifest.json: se ele não existir, a IA cria um analisando os dados do código (ex.: src/data/*.ts).',
    'prov.selectFile': 'Selecionar arquivo…',
    'prov.noFile': 'Nenhum arquivo selecionado',
    'prov.analyze': 'Analisar projeto',
    'prov.analyzing': 'Analisando…',
    'prov.analyzingDesc': 'Lendo o código e inferindo o modelo de conteúdo (content-types + seed)…',
    'prov.step2': '2. Revise o modelo de conteúdo',
    'prov.inferred': '🤖 Inferido pela IA',
    'prov.fromManifest': '✓ Manifest do projeto',
    'prov.framework': 'framework',
    'prov.analyzed': 'Analisou',
    'prov.editJson': 'Edite o JSON se quiser ajustar nomes, tipos ou o conteúdo semeado antes de criar.',
    'prov.provision': 'Provisionar',
    'prov.restart': 'Recomeçar',
    'prov.provisioning': 'Provisionando…',
    'prov.provisioningTitle': 'Configurando tudo — isso leva alguns segundos',
    'prov.provisioningDesc': 'A Strapi está reiniciando para reconhecer as content-types, depois semeia o conteúdo, libera leitura pública e liga o preview. Não feche esta página.',
    'prov.invalidJson': 'O manifest não é um JSON válido. Corrija a sintaxe.',
    'prov.analyzeFail': 'Falha ao analisar o projeto.',
    'prov.provisionFail': 'Falha na provisão.',
    'prov.analyzeWarn': 'Aviso da análise:',
    'prov.doneTitle': '✅ Tudo pronto! Você já pode ver o preview.',
    'prov.typesCreated': 'Content-types criadas:',
    'prov.seeded': 'Conteúdo semeado:',
    'prov.frontendAt': 'Frontend em:',
    'prov.runFrontend': 'Para ver o preview, rode o frontend (uma vez):',
    'prov.relinkDesc': 'Religar o frontend ao Strapi (snapshot): troca os dados hardcoded pelos do Strapi, mantendo as imagens. Os componentes não mudam.',
    'prov.relink': 'Religar dados ao Strapi',
    'prov.relinking': 'Religando…',
    'prov.open': 'Abrir',
    'prov.provisionAnother': 'Provisionar outro',
    'prov.relinkOk': '✅ Religado! Arquivos atualizados: {files}. Recarregue o preview para ver os dados do Strapi. (Original salvo como .bak.)',
    'prov.relinkFail': '⚠️ Não consegui religar: {err}.',
    'prov.relinkErr': 'Falha ao religar.',
    'prov.noData': 'sem arquivo de dados',
  },
};

/** Tradutor com interpolação simples de {chaves}. */
export const makeT = (lang: Lang) => (key: string, vars?: Record<string, string>) => {
  let s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.replace(`{${k}}`, vars[k]);
  return s;
};
