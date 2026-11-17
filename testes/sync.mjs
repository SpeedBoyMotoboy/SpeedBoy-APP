/* Merge de sincronização entre os dois aparelhos.
   Antes, sincronizar era "quem escreveu por último venceu" e o listener
   fazia `stops = remote`. Cada teste aqui corresponde a uma forma concreta
   de perder entrega que existia no app.
   O código é extraído do index.html, não copiado. */
import { trecho, criarPlacar } from './_util.mjs';

const bloco = trecho('function hashCurto(str){', 'function saveStops()');

// mergeStops depende de sbRead/localStorage só através de getTombs, que
// recebemos pronto por parâmetro nos testes — aqui basta um localStorage inerte.
const lsFake = {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
  get length() { return 0; }, key: () => null
};
const { mergeStops, idDaParada, carimbarStops, hashCurto, conteudoDaParada } =
  new Function('localStorage', 'sbRead', 'stops',
    bloco + '\nreturn {mergeStops, idDaParada, carimbarStops, hashCurto, conteudoDaParada};'
  )(lsFake, (k, d) => d, []);

const { ok, fim } = criarPlacar();
const nomes = arr => arr.map(s => s.name).sort().join(',');

// ── 1. Adições simultâneas nos dois aparelhos ──────────────
{
  const local  = [{ _id: 'a', name: 'Ana',  _upd: 100 }];
  const remoto = [{ _id: 'b', name: 'Beto', _upd: 100 }];
  const r = mergeStops(local, remoto, {});
  ok(r.length === 2, `os dois lados sobrevivem (achou ${r.length})`);
  ok(nomes(r) === 'Ana,Beto', 'nenhuma das duas adições é perdida');
}

// ── 2. Edição concorrente da mesma parada: vence a mais nova ──
{
  const local  = [{ _id: 'a', name: 'Ana', value: '10', _upd: 200 }];
  const remoto = [{ _id: 'a', name: 'Ana', value: '25', _upd: 300 }];
  ok(mergeStops(local, remoto, {})[0].value === '25', 'edição remota mais nova prevalece');
  ok(mergeStops(remoto, local, {})[0].value === '25', 'e prevalece também na direção oposta');
}

// ── 3. Alteração local ainda não enviada não é destruída ──
// Este era o pior caso: chegava um snapshot e `stops = remote` apagava
// o que o motoboy tinha acabado de marcar.
{
  const local  = [{ _id: 'a', name: 'Ana', done: true,  _upd: 500 }];
  const remoto = [{ _id: 'a', name: 'Ana', done: false, _upd: 100 }];
  ok(mergeStops(local, remoto, {})[0].done === true,
    'marcação local recente sobrevive à chegada de um snapshot antigo');
}

// ── 4. Exclusão não ressuscita ─────────────────────────────
{
  const local  = [];
  const remoto = [{ _id: 'a', name: 'Ana', _upd: 100 }];
  ok(mergeStops(local, remoto, { a: 200 }).length === 0,
    'parada excluída depois da versão remota não volta');
  ok(mergeStops(local, remoto, { a: 50 }).length === 1,
    'mas uma versão remota MAIS NOVA que a exclusão volta (foi recriada)');
}

// ── 5. Dados de uma versão antiga do app (sem _upd) ────────
{
  const local  = [{ _id: 'a', name: 'Ana', value: '30', _upd: 900 }];
  const remoto = [{ _id: 'a', name: 'Ana', value: '10' }];          // sem carimbo
  ok(mergeStops(local, remoto, {})[0].value === '30',
    'parada sem _upd (app antigo) não sobrescreve a carimbada');
}

// ── 6. Identidade ──────────────────────────────────────────
{
  ok(idDaParada({ _id: 'x1' }) === 'x1', '_id é a identidade quando existe');
  ok(idDaParada({ _trackKey: 'k9' }) === 'tk_k9',
    '_trackKey vira identidade — entregas aceitas antes desta versão não duplicam');
  const s = { name: 'Ana', address: 'R 1' };
  ok(idDaParada(s) === idDaParada({ ...s }), 'sem id, a identidade é estável pelo conteúdo');
  ok(idDaParada(s) !== idDaParada({ name: 'Ana', address: 'R 2' }),
    'endereços diferentes geram identidades diferentes');
}

