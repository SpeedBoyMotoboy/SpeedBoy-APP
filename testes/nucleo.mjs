/* Núcleo compartilhado (speedboy-core.js).

   O teste que mais importa aqui é o dos bairros. A lista existia duas
   vezes, em formatos diferentes, e tinha divergido: 93 bairros que o
   cliente conseguia escolher no pedido.html não existiam no app. Unificar
   só vale se NENHUM bairro se perder no caminho — é isso que a seção 2
   verifica, cidade por cidade, contra as duas listas originais. */
import fs from 'fs';
import path from 'path';
import { RAIZ, lerApp, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();

// Carrega o núcleo do jeito que o navegador carrega
const janela = { localStorage: (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
})() };
new Function('window', 'localStorage', 'document',
  fs.readFileSync(path.join(RAIZ, 'speedboy-core.js'), 'utf8')
)(janela, janela.localStorage, undefined);
const SB = janela.SpeedBoy;

// ── 1. O núcleo expõe o que as páginas usam ──────────────────
{
  const faltando = ['parseMoney','fmtMoney','maskMoney','maskPhone','fmtPhone','CIDADE_BAIRROS',
                    'nomeDaCidade','bairrosDaCidade','getCustomBairros','saveCustomBairros',
                    'addCustomBairro','aplicarTema','alternarTema','toast']
    .filter(n => SB[n] === undefined);
  ok(faltando.length === 0, 'o núcleo expõe tudo que as páginas precisam' +
    (faltando.length ? ' — faltando: ' + faltando.join(', ') : ''));

  // onclick/oninput só enxergam o escopo global
  const semGlobal = ['parseMoney','fmtMoney','maskMoney','maskPhone','fmtPhone','CIDADE_BAIRROS']
    .filter(n => janela[n] === undefined);
  ok(semGlobal.length === 0, 'os nomes usados em atributos inline existem no escopo global' +
    (semGlobal.length ? ' — faltando: ' + semGlobal.join(', ') : ''));
}

// ── 2. NENHUM BAIRRO PODE TER SUMIDO ─────────────────────────
/* A base de comparação está CONGELADA em bairros-antes.json, gerado uma
   vez do último commit anterior à Etapa 5.

   A primeira versão deste teste lia as duas listas antigas de
   `git show origin/main:...`. Funcionou até o PR da Etapa 5 ser mesclado:
   aí `origin/main` PASSOU A SER o código novo, a referência sumiu e o
   teste quebrou na main. Base de comparação não pode ser uma referência
   que se move — e ainda por cima o CI clona raso, então nem sempre há
   histórico para ler. */
{
  const ANTES = JSON.parse(fs.readFileSync(path.join(RAIZ, 'testes', 'bairros-antes.json'), 'utf8'));
  const codigos = Object.keys(ANTES.cidades).sort();

  ok(codigos.length > 0, `a base congelada foi lida (${codigos.length} cidades)`);

  let perdidos = 0;
  for (const cid of codigos) {
    const antes = ANTES.cidades[cid].bairros;
    const agora = new Set((SB.CIDADE_BAIRROS[cid] || { bairros: [] }).bairros);
    const sumiram = antes.filter(b => !agora.has(b));
    perdidos += sumiram.length;
    ok(sumiram.length === 0,
      `${cid} (${SB.nomeDaCidade(cid)}): ${antes.length} bairros preservados` +
      (sumiram.length ? ` — SUMIRAM ${sumiram.length}: ${sumiram.slice(0, 5).join(', ')}` : ''));
  }
  ok(perdidos === 0, `nenhum bairro perdido na unificação (${perdidos} perdas)`);

  // E o app tem que continuar com os que só existiam no formulário do cliente
  ok(ANTES.totalGanhos === 93,
    `a base congelada registra os 93 bairros que só o cliente tinha (${ANTES.totalGanhos})`);
}

// ── 3. Formato único ─────────────────────────────────────────
{
  const cids = Object.keys(SB.CIDADE_BAIRROS);
  const malFormados = cids.filter(c => {
    const v = SB.CIDADE_BAIRROS[c];
    return !v || typeof v.nome !== 'string' || !Array.isArray(v.bairros);
  });
  ok(malFormados.length === 0, 'toda cidade tem {nome, bairros[]}' +
    (malFormados.length ? ' — quebradas: ' + malFormados.join(', ') : ''));
  ok(SB.nomeDaCidade('SRR') === 'Serra', 'nomeDaCidade resolve o código');
  ok(SB.nomeDaCidade('OUT') === 'Outra', 'OUT continua sendo "Outra" (não está na lista de bairros)');
  ok(SB.nomeDaCidade('') === '', 'código vazio não quebra');
}

