/**
 * Botão de idioma das páginas do plugin (PT-BR ↔ English).
 * Alterna a mesma chave `mcp-chat-lang` usada pelo chat flutuante.
 */
import { useLang } from '../i18n';

export const LangSwitcher = ({ size = 'M' as 'S' | 'M' }) => {
  const [lang, setLang] = useLang();
  const pad = size === 'S' ? '2px 8px' : '4px 10px';
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'pt' ? 'en' : 'pt')}
      title="Idioma do plugin / Plugin language (PT-BR ↔ English)"
      style={{
        border: '1px solid #dcdce4', background: '#fff', color: '#32324d',
        borderRadius: 6, padding: pad, cursor: 'pointer', fontSize: 12,
        whiteSpace: 'nowrap', fontWeight: 600,
      }}
    >
      {lang === 'pt' ? '🌐 PT-BR' : '🌐 English'}
    </button>
  );
};