// ── 7. Ordem da lista (é a ordem da rota do dia) ───────────
{
  const local  = [{ _id: 'c', name: 'C', _upd: 1 }, { _id: 'a', name: 'A', _upd: 1 }];
  const remoto = [{ _id: 'a', name: 'A', _upd: 1 }, { _id: 'z', name: 'Z', _upd: 1 }];
  const r = mergeStops(local, remoto, {});
  ok(r[0].name === 'C' && r[1].name === 'A', 'a ordem local é preservada');
  ok(r[2].name === 'Z', 'o que só existe no remoto entra no fim');
}

// ── 8. Convergência: fundir de novo não muda nada ──────────
// Sem isto, dois aparelhos ficariam empurrando dados um para o outro sem parar.
{
  const local  = [{ _id: 'a', name: 'Ana', _upd: 100 }];
  const remoto = [{ _id: 'b', name: 'Beto', _upd: 200 }];
  const um   = mergeStops(local, remoto, {});
  const dois = mergeStops(um, um, {});
  ok(JSON.stringify(um) === JSON.stringify(dois), 'o merge é idempotente');
  const trocado = mergeStops(remoto, local, {});
  ok(nomes(um) === nomes(trocado), 'os dois aparelhos chegam ao mesmo conjunto');
}

// ── 9. Carimbo só avança quando o conteúdo muda ────────────
// Se avançasse a cada gravação, toda parada local pareceria mais nova
// que a do outro aparelho e o merge sempre daria empate a nosso favor.
{
  const arr = [{ name: 'Ana', value: '10' }];
  const api = new Function('localStorage', 'sbRead', 'stops',
    bloco + '\nreturn {carimbarStops, stops};')(lsFake, (k, d) => d, arr);
  api.carimbarStops();
  const id1 = arr[0]._id, upd1 = arr[0]._upd;
  ok(!!id1 && !!upd1, 'carimbarStops põe _id e _upd');

  api.carimbarStops();
  ok(arr[0]._upd === upd1, 'gravar sem mudar nada NÃO avança o carimbo');
  ok(arr[0]._id === id1, 'o id permanece o mesmo');

  arr[0].value = '20';
  api.carimbarStops();
  ok(arr[0]._upd >= upd1, 'mudar o valor avança o carimbo');
  ok(arr[0]._id === id1, 'mudar o conteúdo não troca a identidade');
}

// ── 10. Entradas inválidas não derrubam o merge ────────────
{
  ok(mergeStops(null, null, null).length === 0, 'null de ambos os lados devolve lista vazia');
  ok(mergeStops([{ _id: 'a', name: 'A' }], null, {}).length === 1, 'remoto ausente mantém o local');
  const sujo = mergeStops([{ _id: 'a', name: 'A' }, null, 'lixo'], undefined, {});
  ok(sujo.length === 1, 'itens inválidos no array são ignorados');
}

/* ── Entregas iguais não são a MESMA entrega ──────────────────
   "+3" nas lojas rápidas cria três paradas idênticas: mesma loja, mesmo
   endereço, mesma taxa, sem nome. A identidade era derivada do conteúdo,
   então as três nasciam com o MESMO _id — e tudo que deduplica por
   identidade (o merge, o histórico, o fechamento) ficava com uma só.
   Três entregas feitas, uma cobrada. */
{
  const igual = () => ({ name: '', address: 'Rua A, 10', street: 'Rua A', number: '10',
                         value: 35, store: 'KS', _addedDate: '16/11/2026' });
  const comLista = lista => new Function('localStorage', 'sbRead', 'stops',
    bloco + '\nreturn {mergeStops, carimbarStops};')(lsFake, (k, d) => d, lista);

  const lista = [igual(), igual(), igual()];
  const app = comLista(lista);
  app.carimbarStops();
  const ids = lista.map(s => s._id);
  ok(new Set(ids).size === 3, `três paradas iguais ganham três identidades (ganharam ${new Set(ids).size})`);
  ok(app.mergeStops(lista, JSON.parse(JSON.stringify(lista)), {}).length === 3,
    'e o eco da própria gravação não as funde numa só');
  app.carimbarStops();
  ok(lista.map(s => s._id).join() === ids.join(), 'a identidade não muda numa segunda gravação');

  // Quem já estava com a lista colidida de antes da correção é curado ao gravar.
  const antiga = [{ ...igual(), _id: 'h_abc' }, { ...igual(), _id: 'h_abc' }, { _id: 'h_abc2', name: 'Outra' }];
  comLista(antiga).carimbarStops();
  ok(new Set(antiga.map(s => s._id)).size === 3, 'lista que já tinha ids repetidos é separada');
  ok(antiga[0]._id === 'h_abc' && antiga[2]._id === 'h_abc2', 'a primeira ocorrência e as demais paradas mantêm o id');

  // Identidade vinda de pedido de loja nunca é trocada: é ela que liga a parada ao tracking.
  const deLoja = [{ _id: 'tk_k1', _trackKey: 'k1', name: 'A' }, { _id: 'tk_k1', _trackKey: 'k1', name: 'A' }];
  comLista(deLoja).carimbarStops();
  ok(deLoja[1]._id === 'tk_k1', 'id de pedido de loja repetido NÃO é trocado (é duplicata de verdade)');
}

