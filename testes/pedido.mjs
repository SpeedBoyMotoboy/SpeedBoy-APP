/* pedido.html — a página em que as LOJAS pedem entrega por link.

   Sete defeitos, todos já reproduzidos no código antigo (auditoria C):

   2. Sem sinal, "Enviar" ficava em spinner eterno: o Firebase só resolve a
      gravação quando o SERVIDOR confirma, e não havia prazo. Pior: um pedido
      com três endereços fazia três push() soltos — se um caía no meio, "tentar
      de novo" mandava os três outra vez e a SpeedBoy entregava (e cobrava) em
      dobro. O conserto grava tudo numa única update() multi-caminho, com as
      chaves geradas ANTES, e reaproveita as mesmas chaves no reenvio.
   3. O Luan cancelava e a loja continuava lendo "Aguardando confirmação";
      pedido RECUSADO aparecia no histórico como "Entregue"; tocar em Cancelar
      já escrevia "Cancelada" sem o Luan ter aceitado.
   4. "Pagamento *" nunca foi validado ("A receber" sem valor passava, o motoboy
      chegava sem saber que devia cobrar) e a data padrão era a do UTC: depois
      das 21h em Brasília a loja pedia para "amanhã". Só a 1ª entrega a tinha.
   9. Erro do Firebase chegava cru e em inglês ("PERMISSION_DENIED: Permission
      denied") e o listener de status não tinha callback de erro.
  10. Sem um botão de WhatsApp na tela, a loja com dúvida não tinha como falar.
  11. Nome de cliente com aspas quebrava o botão Cancelar (ia dentro do onclick)
      e nome/endereço entravam sem escape no HTML.
  14. Edição aceitava endereço vazio; toque repetido enfileirava pedidos
      duplicados.

   O código testado é o do próprio pedido.html, rodado num sandbox com um DOM
   e um Firebase de mentira — o mesmo script, sem cópia que envelheça. */
process.env.TZ = 'America/Sao_Paulo';   // o bug da data só aparece fora do UTC

import vm from 'vm';
import { trecho, lerApp, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();
const SCRIPT = trecho('var FIREBASE_CONFIG', "window.addEventListener('load', init);", 'pedido.html');
const HTML = lerApp('pedido.html');

/* ── dublês ─────────────────────────────────────────────────── */
class Elem {
  constructor(id) {
    this.id = id; this.value = ''; this.textContent = ''; this.innerHTML = '';
    this.disabled = false; this.style = {}; this.href = ''; this.children = [];
    const classes = new Set(); this._classes = classes;
    this.classList = {
      add: (...c) => c.forEach(x => classes.add(x)),
      remove: (...c) => c.forEach(x => classes.delete(x)),
      contains: c => classes.has(c),
      toggle: c => { classes.has(c) ? classes.delete(c) : classes.add(c); return classes.has(c); }
    };
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c)); }
  appendChild(e) { this.children.push(e); return e; }
  remove() { this.removido = true; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  closest() { return null; }
  addEventListener() {}
  setAttribute() {}
  getAttribute() { return null; }
  scrollIntoView() {}
  get parentNode() { return new Elem('pai'); }
}

function criarDocumento() {
  const cache = new Map();
  const doc = {
    getElementById(id) { if (!cache.has(id)) cache.set(id, new Elem(id)); return cache.get(id); },
    createElement() { return new Elem('novo'); },
    querySelector() { return new Elem('q'); },
    querySelectorAll() { return []; },
    body: new Elem('body'),
    esquecer(prefixo) { for (const k of [...cache.keys()]) if (k.startsWith(prefixo)) cache.delete(k); }
  };
  return doc;
}

function criarDb(estado) {
  const chamadas = []; let seq = 0;
  const resp = () => {
    if (estado.modo === 'pendura') return new Promise(() => {});
    if (estado.modo === 'volta') return new Promise(res => { estado.soltar = res; });   // o sinal volta depois
    if (estado.modo === 'rejeita') return Promise.reject(estado.erro);
    return Promise.resolve();
  };
  const ref = path => ({
    path, key: path.split('/').pop(),
    push(val) {
      const k = 'K' + (++seq);
      if (val === undefined) return ref(path + '/' + k);          // só gera a chave
      chamadas.push({ op: 'push', path, val });
      const p = resp(); p.key = k; return p;                       // forma antiga
    },
    set(val) { chamadas.push({ op: 'set', path, val }); return resp(); },
    update(val) { chamadas.push({ op: 'update', path, val }); return resp(); },
    child(k) { return ref(path + '/' + k); },
    get parent() { return ref(path.split('/').slice(0, -1).join('/')); },
    on(ev, cb, err) { chamadas.push({ op: 'on', path, cb, err }); },
    once() { return Promise.resolve({ val: () => null }); }
  });
  return { ref, chamadas, estado };
}

