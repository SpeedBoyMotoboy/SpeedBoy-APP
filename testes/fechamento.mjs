/* ═══════════════════════════════════════════════════════════════
   Fechamento — duas formas de o total sair errado.

   As duas foram encontradas lendo o código, não relatadas: nenhuma delas
   dá erro, avisa ou aparece na tela. O número simplesmente sai diferente
   do que o dia foi, e o motoboy fatura por esse número.

   Como sempre, o código testado é EXTRAÍDO do index.html — não é cópia.
   ═══════════════════════════════════════════════════════════════ */
import { trecho, lerApp, criarPlacar } from './_util.mjs';

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
    trecho('const HIST_DIAS_INTEIROS', '\n// ═══', 'index.html') +
    trecho('function inicioPeriodo(', '\nfunction genReportNumber', 'index.html');

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
  /* Datas relativas a hoje: com datas fixas o teste passou a falhar sozinho
     quando elas saíram da janela de 60 dias. */
  const diasAtras = n => {
    const d = new Date(); d.setDate(d.getDate() - n);
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  };
  const guardada = diasAtras(2), entregue = diasAtras(3);
  const { ctx, getReportData } = montar();
  ctx.history = [
    { date: guardada, stops: [
      { _id: 'a', name: 'Ana', value: '10', done: true, _doneDate: entregue }
    ] }
  ];
  ctx.reportPeriod = '60d';
  const s = getReportData().allStops[0];
  ok(s._date === entregue, 'o fechamento mostra a data em que foi entregue');
  ok(s._bucket === guardada,
    'mas guarda o dia REAL onde a parada está — é por ele que a correção a encontra');
  ok(s._si === 0 && s._hoje === false, 'e o índice dentro daquele dia');
}
{
  const { ctx, getReportData } = montar();
  ctx.stops = [{ _id: 'x', name: 'De hoje', value: '10', done: true }];
  const s = getReportData().allStops[0];
  ok(s._hoje === true, 'a entrega de hoje é marcada como tal (mora em stops, não no histórico)');
}

/* ═══════════════════════════════════════════════════════════════
   A FATURA COBRA O QUE O FECHAMENTO CONTA

   O fechamento só conta entrega FEITA. A fatura da loja lia as paradas
   por conta própria, com outra regra: qualquer parada da loja no período
   entrava, entregue ou não. Fatura gerada no meio do dia cobrava as que
   ainda estavam na rua; parada que ficou para trás num dia fechado era
   cobrada para sempre. Mesmo dado, R$ 30 no fechamento e R$ 95 na fatura.

   A cobrança por WhatsApp tinha o mesmo defeito e mais um: ignorava as
   entregas de hoje.
   ═══════════════════════════════════════════════════════════════ */
function montarFatura() {
  const janela = {};
  new Function('window', lerApp('fatura-padrao.js'))(janela);
  const CIDADES = { SER: 'Serra', VIX: 'Vitória' };
  const ctx = {
    history: [], stops: [], cfg: {},
    SBFatura: janela.SBFatura,
    CITY_MAP: CIDADES,
    cityName(c) { return CIDADES[c] || ''; },
    resolveCityCode(c) { return c; },
    avisos: [],
    toast(m) { ctx.avisos.push(m); },
    saveHistory() {},
    idDaParada(s) {
      if (s._id) return s._id;
      if (s._trackKey) return 'tk_' + s._trackKey;
      return 'h_' + [s.name, s.address, s.street, s.number, s.value, s._addedDate].join('|');
    },
    parseMoney(v) { return Number(String(v == null ? 0 : v).replace(',', '.')) || 0; },
    parseDate(d) { const [dia, mes, ano] = String(d).split('/'); return new Date(+ano, +mes - 1, +dia); },
    reportPeriod: 'week',
    fmtMoney(v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); }
  };
  const fonte =
    trecho('function inicioPeriodo(', '\nfunction genReportNumber', 'index.html') +
    trecho('const MESES_FAT=', '\nasync function genFaturaLoja', 'index.html') +
    trecho('function textoCobrancaLoja(', '\nfunction cobrancaWppLoja', 'index.html');
  const fabrica = new Function(
    'ctx',
    `with (ctx) { ${fonte}; return { getReportData, coletarFaturaLoja, textoCobrancaLoja }; }`
  );
  return { ctx, ...fabrica(ctx) };
}
const diasAtrasBR = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString('pt-BR'); };