/* ── O histórico também é de dois aparelhos ───────────────────
   As paradas do dia tinham merge; o histórico não. Cada aparelho gravava
   o histórico INTEIRO por cima do que estava no banco, e ao abrir trocava
   o dia local pelo remoto sempre que o remoto tivesse a mesma quantidade
   de paradas. Marcar "pago" não muda a quantidade — então a marcação
   feita num celular era desfeita pelo outro, e a loja que já tinha pago
   voltava a dever. */
{
  const parseDate = d => { const [a, b, c] = String(d).split('/'); return new Date(+c, +b - 1, +a); };
  const histApp = hist => new Function('localStorage', 'sbRead', 'stops', 'history', 'parseDate',
    bloco + trecho('function carimbarHistorico(', '\nfunction saveStops()') +
    '\nreturn {mergeHistorico, carimbarHistorico};')(lsFake, (k, d) => d, [], hist, parseDate);
  const { mergeHistorico } = histApp([]);
  const dia = (date, ...stops) => ({ date, stops });

  // A marcou como paga (carimbo novo); B ainda tem a versão antiga.
  const A = [dia('10/11/2026', { _id: 'a', name: 'Ana', value: 20, done: true, paid: true,  _upd: 500 })];
  const B = [dia('10/11/2026', { _id: 'a', name: 'Ana', value: 20, done: true, paid: false, _upd: 100 })];
  ok(mergeHistorico(B, A)[0].stops[0].paid === true, 'o "pago" marcado no outro celular chega aqui');
  ok(mergeHistorico(A, B)[0].stops[0].paid === true, 'e a versão antiga do outro celular NÃO desfaz o "pago" daqui');

  // Cada aparelho arquivou entregas diferentes do mesmo dia.
  const m = mergeHistorico(
    [dia('10/11/2026', { _id: 'a', name: 'Ana', done: true, _upd: 1 })],
    [dia('10/11/2026', { _id: 'b', name: 'Beto', done: true, _upd: 1 }), dia('09/11/2026', { _id: 'c', name: 'Caio', done: true, _upd: 1 })]);
  ok(m.length === 2 && m[0].stops.length === 2, 'entregas arquivadas em aparelhos diferentes se somam, não se substituem');
  ok(m[0].date === '10/11/2026' && m[1].date === '09/11/2026', 'e os dias continuam do mais novo para o mais antigo');

  // Entrega corrigida para outro dia num aparelho: não pode ficar nos dois dias.
  const mov = mergeHistorico(
    [dia('09/11/2026', { _id: 'a', name: 'Ana', done: true, _doneDate: '09/11/2026', _upd: 900 })],
    [dia('10/11/2026', { _id: 'a', name: 'Ana', done: true, _doneDate: '10/11/2026', _upd: 100 })]);
  ok(mov.length === 1 && mov[0].date === '09/11/2026', 'entrega movida de dia fica só no dia novo (não duplica no antigo)');

  ok(mergeHistorico([dia('10/11/2026', { _id: 'a', _upd: 1 })], null).length === 1, 'remoto vazio não apaga o histórico local');
  ok(mergeHistorico([null, { date: '10/11/2026' }, dia('10/11/2026', null, { _id: 'a', _upd: 1 })], [])[0].stops.length === 1,
    'dia ou parada inválidos no meio não derrubam o merge');

  // O carimbo do histórico só avança para o que mudou de verdade.
  const hist = [dia('10/11/2026', { _id: 'a', name: 'Ana', paid: false }, { _id: 'b', name: 'Beto', paid: false })];
  const app = histApp(hist);
  app.carimbarHistorico();
  const [u1, u2] = hist[0].stops.map(s => s._upd);
  /* Entrega antiga, sem retrato: a primeira passada NÃO pode carimbar com
     "agora". Carimbava — e o aparelho que atualizasse o app por último
     passava por cima do "pago" marcado no outro. */
  ok(u1 === undefined && u2 === undefined && !!hist[0].stops[0]._h,
    'histórico antigo ganha o retrato (_h) sem ganhar carimbo novo');
  hist[0].stops[0].paid = true;                 // marcou a Ana como paga
  const antes = Date.now;
  Date.now = () => antes() + 5000;
  app.carimbarHistorico();
  Date.now = antes;
  ok(hist[0].stops[0]._upd > 0, 'marcar "pago" no histórico avança o carimbo daquela entrega');
  ok(hist[0].stops[1]._upd === u2, 'e a entrega que não mudou mantém o carimbo — senão tudo pareceria novo e o merge daria sempre empate');
}