/* Uma página nova: DOM falso, relógio controlável, Firebase falso. */
function pagina(busca = '?room=SB-TEST&store=KS') {
  const doc = criarDocumento();
  const estado = { modo: 'ok', erro: null };
  const db = criarDb(estado);
  const storage = new Map();
  const timers = []; let agora = 0, idT = 0;
  const INSTANTE = Date.UTC(2026, 10, 17, 1, 30);   // 22:30 de 16/11 em Brasília, já 17/11 no UTC
  class DataFixa extends Date {
    constructor(...a) { if (a.length === 0) super(INSTANTE); else super(...a); }
    static now() { return INSTANTE; }
  }
  const SB = {
    getCustomBairros: () => ({}), saveCustomBairros() {}, addCustomBairro() {},
    bairrosDaCidade: () => ["D'Água <b>x</b>", 'Centro']
  };
  const sandbox = {
    document: doc, URLSearchParams, JSON, Promise, Object, Array, String, Number, Math, isNaN, parseFloat, parseInt, RegExp, Error,
    Date: DataFixa, encodeURIComponent, console: { log() {}, warn() {}, error() {} },
    localStorage: { getItem: k => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) },
    setTimeout: (fn, ms) => { timers.push({ id: ++idT, t: agora + (ms || 0), fn }); return idT; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    confirm: () => true, alert() {}, SpeedBoy: SB,
    CIDADE_BAIRROS: { VV: { nome: 'Vila Velha', bairros: [] }, SRR: { nome: 'Serra', bairros: [] } },
    parseMoney: s => parseFloat(String(s == null ? '' : s).replace(',', '.')) || 0,
    maskPhone() {}, open() {}, scrollTo() {},
    speedboyLoginAnonimo: () => Promise.resolve('uid-1')
  };
  sandbox.window = sandbox;
  sandbox.window.location = { search: busca };
  sandbox.SPEEDBOY_FIREBASE_CONFIG = {};
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox);
  sandbox.db = db;                                   // entra no lugar do firebase.database()

  const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };
  const avancar = async ms => {
    agora += ms;
    for (;;) {
      timers.sort((a, b) => a.t - b.t);
      if (!timers.length || timers[0].t > agora) break;
      timers.shift().fn();
      await tick();
    }
    await tick();
  };
  const el = id => doc.getElementById(id);
  return { ctx: sandbox, doc, db, estado, tick, avancar, el, storage,
           toast: () => el('toast').textContent,
           rodar: codigo => vm.runInContext(codigo, sandbox) };
}

