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

/* ═══════════════════════════════════════════════════════════════
   CORRIGIR ENTREGA JÁ FECHADA

   O que dava para consertar numa entrega antiga: o valor, e só na lista
   dos últimos 30 dias da inicial. Nome errado não tinha conserto em lugar
   nenhum, e entrega do mês passado não aparecia em tela que permitisse
   editar. O fechamento vira fatura — nome trocado e taxa zerada vão
   inteiros para o PDF que a loja recebe para conferir.
   ═══════════════════════════════════════════════════════════════ */

// Sandbox da correção: mexe em history/stops e move parada entre dias.
function montarEdicao() {
  const ctx = {
    history: [], stops: [],
    parseMoney(v) { return Number(String(v == null ? 0 : v).replace(',', '.')) || 0; },
    parseDate(d) { const [dia, mes, ano] = String(d).split('/'); return new Date(+ano, +mes - 1, +dia); }
  };
  const fonte =
    trecho('function paradaPorRef(ref){', '\nfunction abrirEditHist', 'index.html') +
    trecho('function brParaISO(br){', '\n/* Trocar a data', 'index.html') +
    trecho('function moverParadaDeDia(', '\n/* ── O que provavelmente', 'index.html') +
    trecho('function entregasSuspeitas(d){', '\nfunction _renderSuspeitas', 'index.html');
  const fabrica = new Function('ctx',
    `with (ctx) { ${fonte}; return { paradaPorRef, moverParadaDeDia, entregasSuspeitas, brParaISO, isoParaBR }; }`);
  return { ctx, ...fabrica(ctx) };
}

// ── Achar a entrega certa para corrigir ──────────────────────
{
  const { ctx, paradaPorRef } = montarEdicao();
  ctx.stops = [{ _id: 'hoje', name: 'De hoje' }];
  ctx.history = [
    { date: '05/07/2026', stops: [{ _id: 'a', name: 'Ana' }, { _id: 'b', name: 'Beto' }] },
    { date: '04/07/2026', stops: [{ _id: 'c', name: 'Caio' }] }
  ];
  ok(paradaPorRef({ data: '05/07/2026', si: 1 }).name === 'Beto',
    'a entrega é endereçada por DATA + índice, não por índice do array inteiro');
  ok(paradaPorRef({ data: '04/07/2026', si: 0 }).name === 'Caio',
    'e acha em qualquer dia do histórico, não só nos últimos 30');
  ok(paradaPorRef({ hoje: true, si: 0 }).name === 'De hoje',
    'a de hoje vem de stops, não do histórico');
  ok(paradaPorRef({ data: '01/01/2000', si: 0 }) === null,
    'dia que não existe devolve nulo em vez de quebrar');
  ok(paradaPorRef({ data: '05/07/2026', si: 99 }) === null,
    'índice fora da lista devolve nulo');
  ok(paradaPorRef(null) === null, 'sem referência, nulo');
}

// ── Trocar a data move a entrega de dia ──────────────────────
/* Sem mover, a entrega ficaria listada sob a data antiga: o total dos DOIS
   dias continuaria errado, e no fim do mês a fatura também. */
{
  const { ctx, moverParadaDeDia } = montarEdicao();
  ctx.history = [
    { date: '05/07/2026', stops: [{ _id: 'a', name: 'Ana' }, { _id: 'b', name: 'Beto' }] },
    { date: '03/07/2026', stops: [{ _id: 'c', name: 'Caio' }] }
  ];
  ok(moverParadaDeDia('05/07/2026', 0, '03/07/2026') === true, 'a mudança de dia acontece');
  ok(ctx.history.find(d => d.date === '05/07/2026').stops.length === 1,
    'a entrega sai do dia antigo');
  ok(ctx.history.find(d => d.date === '03/07/2026').stops.map(s => s.name).join(',') === 'Caio,Ana',
    'e entra no dia novo');
}
{
  // Dia de destino que ainda não existe precisa ser criado
  const { ctx, moverParadaDeDia } = montarEdicao();
  ctx.history = [{ date: '05/07/2026', stops: [{ _id: 'a', name: 'Ana' }] }];
  moverParadaDeDia('05/07/2026', 0, '28/06/2026');
  const destino = ctx.history.find(d => d.date === '28/06/2026');
  ok(!!destino && destino.stops[0].name === 'Ana', 'dia de destino inexistente é criado');
  ok(!ctx.history.some(d => d.date === '05/07/2026'),
    'e o dia que ficou vazio some, em vez de virar um dia de zero entregas no fechamento');
}
{
  // Ordem do histórico: o app inteiro conta com mais recente primeiro
  const { ctx, moverParadaDeDia } = montarEdicao();
  ctx.history = [
    { date: '05/07/2026', stops: [{ _id: 'a', name: 'Ana' }, { _id: 'z', name: 'Zeca' }] },
    { date: '01/07/2026', stops: [{ _id: 'c', name: 'Caio' }] }
  ];
  moverParadaDeDia('05/07/2026', 0, '10/07/2026');
  ok(ctx.history.map(d => d.date).join(' ') === '10/07/2026 05/07/2026 01/07/2026',
    'o histórico continua em ordem, do mais recente para o mais antigo');
}

