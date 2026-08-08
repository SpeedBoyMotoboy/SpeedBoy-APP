/* ═══════════════════════════════════════════════════════════════
   Configurações e primeiro uso.

   Dois problemas medidos no app antes desta etapa:

   1. A tela de Config tinha 1899px de conteúdo — 2,7 telas de rolagem —
      porque só uma das sete seções dobrava. O campo do código da sala,
      que é o que uma pessoa num aparelho novo precisa achar, ficava a
      1116px do topo.

   2. O botão "🔄 Novo" trocava o código da sala em UM toque, sem
      confirmação. Trocar desconecta o outro celular em silêncio: os dois
      continuam funcionando, gravando em salas diferentes, sem erro
      nenhum na tela.
   ═══════════════════════════════════════════════════════════════ */
import { trecho, lerApp, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();
const src = lerApp('index.html');

// ── 1. Todas as seções dobram, e pelo mesmo mecanismo ────────
/* Antes, "Links das Lojas" dobrava com uma função própria e estilos
   inline, e as outras seis não dobravam. "Modo FULL" entrou depois e
   segue o mesmo mecanismo — a lista abaixo é o contrato. */
{
  const SECOES = ['lojas', 'rapidas', 'full', 'links', 'sync', 'fatura', 'backup', 'perigo'];
  const faltando = SECOES.filter(s =>
    !new RegExp(`aria-controls="cfg-${s}"`).test(src) || !new RegExp(`id="cfg-${s}"`).test(src));
  ok(faltando.length === 0,
    'todas as seções da Config dobram' + (faltando.length ? ' — faltando: ' + faltando.join(', ') : ''));

  ok(!/toggleLinksPanel/.test(src),
    'a função ad-hoc que dobrava só os Links foi embora');

  // O cabeçalho precisa ser botão de verdade: div com onclick não é focável
  // nem anunciada como controle pelo leitor de tela.
  const cabecalhos = src.match(/<button[^>]*class="cfg-cab[^"]*"[^>]*>/g) || [];
  ok(cabecalhos.length === SECOES.length,
    `os ${SECOES.length} cabeçalhos são <button> (achou ${cabecalhos.length})`);
  ok(cabecalhos.every(c => /aria-expanded=/.test(c)),
    'todo cabeçalho declara aria-expanded');
}

// ── 2. O padrão de aberto/fechado segue a frequência de uso ──
{
  const padrao = trecho('const CFG_ABERTAS_PADRAO', ';', 'index.html');
  ok(/lojas:true/.test(padrao) && /rapidas:true/.test(padrao),
    'o que se usa todo dia (lojas, lojas rápidas) começa aberto');
  ok(/fatura:false/.test(padrao) && /backup:false/.test(padrao) && /perigo:false/.test(padrao),
    'o que se usa uma vez (fatura, backup, perigo) começa fechado');

  const aplicar = trecho('function aplicarDobras(){', '\n/* Resumo', 'index.html');
  ok(/sb_room_code/.test(aplicar) && /estado\.sync\s*=\s*true/.test(aplicar),
    'sem sala configurada, a Sincronização abre sozinha — é o que a pessoa foi procurar');
}

// ── 3. Fechado não pode virar "não sei o que tem lá" ─────────
{
  const resumo = trecho('function atualizarResumosCfg(){', '\n}', 'index.html');
  for (const secao of ['lojas', 'rapidas', 'full', 'links', 'sync', 'fatura', 'backup']) {
    ok(resumo.includes(`'${secao}'`), `a seção "${secao}" mostra um resumo quando fechada`);
  }
  ok(/\.cfg-cab\[aria-expanded="true"\]\s+\.cfg-resumo\s*\{[^}]*display:\s*none/.test(src),
    'o resumo some quando a seção está aberta (a informação já está à vista)');
}

// ── 4. O CÓDIGO DA SALA NÃO TROCA EM UM TOQUE ────────────────
/* O caso que motivou: os dois celulares na mesma sala, alguém toca em
   "Novo" sem querer, e a partir dali as listas param de conversar sem
   nenhum aviso nos dois lados. */
{
  const corpo = trecho('async function newRoom(){', '\nfunction trocarSalaPara', 'index.html');

  ok(/confirmarAcao\(/.test(corpo), 'newRoom pede confirmação antes de trocar a sala');
  ok(/PARA de receber|para de receber/.test(corpo),
    'a confirmação diz a consequência: o outro celular para de receber');
  ok(/perigo:\s*true/.test(corpo), 'a confirmação é marcada como destrutiva');
  ok(/comDesfazer\(/.test(corpo), 'e ainda oferece desfazer, voltando ao código anterior');

  // Sala nova em aparelho zerado não tem o que desfazer — nem deve oferecer.
  ok(/anterior\s*\?/.test(corpo),
    'sem sala anterior, não oferece um desfazer que não faria nada');
}

// ── 5. O código da sala existe antes de a Config abrir ───────
/* Ele só nascia dentro de loadConfig(). Num aparelho recém-instalado
   ninguém abriu a Config ainda — e o cartão de boas-vindas precisa
   mostrar o código logo na primeira tela. */
{
  const corpo = trecho('function salaAtual(){', '\n}', 'index.html');
  ok(/EMBEDDED_ROOM/.test(corpo), 'salaAtual respeita a sala embutida');
  ok(/genRoomCode\(\)/.test(corpo) && /setItem\('sb_room_code'/.test(corpo),
    'salaAtual gera e guarda o código quando ainda não existe');
  ok(/const sala = salaAtual\(\)/.test(src),
    'o cartão de boas-vindas usa salaAtual — não lê o localStorage cru');
}

// ── 6. Primeiro uso: aparece na hora certa e some para sempre ─
{
  const corpo = trecho('function ehPrimeiroUso(){', '\n}', 'index.html');
  ok(/!stops\.length/.test(corpo) && /!history\.length/.test(corpo),
    'o cartão só aparece com o app realmente vazio (sem paradas e sem histórico)');
  ok(/sb_ja_comecou/.test(corpo),
    'depois de começar, o cartão não volta mais');

  const entrar = trecho('function entrarPeloBemVindo(){', '\n}', 'index.html');
  ok(/SB-\[A-Z0-9\]\{4\}/.test(entrar),
    'o código digitado é validado no mesmo formato que as regras do Firebase exigem');
  ok(/toast\(/.test(entrar),
    'código inválido avisa em vez de deixar a pessoa esperando uma lista que não vem');
}

// ── 7. O código do cliente nunca entra cru na tela ───────────
// O cartão interpola a sala em innerHTML.
{
  const cartao = trecho('function cartaoPrimeiroUso(){', '\n}', 'index.html');
  ok(/esc\(sala/.test(cartao), 'o código da sala passa por esc() antes de virar HTML');
}

fim();