// ── A fatura não cobra o que não foi entregue ────────────────
{
  const { ctx, getReportData, coletarFaturaLoja } = montarFatura();
  const ontem = diasAtrasBR(1);
  ctx.stops = [
    { _id: 'a', name: 'Entregue',  store: 'KS', value: '20', done: true,  _doneDate: HOJE, _addedDate: HOJE, city: 'SER' },
    { _id: 'b', name: 'Na rua',    store: 'KS', value: '25', done: false, _addedDate: HOJE, city: 'SER' },
    { _id: 'x', name: 'Outra loja', store: 'Aritana', value: '50', done: true, _doneDate: HOJE, city: 'SER' }
  ];
  ctx.history = [{ date: ontem, stops: [
    { _id: 'd', name: 'Ficou para trás', store: 'KS', value: '40', done: false, _addedDate: ontem, city: 'SER' },
    { _id: 'e', name: 'Ontem feita',     store: 'KS', value: '10', done: true,  _doneDate: ontem, _addedDate: ontem, city: 'SER' }
  ] }];

  const fat = coletarFaturaLoja('KS', 'semana');
  const nomes = fat.itens.map(i => i.cliente).join(', ');
  ok(fat.totais.total === 30, `a fatura cobra só o que foi entregue (cobrou R$ ${fat.totais.total}, esperado R$ 30: ${nomes})`);
  ok(!fat.itens.some(i => i.cliente === 'Na rua'), 'parada ainda na rua não entra na fatura');
  ok(!fat.itens.some(i => i.cliente === 'Ficou para trás'), 'parada que nunca foi entregue não é cobrada depois');
  ok(!fat.itens.some(i => i.cliente === 'Outra loja'), 'entrega de outra loja não vaza para a fatura');

  const rep = getReportData();
  ok(rep.sm.KS.t === fat.totais.total,
    `fatura e fechamento dão o MESMO total para a loja (fechamento R$ ${rep.sm.KS.t}, fatura R$ ${fat.totais.total})`);
  ok(rep.sm.KS.c === fat.totais.servicos,
    `e a mesma quantidade de entregas (fechamento ${rep.sm.KS.c}, fatura ${fat.totais.servicos})`);
}

// ── A mesma entrega em dois lugares é cobrada uma vez ────────
/* Depois de "limpar o dia", a entrega existe em `stops` e no histórico de
   hoje. A fatura deduplicava por nome+endereço+valor+data: bastava corrigir
   o valor de uma das cópias para a loja pagar duas vezes. */
{
  const { ctx, coletarFaturaLoja } = montarFatura();
  ctx.stops = [{ _id: 'a', name: 'Ana', store: 'KS', value: '25', done: true, _doneDate: HOJE, city: 'SER' }];
  ctx.history = [{ date: HOJE, stops: [{ _id: 'a', name: 'Ana', store: 'KS', value: '20', done: true, _doneDate: HOJE, city: 'SER' }] }];
  const fat = coletarFaturaLoja('KS', 'semana');
  ok(fat.itens.length === 1 && fat.totais.total === 25,
    `a mesma entrega não é cobrada duas vezes (${fat.itens.length} item(ns), R$ ${fat.totais.total})`);
}

// ── A data da fatura é a da entrega, não a do cadastro ───────
{
  const { ctx, coletarFaturaLoja } = montarFatura();
  const anteontem = diasAtrasBR(2);
  ctx.stops = [{ _id: 'a', name: 'Ana', store: 'KS', value: '20', done: true, _doneDate: HOJE, _addedDate: anteontem, city: 'SER' }];
  const fat = coletarFaturaLoja('KS', 'semana');
  const [dia, mes, ano] = HOJE.split('/');
  ok(fat.itens[0].data === `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`,
    `a fatura mostra o dia em que foi ENTREGUE (mostrou ${fat.itens[0].data})`);
}