const parada = (nome = 'Ana') => ({
  name: nome, address: 'Rua A, 10, Centro - Vila Velha', complement: '', reference: '',
  phone: '27999990000', timeFrom: '', timeTo: '', deliveryDate: '16/11/2026', serviceType: 'entrega',
  cityId: 'VV', city: 'Vila Velha', neighborhood: 'Centro', street: 'Rua A', number: '10',
  productValue: 0, productPaid: true, value: 0, paid: false, notes: '', store: 'KS',
  done: false, status: 'pending', submittedAt: '2026-11-17T01:30:00.000Z', arrivedAt: '22:30'
});
const tenta = (rotulo, fn) => { try { return fn(); } catch (e) { ok(false, `${rotulo} — ${e.message.split('\n')[0]}`); return undefined; } };
const decodifica = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/* ═══ Achado 2 · envio ═══════════════════════════════════════ */
{
  // (a) sem sinal: a gravação nunca resolve
  const p = pagina(); p.estado.modo = 'pendura';
  p.el('btnSubmit').disabled = true; p.el('loading').classList.add('show');   // o que o clique em Enviar já fez
  p.ctx.enviarPedido([parada('Ana')], ['stop_1']);
  await p.tick(); await p.avancar(14000);
  ok(p.el('loading').classList.contains('show'), '2a. antes dos 15 s o overlay ainda está lá (a rede pode só estar lenta)');
  await p.avancar(2000);
  ok(!p.el('loading').classList.contains('show'), '2a. sem sinal: passados ~15 s o overlay SAI (antes: spinner eterno)');
  ok(p.el('btnSubmit').disabled === false, '2a. e o botão Enviar volta a funcionar');
  ok(/NÃO foi enviado/.test(p.toast()), `2a. e diz em português que o pedido NÃO foi enviado (toast: "${p.toast()}")`);
  ok(!p.el('successWrap').classList.contains('show'), '2a. nunca mostra "Pedido enviado!" sem confirmação');

  // o login anônimo também entra no prazo
  const q = pagina(); q.ctx.speedboyLoginAnonimo = () => new Promise(() => {});
  q.el('loading').classList.add('show');
  q.ctx.enviarPedido([parada('Ana')], ['stop_1']);
  await q.tick(); await q.avancar(16000);
  ok(!q.el('loading').classList.contains('show') && /NÃO foi enviado/.test(q.toast()),
    '2a. login anônimo pendurado também estoura o prazo (o prazo cobre o login)');
}
{
  /* (a') o sinal VOLTA com a página aberta. O Firebase não desiste da
     gravação: guarda e manda quando reconecta. A loja não pode continuar
     lendo "não foi enviado" com o pedido já na fila — pediria de novo por
     telefone, e a entrega sairia duas vezes. */
  const p = pagina(); p.estado.modo = 'volta';
  p.ctx.enviarPedido([parada('Ana')], ['stop_1']);
  await p.tick(); await p.avancar(16000);
  ok(/NÃO foi enviado/.test(p.toast()) && !p.el('successWrap').classList.contains('show'),
    "2a'. sem sinal: avisa que ainda não foi (e não mostra sucesso)");
  p.estado.soltar(); await p.tick(); await p.tick();
  ok(p.el('successWrap').classList.contains('show'),
    "2a'. o sinal voltou e a gravação subiu: a tela passa para \"Pedido enviado\" sozinha");
  const nGrav = p.db.chamadas.filter(c => c.op === 'update').length;
  ok(nGrav === 1, `2a'. e foi UMA gravação só (${nGrav})`);
}
{
  // (b) tudo-ou-nada: uma única update() multi-caminho em pending
  const p = pagina();
  p.ctx.enviarPedido([parada('Ana'), parada('Bia'), parada('Caio')], ['stop_1', 'stop_2', 'stop_3']);
  await p.tick();
  const c = p.db.chamadas;
  const ups = c.filter(x => x.op === 'update');
  ok(ups.length === 1 && ups[0].path === 'rooms/SB-TEST/pending',
    `2b. três paradas viram UMA update() em rooms/SB-TEST/pending (antes: 3 push soltos — ${c.filter(x => x.op === 'push').length} push, ${ups.length} update)`);
  ok(c.filter(x => x.op === 'push' || x.op === 'set').length === 0, '2b. e nenhuma gravação solta além dela');
  if (ups[0]) {
    const chaves = Object.keys(ups[0].val);
    ok(chaves.length === 3 && new Set(chaves).size === 3 && chaves.every(k => !k.includes('/')),
      '2b. três chaves distintas, filhas diretas de pending');
    const itens = chaves.map(k => ups[0].val[k]);
    ok(itens.every(v => typeof v === 'string' && v.length <= 16384), '2b. cada item continua string JSON ≤ 16384 (a regra valida por filho)');
    const lido = tenta('2b. item é JSON', () => JSON.parse(itens[1]));
    ok(lido && lido.name === 'Bia' && lido.status === 'pending' && lido.address && lido.store === 'KS',
      '2b. o formato do item não mudou (o index.html lê esse nó)');
  }
  ok(p.el('successWrap').classList.contains('show'), '2b. e então mostra o sucesso');
}
{
  // (c) reenviar depois de timeout reutiliza as MESMAS chaves
  const p = pagina(); p.estado.modo = 'pendura';
  p.ctx.enviarPedido([parada('Ana'), parada('Bia')], ['stop_1', 'stop_2']);
  await p.tick(); await p.avancar(16000);
  p.estado.modo = 'ok';
  p.ctx.enviarPedido([parada('Ana'), parada('Bia')], ['stop_1', 'stop_2']);
  await p.tick();
  const ups = p.db.chamadas.filter(x => x.op === 'update');
  const k1 = ups[0] ? Object.keys(ups[0].val).sort().join() : '';
  const k2 = ups[1] ? Object.keys(ups[1].val).sort().join() : '';
  ok(ups.length === 2 && k1 === k2 && k1 !== '',
    `2c. reenvio depois do timeout usa as mesmas chaves (a parada nunca entra duas vezes) — 1ª: ${k1 || '—'} · 2ª: ${k2 || '—'}`);

  // falha por regra no meio: idem
  const q = pagina(); q.estado.modo = 'rejeita'; q.estado.erro = Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' });
  q.ctx.enviarPedido([parada('Ana')], ['stop_1']); await q.tick();
  q.estado.modo = 'ok';
  q.ctx.enviarPedido([parada('Ana')], ['stop_1']); await q.tick();
  const u = q.db.chamadas.filter(x => x.op === 'update');
  ok(u.length === 2 && Object.keys(u[0].val).join() === Object.keys(u[1].val).join(),
    '2c. reenvio depois de erro também reaproveita a chave');

  // depois de um sucesso, o PRÓXIMO pedido ganha chaves novas
  const r = pagina();
  r.ctx.enviarPedido([parada('Ana')], ['stop_1']); await r.tick();
  r.ctx.resetForm(); r.ctx.enviarPedido([parada('Zé')], ['stop_1']); await r.tick();
  const w = r.db.chamadas.filter(x => x.op === 'update');
  ok(w.length === 2 && Object.keys(w[0].val)[0] !== Object.keys(w[1].val)[0],
    '2c. pedido novo (depois de sucesso) não reaproveita a chave do anterior');
}
{
  // (d) duplo toque
  const p = pagina(); p.estado.modo = 'pendura';
  p.ctx.enviarPedido([parada('Ana')], ['stop_1']);
  p.ctx.enviarPedido([parada('Ana')], ['stop_1']);
  await p.tick();
  const g = p.db.chamadas.filter(x => x.op === 'update' || x.op === 'push' || x.op === 'set').length;
  ok(g === 1, `2d. duplo toque em Enviar grava uma vez só (gravações: ${g})`);
  await p.avancar(16000);
  p.estado.modo = 'ok';
  p.ctx.enviarPedido([parada('Ana')], ['stop_1']); await p.tick();
  ok(p.db.chamadas.filter(x => x.op === 'update').length === 2, '2d. depois da falha o botão destrava e dá para tentar de novo');
}
{
  // painel fixo (&para=): mesma garantia, em /repass + /tracking
  const p = pagina('?room=SB-TEST&store=KS&para=FX-ABCD1&nome=Marcia');
  p.ctx.enviarPedido([parada('Ana'), parada('Bia')], ['stop_1', 'stop_2']); await p.tick();
  const ups = p.db.chamadas.filter(x => x.op === 'update');
  const caminhos = ups[0] ? Object.keys(ups[0].val) : [];
  ok(ups.length === 1 && ups[0].path === 'rooms/SB-TEST' &&
     caminhos.filter(k => k.startsWith('repass/FX-ABCD1_')).length === 2 &&
     caminhos.filter(k => k.startsWith('tracking/')).length === 2 &&
     p.db.chamadas.filter(x => x.op === 'set').length === 0,
    '2. link da entregadora fixa: repass + tracking das paradas numa única update() (tudo-ou-nada)');
}

