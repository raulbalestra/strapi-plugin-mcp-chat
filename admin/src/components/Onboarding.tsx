/**
 * Mini-curso de onboarding: um carrossel de passos mostrado na PRIMEIRA vez que o
 * usuário abre o plugin (flag em localStorage), e reabrível pelo botão "❓ Tour".
 *
 * Cada passo tem uma ilustração (SVG placeholder) + título + descrição, em PT/EN.
 * Para usar screenshots reais, troque o componente `art` do passo por
 * `<img src={...} />` (ou aponte para arquivos em admin/src/assets).
 */
import { useEffect, useState } from 'react';
import type { Lang } from '../i18n';

const LS_DONE = 'mcp-chat-tour-done';

export const tourWasSeen = (): boolean => {
  try { return localStorage.getItem(LS_DONE) === '1'; } catch { return false; }
};
const markSeen = () => { try { localStorage.setItem(LS_DONE, '1'); } catch { /* noop */ } };

// ── Ilustrações (placeholders SVG; substitua por screenshots quando tiver) ──────
const Frame = ({ children }: { children: React.ReactNode }) => (
  <svg viewBox="0 0 320 180" width="100%" style={{ display: 'block' }} xmlns="http://www.w3.org/2000/svg">
    <rect x="0" y="0" width="320" height="180" rx="12" fill="#f0f0ff" />
    <rect x="0" y="0" width="320" height="26" rx="12" fill="#181826" />
    <circle cx="14" cy="13" r="4" fill="#ff5f57" />
    <circle cx="30" cy="13" r="4" fill="#febc2e" />
    <circle cx="46" cy="13" r="4" fill="#28c840" />
    {children}
  </svg>
);
const artWelcome = (
  <Frame>
    <circle cx="160" cy="100" r="40" fill="#4945ff" />
    <path d="M140 92h40a6 6 0 0 1 6 6v22a6 6 0 0 1-6 6h-22l-12 10v-10h-6a6 6 0 0 1-6-6V98a6 6 0 0 1 6-6Z" fill="#fff" />
    <circle cx="150" cy="109" r="3" fill="#4945ff" /><circle cx="160" cy="109" r="3" fill="#4945ff" /><circle cx="170" cy="109" r="3" fill="#4945ff" />
  </Frame>
);
const artChat = (
  <Frame>
    <rect x="30" y="44" width="180" height="18" rx="9" fill="#dcd9ff" />
    <rect x="110" y="74" width="180" height="18" rx="9" fill="#4945ff" />
    <rect x="30" y="104" width="140" height="18" rx="9" fill="#dcd9ff" />
    <circle cx="270" cy="140" r="16" fill="#4945ff" /><text x="270" y="146" fontSize="16" textAnchor="middle" fill="#fff">🎤</text>
  </Frame>
);
const artEdit = (
  <Frame>
    <rect x="30" y="50" width="120" height="80" rx="8" fill="#fff" stroke="#dcdce4" />
    <rect x="42" y="64" width="80" height="10" rx="5" fill="#c0bfff" />
    <rect x="42" y="84" width="96" height="8" rx="4" fill="#e6e6f0" />
    <rect x="42" y="100" width="70" height="8" rx="4" fill="#e6e6f0" />
    <path d="M170 90h70m0 0-14-12m14 12-14 12" stroke="#4945ff" strokeWidth="4" fill="none" strokeLinecap="round" />
    <rect x="250" y="58" width="46" height="64" rx="6" fill="#28c840" opacity="0.18" />
    <text x="273" y="96" fontSize="22" textAnchor="middle">✓</text>
  </Frame>
);
const artPreview = (
  <Frame>
    <rect x="24" y="40" width="130" height="120" rx="8" fill="#fff" stroke="#dcdce4" />
    <rect x="166" y="40" width="130" height="120" rx="8" fill="#fff" stroke="#dcdce4" />
    <rect x="36" y="54" width="100" height="10" rx="5" fill="#c0bfff" />
    <rect x="36" y="74" width="80" height="8" rx="4" fill="#e6e6f0" />
    <rect x="178" y="54" width="106" height="40" rx="6" fill="#6bdaff" opacity="0.5" />
    <rect x="178" y="104" width="80" height="8" rx="4" fill="#e6e6f0" />
    <text x="158" y="120" fontSize="16" textAnchor="middle">👁️</text>
  </Frame>
);
const artProvision = (
  <Frame>
    <rect x="40" y="60" width="60" height="60" rx="10" fill="#000" /><text x="70" y="98" fontSize="26" textAnchor="middle" fill="#fff">N</text>
    <circle cx="160" cy="90" r="30" fill="#f9ffb5" stroke="#0b1722" strokeWidth="2" />
    <path d="M110 90h20m100 0h-20" stroke="#4945ff" strokeWidth="4" strokeLinecap="round" />
    <rect x="220" y="60" width="60" height="60" rx="10" fill="#4945ff" /><text x="250" y="98" fontSize="22" textAnchor="middle" fill="#fff">DB</text>
  </Frame>
);
const artTranslate = (
  <Frame>
    <text x="80" y="105" fontSize="34" textAnchor="middle">🇧🇷</text>
    <path d="M120 90h80m0 0-14-12m14 12-14 12" stroke="#4945ff" strokeWidth="4" fill="none" strokeLinecap="round" />
    <text x="240" y="105" fontSize="34" textAnchor="middle">🌍</text>
  </Frame>
);