// ── Cancelada aparece, mas não soma ──────────────────────────
{
  const { ctx, coletarFaturaLoja } = montarFatura();
  ctx.stops = [
    { _id: 'a', name: 'Ana',  store: 'KS', value: '20', done: true, paid: true, _doneDate: HOJE, city: 'SER' },
    { _id: 'b', name: 'Caio', store: 'KS', value: 0, done: true, cancelled: true, _doneDate: HOJE, city: 'SER' }
  ];
  const fat = coletarFaturaLoja('KS', 'semana');
  ok(fat.totais.cancelados === 1 && fat.totais.total === 20, 'cancelada continua assinalada na fatura, com taxa zero');
  ok(fat.totais.recebido === 20 && fat.totais.a_receber === 0, 'o que já foi pago abate do "a receber"');
}

// ── Sem entrega feita não há fatura ──────────────────────────
{
  const { ctx, coletarFaturaLoja } = montarFatura();
  ctx.stops = [{ _id: 'b', name: 'Na rua', store: 'KS', value: '25', done: false, city: 'SER' }];
  ok(coletarFaturaLoja('KS', 'semana') === null && ctx.avisos.length === 1,
    'loja só com parada pendente não gera fatura (e avisa)');
}

// ── A chave PIX viaja na fatura ──────────────────────────────
/* A fatura dizia quanto a loja devia e não dizia COMO pagar. A chave fica
   na Config e vai junto: página de conferência, PDF e mensagem. */
{
  const { ctx, coletarFaturaLoja } = montarFatura();
  ctx.stops = [{ _id: 'a', name: 'Ana', store: 'KS', value: '20', done: true, _doneDate: HOJE, city: 'SER' }];
  ok(coletarFaturaLoja('KS', 'semana').pagamento.pix === '', 'sem chave configurada, a fatura não inventa uma');
  ctx.cfg = { pixChave: '  46.178.859/0001-96 ', pixNome: 'SpeedBoy Entregas' };
  const fat = coletarFaturaLoja('KS', 'semana');
  ok(fat.pagamento.pix === '46.178.859/0001-96', 'a chave PIX da Config vai na fatura, sem espaço sobrando');
  ok(fat.pagamento.pix_nome === 'SpeedBoy Entregas', 'e o nome do favorecido junto');
}

// ── Cobrança por WhatsApp: o mesmo número da fatura ──────────
{
  const { ctx, textoCobrancaLoja } = montarFatura();
  const ontem = diasAtrasBR(1);
  ctx.cfg = { pixChave: 'pix@speedboy.com' };
  ctx.stops = [
    { _id: 'a', name: 'Hoje feita', store: 'KS', value: '20', done: true,  _doneDate: HOJE, city: 'SER' },
    { _id: 'b', name: 'Na rua',     store: 'KS', value: '25', done: false, city: 'SER' }
  ];
  ctx.history = [{ date: ontem, stops: [
    { _id: 'e', name: 'Ontem paga',   store: 'KS', value: '10', done: true, paid: true, _doneDate: ontem, city: 'SER' },
    { _id: 'd', name: 'Nunca feita',  store: 'KS', value: '40', done: false, city: 'SER' }
  ] }];
  const c = textoCobrancaLoja('KS');
  ok(c.total === 30 && c.pendente === 20,
    `a cobrança soma só o entregue, incluindo o de hoje (total R$ ${c.total}, a receber R$ ${c.pendente})`);
  ok(c.msg.includes('Hoje feita') && !c.msg.includes('Na rua') && !c.msg.includes('Nunca feita'),
    'e lista só as entregas feitas e ainda não pagas');
  ok(c.msg.includes('pix@speedboy.com'), 'a mensagem leva a chave PIX — quem recebe a cobrança sabe como pagar');
  ok(textoCobrancaLoja('Loja que não existe') === null, 'loja sem entrega no período não gera cobrança');
}

