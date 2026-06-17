/**
 * Painel de live preview DOCADO (side-by-side) com a UI da Strapi.
 *
 * Em vez de flutuar por cima, ele ENCOLHE o app do admin (#strapi) para a
 * esquerda e ocupa toda a coluna da direita, em altura cheia. Assim o
 * Content Manager (incluindo Salvar/Publicar) continua 100% visível e usável.
 *
 * O truque para encolher tudo — inclusive o menu lateral fixo da Strapi — é
 * aplicar `transform` no #strapi: isso o torna o bloco-contêiner dos filhos
 * `position: fixed`, então eles passam a respeitar a largura reduzida.
 *
 * A largura é ajustável arrastando a divisória na borda esquerda do painel.
 */
import { useEffect, useRef, useState } from 'react';

type Props = {
  open: boolean;
  /** src do iframe — muda só em navegação manual ou reload. */
  src: string;
  /** URL exibida na barra — acompanha a navegação dentro do iframe. */
  displayUrl: string;
  onUrl: (v: string) => void;
  iframeKey: number;
  onReload: () => void;
  onClose: () => void;
  /** mostra um overlay de carregamento sobre o iframe (ex.: subindo o dev server). */
  loading?: boolean;
  loadingText?: string;
  loadingError?: boolean;
  /** modo rascunho: mostra conteúdo não publicado (draft) em vez do publicado. */
  draft?: boolean;
  onToggleDraft?: () => void;
};

const MIN_W = 320;
const clampW = (w: number) => Math.max(MIN_W, Math.min(window.innerWidth - 360, w));

export const PreviewPanel = ({ open, src, displayUrl, onUrl, iframeKey, onReload, onClose, loading, loadingText, loadingError, draft, onToggleDraft }: Props) => {
  const [width, setWidth] = useState(() => Math.round(window.innerWidth * 0.42));
  const [draftUrl, setDraftUrl] = useState(displayUrl);
  const [resizing, setResizing] = useState(false);
  const dragging = useRef(false);

  useEffect(() => setDraftUrl(displayUrl), [displayUrl]);

  // Encolhe / restaura o app do admin enquanto o painel está aberto.
  useEffect(() => {
    const root = document.getElementById('strapi') as HTMLElement | null;
    if (!root) return;
    if (open) {
      root.style.width = `calc(100vw - ${width}px)`;
      root.style.maxWidth = `calc(100vw - ${width}px)`;
      root.style.transform = 'translateZ(0)';
      root.style.overflow = 'hidden';
    } else {
      root.style.width = '';
      root.style.maxWidth = '';
      root.style.transform = '';
      root.style.overflow = '';
    }
    return () => {
      root.style.width = '';
      root.style.maxWidth = '';
      root.style.transform = '';
      root.style.overflow = '';
    };
  }, [open, width]);

  // Arrastar a divisória para redimensionar.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(clampW(window.innerWidth - e.clientX));
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setResizing(false);
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  if (!open) return null;

  const hdrBtn: React.CSSProperties = {
    border: '1px solid #4a4a6a', background: '#2a2a45', color: '#fff',
    borderRadius: 6, padding: '4px 9px', cursor: 'pointer', fontSize: 12,
  };

  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width,
        zIndex: 2147482000, background: '#fff',
        borderLeft: '1px solid #dcdce4', boxShadow: '-6px 0 24px rgba(0,0,0,0.14)',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Divisória de redimensionamento (borda esquerda) */}
      <div
        onMouseDown={(e) => {
          dragging.current = true;
          setResizing(true);
          document.body.style.userSelect = 'none';
          e.preventDefault();
        }}
        title="Arraste para ajustar a largura"
        style={{
          position: 'absolute', left: -4, top: 0, bottom: 0, width: 8,
          cursor: 'col-resize', zIndex: 2,
        }}
      />

      {/* Header */}
      <div
        style={{
          display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px',
          background: '#181826', color: '#fff', userSelect: 'none',
        }}
      >
        <strong style={{ fontSize: 13, whiteSpace: 'nowrap' }}>🖼 Preview</strong>
        <input
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onUrl(draftUrl); }}
          onBlur={() => onUrl(draftUrl)}
          style={{
            flex: 1, fontSize: 12, padding: '4px 8px', borderRadius: 6,
            border: '1px solid #4a4a6a', background: '#0f0f1a', color: '#fff',
          }}
        />
        {onToggleDraft && (
          <button
            onClick={onToggleDraft}
            title={
              draft
                ? 'Mostrando RASCUNHO (conteúdo não publicado). Clique para ver o publicado (Live).'
                : 'Mostrando publicado (Live). Clique para ver o RASCUNHO (draft).'
            }
            style={{
              ...hdrBtn,
              background: draft ? '#8c4bff' : '#2a2a45',
              borderColor: draft ? '#8c4bff' : '#4a4a6a',
              whiteSpace: 'nowrap',
            }}
          >
            {draft ? '📝 Draft' : '🌐 Live'}
          </button>
        )}
        <button onClick={onReload} title="Recarregar" style={hdrBtn}>↻</button>
        <button onClick={onClose} title="Fechar" style={hdrBtn}>✕</button>
      </div>

      {/* Iframe */}
      <div style={{ flex: 1, position: 'relative' }}>
        <iframe
          key={iframeKey}
          src={src}
          title="Live Preview do site"
          allow="clipboard-read; clipboard-write"
          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
        />
        {/* máscara durante o resize p/ o iframe não engolir o mouse */}
        {resizing && <div style={{ position: 'absolute', inset: 0 }} />}

        {/* overlay de carregamento (subindo o dev server do frontend) */}
        {loading && (
          <div
            style={{
              position: 'absolute', inset: 0, background: '#0f0f1a',
              color: '#fff', display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24,
            }}
          >
            {loadingError ? (
              <div style={{ fontSize: 40 }}>⚠️</div>
            ) : (
              <>
                <div
                  style={{
                    width: 40, height: 40, borderRadius: '50%',
                    border: '4px solid #3a3a55', borderTopColor: '#7b79ff',
                    animation: 'mcpspin 0.9s linear infinite',
                  }}
                />
                <style>{'@keyframes mcpspin{to{transform:rotate(360deg)}}'}</style>
              </>
            )}
            <div style={{ fontSize: 14, fontWeight: 600, textAlign: 'center' }}>
              {loadingText || 'Iniciando o frontend…'}
            </div>
            {!loadingError && (
              <div style={{ fontSize: 12, color: '#9a9ab5', textAlign: 'center', maxWidth: 360 }}>
                Instalando dependências e subindo o dev server. Na primeira vez pode
                levar um pouco mais.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