/* ═══ Achado 3 · status ══════════════════════════════════════ */
{
  const p = pagina();
  const canc = tenta('3. statusInfo existe', () => p.ctx.statusInfo('cancelado'));
  const rec = tenta('3. statusInfo existe', () => p.ctx.statusInfo('recusado'));
  ok(canc && /cancelad/i.test(canc.txt) && !/aguardando/i.test(canc.txt) && canc.done === true,
    `3. "cancelado" tem texto próprio, não "Aguardando" (${canc && canc.txt})`);
  ok(rec && /recusad|não aceit/i.test(rec.txt) && !/entregue/i.test(rec.txt) && rec.done === true,
    `3. "recusado" tem texto próprio (${rec && rec.txt})`);

  // tela de sucesso: o status chega do tracking
  p.ctx.lastSubmittedKeys = ['k1'];
  p.ctx._trackStatus = { k1: 'cancelado' };
  p.ctx.applyTrackingToSuccess();
  ok(/cancelad/i.test(p.el('badge_k1').textContent), `3. o selo da tela de sucesso mostra "cancelada" (${p.el('badge_k1').textContent})`);
  ok(p.el('act_k1').removido === true, '3. e some com Editar/Cancelar');

  // histórico
  const hist = (stop) => JSON.stringify([{ date: '16/11/2026', time: '10:00', room: 'SB-TEST', stops: [stop] }]);
  const base = { name: 'Ana', address: 'x', city: 'Vila Velha', key: 'k1', cancelled: false, fixo: false };
  const q1 = pagina(); q1.storage.set('sb_client_hist_KS', hist(base));
  q1.ctx._trackStatus = { k1: 'recusado' }; q1.ctx.renderClientHistory();
  let h = q1.el('histList').innerHTML;
  ok(!/Entregue/.test(h) && /recusad|não aceit/i.test(h), '3. pedido RECUSADO nunca aparece como "Entregue" no histórico');
  ok(!/histEdit|histCancel/.test(h), '3. e não oferece Editar/Cancelar');

  const q2 = pagina(); q2.storage.set('sb_client_hist_KS', hist(base));
  q2.ctx._trackStatus = { k1: 'cancelado' }; q2.ctx.renderClientHistory();
  h = q2.el('histList').innerHTML;
  ok(/cancelad/i.test(h) && !/histEdit|histCancel/.test(h), '3. pedido CANCELADO: selo certo e sem Editar/Cancelar');

  const q3 = pagina(); q3.storage.set('sb_client_hist_KS', hist(base));
  q3.ctx._trackStatus = { k1: 'aceito' }; q3.ctx.renderClientHistory();
  ok(/Aceito/.test(q3.el('histList').innerHTML), '3. o histórico mostra o status real (aceito), não só entregue/cancelada');

  // tocar em Cancelar: "solicitado" até o tracking confirmar
  const q4 = pagina(); q4.storage.set('sb_client_hist_KS', hist(base));
  q4.ctx._trackStatus = { k1: 'aceito' };
  q4.ctx.histCancel(0, 0); await q4.tick();
  h = q4.el('histList').innerHTML;
  ok(/Cancelamento solicitado/.test(h) && !/❌ Cancelada/.test(h),
    '3. tocar em Cancelar mostra "Cancelamento solicitado", não "Cancelada" (o Luan ainda pode recusar)');
  ok(!/histEdit|histCancel/.test(h), '3. e não oferece pedir de novo');
  q4.ctx._trackStatus = { k1: 'cancelado' }; q4.ctx.renderClientHistory();
  ok(/Cancelada/.test(q4.el('histList').innerHTML), '3. quando o tracking confirma, vira "Cancelada"');
}

