/* ═══════════════════════════════════════════════════════════════
   Fechamento — duas formas de o total sair errado.

   As duas foram encontradas lendo o código, não relatadas: nenhuma delas
   dá erro, avisa ou aparece na tela. O número simplesmente sai diferente
   do que o dia foi, e o motoboy fatura por esse número.

   Como sempre, o código testado é EXTRAÍDO do index.html — não é cópia.
   ═══════════════════════════════════════════════════════════════ */
import { trecho, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();

/* Sandbox mínimo: as duas funções mexem em `history`, `stops` e chamam
   saveHistory/idDaParada/parseMoney/parseDate. */
function montar() {
  const ctx = {
    history: [], stops: [],
    saveHistory() {},
    idDaParada(s) {
      if (s._id) return s._id;
      if (s._trackKey) return 'tk_' + s._trackKey;
      return 'h_' + [s.name, s.address, s.street, s.number, s.value, s._addedDate].join('|');
    },
    parseMoney(v) { return Number(String(v == null ? 0 : v).replace(',', '.')) || 0; },
    parseDate(d) { const [dia, mes, ano] = String(d).split('/'); return new Date(+ano, +mes - 1, +dia); },
    reportPeriod: 'month',
    fmtMoney(v) { return 'R$ ' + Number(v).toFixed(2); }
  };

  const fonte =
    trecho('function saveToHistory(date){', '\n// ═══', 'index.html') +
    trecho('function getReportData(){', '\nfunction genReportNumber', 'index.html');

  // `history` e `stops` precisam ser variáveis livres do trecho: entram como parâmetros.
  const fabrica = new Function(
    'ctx',
    `with (ctx) { ${fonte}; return { saveToHistory, getReportData }; }`
  );
  return { ctx, ...fabrica(ctx) };
}

const HOJE = new Date().toLocaleDateString('pt-BR');

// ── 1. Limpar a lista duas vezes no mesmo dia ────────────────
/* Cenário real: o motoboy limpa a lista no fim da manhã e de novo no fim
   da tarde. Antes, o segundo "limpar" gravava por cima do primeiro e as
   entregas da manhã sumiam do histórico — junto com o dinheiro delas. */
{
  const { ctx, saveToHistory } = montar();

  ctx.stops = [
    { _id: 'a', name: 'Manhã 1', value: '27', done: true },
    { _id: 'b', name: 'Manhã 2', value: '20', done: true }
  ];
  saveToHistory(HOJE);
  ctx.stops = [];

  ctx.stops = [{ _id: 'c', name: 'Tarde 1', value: '20', done: true }];
  saveToHistory(HOJE);
  ctx.stops = [];

  const dia = ctx.history.find(d => d.date === HOJE);
  const nomes = (dia ? dia.stops : []).map(s => s.name);
  ok(nomes.length === 3,
    `limpar a lista duas vezes no mesmo dia guarda as 3 entregas (guardou ${nomes.length}: ${nomes.join(', ')})`);

  const soma = (dia ? dia.stops : []).reduce((t, s) => t + Number(s.value), 0);
  ok(soma === 67, `o dia continua somando R$ 67 (somou R$ ${soma})`);
}

// ── 2. A mesma parada, atualizada, não vira duas ─────────────
// Fundir não pode duplicar: mesma identidade, versão nova vence.
{
  const { ctx, saveToHistory } = montar();

  ctx.stops = [{ _id: 'a', name: 'Cliente', value: '10', done: true }];
  saveToHistory(HOJE);

  ctx.stops = [{ _id: 'a', name: 'Cliente', value: '15', done: true }];   // corrigiu o valor
  saveToHistory(HOJE);

  const dia = ctx.history.find(d => d.date === HOJE);
  ok(dia.stops.length === 1, `a mesma parada não duplica no histórico (ficou com ${dia.stops.length})`);
  ok(dia.stops[0].value === '15', `a versão mais nova vence (ficou ${dia.stops[0].value})`);
}

// ── 3. Contagem dupla no fechamento ──────────────────────────
/* getReportData lê `[{date:hoje, stops}, ...history]`. Depois de um
   "limpar o dia", a MESMA entrega existe nos dois lugares — e entrava
   duas vezes no total. */
{
  const { ctx, getReportData } = montar();

  const entrega = { _id: 'a', name: 'Cliente', value: '30', done: true, paid: true };
  ctx.stops = [entrega];
  ctx.history = [{ date: HOJE, stops: [JSON.parse(JSON.stringify(entrega))] }];

  const d = getReportData();
  ok(d.deliveries === 1, `uma entrega em dois lugares conta UMA vez (contou ${d.deliveries})`);
  ok(d.total === 30, `o total não dobra (deu R$ ${d.total}, esperado R$ 30)`);
  ok(d.received === 30, `o recebido não dobra (deu R$ ${d.received})`);
}

// ── 4. Entregas diferentes continuam somando ─────────────────
// A trava não pode engolir entrega legítima.
{
  const { ctx, getReportData } = montar();
  ctx.stops = [
    { _id: 'a', name: 'A', value: '10', done: true },
    { _id: 'b', name: 'B', value: '20', done: true }
  ];
  ctx.history = [{ date: HOJE, stops: [{ _id: 'c', name: 'C', value: '30', done: true }] }];

  const d = getReportData();
  ok(d.deliveries === 3, `três entregas distintas continuam contando (contou ${d.deliveries})`);
  ok(d.total === 60, `o total soma as três (deu R$ ${d.total})`);
}

// ── 5. Parada não entregue continua fora ─────────────────────
{
  const { ctx, getReportData } = montar();
  ctx.stops = [
    { _id: 'a', name: 'Entregue', value: '10', done: true },
    { _id: 'b', name: 'Pendente', value: '99', done: false }
  ];
  const d = getReportData();
  ok(d.deliveries === 1 && d.total === 10,
    `parada ainda não entregue fica fora do fechamento (${d.deliveries} entrega, R$ ${d.total})`);
}

fim();