// ── 4. Bairros personalizados: os dois escopos convivem ──────
// O app guarda tudo junto; o formulário guarda por loja. Eram duas
// funções com o mesmo nome e storages diferentes.
{
  SB.addCustomBairro('SRR', 'Meu Bairro App');
  SB.addCustomBairro('SRR', 'Bairro Da Loja', 'KS');
  const doApp  = SB.getCustomBairros();
  const daLoja = SB.getCustomBairros('KS');
  ok((doApp.SRR || []).includes('Meu Bairro App'), 'escopo do app guarda o bairro do app');
  ok(!(doApp.SRR || []).includes('Bairro Da Loja'), 'o bairro da loja NÃO vaza para o escopo do app');
  ok((daLoja.SRR || []).includes('Bairro Da Loja'), 'escopo da loja guarda o bairro da loja');
  ok(!(daLoja.SRR || []).includes('Meu Bairro App'), 'o bairro do app NÃO vaza para o escopo da loja');

  ok(SB.addCustomBairro('SRR', 'Meu Bairro App') === false, 'não duplica bairro já existente');
  ok(SB.addCustomBairro('', 'x') === false, 'cidade vazia é recusada');

  const lista = SB.bairrosDaCidade('SRR');
  ok(lista.includes('Meu Bairro App'), 'bairrosDaCidade junta oficiais e personalizados');
  ok(new Set(lista).size === lista.length, 'sem repetição na lista final');
  ok(SB.bairrosDaCidade('NAOEXISTE').length === 0, 'cidade desconhecida devolve lista vazia');
}

// ── 5. Telefone: o bug do motoboy.html ───────────────────────
{
  ok(SB.fmtPhone('27999165959') === '(27) 99916-5959', 'formata celular de 11 dígitos');
  ok(SB.fmtPhone(null) === '', 'telefone nulo não quebra (o motoboy.html quebrava)');
  ok(SB.fmtPhone(undefined) === '', 'telefone indefinido não quebra');
  ok(SB.fmtPhone('') === '', 'telefone vazio devolve vazio');
  ok(SB.fmtPhone('123') === '123', 'número curto passa intacto');
}

// ── 6. Dinheiro ──────────────────────────────────────────────
{
  ok(SB.parseMoney('12,50') === 12.5, 'parseMoney aceita vírgula');
  ok(SB.parseMoney('') === 0, 'vazio vira zero');
  ok(SB.parseMoney(null) === 0, 'nulo vira zero');
  ok(SB.fmtMoney(12.5) === 'R$ 12,50', 'fmtMoney formata em real');
  ok(SB.fmtMoney('abc') === 'R$ 0,00', 'valor inválido vira zero');
}

// ── 7. Nenhuma página redeclara o que o núcleo já dá ─────────
{
  const PAGINAS = ['index.html', 'pedido.html', 'motoboy.html'];
  const SIMBOLOS = ['parseMoney', 'fmtPhone', 'maskPhone', 'CIDADE_BAIRROS',
                    'getCustomBairros', 'saveCustomBairros', 'addCustomBairro'];
  /* Adaptador de uma linha que delega ao núcleo é intencional — é assim que
     o pedido.html carrega o escopo da loja. O que não pode voltar é a
     REIMPLEMENTAÇÃO: um corpo que não menciona SpeedBoy. */
  for (const arq of PAGINAS) {
    const src = lerApp(arq);
    const reimplementados = SIMBOLOS.filter(nome => {
      const m = new RegExp(`function\\s+${nome}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]{0,400}?)\\n?\\}`).exec(src);
      if (m) return !m[1].includes('SpeedBoy.');
      const d = new RegExp(`(var|const|let)\\s+${nome}\\s*=\\s*([\\s\\S]{0,200})`).exec(src);
      return !!d && !d[2].includes('SpeedBoy.');
    });
    ok(reimplementados.length === 0,
      `${arq}: não reimplementa o que vem do núcleo` +
      (reimplementados.length ? ` — ainda local: ${reimplementados.join(', ')}` : ''));
  }
}

fim();
