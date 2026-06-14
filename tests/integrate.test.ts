import {
  exportNames,
  findExportValues,
  extractImports,
  buildMultiLocaleModule,
} from '../server/src/provision/integrate';

/**
 * Testa as partes DETERMINÍSTICAS do snapshot multi-locale (sem LLM/Strapi):
 * extração de exports balanceada, preservação de imports e montagem do módulo
 * com exports "vivos" + seletor de idioma.
 */

let pass = 0;
let fail = 0;
const ok = (c: boolean, m: string) => {
  if (c) pass++;
  else {
    fail++;
    console.log('  FAIL:', m);
  }
};

const FILE = `// Snapshot from Strapi
import hero from "@/assets/hero.png";
import tile from "@/assets/tile.jpg";

export const site = {
  name: "Acme",
  tagline: "Quality Work. Reliable Service.",
  areas: ["Seattle", "Bellevue"],
};

export const services: Service[] = [
  { slug: "bathroom", title: "Bathroom Remodeling", image: hero },
  { slug: "tile", title: "Tile Installation", image: tile, note: "a; b (c) [d]" },
];

export const empty = [];
`;

// exportNames
const names = exportNames(FILE);
ok(['site', 'services', 'empty'].every((n) => names.includes(n)), 'exportNames acha todos');

// findExportValues — balanceado, mesmo com ; dentro de string
const vals = findExportValues(FILE, names);
ok(/Quality Work/.test(vals.site) && vals.site.trim().endsWith('}'), 'valor de site extraído e fechado');
ok(vals.services.includes('Tile Installation') && vals.services.includes('a; b (c) [d]'), 'services com ;/() dentro de string preservado');
for (const n of names) {
  const v = vals[n] || '';
  const open = (v.match(/[{[(]/g) || []).length;
  const close = (v.match(/[}\])]/g) || []).length;
  ok(open === close, `balanceado: ${n}`);
}

// extractImports
const imp = extractImports(FILE);
ok(imp.includes('hero') && imp.includes('tile') && !imp.includes('export'), 'imports extraídos (sem exports)');

// buildMultiLocaleModule
const pt = FILE.replace('Quality Work. Reliable Service.', 'Trabalho de Qualidade.').replace(
  'Bathroom Remodeling',
  'Reforma de Banheiro'
);
const mod = buildMultiLocaleModule({ en: FILE, 'pt-BR': pt }, 'en');
ok(mod.includes('__availableLocales = ["en","pt-BR"]'), 'módulo lista os locales');
ok(mod.includes('export const site: any = __live("site")'), 'export site vivo');
ok(mod.includes('export const services: any = __live("services")'), 'export services vivo');
ok(mod.includes('Trabalho de Qualidade') && mod.includes('Reforma de Banheiro'), 'texto pt-BR no __data');
ok(mod.includes('function __live') && mod.includes('export function __setLocale'), 'tem proxy + setLocale');
ok(mod.includes('import hero from "@/assets/hero.png"'), 'imports de assets preservados no módulo');

console.log(`\nintegrate.test: ${pass} passaram, ${fail} falharam`);
if (fail > 0) process.exit(1);