// ── Datas: ida e volta entre o campo e o app ─────────────────
/* O <input type="date"> fala ISO; o app inteiro fala dd/mm/aaaa. Converter
   errado colocaria a entrega em outro mês sem ninguém pedir. */
{
  const { brParaISO, isoParaBR } = montarEdicao();
  ok(brParaISO('05/07/2026') === '2026-07-05', 'dd/mm/aaaa vira ISO para o campo');
  ok(isoParaBR('2026-07-05') === '05/07/2026', 'e ISO volta para dd/mm/aaaa');
  ok(brParaISO('5/7/2026') === '2026-07-05', 'dia e mês sem zero à esquerda também');
  ok(brParaISO('') === '' && isoParaBR('') === '', 'vazio não vira data inventada');
  ok(isoParaBR(brParaISO('31/12/2025')) === '31/12/2025', 'a ida e a volta preservam a data');
}

// ── A varredura acha o que quebraria a fatura ────────────────
{
  const { entregasSuspeitas } = montarEdicao();
  const d = { allStops: [
    { name: 'Ana Souza', value: 12, store: 'KS' },                 // ok
    { name: '', value: 15, store: 'KS' },                          // sem nome
    { name: 'Beto', value: 0, store: 'KS' },                       // taxa zerada
    { name: 'Caio', value: 10, store: '' },                        // sem loja
    { name: 'Sem nome', value: 0, store: '' },                     // três motivos
    { name: 'Duda', value: 0, store: 'KS', _cancelled: true },     // cancelada: zero é o certo
    { name: 'Elis', value: 0, store: 'KS', cancelled: true }
  ]};
  const r = entregasSuspeitas(d);
  ok(r.length === 4, `acha as 4 que quebram a fatura (achou ${r.length})`);
  ok(r.some(x => x.motivos.includes('sem nome')),    'pega nome vazio');
  ok(r.some(x => x.motivos.includes('taxa zerada')), 'pega taxa zerada');
  ok(r.some(x => x.motivos.includes('sem loja')),    'pega entrega sem loja');
  ok(r.find(x => x.s.name === 'Sem nome').motivos.length === 3,
    'e lista TODOS os motivos de uma vez, para não corrigir duas vezes a mesma entrega');
  /* Cancelada com valor zero é o certo, não um erro. Marcá-la faria a lista
     de avisos encher de falso positivo e ninguém mais olharia para ela. */
  ok(!r.some(x => x.s.name === 'Duda' || x.s.name === 'Elis'),
    'cancelada fica fora — zero nela é o esperado');
  ok(entregasSuspeitas({ allStops: [] }).length === 0, 'período sem entregas não acusa nada');
}

// ── getReportData diz ONDE cada entrega mora ─────────────────
/* Sem isto o botão de corrigir não teria como achar a parada de volta: a
   data que o fechamento MOSTRA (_doneDate) pode não ser o dia em que ela
   está guardada. */
{
  const { ctx, getReportData } = montar();
  ctx.history = [
    { date: '05/07/2026', stops: [
      { _id: 'a', name: 'Ana', value: '10', done: true, _doneDate: '04/07/2026' }
    ] }
  ];
  ctx.reportPeriod = '60d';
  const s = getReportData().allStops[0];
  ok(s._date === '04/07/2026', 'o fechamento mostra a data em que foi entregue');
  ok(s._bucket === '05/07/2026',
    'mas guarda o dia REAL onde a parada está — é por ele que a correção a encontra');
  ok(s._si === 0 && s._hoje === false, 'e o índice dentro daquele dia');
}
{
  const { ctx, getReportData } = montar();
  ctx.stops = [{ _id: 'x', name: 'De hoje', value: '10', done: true }];
  const s = getReportData().allStops[0];
  ok(s._hoje === true, 'a entrega de hoje é marcada como tal (mora em stops, não no histórico)');
}

fim();
