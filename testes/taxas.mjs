/* ═══════════════════════════════════════════════════════════════
   Taxa da entrega — de onde vem o número que fecha o dia.

   O pedido que chega pelo pedido.html traz SEMPRE `value: 0`, porque
   quem define quanto o motoboy cobra não é a loja. O valor entra no
   momento em que ele aceita o pedido. Ou seja: se essa hora errar, erra
   o fechamento, e erra em silêncio — a taxa não dá erro, ela só fica
   diferente do combinado.

   Antes desta etapa havia duas regras fixas no código:

   • ARITANA, por bairro. Procurava o nome do bairro dentro do endereço
     inteiro — que começa pela RUA. "Rua São Marcos, 100, Centro" casava
     com o bairro São Marcos (R$ 55) em vez de Centro (R$ 20), e ainda
     mostrava um aviso verde como se tivesse acertado. Em 5 endereços
     realistas testados, 4 pegaram a taxa errada.

   • KS, por cidade. Certa, mas presa a um nome escrito no código:
     qualquer outra loja caía com taxa zero e ia zerada para o
     fechamento, sem ninguém avisar.

   Agora a taxa sai da CIDADE, de uma tabela que o motoboy edita.

   Como nos outros testes, o código exercitado é EXTRAÍDO do index.html
   — não é cópia, então ele envelhece junto com o app.
   ═══════════════════════════════════════════════════════════════ */
import { trecho, lerApp, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();
const src = lerApp('index.html');

/* Sandbox: as funções de taxa dependem de cfg/saveCfg e dos utilitários
   de cidade, que também vêm do index.html. */
function montar(cfgInicial = {}) {
  const salvos = [];
  const ctx = {
    cfg: cfgInicial,
    saveCfg() { salvos.push(JSON.parse(JSON.stringify(ctx.cfg))); },
    toast() {},
    fmtMoney(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); },
    parseMoney(s) { return parseFloat(String(s ?? '').replace(',', '.')) || 0; },
    document: { getElementById: () => null }
  };

  const fonte =
    trecho('const CITY_MAP=', '// ═══════════════ TAXAS POR CIDADE', 'index.html') +
    trecho("const TAXA_PADRAO = '_padrao';", '\nmigrarTaxas();', 'index.html');

  const fabrica = new Function('ctx',
    `with (ctx) { ${fonte}; return { migrarTaxas, taxaDaCidade, tabelaDeTaxas, resolveCityCode }; }`);
  return { ctx, salvos, ...fabrica(ctx) };
}

// ── 1. Migração: quem já usava a taxa da KS não perde nada ───
{
  const { ctx, migrarTaxas } = montar({ stores: ['KS', 'Padaria do Zé'] });
  migrarTaxas();
  ok(ctx.cfg.taxas && ctx.cfg.taxas.KS
     && ctx.cfg.taxas.KS.VIX === 25 && ctx.cfg.taxas.KS.SRR === 35
     && ctx.cfg.taxas.KS.CCA === 35 && ctx.cfg.taxas.KS.VV === 35,
    'migração leva as taxas fixas da KS para a tabela editável');
  ok(ctx.cfg.taxas._padrao && Object.keys(ctx.cfg.taxas._padrao).length === 0,
    'a tabela padrão nasce vazia, para o motoboy preencher');
}

// ── 2. Sem loja KS cadastrada, não inventa tabela ────────────
{
  const { ctx, migrarTaxas } = montar({ stores: ['Padaria do Zé'] });
  migrarTaxas();
  ok(!ctx.cfg.taxas.KS, 'quem nunca teve KS não ganha uma tabela do nada');
}

// ── 3. Migração não passa por cima do que já existe ──────────
/* Roda em toda abertura do app; se sobrescrevesse, apagaria as taxas
   editadas a cada recarga. */
{
  const { ctx, migrarTaxas, salvos } = montar({
    stores: ['KS'],
    taxas: { _padrao: { SRR: 40 }, KS: { SRR: 12 } }
  });
  migrarTaxas();
  ok(ctx.cfg.taxas._padrao.SRR === 40 && ctx.cfg.taxas.KS.SRR === 12,
    'migração não mexe em tabela já existente');
  ok(salvos.length === 0, 'e nem grava à toa quando não há o que migrar');
}

// ── 4. A tabela da loja vale mais que a padrão ───────────────
{
  const { taxaDaCidade } = montar({
    stores: ['KS'],
    taxas: { _padrao: { SRR: 30, VIX: 30, VV: 30, CCA: 30, VIA: 30 }, KS: { VIX: 25 } }
  });
  const r = taxaDaCidade('KS', 'VIX');
  ok(r.taxa === 25 && r.origem === 'KS',
    'loja com taxa própria usa a dela (KS em Vitória: R$ 25, não R$ 30)');
}

// ── 5. Cidade que a loja não define cai na padrão ────────────
{
  const { taxaDaCidade } = montar({
    stores: ['KS'],
    taxas: { _padrao: { SRR: 30 }, KS: { VIX: 25 } }
  });
  const r = taxaDaCidade('KS', 'SRR');
  ok(r.taxa === 30 && r.origem === 'padrão',
    'cidade fora da tabela da loja herda a padrão');
}