/* ═══════════════════════════════════════════════════════════════
   O HISTÓRICO GUARDA ENTREGA FEITA — E NÃO ESQUECE DÍVIDA

   • Toda virada de dia copiava a lista INTEIRA para o histórico, pendentes
     incluídas, e a pendente continuava na lista. Uma entrega agendada para
     daqui a cinco dias deixava cinco cópias, uma por dia — e Ganhos,
     fatura e a lista de "últimos 30 dias" somavam todas.
   • O histórico era cortado em 60 dias sem olhar o que saía: entrega que a
     loja ainda não pagou sumia do "a receber" e da cobrança, em silêncio.
   ═══════════════════════════════════════════════════════════════ */
function montarHistorico() {
  const ctx = {
    history: [], stops: [], gravou: 0,
    saveHistory() { ctx.gravou++; },
    idDaParada(s) { return s._id || 'h_' + [s.name, s.value, s._addedDate].join('|'); },
    parseMoney(v) { return Number(String(v == null ? 0 : v).replace(',', '.')) || 0; },
    parseDate(d) { const [dia, mes, ano] = String(d).split('/'); return new Date(+ano, +mes - 1, +dia); }
  };
  const fonte = trecho('const HIST_DIAS_INTEIROS', '\n// ═══', 'index.html');
  const fabrica = new Function('ctx', `with (ctx) { ${fonte}; return { saveToHistory, apararHistorico, HIST_DIAS_INTEIROS }; }`);
  return { ctx, ...fabrica(ctx) };
}

// ── Pendente não vai para o histórico ────────────────────────
{
  const { ctx, saveToHistory } = montarHistorico();
  ctx.stops = [
    { _id: 'a', name: 'Feita',    value: '20', done: true },
    { _id: 'b', name: 'Pendente', value: '25', done: false },
    { _id: 'c', name: 'Agendada', value: '30', done: false, deliveryDate: '01/01/2099' }
  ];
  saveToHistory(HOJE);
  const dia = ctx.history.find(d => d.date === HOJE);
  ok(!!dia && dia.stops.length === 1 && dia.stops[0].name === 'Feita',
    `só a entrega feita vai para o histórico (foram ${dia ? dia.stops.map(s => s.name).join(', ') : 'nenhuma'})`);

  const b = montarHistorico();
  b.ctx.stops = [{ _id: 'b', name: 'Pendente', value: '25', done: false }];
  b.saveToHistory(HOJE);
  ok(b.ctx.history.length === 0, 'dia só com pendentes não cria registro vazio no histórico');
}

// ── As cópias antigas de pendentes são varridas ──────────────
{
  const { apararHistorico } = montarHistorico();
  const r = apararHistorico([
    { date: diasAtrasBR(1), stops: [{ _id: 'a', name: 'Feita', value: '20', done: true }, { _id: 'b', name: 'Cópia pendente', value: '25', done: false }] },
    { date: diasAtrasBR(2), stops: [{ _id: 'b', name: 'Cópia pendente', value: '25', done: false }] }
  ]);
  ok(r.length === 1 && r[0].stops.length === 1 && r[0].stops[0].name === 'Feita',
    'cópias de parada pendente deixadas por versões antigas saem do histórico; dia que fica vazio também');
}

