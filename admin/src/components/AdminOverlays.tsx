/**
 * Wrapper das sobreposições globais do admin: o chat flutuante e o painel
 * grande de live preview. Mantém o estado do preview compartilhado entre os dois
 * (o botão 🖼 do chat abre/fecha o painel grande na UI da Strapi).
 *
 * O iframe do preview costuma ser de outra origem (site x admin), então o admin
 * não consegue ler diretamente para onde o usuário navegou dentro dele. A página
 * do site se reporta via postMessage (ver PreviewBridge, no frontend); aqui
 * escutamos essa mensagem para que ao RECARREGAR o preview a gente volte para a
 * MESMA página que estava aberta — e não para a home.
 *
 * A URL do site é configurável: começa em localStorage (lembrada entre sessões)
 * ou no fallback abaixo, e pode ser trocada na barra do painel. A origem aceita
 * no postMessage é derivada dessa URL, então funciona para qualquer frontend.
 */
import { useEffect, useRef, useState } from 'react';
import { getFetchClient } from '@strapi/strapi/admin';
import { FloatingChat } from './FloatingChat';
import { PreviewPanel } from './PreviewPanel';

// Fallback caso não haja nada salvo. Troque pela URL do seu frontend ou apenas
// edite na barra do painel — o valor fica salvo em localStorage.
const FALLBACK_PREVIEW_URL = 'http://localhost:3000';
const LS_KEY = 'mcp-chat-preview-url';
const LS_DRAFT = 'mcp-chat-preview-draft';

const initialPreviewUrl = (): string => {
  try {
    return localStorage.getItem(LS_KEY) || FALLBACK_PREVIEW_URL;
  } catch {
    return FALLBACK_PREVIEW_URL;
  }
};

const initialDraft = (): boolean => {
  try {
    return localStorage.getItem(LS_DRAFT) === '1';
  } catch {
    return false;
  }
};

/** Aplica/remove o flag `?preview=1` na URL do iframe. Em modo rascunho, o
 *  frontend provisionado (e qualquer frontend que respeite o contrato de
 *  preview) busca `status=draft` no Strapi em vez do conteúdo publicado. */
const withPreviewFlag = (url: string, draft: boolean): string => {
  try {
    const u = new URL(url);
    if (draft) u.searchParams.set('preview', '1');
    else u.searchParams.delete('preview');
    return u.toString();
  } catch {
    return url;
  }
};

const originOf = (u: string): string | null => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