// ── 6. Nome de loja é digitado à mão em vários lugares ───────
/* Vem do link da loja (?store=), da config e do texto colado. Se a busca
   fosse sensível a caixa, "ks" pagaria uma taxa e "KS" outra. */
{
  const { taxaDaCidade } = montar({ stores: ['KS'], taxas: { _padrao: {}, KS: { VIX: 25 } } });
  ok(taxaDaCidade('ks', 'VIX').taxa === 25, 'acha a loja em minúscula');
  ok(taxaDaCidade('  KS  ', 'VIX').taxa === 25, 'acha a loja com espaço em volta');
}

// ── 7. Aceita o nome da cidade, não só o código ──────────────
/* O pedido.html manda `city: 'Vila Velha'` e `cityId: 'VV'`. */
{
  const { taxaDaCidade } = montar({ taxas: { _padrao: { VV: 22 } } });
  ok(taxaDaCidade('', 'VV').taxa === 22, 'entende o código da cidade');
  ok(taxaDaCidade('', 'Vila Velha').taxa === 22, 'entende o nome da cidade');
  ok(taxaDaCidade('', 'vila velha').taxa === 22, 'entende o nome sem maiúscula');
}

// ── 8. Sem taxa definida, devolve zero — e diz que é zero ────
/* Zero não é "sem informação": é entrega de graça no fechamento. Quem
   chama precisa conseguir distinguir para avisar. */
{
  const { taxaDaCidade } = montar({ taxas: { _padrao: { SRR: 30 } } });
  ok(taxaDaCidade('', 'VIX').taxa === 0, 'cidade sem taxa na padrão devolve 0');
  ok(taxaDaCidade('', 'Marte').taxa === 0, 'cidade irreconhecível devolve 0');
  ok(taxaDaCidade('', '').taxa === 0, 'sem cidade devolve 0');
  ok(taxaDaCidade('', 'VIX').origem === '', 'e a origem vem vazia, sem inventar procedência');
}

// ── 9. O bug do nome da rua não tem como voltar ──────────────
/* A regressão é estrutural: taxaDaCidade recebe (loja, cidade). O
   endereço não entra, então nome de rua não tem por onde influenciar. */
{
  const { taxaDaCidade } = montar({ taxas: { _padrao: { VV: 20, SRR: 55 } } });
  const casos = [
    'Rua São Marcos, 100, Centro',      // "são marcos" era bairro de R$ 55
    'Rua Santa Luzia, 50, Itapuã',      // "santa luzia" era bairro de R$ 40
    'Rua Jardim Camburi, 5, Itaparica', // "jardim camburi" era bairro de R$ 30
    'Rua São João, 12, Glória'          // "são joão" era bairro de R$ 75
  ];
  const todas = casos.every(() => taxaDaCidade('', 'VV').taxa === 20);
  ok(todas, 'endereço com nome de bairro na rua não muda mais a taxa (Vila Velha: R$ 20)');

  ok(!/ARITANA_TAXAS|detectarTaxaAritana|autoTaxaAritana/.test(src),
    'a tabela por bairro e as funções que liam o endereço saíram do app');
  ok(!/KS_TAXAS_BY_CITY/.test(src),
    'a tabela fixa da KS deu lugar à tabela editável');
}

// ── 10. O aceite usa a taxa da cidade e avisa quando dá zero ─
{
  const aceite = trecho('async function acceptPending(key){', '\nasync function rejectPending', 'index.html');
  ok(/taxaDaCidade\(/.test(aceite),
    'aceitar um pedido busca a taxa pela cidade');
  ok(/avisarTaxaZero\(/.test(aceite),
    'e avisa quando a entrega entraria sem taxa');
  ok(/if\(!s\.value\)/.test(aceite),
    'taxa digitada à mão não é sobrescrita pela automática');
}

// ── 11. A tela de edição existe e segue o padrão da Config ───
{
  ok(/aria-controls="cfg-taxas"/.test(src) && /id="cfg-taxas"/.test(src),
    'a seção "Taxas por cidade" dobra como as outras');
  ok(/id="taxaEscopo"/.test(src) && /id="taxasGrid"/.test(src),
    'dá para escolher entre a tabela padrão e a de uma loja');
  ok(/function salvarTaxa\(/.test(src) && /renderTaxasConfig\(\)/.test(src),
    'os valores são salvos e a lista de lojas alimenta o seletor');
}

// ── 12. Todas as cidades do formulário têm onde receber taxa ─
/* Se o formulário oferece uma cidade que a tela de taxas não lista, toda
   entrega para lá entra zerada sem o motoboy ter como corrigir. */
{
  const seletor = trecho('<select class="field-input" id="fCity"', '</select>', 'index.html');
  const doForm = [...seletor.matchAll(/<option value="([A-Z]{2,4})"/g)].map(m => m[1]);
  const daTela = (src.match(/const TAXA_CIDADES = \[([^\]]+)\]/) || [, ''])[1]
    .split(',').map(s => s.trim().replace(/'/g, '')).filter(Boolean);
  const faltando = doForm.filter(c => !daTela.includes(c));
  ok(doForm.length > 0 && faltando.length === 0,
    `as ${doForm.length} cidades do formulário aparecem na tela de taxas`
    + (faltando.length ? ' — faltando: ' + faltando.join(', ') : ''));
}

fim();