/* ═══ Achado 4 · pagamento e data ════════════════════════════ */
{
  const p = pagina();
  const base = { name: 'Ana', city: 'VV', bairro: 'Centro', rua: 'A', numero: '1', phone: '27999990000', data: '2026-11-16', pagamento: 'paid', valor: 0, exigePagamento: true };
  const v = o => tenta('4. validarParada existe', () => p.ctx.validarParada(Object.assign({}, base, o))) || {};
  ok(Object.keys(v({})).length === 0, '4. parada completa e já paga passa');
  ok(v({ pagamento: '' }).pagamento, '4. sem escolher o pagamento: erro no campo pagamento');
  ok(v({ pagamento: 'due', valor: 0 }).valor, '4. "A receber" sem valor: erro no campo valor');
  ok(Object.keys(v({ pagamento: 'due', valor: 12.5 })).length === 0, '4. "A receber" com valor passa');
  ok(Object.keys(v({ pagamento: '', exigePagamento: false })).length === 0, '4. link da entregadora fixa (sem pagamento) não exige');
  ok(v({ phone: '2799' }).phone && v({ name: '' }).name && v({ data: '' }).data, '4. telefone curto, nome e data vazios também dão erro');
  ok(typeof v({ pagamento: '' }).pagamento === 'string' && v({ pagamento: '' }).pagamento.length > 5, '4. a mensagem vem em texto (para ficar junto do campo)');

  const dia = tenta('4. dataLocalISO existe', () => p.ctx.dataLocalISO(new Date(2026, 10, 16, 22, 30)));
  ok(dia === '2026-11-16', `4. data padrão é a LOCAL: 22h30 em Brasília é dia 16, não 17 do UTC (${dia})`);

  p.ctx.addStop();
  ok(p.el('stop_1_date').value === '2026-11-16', `4. a 1ª entrega já nasce com a data de hoje (${p.el('stop_1_date').value || 'vazia'})`);
  p.ctx.addStop();
  ok(p.el('stop_2_date').value === '2026-11-16', `4. a 2ª entrega também (antes: só a 1ª) (${p.el('stop_2_date').value || 'vazia'})`);
  p.doc.esquecer('stop_'); p.ctx.resetForm();
  ok(p.el('stop_1_date').value === '2026-11-16', `4. e depois de "Novo pedido" também (${p.el('stop_1_date').value || 'vazia'})`);
}

