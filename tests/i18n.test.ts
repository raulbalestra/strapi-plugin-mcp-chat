import { validateManifest } from '../server/src/provision/manifest';
import { buildSchema } from '../server/src/provision/generate';
import {
  splitForTranslation,
  approxTokens,
  MAX_CHUNK_TOKENS,
} from '../server/src/provision/translate';
import { createContentTools } from '../server/src/content-tools';

/**
 * Testa o suporte a i18n de forma pura (sem Strapi viva e sem rede):
 *  - manifest aceita os flags `localized`;
 *  - o gerador emite pluginOptions.i18n.localized no nível CT e atributo;
 *  - splitForTranslation nunca estoura (Dor 1) e remonta o texto;
 *  - criarLocale valida contra a lista ISO (anti-alucinação) e é idempotente.
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

// ── manifest + gerador ──────────────────────────────────────────────────────
const raw = {
  name: 'demo-i18n',
  framework: 'next',
  contentTypes: [
    {
      singularName: 'pagina',
      kind: 'singleType',
      localized: true,
      attributes: {
        titulo: { type: 'string', localized: true },
        corpo: { type: 'richtext', localized: true },
        slug: { type: 'string' }, // não localizado de propósito (compartilhado)
      },
    },
  ],
};
const v = validateManifest(raw);
ok(v.ok, 'manifest com localized valida');
if (v.ok) {
  const ct = v.data.contentTypes[0];
  ok((ct as any).localized === true, 'flag localized preservada na CT');
  const schema = buildSchema(ct);
  ok(schema.pluginOptions?.i18n?.localized === true, 'CT emite pluginOptions.i18n.localized');
  ok(
    schema.attributes.titulo.pluginOptions?.i18n?.localized === true,
    'campo localized emite pluginOptions.i18n'
  );
  ok(
    schema.attributes.corpo.pluginOptions?.i18n?.localized === true,
    'richtext localized emite pluginOptions.i18n'
  );
  ok(
    schema.attributes.slug.pluginOptions === undefined,
    'campo não-localized NÃO emite pluginOptions'
  );
}

// CT sem localized → sem pluginOptions (comportamento atual inalterado)
const v2 = validateManifest({
  name: 'demo-plain',
  framework: 'next',
  contentTypes: [{ singularName: 'item', attributes: { nome: { type: 'string' } } }],
});
ok(v2.ok && buildSchema(v2.data.contentTypes[0]).pluginOptions === undefined, 'CT sem i18n fica sem pluginOptions');

// ── splitForTranslation (Dor 1: texto longo) ────────────────────────────────
const shortRes = splitForTranslation('Olá mundo', 'string');
ok(shortRes.chunks.length === 1, 'texto curto = 1 chunk');
ok(shortRes.join(['Hello world']) === 'Hello world', 'join de 1 chunk devolve o pedaço');

const paras = Array.from({ length: 40 }, (_, i) => `Parágrafo número ${i} ${'lorem ipsum '.repeat(30)}`);
const longText = paras.join('\n\n');
ok(approxTokens(longText) > MAX_CHUNK_TOKENS, 'texto de teste realmente excede o teto');
const longRes = splitForTranslation(longText, 'richtext');
ok(longRes.chunks.length > 1, 'texto longo vira N chunks (>1)');
ok(longRes.chunks.every((c) => approxTokens(c) <= MAX_CHUNK_TOKENS), 'todo chunk fica <= teto de tokens');
const rejoined = longRes.join(longRes.chunks);
ok(rejoined.includes('Parágrafo número 0') && rejoined.includes('Parágrafo número 39'), 'remontagem preserva o conteúdo (início e fim)');

// parágrafo único gigante cai para sentenças e ainda respeita o teto
const bigPara = Array.from({ length: 200 }, (_, i) => `Esta é a sentença ${i} com bastante texto para ocupar bastante espaço aqui.`).join(' ');
const bigRes = splitForTranslation(bigPara, 'text');
ok(bigRes.chunks.length > 1 && bigRes.chunks.every((c) => approxTokens(c) <= MAX_CHUNK_TOKENS), 'parágrafo gigante é dividido por sentença sob o teto');

// ── criarLocale: validação ISO + idempotência ───────────────────────────────
const store: any[] = [];
const isoList = [
  { code: 'en', name: 'English (en)' },
  { code: 'pt-BR', name: 'Portuguese (Brazil) (pt-BR)' },
];
const strapiMock: any = {
  contentTypes: {},
  plugin: (n: string) =>
    n === 'i18n'
      ? {
          service: (s: string) =>
            s === 'iso-locales'
              ? { getIsoLocales: () => isoList }
              : {
                  getDefaultLocale: async () => 'en',
                  find: async () => store,
                  findByCode: async (c: string) => store.find((l) => l.code === c) || null,
                  create: async (l: any) => {
                    store.push(l);
                    return l;
                  },
                },
        }
      : undefined,
};
const tools = createContentTools(strapiMock);

(async () => {
  const bad = await tools.criarLocale({ code: 'zz-NOPE' });
  ok(!!(bad as any).erro, 'código fora da lista ISO é rejeitado');

  const good = await tools.criarLocale({ code: 'pt-br' }); // case-insensitive
  ok((good as any).ok && (good as any).code === 'pt-BR', 'código ISO válido cria locale (normaliza o case)');
  ok((good as any).existed === false, 'primeira criação: existed=false');

  const again = await tools.criarLocale({ code: 'pt-BR' });
  ok((again as any).ok && (again as any).existed === true, 'idempotente: segunda vez existed=true');

  console.log(`\ni18n.test: ${pass} passaram, ${fail} falharam`);
  if (fail > 0) process.exit(1);
})();
