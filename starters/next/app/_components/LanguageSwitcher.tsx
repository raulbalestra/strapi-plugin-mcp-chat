"use client";

// Seletor de idioma — troca ?locale e recarrega (o RSC refetcha por locale).
// A lista de idiomas vem de NEXT_PUBLIC_LOCALES (CSV; ex.: "en,pt-BR"). Default: en.
import { useSearchParams } from "next/navigation";

const LOCALES = (process.env.NEXT_PUBLIC_LOCALES ?? "en")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const LABELS: Record<string, string> = {
  en: "EN", "pt-BR": "PT", pt: "PT", es: "ES", fr: "FR", de: "DE", it: "IT",
  nl: "NL", ja: "JA", ko: "KO", ru: "RU", ar: "AR", "zh-Hans": "ZH", zh: "ZH",
};

export default function LanguageSwitcher() {
  const sp = useSearchParams();
  if (LOCALES.length < 2) return null;
  const current = sp.get("locale") || LOCALES[0];
  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const u = new URL(window.location.href);
    u.searchParams.set("locale", e.target.value);
    window.location.href = u.toString();
  };
  return (
    <select
      aria-label="Language"
      value={current}
      onChange={onChange}
      style={{
        border: "1px solid rgba(0,0,0,.15)", borderRadius: 9999, padding: "4px 10px",
        fontSize: 13, fontWeight: 600, background: "transparent", cursor: "pointer",
      }}
    >
      {LOCALES.map((l) => (
        <option key={l} value={l}>{LABELS[l] || l.toUpperCase()}</option>
      ))}
    </select>
  );
}