/* ── Desfazer e apagar precisam VENCER o banco ────────────────
   Com merge, "voltar atrás" vira um problema novo: a versão que o
   desfazer quer apagar já subiu, e tem carimbo mais novo que a versão
   restaurada. Sem cuidado, o próximo envio traz a mudança de volta e o
   desfazer se desfaz sozinho — o mesmo defeito que a lápide resolve nas
   paradas. O mesmo vale para "apagar todo o histórico" e para restaurar
   um backup: se fundissem com o banco, tudo voltava. */
{
  const parseDate = d => { const [a, b, c] = String(d).split('/'); return new Date(+c, +b - 1, +a); };
  const gravacoes = [];
  const app = new Function('localStorage', 'sbRead', 'stops', 'history', 'parseDate', 'saveHistory', 'restaurarParadas', 'retratoParadas',
    bloco + trecho('function forcarCarimboHistorico(){', '\n/* `substituir`') + trecho('function restaurarDia(r){', '\n// ═══') +
    '\nreturn {mergeHistorico, restaurarDia, assinaturaHistorico, forcarCarimboHistorico, ler: () => history};')(
    lsFake, (k, d) => d, [],
    [{ date: '10/11/2026', stops: [{ _id: 'a', name: 'Ana', value: 30, _upd: 500 }, { _id: 'b', name: 'Beto', value: 10, _upd: 50 }] }],
    parseDate, substituir => gravacoes.push(!!substituir), () => {}, () => []);

  // O retrato de ANTES da correção: Ana valia 20. A correção (30, carimbo 500) já subiu.
  const retrato = { stops: [], history: [{ date: '10/11/2026', stops: [{ _id: 'a', name: 'Ana', value: 20, _upd: 100 }, { _id: 'b', name: 'Beto', value: 10, _upd: 50 }] }] };
  const noBanco = [{ date: '10/11/2026', stops: [{ _id: 'a', name: 'Ana', value: 30, _upd: 500 }, { _id: 'b', name: 'Beto', value: 10, _upd: 50 }] }];
  app.restaurarDia(retrato);
  const h = app.ler();
  ok(h[0].stops[0].value === 20, 'desfazer devolve o valor de antes');
  ok(h[0].stops[0]._upd > 500, 'e a versão restaurada ganha carimbo NOVO — senão a mudança desfeita voltaria no próximo merge');
  ok(h[0].stops[1]._upd === 50, 'o que o desfazer não tocou mantém o carimbo');
  ok(app.mergeHistorico(h, noBanco)[0].stops[0].value === 20, 'fundido com o que já estava no banco, o desfazer continua valendo');
  ok(gravacoes.length === 1 && gravacoes[0] === true, 'e grava SUBSTITUINDO o banco, sem fundir antes');

  // Assinatura: o que decide se há algo a enviar
  const A = [{ date: '10/11/2026', stops: [{ _id: 'a', _upd: 1, name: 'x' }] }];
  const B = [{ stops: [{ name: 'x', _upd: 1, _id: 'a' }], date: '10/11/2026' }];   // mesma coisa, chaves em outra ordem
  ok(app.assinaturaHistorico(A) === app.assinaturaHistorico(B), 'mesmo histórico com as chaves em outra ordem não conta como diferente (não reenvia à toa)');
  ok(app.assinaturaHistorico(A) !== app.assinaturaHistorico([{ date: '10/11/2026', stops: [{ _id: 'a', _upd: 2 }] }]), 'carimbo diferente conta');
  ok(app.assinaturaHistorico([null, { date: 'x' }]) === app.assinaturaHistorico([]), 'lixo no meio não derruba');
}