export const AdminOverlays = () => {
  const [previewOn, setPreviewOn] = useState(false);
  // `src` do iframe: muda só em navegação manual (barra de URL) ou no reload.
  const [previewSrc, setPreviewSrc] = useState(initialPreviewUrl);
  // URL "viva" — acompanha a navegação dentro do iframe (p/ a barra e o reload).
  const [liveHref, setLiveHref] = useState(initialPreviewUrl);
  const liveRef = useRef(initialPreviewUrl());
  const srcRef = useRef(initialPreviewUrl());
  const [iframeKey, setIframeKey] = useState(0);
  // Modo rascunho do preview (mostra conteúdo não publicado).
  const [draftPreview, setDraftPreview] = useState(initialDraft);

  // Auto-run do frontend provisionado SEMPRE que o preview é ligado.
  const [runLoading, setRunLoading] = useState(false);
  const [runText, setRunText] = useState('');
  const [runError, setRunError] = useState(false);

  // Escuta a página do site reportando sua URL atual. Aceita apenas mensagens
  // vindas da origem do site atualmente carregado no preview.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const allowed = originOf(srcRef.current);
      if (!allowed || e.origin !== allowed) return;
      const d: any = e.data;
      if (d && d.type === 'preview:location' && typeof d.href === 'string') {
        liveRef.current = d.href;
        setLiveHref(d.href);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Reload: recarrega a página em que o usuário REALMENTE está (não a home).
  // O scroll é restaurado pelo PreviewBridge no lado do site.
  const reload = () => {
    const target = liveRef.current || FALLBACK_PREVIEW_URL;
    srcRef.current = target;
    setPreviewSrc(target);
    setIframeKey((k) => k + 1);
  };

  // SEMPRE que o preview é LIGADO: pede ao backend para rodar o frontend
  // provisionado (instala + sobe o dev server) e mostra "carregando" até ele
  // responder. O backend é idempotente: se já estiver no ar, não duplica; se
  // tiver caído, reinicia. Se não houver nada provisionado, é no-op (modo manual).
  useEffect(() => {
    if (!previewOn) return;
    let cancelled = false;
    const { post, get } = getFetchClient();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      try {
        setRunError(false);
        setRunText('Iniciando o frontend…');
        let st: any;
        try {
          const { data } = await post('/mcp-chat/frontend/run', {});
          st = data;
        } catch {
          return; // nada provisionado → modo manual
        }
        if (!st || (st.state === 'idle' && !st.url)) return;

        setRunLoading(true);
        const startedAt = Date.now();
        while (!cancelled && st && st.state !== 'running' && st.state !== 'error') {
          if (Date.now() - startedAt > 180000) { st = { state: 'error', error: 'tempo esgotado' }; break; }
          setRunText(st.state === 'installing' ? 'Instalando dependências…' : 'Subindo o dev server…');
          await sleep(1500);
          try {
            const { data } = await get('/mcp-chat/frontend/run-status');
            st = data;
          } catch { /* reiniciando: continua */ }
        }
        if (cancelled) return;

        if (st.state === 'running' && st.url) {
          navigate(st.url);
          setRunLoading(false);
        } else if (st.state === 'error') {
          setRunError(true);
          setRunText('Falha ao iniciar o frontend: ' + (st.error || 'veja o terminal'));
        } else {
          setRunLoading(false);
        }
      } catch {
        setRunLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [previewOn]);

  // Navegação manual pela barra de URL (e persiste a escolha).
  const navigate = (v: string) => {
    srcRef.current = v;
    liveRef.current = v;
    setPreviewSrc(v);
    setLiveHref(v);
    setIframeKey((k) => k + 1);
    try {
      localStorage.setItem(LS_KEY, v);
    } catch {
      /* noop */
    }
  };

  return (
    <>
      <PreviewPanel
        open={previewOn}
        src={withPreviewFlag(previewSrc, draftPreview)}
        displayUrl={liveHref}
        onUrl={navigate}
        iframeKey={iframeKey}
        onReload={reload}
        onClose={() => setPreviewOn(false)}
        loading={runLoading}
        loadingText={runText}
        loadingError={runError}
        draft={draftPreview}
        onToggleDraft={() => {
          setDraftPreview((v) => {
            const next = !v;
            try { localStorage.setItem(LS_DRAFT, next ? '1' : '0'); } catch { /* noop */ }
            return next;
          });
          setIframeKey((k) => k + 1); // recarrega o iframe com/sem o flag
        }}
      />
      <FloatingChat
        previewOn={previewOn}
        previewUrl={liveHref}
        onTogglePreview={() => setPreviewOn((v) => !v)}
        onReply={async (didWrite) => {
          if (!previewOn) return;
          // Houve edição no Strapi: re-sincroniza o snapshot do frontend para o
          // preview refletir (a fonte da verdade é o Strapi). Se não for snapshot
          // ou não houver provisão, o integrate é no-op e só recarregamos.
          if (didWrite) {
            try {
              setRunError(false);
              setRunText('Sincronizando alterações…');
              setRunLoading(true);
              const { post } = getFetchClient();
              await post('/mcp-chat/frontend/integrate', {});
            } catch {
              /* sem integração: segue só com reload */
            } finally {
              setRunLoading(false);
            }
          }
          reload();
        }}
      />
    </>
  );
};
