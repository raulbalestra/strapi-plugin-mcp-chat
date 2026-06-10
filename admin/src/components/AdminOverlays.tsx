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
import { FloatingChat } from './FloatingChat';
import { PreviewPanel } from './PreviewPanel';

// Fallback caso não haja nada salvo. Troque pela URL do seu frontend ou apenas
// edite na barra do painel — o valor fica salvo em localStorage.
const FALLBACK_PREVIEW_URL = 'http://localhost:3000';
const LS_KEY = 'mcp-chat-preview-url';

const initialPreviewUrl = (): string => {
  try {
    return localStorage.getItem(LS_KEY) || FALLBACK_PREVIEW_URL;
  } catch {
    return FALLBACK_PREVIEW_URL;
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
        src={previewSrc}
        displayUrl={liveHref}
        onUrl={navigate}
        iframeKey={iframeKey}
        onReload={reload}
        onClose={() => setPreviewOn(false)}
      />
      <FloatingChat
        previewOn={previewOn}
        previewUrl={liveHref}
        onTogglePreview={() => setPreviewOn((v) => !v)}
        onReplyReload={() => { if (previewOn) reload(); }}
      />
    </>
  );
};