/* ── O merge não apaga entrega ────────────────────────────────
   Histórico antigo pode ter duas entregas com o mesmo id (paradas iguais,
   de antes de cada uma ter identidade própria). Fundir por id puro
   devolvia uma só e GRAVAVA isso: a segunda entrega sumia de vez. */
{
  const parseDate = d => { const [a, b, c] = String(d).split('/'); return new Date(+c, +b - 1, +a); };
  const { mergeHistorico } = new Function('localStorage', 'sbRead', 'stops', 'history', 'parseDate',
    bloco + '\nreturn {mergeHistorico};')(lsFake, (k, d) => d, [], [], parseDate);
  const gemeas = () => [{ date: '10/11/2026', stops: [
    { _id: 'h_x', name: '', value: 35, done: true }, { _id: 'h_x', name: '', value: 35, done: true }] }];
  ok(mergeHistorico(gemeas(), gemeas())[0].stops.length === 2, 'duas entregas com o mesmo id continuam sendo duas depois do merge');
  ok(mergeHistorico(gemeas(), [])[0].stops.length === 2, 'inclusive quando o banco está vazio');
  const comPago = gemeas(); comPago[0].stops[1].paid = true; comPago[0].stops[1]._upd = 9;
  const r = mergeHistorico(gemeas(), comPago)[0].stops;
  ok(r.length === 2 && r.filter(s => s.paid).length === 1, 'e a marcação feita numa delas no outro aparelho chega só nela');
}

/* ── Parada nova nasce com identidade nova ────────────────────
   A identidade derivada do conteúdo fazia a entrega de hoje à tarde, igual
   à da manhã que já foi para o histórico, nascer com o MESMO id — e, ao
   ser arquivada, ficar no lugar da primeira. Uma entrega a menos. */
{
  const nova = () => ({ name: '', address: 'Rua A, 10', value: 35, store: 'KS', _addedDate: '16/11/2026' });
  const lista = [nova()];
  const app = new Function('localStorage', 'sbRead', 'stops',
    bloco + '\nreturn {carimbarStops, idDaParada};')(lsFake, (k, d) => d, lista);
  const derivado = app.idDaParada(nova());      // o id que a regra antiga daria
  app.carimbarStops();
  ok(lista[0]._id && lista[0]._id !== derivado, 'parada sem _id ganha identidade própria, não a derivada do conteúdo');
  const deLoja = [{ name: 'Ana', _trackKey: 'k7' }];
  new Function('localStorage', 'sbRead', 'stops', bloco + '\nreturn {carimbarStops};')(lsFake, (k, d) => d, deLoja).carimbarStops();
  ok(deLoja[0]._id === 'tk_k7', 'pedido de loja continua identificado pela chave dele (é o elo com o tracking)');
}