// ── Passou de 60 dias: sai o que foi pago, fica o que é devido ──
{
  const { apararHistorico, HIST_DIAS_INTEIROS } = montarHistorico();
  const dias = [];
  for (let n = 1; n <= HIST_DIAS_INTEIROS + 5; n++) {
    dias.push({ date: diasAtrasBR(n), stops: [
      { _id: 'p' + n, name: 'Paga ' + n,   store: 'KS', value: '20', done: true, paid: true },
      { _id: 'd' + n, name: 'Devida ' + n, store: 'KS', value: '35', done: true, paid: false }
    ] });
  }
  dias.push({ date: diasAtrasBR(HIST_DIAS_INTEIROS + 10), stops: [{ _id: 'q', name: 'Velha e paga', value: '20', done: true, paid: true }] });
  dias.push({ date: diasAtrasBR(HIST_DIAS_INTEIROS + 11), stops: [{ _id: 'x', name: 'Cancelada', value: 0, done: true, cancelled: true }] });
  const r = apararHistorico(dias);
  const todas = r.flatMap(d => d.stops);
  const devido = todas.filter(s => !s.paid && !s.cancelled).reduce((t, s) => t + Number(s.value), 0);
  ok(devido === 35 * (HIST_DIAS_INTEIROS + 5),
    `nenhuma entrega não paga some com o corte (a receber: R$ ${devido}, esperado R$ ${35 * (HIST_DIAS_INTEIROS + 5)})`);
  ok(todas.filter(s => s.paid).length === HIST_DIAS_INTEIROS, 'das pagas, ficam só as dos dias recentes — o histórico não cresce para sempre');
  ok(!todas.some(s => s.name === 'Velha e paga' || s.name === 'Cancelada'), 'dia antigo sem nada a receber sai inteiro');
  const datas = r.map(d => d.date);
  ok(datas.join() === datas.slice().sort((a, b) => {
    const p = v => { const [d, m, y] = v.split('/'); return new Date(+y, +m - 1, +d); }; return p(b) - p(a);
  }).join(), 'e o histórico continua do dia mais novo para o mais antigo');
}

/* ═══════════════════════════════════════════════════════════════
   GANHOS — o número que o dono olha todo dia

   A tela de Ganhos varria as paradas com uma terceira regra, diferente do
   fechamento e da fatura: somava parada pendente como se fosse ganho,
   somava as cópias do histórico, e "Lucro hoje" tratava como lucro o que
   é pago ao motoboy do repasse.
   ═══════════════════════════════════════════════════════════════ */
function montarGanhos() {
  const { ctx, getReportData } = montarFatura();
  const fonte =
    trecho('function ehAgendada(s){', '\nasync function openRoute', 'index.html') +
    trecho('function apurarGanhos(', '\nfunction renderFinance', 'index.html');
  const fabrica = new Function('ctx', `with (ctx) { ${trecho('function inicioPeriodo(', '\nfunction genReportNumber', 'index.html')}; ${fonte}; return { apurarGanhos, getReportData }; }`);
  return { ctx, ...fabrica(ctx) };
}
{
  const { ctx, apurarGanhos } = montarGanhos();
  const ontem = diasAtrasBR(1);
  ctx.stops = [
    { _id: 'a', name: 'Feita hoje',  store: 'KS', value: '20', done: true, paid: true, _doneDate: HOJE },
    { _id: 'r', name: 'Repassada',   store: 'KS', value: '30', done: true, _doneDate: HOJE, repassValor: 12, deliveredBy: 'Márcia' },
    { _id: 'b', name: 'Na rua',      store: 'KS', value: '25', done: false },
    { _id: 'f', name: 'Semana que vem', store: 'KS', value: '99', done: false, deliveryDate: '01/01/2099' },
    { _id: 'x', name: 'Cancelada',   store: 'KS', value: '40', done: true, cancelled: true, _doneDate: HOJE }
  ];
  // "Na rua" e "Semana que vem" atravessaram a meia-noite: versões antigas deixaram cópias.
  ctx.history = [{ date: ontem, stops: [
    { _id: 'b', name: 'Na rua', store: 'KS', value: '25', done: false },
    { _id: 'f', name: 'Semana que vem', store: 'KS', value: '99', done: false, deliveryDate: '01/01/2099' }
  ] }];
  const g = apurarGanhos();
  ok(g.hojeFeito === 50, `"Hoje" é o que foi ENTREGUE hoje (deu R$ ${g.hojeFeito}, esperado R$ 50)`);
  ok(g.hojeNaRua === 25, `o que ainda está na rua aparece à parte, sem a agendada (deu R$ ${g.hojeNaRua})`);
  ok(g.hojeEntregas === 2 && g.hojeRecebido === 20, 'contagem e recebido só das feitas');
  ok(g.mes === 50 && g.ultimos7 === 50,
    `mês e últimos 7 dias não somam pendente, cópia nem cancelada (mês R$ ${g.mes}, 7 dias R$ ${g.ultimos7})`);
  ok(g.hojeMotoboys === 12, 'o que vai para o motoboy do repasse é apurado');
  ok(g.lucroHoje(8) === 30, `lucro = entregue − despesas − motoboys (50 − 8 − 12 = 30; deu ${g.lucroHoje(8)})`);
}
// Ganhos e fechamento contam a mesma coisa
{
  const { ctx, apurarGanhos, getReportData } = montarGanhos();
  ctx.stops = [{ _id: 'a', name: 'A', store: 'KS', value: '20', done: true, _doneDate: HOJE }];
  ctx.history = [
    { date: diasAtrasBR(2), stops: [{ _id: 'c', name: 'C', store: 'KS', value: '15', done: true, _doneDate: diasAtrasBR(2) }] },
    { date: diasAtrasBR(3), stops: [{ _id: 'd', name: 'D', store: 'KS', value: '10', done: true, _doneDate: diasAtrasBR(3) }] }
  ];
  ctx.reportPeriod = 'week';
  ok(apurarGanhos().ultimos7 === getReportData().total,
    'os "últimos 7 dias" de Ganhos batem com o fechamento de 7 dias — uma lista só para os dois');
}
// A projeção não infla no começo do mês
{
  const { ctx, apurarGanhos } = montarGanhos();
  ctx.history = [];
  for (let n = 1; n <= 6; n++) ctx.history.push({ date: diasAtrasBR(n), stops: [{ _id: 'h' + n, name: 'H', value: '70', done: true, _doneDate: diasAtrasBR(n) }] });
  ctx.stops = [{ _id: 'hj', name: 'Hoje', value: '70', done: true, _doneDate: HOJE }];
  const g = apurarGanhos();
  ok(g.mediaDiaria === 70, `média diária = últimos 7 dias ÷ 7, em qualquer dia do mês (deu ${g.mediaDiaria})`);
}