/* ═══ Achado 9 · erros ═══════════════════════════════════════ */
{
  const p = pagina();
  const t = e => tenta('9. traduzirErro existe', () => p.ctx.traduzirErro(e)) || '';
  const perm = t(Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' }));
  ok(perm && !/permission|denied/i.test(perm), `9. PERMISSION_DENIED vira português (${perm})`);
  const rede = t(new Error('Failed to fetch'));
  ok(rede && /conex|sinal|internet/i.test(rede) && !/fetch/i.test(rede), `9. falha de rede vira português (${rede})`);
  const nrede = t(Object.assign(new Error('A network error (such as timeout, interrupted connection or unreachable host) has occurred.'), { code: 'auth/network-request-failed' }));
  ok(nrede && !/network error|unreachable/i.test(nrede), '9. erro de rede do login também');
  const lixo = t(new Error('INTERNAL ASSERT FAILED: algo'));
  ok(lixo && !/assert|internal/i.test(lixo), '9. erro desconhecido nunca vaza texto cru em inglês');

  // o envio nunca mostra o texto cru
  const q = pagina(); q.estado.modo = 'rejeita';
  q.estado.erro = Object.assign(new Error('PERMISSION_DENIED: Permission denied'), { code: 'PERMISSION_DENIED' });
  q.ctx.enviarPedido([parada('Ana')], ['stop_1']); await q.tick();
  ok(!/PERMISSION|denied/i.test(q.toast()) && /NÃO foi enviado/.test(q.toast()),
    `9. erro de regra no envio: aviso em português, sem texto cru (${q.toast()})`);

  // listener de status com callback de erro
  const r = pagina(); r.ctx.listenTracking();
  const on = r.db.chamadas.find(x => x.op === 'on' && /tracking$/.test(x.path));
  ok(on && typeof on.err === 'function', '9. listenTracking passa callback de erro ao .on()');
  if (on && typeof on.err === 'function') {
    on.err(Object.assign(new Error('permission_denied at /rooms/SB-TEST/tracking: Client doesn\'t have permission'), { code: 'PERMISSION_DENIED' }));
    const aviso = r.el('avisoTracking');
    ok(!/permission|denied/i.test(aviso.textContent) && aviso.textContent.length > 10 && aviso.classList.contains('show'),
      `9. e a loja é avisada, em português (${aviso.textContent})`);
  }
}

/* ═══ Achado 10 · falar com a SpeedBoy ═══════════════════════ */
{
  const trechoId = (de, ate) => HTML.slice(HTML.indexOf(de), HTML.indexOf(ate, HTML.indexOf(de)));
  const form = trechoId('id="mainWrap"', 'id="successWrap"');
  const sucesso = trechoId('id="successWrap"', 'id="errorWrap"');
  const erro = trechoId('id="errorWrap"', '<script>');
  ok(/Falar com a SpeedBoy/.test(form), '10. o formulário tem "Falar com a SpeedBoy"');
  ok(/Falar com a SpeedBoy/.test(erro), '10. a tela "Link inválido" também');
  ok(/Falar com a SpeedBoy/.test(sucesso), '10. e a tela de sucesso');
  ok(/nesta mesma página/.test(sucesso), '10. a tela de sucesso diz que o status se acompanha nesta mesma página');
  ok(/Luan/.test(form) && /Luan/.test(sucesso) && /Luan/.test(erro), '10. os textos que citam o Luan continuam (só se acrescenta)');

  const p = pagina('?room=SB-TEST&store=KS&phone=55 (27) 99916-5959');
  const u = tenta('10. urlFalarSpeedBoy existe', () => p.ctx.urlFalarSpeedBoy());
  ok(u && u.startsWith('https://wa.me/5527999165959'), `10. o link usa o LUAN_PHONE só com dígitos (${u})`);
  const d = pagina();
  ok(/^https:\/\/wa\.me\/5527999165959/.test(tenta('10. urlFalarSpeedBoy', () => d.ctx.urlFalarSpeedBoy()) || ''), '10. sem ?phone= usa o número padrão do Luan');
}

/* ═══ Achado 11 · XSS e onclick ══════════════════════════════ */
{
  const feio = 'Maria "Mari" <img src=x onerror=alert(1)> \\';
  const p = pagina();
  p.ctx.enviarPedido([Object.assign(parada(feio), { address: 'Rua <b>X</b>, 1', reference: '<i>perto</i>' })], ['stop_1']); await p.tick();
  const html = p.el('successList').innerHTML;
  ok(!/<img|<b>X|<i>perto/.test(html), '11. nome, endereço e referência na tela de sucesso passam por escapar()');
  const m = html.match(/onclick="([^"]*requestCancel[^"]*)"/);
  ok(m && !/Mari|img/.test(m[1]), `11. o onclick de Cancelar não leva o nome do cliente (${m && m[1]})`);
  if (m) {
    let erroJs = null;
    try { p.rodar(decodifica(m[1])); } catch (e) { erroJs = e; }
    await p.tick();
    const cr = p.db.chamadas.filter(x => /client_requests/.test(x.path) && (x.val || x.op === 'set'));
    const payload = cr[0] && JSON.parse(cr[0].val || '{}');
    ok(!erroJs && payload && payload.type === 'cancel' && payload.name === feio,
      `11. e o botão FUNCIONA com aspas e barra no nome (${erroJs ? erroJs.message : 'pedido de cancelamento gravado'})`);
  }

  // histórico
  const q = pagina();
  q.storage.set('sb_client_hist_KS', JSON.stringify([{ date: '16/11/2026', time: '10:00', room: 'SB-TEST',
    stops: [{ name: '<img src=x onerror=alert(1)>', address: 'x', city: '<b>VV</b>', reference: '<u>ref</u>', deliveryDate: '16/11/2026', key: 'k1' }] }]));
  q.ctx.renderClientHistory();
  const h = q.el('histList').innerHTML;
  ok(!/<img|<b>VV|<u>ref/.test(h), '11. histórico (lido do localStorage) escapa nome, cidade e referência');

  // sugestões de bairro
  const r = pagina();
  r.el('stop_1_city').value = 'VV'; r.el('stop_1_bairro').value = 'd';
  r.ctx.filterBairros('stop_1');
  const s = r.el('stop_1_bairro_suggestions').innerHTML;
  ok(s && !/<b>x/.test(s) && !/onclick="[^"]*D\\?'/.test(s), `11. sugestão de bairro com ' e < não vira HTML nem quebra o onclick`);
}

/* ═══ Achado 14 · edição e cancelamento ══════════════════════ */
{
  const p = pagina();
  p.ctx._editKey = 'k1'; p.ctx._editName = 'Ana';
  p.el('editAddress').value = '   ';
  p.ctx.submitEdit(); await p.tick();
  ok(p.db.chamadas.filter(x => /client_requests/.test(x.path)).length === 0, '14. edição com endereço vazio NÃO é enviada');
  ok(/endere/i.test(p.toast()), `14. e a loja é avisada (${p.toast()})`);

  // toque repetido enquanto pendura
  const q = pagina(); q.estado.modo = 'pendura';
  q.ctx._editKey = 'k1'; q.ctx._editName = 'Ana'; q.el('editAddress').value = 'Rua B, 2';
  q.ctx.submitEdit(); q.ctx.submitEdit(); await q.tick();
  const n = q.db.chamadas.filter(x => /client_requests/.test(x.path) && (x.op === 'push' || x.op === 'set')).length;
  ok(n === 1, `14. duas batidas em "Enviar solicitação" enfileiram um pedido só (${n})`);
  await q.avancar(16000);
  ok(/NÃO foi enviad/.test(q.toast()), `14. sem sinal, a edição estoura o prazo e avisa que NÃO foi enviada (${q.toast()})`);
  q.estado.modo = 'ok'; q.ctx.submitEdit(); await q.tick();
  const ch = q.db.chamadas.filter(x => /client_requests/.test(x.path) && (x.op === 'push' || x.op === 'set'));
  const chaves = new Set(ch.map(x => x.path.split('/').pop() === 'client_requests' ? 'novo' : x.path));
  ok(ch.length === 2 && chaves.size === 1, `14. o reenvio reutiliza a mesma chave da solicitação — não duplica (${[...chaves].join(',')})`);

  // cancelamento
  const r = pagina(); r.estado.modo = 'pendura';
  r.ctx.requestCancel = r.ctx.requestCancel;
  r.ctx.lastSubmittedKeys = ['k9']; r.ctx.lastSubmittedStops = [parada('Ana')];
  r.ctx.requestCancel(0); r.ctx.requestCancel(0); await r.tick();
  const m = r.db.chamadas.filter(x => /client_requests/.test(x.path) && (x.op === 'push' || x.op === 'set')).length;
  ok(m === 1, `14. toque repetido em Cancelar não enfileira duplicata (${m})`);
  await r.avancar(16000);
  ok(/NÃO foi enviad/.test(r.toast()), '14. cancelamento sem sinal também avisa que NÃO foi enviado');
}

/* ═══ regras da casa ═════════════════════════════════════════ */
ok(!/:root\s*\{/.test(HTML.replace(/<!--[\s\S]*?-->/g, '')), 'a paleta continua vindo do speedboy.css (nenhum :root próprio)');
ok(((HTML.match(/<button(?:\s[^>]*)?>/g) || []).filter(t => !/\btype\s*=/.test(t))).length === 0, 'todo <button> tem type');

/* ═══ Cancelamento recusado ═══════════════════════════════════
   A loja pede para cancelar; o Luan pode dizer não (a entrega já saiu).
   A página ficava em "Cancelamento solicitado" para sempre. */
{
  const p = pagina();
  const { cancelFoiNegado, rotuloPedido } = p.ctx;
  ok(cancelFoiNegado(true, '2026-11-16T10:00', '') === true, 'cancelamento pendente + carimbo novo do Luan = foi negado');
  ok(cancelFoiNegado(false, '2026-11-16T10:00', '') === false, 'sem pedido pendente, o carimbo não significa nada');
  ok(cancelFoiNegado(true, '2026-11-16T10:00', '2026-11-16T10:00') === false,
    'um "não" ANTIGO não responde a um pedido novo de cancelamento');
  ok(cancelFoiNegado(true, '', '') === false, 'sem carimbo, o pedido continua aguardando');

  const r = rotuloPedido('aceito', false, true);
  ok(/cancelamento não aceito/.test(r.txt) && r.acoes === true, `a loja lê que o cancelamento não foi aceito e a entrega segue ("${r.txt}")`);
  ok(rotuloPedido('aceito', true, true).txt.includes('solicitado'), 'pedido novo de cancelamento volta a aparecer como solicitado');
  ok(!/não aceito/.test(rotuloPedido('entregue', false, true).txt), 'depois de entregue, o que vale é "Entregue"');
}

/* ═══ Envio pendurado que sobe depois ═════════════════════════
   Achado de revisão: sem sinal, a loja envia Ana e Bia (pendura), remove a
   Bia e reenvia só a Ana. Quando o sinal voltava, a gravação antiga subia:
   a Bia entrava na fila mesmo removida, e a tela de sucesso era trocada
   pela do pedido antigo, com segunda entrada no histórico. */
{
  const p = pagina(); p.estado.modo = 'volta';
  p.ctx.enviarPedido([parada('Ana'), parada('Bia')], ['stop_1', 'stop_2']);
  await p.tick(); await p.avancar(16000);
  const soltarA = p.estado.soltar;
  p.estado.modo = 'ok';
  p.ctx.enviarPedido([parada('Ana')], ['stop_1']); await p.tick(); await p.tick();
  const ups = p.db.chamadas.filter(c => c.op === 'update');
  const chavesA = Object.keys(ups[0].val), segundo = ups[1].val;
  ok(Object.keys(segundo).filter(k => segundo[k] !== null).length === 1 && segundo[chavesA[1]] === null,
    'reenvio sem a parada removida APAGA a chave dela no banco (a gravação antiga não a deixa na fila)');
  const antes = p.el('successList').innerHTML;
  soltarA(); await p.tick(); await p.tick();
  ok(p.el('successList').innerHTML === antes, 'o envio antigo que sobe depois não toma a tela do pedido novo');
}

fim();
