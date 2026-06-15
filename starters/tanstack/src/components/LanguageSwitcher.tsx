// Seletor de idioma — troca ?locale e recarrega (o loader refetcha por locale).
// A lista de idiomas vem de VITE_LOCALES (CSV; ex.: "en,pt-BR"). Default: en.
const LOCALES = (import.meta.env.VITE_LOCALES ?? 'en')
  .split(',')
  .map((s: string) => s.trim())
  .filter(Boolean)

const LABELS: Record<string, string> = {
  en: 'EN', 'pt-BR': 'PT', pt: 'PT', es: 'ES', fr: 'FR', de: 'DE', it: 'IT',
  nl: 'NL', ja: 'JA', ko: 'KO', ru: 'RU', ar: 'AR', 'zh-Hans': 'ZH', zh: 'ZH',
}

export function LanguageSwitcher() {
  if (LOCALES.length < 2) return null
  let current = LOCALES[0]
  try {
    if (typeof window !== 'undefined') {
      current = new URL(window.location.href).searchParams.get('locale') || LOCALES[0]
    }
  } catch {}
  const onChange = (e: any) => {
    const loc = e.target.value
    const u = new URL(window.location.href)
    u.searchParams.set('locale', loc)
    window.location.href = u.toString()
  }
  return (
    <select
      aria-label="Language"
      value={current}
      onChange={onChange}
      style={{
        border: '1px solid rgba(0,0,0,.15)', borderRadius: 9999, padding: '4px 10px',
        fontSize: 13, fontWeight: 600, background: 'transparent', cursor: 'pointer',
      }}
    >
      {LOCALES.map((l: string) => (
        <option key={l} value={l}>{LABELS[l] || l.toUpperCase()}</option>
      ))}
    </select>
  )
}

export default LanguageSwitcher