type Step = { title: string; body: string; art: React.ReactNode };

const STEPS: Record<Lang, Step[]> = {
  en: [
    { title: 'Welcome to MCP Chat', body: 'An AI assistant inside your Strapi admin that actually reads, edits and publishes your content via the native MCP server. This quick tour shows what it can do.', art: artWelcome },
    { title: 'Just ask, in plain language', body: 'Type, talk (🎤 voice) or share your screen. Example: “Change the homepage hero title to Welcome”. No need to find the field yourself — the AI searches everything.', art: artChat },
    { title: 'It edits & publishes for real', body: 'The assistant finds the text across content-types, components and dynamic zones, updates it and publishes — then confirms what changed.', art: artEdit },
    { title: 'Side-by-side live preview', body: 'Toggle Live Preview to see your frontend next to the admin. After each edit it reloads on the same page you were viewing.', art: artPreview },
    { title: 'Provision a frontend', body: 'Upload a Next.js or TanStack Start .zip — the AI infers the content model, you review it, and the plugin creates the content-types and seeds the data.', art: artProvision },
    { title: 'Translate the whole site', body: 'Ask “translate the whole site to French” and it creates the locales and translates every localized field via Strapi’s native i18n.', art: artTranslate },
  ],
  pt: [
    { title: 'Bem-vindo ao MCP Chat', body: 'Um assistente de IA dentro do admin do Strapi que realmente lê, edita e publica seu conteúdo via o MCP nativo. Este tour rápido mostra o que ele faz.', art: artWelcome },
    { title: 'É só pedir, em linguagem natural', body: 'Escreva, fale (🎤 voz) ou compartilhe a tela. Ex.: “Troque o título do hero da home para Bem-vindo”. Não precisa achar o campo — a IA busca em tudo.', art: artChat },
    { title: 'Ele edita e publica de verdade', body: 'O assistente acha o texto em content-types, componentes e dynamic zones, atualiza e publica — e confirma o que mudou.', art: artEdit },
    { title: 'Preview ao vivo lado a lado', body: 'Ligue o Live Preview para ver seu frontend ao lado do admin. Após cada edição ele recarrega na mesma página que você estava vendo.', art: artPreview },
    { title: 'Provisione um frontend', body: 'Suba um .zip Next.js ou TanStack Start — a IA infere o modelo de conteúdo, você revisa, e o plugin cria as content-types e semeia os dados.', art: artProvision },
    { title: 'Traduza o site inteiro', body: 'Peça “traduza o site todo para francês” e ele cria os locales e traduz cada campo localizado via o i18n nativo do Strapi.', art: artTranslate },
  ],
};

const L = {
  en: { skip: 'Skip', back: 'Back', next: 'Next', done: 'Got it!', step: 'Step' },
  pt: { skip: 'Pular', back: 'Voltar', next: 'Próximo', done: 'Entendi!', step: 'Passo' },
};

export const Onboarding = ({ lang, open, onClose }: { lang: Lang; open: boolean; onClose: () => void }) => {
  const [i, setI] = useState(0);
  const steps = STEPS[lang];
  const t = L[lang];

  useEffect(() => { if (open) setI(0); }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === 'Escape') finish();
      if (e.key === 'ArrowRight') setI((v) => Math.min(steps.length - 1, v + 1));
      if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, steps.length]);

  if (!open) return null;
  const finish = () => { markSeen(); onClose(); };
  const last = i === steps.length - 1;
  const s = steps[i];

  return (
    <div
      onClick={finish}
      style={{
        position: 'fixed', inset: 0, zIndex: 2147483600,
        background: 'rgba(10,10,25,0.55)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460, maxWidth: '100%', background: '#fff', borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.35)', overflow: 'hidden',
          fontFamily: 'inherit',
        }}
      >
        <div style={{ padding: 16 }}>{s.art}</div>
        <div style={{ padding: '0 20px 8px' }}>
          <h2 style={{ margin: '4px 0 8px', fontSize: 18, color: '#181826' }}>{s.title}</h2>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#4a4a6a', minHeight: 64 }}>{s.body}</p>
        </div>

        {/* dots (hover para pular pra um passo) */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', padding: '8px 0 4px' }}>
          {steps.map((st, idx) => (
            <button
              key={idx}
              onClick={() => setI(idx)}
              title={`${t.step} ${idx + 1}: ${st.title}`}
              style={{
                width: idx === i ? 22 : 8, height: 8, borderRadius: 4, border: 'none',
                background: idx === i ? '#4945ff' : '#d9d9e8', cursor: 'pointer',
                transition: 'width .2s, background .2s',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderTop: '1px solid #eee' }}>
          <button onClick={finish} style={{ background: 'none', border: 'none', color: '#8e8ea9', cursor: 'pointer', fontSize: 13 }}>
            {t.skip}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {i > 0 && (
              <button onClick={() => setI((v) => v - 1)}
                style={{ border: '1px solid #dcdce4', background: '#fff', color: '#32324d', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 }}>
                {t.back}
              </button>
            )}
            <button
              onClick={() => (last ? finish() : setI((v) => v + 1))}
              style={{ border: 'none', background: '#4945ff', color: '#fff', borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
            >
              {last ? t.done : t.next}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
