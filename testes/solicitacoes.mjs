/* Solicitações do cliente (editar / cancelar).

   O bug: pedido.html gravava em client_requests/<chave-do-pedido> com
   .set(), e index.html deduplicava por essa mesma chave. Uma edição e um
   cancelamento do MESMO pedido se sobrescreviam no banco, e o segundo
   ainda era descartado pelo dedup. O motoboy só via um dos dois.

   O código é extraído dos arquivos reais, não copiado. */
import { trecho, lerApp, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();

// ── 1. pedido.html usa push(), não set() na chave do pedido ──
{
  const src = lerApp('pedido.html');
  const escritas = src.match(/client_requests[^\n]*/g) || [];
  ok(escritas.length === 2, `as duas escritas de solicitação existem (achou ${escritas.length})`);

  const naChave = escritas.filter(l => /client_requests['"]?\s*\+\s*['"]?\/?['"]?\s*\+?\s*\w*\)?\.set\(/.test(l)
                                     || /client_requests\/['"]\s*\+\s*\w+\)\.set\(/.test(l));
  ok(naChave.length === 0,
    'nenhuma solicitação é gravada com set() na chave do pedido' +
    (naChave.length ? '\n     ' + naChave.join('\n     ') : ''));

  ok(escritas.every(l => l.includes('.push(')),
    'as duas solicitações usam push() — cada uma ganha chave própria');
  ok((src.match(/orderKey:/g) || []).length === 2,
    'as duas carregam orderKey, para o app saber a qual entrega se referem');
}

// ── 2. index.html separa a solicitação da entrega ──
{
  const src = lerApp('index.html');
  ok(/function chaveDoPedido\(/.test(src), 'existe chaveDoPedido(reqId, req)');
  ok(/function showEditRequest\(reqId,req\)/.test(src), 'showEditRequest recebe reqId');
  ok(/function showCancelRequest\(reqId,req\)/.test(src), 'showCancelRequest recebe reqId');
  ok(/async function rmClientRequest\(reqId\)/.test(src), 'rmClientRequest remove a solicitação, não a entrega');

  // O dedup precisa ser pela solicitação; pela entrega, o 2o pedido some.
  ok(/_crSeen\[reqId\]/.test(src), 'o dedup é por solicitação (_crSeen[reqId])');
}

// ── 3. chaveDoPedido: nova e antiga ──
{
  /* O corte para em `async function showEditRequest`, não em `function ...`:
     showEditRequest virou async na Etapa 6, e cortar no `function` deixava
     um `async` solto no fim do trecho — o extrato nem parseava. */
  const bloco = trecho('function chaveDoPedido(', 'async function showEditRequest(');
  const { chaveDoPedido } = new Function(bloco + '\nreturn {chaveDoPedido};')();

  ok(chaveDoPedido('req-1', { orderKey: 'pedido-9' }) === 'pedido-9',
    'solicitação nova aponta para a entrega pelo orderKey');
  ok(chaveDoPedido('pedido-9', { type: 'cancel' }) === 'pedido-9',
    'solicitação ANTIGA (sem orderKey) continua funcionando — a chave dela era a do pedido');
  ok(chaveDoPedido('pedido-9', null) === 'pedido-9', 'payload inválido não derruba');
}

// ── 4. O cenário do bug: editar e cancelar o mesmo pedido ──
// Reproduz as duas gravações e confere que sobrevivem separadas.
{
  const banco = {};
  let seq = 0;
  const push = valor => { banco['-req' + (++seq)] = valor; };

  const PEDIDO = 'pedido-abc';
  push(JSON.stringify({ type: 'edit',   orderKey: PEDIDO, name: 'Ana', fields: { notes: 'trocar' }, ts: 1 }));
  push(JSON.stringify({ type: 'cancel', orderKey: PEDIDO, name: 'Ana', ts: 2 }));

  const chaves = Object.keys(banco);
  ok(chaves.length === 2, `as duas solicitações coexistem no banco (achou ${chaves.length})`);

  // Lado do app: dedup por solicitação, alvo pelo orderKey
  const vistos = {};
  const tratadas = [];
  for (const [reqId, raw] of Object.entries(banco)) {
    if (vistos[reqId]) continue;
    vistos[reqId] = true;
    const req = JSON.parse(raw);
    tratadas.push({ tipo: req.type, pedido: req.orderKey || reqId });
  }
  ok(tratadas.length === 2, 'o app trata as duas — antes o dedup engolia a segunda');
  ok(tratadas.every(t => t.pedido === PEDIDO), 'ambas apontam para a mesma entrega');
  ok(tratadas[0].tipo === 'edit' && tratadas[1].tipo === 'cancel',
    'chegam na ordem em que o cliente pediu');

  // Com o comportamento antigo (chave = pedido), a segunda sobrescrevia a primeira
  const bancoAntigo = {};
  bancoAntigo[PEDIDO] = JSON.stringify({ type: 'edit', name: 'Ana' });
  bancoAntigo[PEDIDO] = JSON.stringify({ type: 'cancel', name: 'Ana' });
  ok(Object.keys(bancoAntigo).length === 1,
    'confirmado que o formato antigo perdia uma das duas (só 1 chave sobra)');
}

// ── 5. Pedido ainda não aceito também aceita edição/cancelamento ──
// Antes, se o cliente pedisse alteração antes de o motoboy aceitar, a
// entrega não estava em `stops` e o pedido dele era simplesmente descartado
// com "não encontrada".
{
  const src = lerApp('index.html');
  ok(/async function updatePending\(key,obj\)/.test(src),
    'existe updatePending() para gravar de volta o pedido pendente');
  ok(/else if\(pendingData\[key\]\)\{\s*\n?\s*Object\.assign\(pendingData\[key\]/.test(src)
     || /else if\(pendingData\[key\]\)\{[\s\S]{0,120}Object\.assign\(pendingData\[key\]/.test(src),
    'editar cai em /pending quando a entrega ainda não foi aceita');
  ok(/else if\(pendingData\[key\]\)\{\s*rmPending\(key\)/.test(src),
    'cancelar remove de /pending quando a entrega ainda não foi aceita');
  ok(!/toast\('⚠️ Entrega não encontrada nos stops ativos'/.test(src),
    'o caminho "não encontrada nos stops ativos" deixou de descartar o pedido');
}

fim();
