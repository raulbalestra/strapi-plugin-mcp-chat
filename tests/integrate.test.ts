import {
  exportNames,
  findExportValues,
  extractImports,
  assetImportIds,
  buildLiveDataModule,
} from '../server/src/provision/integrate';

/**
 * Testa as partes DETERMINÍSTICAS do consumo AO VIVO (sem LLM/Strapi):
 * extração de exports/imports, ids de assets e montagem do módulo ao vivo
 * (client + store + exports "vivos" + loadAllData).
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

// extractImports + assetImportIds
const imp = extractImports(FILE);
ok(imp.includes('hero') && imp.includes('tile') && !imp.includes('export'), 'imports extraídos (sem exports)');
const aids = assetImportIds(FILE);
ok(aids.includes('hero') && aids.includes('tile'), 'assetImportIds acha os assets p/ fallback');

// buildLiveDataModule (módulo AO VIVO oficial)
const mapper = 'function mapStrapiToData(raw) { return { site: raw.site ?? {}, services: raw.service ?? [], empty: [] }; }';
const cts = [
  { singularName: 'site', pluralName: 'sites', kind: 'singleType' },
  { singularName: 'service', pluralName: 'services', kind: 'collectionType' },
];
const mod = buildLiveDataModule(FILE, mapper, cts, ['en', 'pt-BR'], 'en');
ok(mod.includes('from "./strapi-client"'), 'importa o client oficial');
ok(mod.includes('export async function loadAllData'), 'expõe loadAllData (loader)');
ok(mod.includes('mapStrapiToData'), 'inclui o mapeador');
ok(mod.includes('export const site: any = __live("site")') && mod.includes('export const services: any = __live("services")'), 'exports vivos (proxy)');
ok(mod.includes('__availableLocales = ["en","pt-BR"]') && mod.includes('export function __getLocale'), 'expõe locales + __getLocale p/ o seletor');
ok(mod.includes('fetchSingle(c.s, opts)') && mod.includes('fetchCollection(c.p, opts)'), 'loadAllData usa single/collection por kind');
ok(mod.includes('"p":"services"') && mod.includes('"s":"site"'), '__cts traz singular/plural corretos');
ok(mod.includes('import hero from "@/assets/hero.png"'), 'imports de assets preservados (fallback de imagem)');

console.log(`\nintegrate.test: ${pass} passaram, ${fail} falharam`);
if (fail > 0) process.exit(1);