/* ── Contas a receber: quem deve, quanto, desde quando ────────
   O "a receber" do fechamento muda com a aba de período. Este é o total
   por loja de TUDO o que está guardado — a pergunta de quem vai cobrar. */
{
  const { ctx } = montarFatura();
  const fonte = trecho('function inicioPeriodo(', '\nfunction genReportNumber', 'index.html') +
                trecho('function contasAReceber(', '\nfunction _renderContas', 'index.html');
  const { contasAReceber } = new Function('ctx', `with (ctx) { ${fonte}; return { contasAReceber }; }`)(ctx);
  ctx.stops = [
    { _id: 'a', name: 'Hoje', store: 'KS', value: '20', done: true, _doneDate: HOJE },
    { _id: 'b', name: 'Na rua', store: 'KS', value: '99', done: false }
  ];
  ctx.history = [
    { date: diasAtrasBR(40), stops: [{ _id: 'c', name: 'Antiga', store: 'KS', value: '35', done: true, _doneDate: diasAtrasBR(40) }] },
    { date: diasAtrasBR(3), stops: [
      { _id: 'd', name: 'Paga', store: 'KS', value: '50', done: true, paid: true, _doneDate: diasAtrasBR(3) },
      { _id: 'e', name: 'Aritana', store: 'Aritana', value: '80', done: true, _doneDate: diasAtrasBR(3) },
      { _id: 'f', name: 'Cancelada', store: 'Aritana', value: '60', done: true, cancelled: true, _doneDate: diasAtrasBR(3) },
      { _id: 'g', name: 'Avulso', store: '', value: '15', done: true, _doneDate: diasAtrasBR(3) }
    ] }
  ];
  const c = contasAReceber();
  const ks = c.find(x => x.loja === 'KS');
  ok(c.map(x => x.loja).join() === 'Aritana,KS,Sem loja', `uma linha por loja, da que mais deve para a que menos (veio ${c.map(x => x.loja).join()})`);
  ok(ks.valor === 55 && ks.entregas === 2, `soma só o entregue e ainda não pago — sem a paga e sem a que está na rua (KS: R$ ${ks.valor})`);
  ok(ks.dias === 40, `diz há quantos dias está a dívida mais antiga (${ks.dias})`);
  ok(c.find(x => x.loja === 'Aritana').valor === 80, 'cancelada não é dívida');
}

fim();