/* ── Enviar o histórico: quem não leu não grava por cima ──────
   Dois defeitos do primeiro merge, achados em revisão:
   • falha de LEITURA (sem sinal, prazo estourado) era tratada como "banco
     vazio" e o histórico local ia inteiro por cima — desfazendo os "pago"
     do outro aparelho, exatamente o que o merge existe para impedir;
   • a marca de "substituir o banco" (apagar histórico, restaurar backup)
     não dizia de qual sala era: feita sem sala, sobrava para a primeira
     sala em que o aparelho entrasse, e apagava o histórico dela. */
{
  const parseDate = d => { const [a, b, c] = String(d).split('/'); return new Date(+c, +b - 1, +a); };
  const montar = ({ local, remoto, sala = 'SB-AAAA', falhaLeitura = false }) => {
    const ls = new Map(); if (sala) ls.set('sb_room_code', sala);
    const banco = { valor: remoto === undefined ? null : JSON.stringify(remoto), sets: 0 };
    const ctx = {
      history: local, stops: [],
      localStorage: { getItem: k => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k) },
      sbRead: (k, d) => d, parseDate, parseMoney: v => Number(v) || 0,
      fbDb: {}, fbMods: {
        ref: (db, p) => p,
        get: async () => { if (falhaLeitura) throw new Error('Client is offline'); return { val: () => banco.valor }; },
        set: async (p, v) => { banco.valor = v; banco.sets++; }
      },
      window: { addEventListener() {} }, document: { getElementById: () => ({ classList: { contains: () => false } }) },
      renderHome() {}, renderReport() {}, renderFinance() {}, sbLogError() {}, setTimeout, Promise, JSON, Map, Set, Date, Array, Object, String, Number
    };
    const fonte = bloco + trecho('function forcarCarimboHistorico(){', '\n/* `substituir`') +
      trecho('const HIST_DIAS_INTEIROS', '\nfunction saveToHistory') +
      trecho('async function lerHistoricoRemoto(room){', '\nfunction genRoomCode');
    const api = new Function('ctx', `with (ctx) { ${fonte}; return { fbPushHistory, loadHistoryFromFirebase, ler: () => history }; }`)(ctx);
    return { ...api, banco, ls };
  };
  const dia = (...stops) => [{ date: '10/11/2026', stops }];
  const pagas = () => dia({ _id: 'a', done: true, paid: true, value: 20, _upd: 500 }, { _id: 'b', done: true, paid: true, value: 20, _upd: 500 });
  const velhas = () => dia({ _id: 'a', done: true, paid: false, value: 20, _upd: 100 }, { _id: 'b', done: true, paid: false, value: 20, _upd: 100 });

  // leitura falhou: não grava
  const a = montar({ local: velhas(), remoto: pagas(), falhaLeitura: true });
  await a.fbPushHistory();
  ok(a.banco.sets === 0, 'sem conseguir ler o banco, o histórico local NÃO é gravado por cima');
  ok(JSON.parse(a.banco.valor)[0].stops.every(s => s.paid), 'e os "pago" do outro aparelho continuam lá');
  ok(a.ls.get('sb_hist_pendente') === '1', 'o envio fica marcado como pendente, para tentar de novo quando o sinal voltar');

  // leitura ok: funde e grava o fundido
  const b = montar({ local: velhas(), remoto: pagas() });
  await b.fbPushHistory();
  ok(b.ler()[0].stops.every(s => s.paid), 'com leitura, o que o outro aparelho marcou entra aqui');

  // marca de substituir sem sala não é gravada
  const c = montar({ local: [], remoto: pagas(), sala: '' });
  await c.fbPushHistory(true);
  ok(!c.ls.has('sb_hist_substituir'), 'apagar o histórico sem sala não deixa marca para trás');

  // marca de OUTRA sala é ignorada ao entrar numa sala
  const d = montar({ local: [], remoto: pagas(), sala: 'SB-BBBB' });
  d.ls.set('sb_hist_substituir', 'SB-AAAA');
  await d.loadHistoryFromFirebase('SB-BBBB');
  ok(JSON.parse(d.banco.valor)[0].stops.length === 2, 'marca de outra sala NÃO apaga o histórico da sala em que o aparelho entrou');
  ok(d.ler().length === 1 && !d.ls.has('sb_hist_substituir'), 'o histórico da sala é fundido normalmente e a marca velha é descartada');

  // marca da própria sala vale: o apagado sem sinal não volta
  const e = montar({ local: [], remoto: pagas(), sala: 'SB-AAAA' });
  e.ls.set('sb_hist_substituir', 'SB-AAAA');
  await e.loadHistoryFromFirebase('SB-AAAA');
  ok(e.banco.valor === '[]' && e.ler().length === 0 && !e.ls.has('sb_hist_substituir'),
    'histórico apagado sem sinal continua apagado ao reconectar na MESMA sala');
}

fim();
