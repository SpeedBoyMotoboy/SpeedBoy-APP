/* ═══════════════════════════════════════════════════════════════
   As regras do banco cobrem tudo que o app grava?

   `$desconhecido: {".validate": false}` existe para recusar caminho
   inventado — e é a regra mais perigosa do arquivo, porque a recusa é
   SILENCIOSA para quem está usando o app: a gravação falha no console do
   navegador e a tela não muda de aparência.

   Foi exatamente o que aconteceu com `tombs`, o caminho das exclusões. Ele
   nunca esteve nas regras. Publicadas, a consequência seria:

     • apagar uma parada num celular pararia de chegar no outro — ela
       voltaria à lista dela no snapshot seguinte, e ninguém saberia por quê
     • o `Promise.all` do fbPush rejeitaria em toda gravação, então a
       pendência nunca seria limpa: o ponto de sincronização ficaria em
       "⏳ Aguardando envio" para sempre, mesmo com tudo enviado

   Este teste lê os caminhos que as quatro páginas realmente usam e exige
   que cada um tenha regra. Não protege contra regra errada — protege
   contra regra AUSENTE, que é o caso que não dá erro visível.
   ═══════════════════════════════════════════════════════════════ */
import { lerApp, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();
const PAGINAS = ['index.html', 'pedido.html', 'motoboy.html', 'fatura.html'];

const regras = JSON.parse(lerApp('database.rules.json'));
const sala = regras.rules.rooms.$room;

/* Primeiro filho de `rooms/<sala>/` em cada caminho citado no código.

   O nome da sala é sempre uma variável, então o caminho aparece partido em
   pedaços: `'rooms/' + room + '/stops'` ou `` `rooms/${room}/stops` ``.
   Normaliza os dois formatos para `rooms/#/stops` ANTES de procurar —
   procurar direto no texto casa só até a primeira aspa. */
function caminhosUsados(src) {
  const normal = src
    .replace(/'\s*\+\s*[^+']*?\s*\+\s*'/g, '#')   // 'rooms/' + room + '/stops'
    .replace(/\$\{[^}]*\}/g, '#')                 // `rooms/${room}/stops`
    .replace(/'\s*\+\s*[\w.$()]+/g, '#');         // 'rooms/' + room  (fim da string)
  const achados = new Set();
  for (const m of normal.matchAll(/rooms\/[#\w-]+\/([\w-]+)/g)) achados.add(m[1]);
  return achados;
}

const usados = new Set();
for (const arq of PAGINAS) for (const c of caminhosUsados(lerApp(arq))) usados.add(c);

ok(usados.size >= 8,
  `os caminhos do app foram encontrados no código (achou ${usados.size}: ${[...usados].sort().join(', ')})`);

// ── Todo caminho usado tem regra ───────────────────────────────
const semRegra = [...usados].filter(no => !(no in sala)).sort();
ok(semRegra.length === 0,
  'todo caminho que o app grava tem regra em database.rules.json' +
  (semRegra.length
    ? ` — SEM REGRA (o $desconhecido recusa em silêncio): ${semRegra.join(', ')}`
    : ''));

// ── E toda regra tem teto de tamanho ───────────────────────────
/* Sem teto, um bug de laço enche o banco e derruba a cota do plano — e a
   cota derrubada afeta as quatro páginas ao mesmo tempo. */
const semTeto = Object.entries(sala)
  .filter(([no]) => !no.startsWith('.') && no !== '$desconhecido')
  .filter(([, v]) => {
    const val = v['.validate'] || (v.$item && v.$item['.validate']) || '';
    return !/length\s*<=\s*\d+/.test(val);
  })
  .map(([no]) => no);
ok(semTeto.length === 0,
  'toda regra tem teto de tamanho' + (semTeto.length ? ` — sem teto: ${semTeto.join(', ')}` : ''));

// ── A trava que torna isto necessário continua lá ──────────────
ok(sala.$desconhecido && sala.$desconhecido['.validate'] === false,
  'caminho não previsto continua sendo recusado ($desconhecido)');
ok(regras.rules['.read'] === false && regras.rules['.write'] === false,
  'nada fora de rooms/ é acessível');
ok(/auth != null/.test(sala['.read']) && /auth != null/.test(sala['.write']),
  'leitura e escrita exigem sessão autenticada');
ok(/SB-\[A-Z0-9\]\{4\}/.test(sala['.write']),
  'só sala no formato SB-XXXX (impede criar lixo em caminho inventado)');

// ── O teto da foto bate com o que o motoboy.html gera ──────────
{
  const moto = lerApp('motoboy.html');
  const limite = Number((moto.match(/var LIMITE=(\d+)/) || [])[1]);
  const regra = Number((sala.proofs.$item['.validate'].match(/<=\s*(\d+)/) || [])[1]);
  ok(!!limite && limite <= regra,
    `o comprovante gerado (${limite}) cabe no teto da regra (${regra}) — maior, a foto seria recusada depois de tirada`);
}

fim();
