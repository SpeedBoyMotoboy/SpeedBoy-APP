/* ═══════════════════════════════════════════════════════════════
   Painel do motoboy sem sinal: a confirmação da entrega não pode se perder

   A entrega só é paga com a confirmação. Antes, o motoboy na rua sem sinal:

     • tocava em "Marcar como entregue" e a tela ficava em "⏳ Enviando..."
       para sempre: o SDK só resolve a gravação quando o SERVIDOR responde,
       e a entrega só era marcada DENTRO desse .then — sem timeout, sem
       mensagem, o modal preso
     • se recarregasse a página (ou o Android matasse a aba), a gravação que
       o SDK guardava só em memória e a foto sumiam: a entrega voltava a
       "pendente" e a loja nunca recebia o comprovante
     • cada nova tentativa gerava OUTRO proofId — comprovante órfão
     • quando o sinal voltava, o primeiro toque regravava o repasse INTEIRO
       com a cópia velha do aparelho: endereço que o dono corrigiu voltava ao
       antigo e parada que ele removeu ressuscitava
     • foto recusada pelo servidor: o aviso de erro era coberto, na hora, pelo
       "✅ Entrega confirmada!" — e a loja ficava sem comprovante
     • "Problema enviado para a loja" era dito antes de qualquer gravação
     • painel fixo sem `tel` no link ficava sem o botão de ajuda; sem sinal e
       sem cache, "Carregando..." para sempre — ou "Link inválido" quando o
       SDK nem tinha carregado

   Estes testes rodam o <script> REAL do motoboy.html num sandbox (vm), com
   dublês do DOM, do localStorage e do Firebase — inclusive o "servidor" que
   fica sem sinal, volta, e é alterado pelo dono no meio do caminho. Cada
   verificação é sobre o que o motoboy vê e o que o servidor recebe, não sobre
   nomes de função: contra o código antigo elas reprovam pelo sintoma, não
   por falta de função.
   ═══════════════════════════════════════════════════════════════ */
import vm from 'vm';
import { trecho, lerApp, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();
const esperar = ms => new Promise(r => setTimeout(r, ms));

const SCRIPT = trecho("<script>\n'use strict';", '</script>', 'motoboy.html').replace(/^<script>\n/, '');

// ── dublê do DOM: o suficiente para o painel desenhar e a gente ler ──
class El {
  constructor(id) {
    this.id = id; this.textContent = ''; this.innerHTML = ''; this.value = ''; this.disabled = false;
    this.style = {}; this.href = ''; this.src = '';
    const cls = new Set();
    this.classList = {
      add: c => cls.add(c), remove: c => cls.delete(c), contains: c => cls.has(c),
      toggle: (c, f) => { const quer = f === undefined ? !cls.has(c) : f; quer ? cls.add(c) : cls.delete(c); return quer; }
    };
    if (id === 'entregaModal' || id === 'probModal') cls.add('hidden');
  }
  addEventListener() {} removeAttribute() {} setAttribute() {} focus() {}
}

// ── dublê do localStorage (compartilhado entre "recarregamentos") ──
function criarArmazenamento(limiteValor = Infinity) {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem(k, v) {
      if (String(v).length > limiteValor) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      m.set(k, String(v));
    },
    removeItem: k => m.delete(k),
    _m: m
  };
}

/* ── dublê do Firebase ─────────────────────────────────────────
   O ponto que importa: SEM SINAL uma gravação NUNCA resolve nem rejeita
   (é assim no SDK real) — fica pendente e roda quando o sinal volta. Por
   isso `online=false` guarda a operação em vez de falhar. */
function criarServidor() {
  const S = {
    dados: {}, online: true, pendentes: [], listeners: [], proofsGravados: [],
    recusaFoto: false,
    voltar() { S.online = true; const ops = S.pendentes.splice(0); ops.forEach(o => o()); },
    cair() { S.online = false; },
    snap(path) {
      const filhos = Object.keys(S.dados).filter(k => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));
      const val = path in S.dados ? S.dados[path]
        : filhos.length ? Object.fromEntries(filhos.map(k => [k.slice(path.length + 1), S.dados[k]])) : null;
      return { val: () => (val === undefined ? null : val) };
    },
    emitir() { S.listeners.forEach(l => l.cb(S.snap(l.path))); }
  };
  S.db = {
    ref(path) {
      return {
        set(v) {
          return new Promise((res, rej) => {
            const op = () => {
              if (S.recusaFoto && /\/proofs\//.test(path)) return rej({ code: 'PERMISSION_DENIED' });
              if (/\/proofs\//.test(path)) S.proofsGravados.push(path);
              S.dados[path] = v; res();
            };
            S.online ? op() : S.pendentes.push(op);
          });
        },
        transaction(fn, cb) {
          const op = () => {
            const cur = path in S.dados ? S.dados[path] : null;
            if (cur === null) { fn(null); cb(null, true, S.snap(path)); return; }
            const r = fn(null);                       // 1ª passada do SDK real: sem dado local
            const novo = fn(cur);
            if (novo === undefined) { cb(null, false, S.snap(path)); return; }
            S.dados[path] = novo; cb(null, true, S.snap(path));
          };
          S.online ? op() : S.pendentes.push(op);
        },
        on(ev, cb) { S.listeners.push({ path, cb }); },
        once(ev, cb) { cb(S.snap(path)); }
      };
    }
  };
  return S;
}

const SALA = 'SB-TEST';
const NO = `rooms/${SALA}/repass/RP1`;
const repasseBase = () => JSON.stringify({
  motoboy: 'Carlos', askReceiver: true, askPhoto: true,
  deliveries: [
    { stopId: 'a', name: 'Ana', address: 'R. A, 1', taxa: 9, done: false },
    { stopId: 'b', name: 'Beto', address: 'R. B, 2', taxa: 8, done: false }
  ]
});
const FOTO = 'data:image/jpeg;base64,' + 'A'.repeat(400);

/* Abre o painel como o navegador abriria. `armazenamento` e `servidor`
   persistem entre chamadas: é assim que se simula "recarregar a página". */
async function abrir({ search = `?room=${SALA}&id=RP1`, armazenamento, servidor, semSdk = false, tempoSemSinal, esperarInit = true } = {}) {
  const els = {};
  const handlers = {};
  const ctx = {
    console: { log() {}, warn() {}, error() {} },
    URLSearchParams, setTimeout, clearTimeout,
    localStorage: armazenamento,
    navigator: { userAgent: 'teste', platform: 'x', maxTouchPoints: 0 },
    SpeedBoy: { aplicarTema() {}, alternarTema() {} },
    fmtPhone: s => String(s || ''),
    abertos: [],
    document: {
      title: '',
      getElementById: id => (els[id] = els[id] || new El(id)),
      querySelector: () => new El('q'), querySelectorAll: () => []
    }
  };
  ctx.window = ctx;
  ctx.location = { search, reload() { ctx.recarregou = true; } };
  ctx.SPEEDBOY_FIREBASE_CONFIG = {};
  ctx.matchMedia = () => ({ matches: false });
  ctx.addEventListener = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  ctx.open = u => { ctx.abertos.push(u); };
  ctx.speedboyLoginAnonimo = () => Promise.resolve();
  if (!semSdk) ctx.firebase = { initializeApp() {}, database: () => servidor.db };
  vm.createContext(ctx);
  vm.runInContext(SCRIPT, ctx);
  ctx.TIMEOUT_ENVIO = 80;                       // 15 s de verdade não cabe num teste
  if (tempoSemSinal) ctx.TEMPO_SEM_SINAL = tempoSemSinal;
  ctx.el = id => (els[id] = els[id] || new El(id));
  ctx.dispara = ev => (handlers[ev] || []).forEach(f => f());
  if (esperarInit) { ctx.init(); await esperar(15); }
  return ctx;
}

const sistema = () => ({ armazenamento: criarArmazenamento(), servidor: criarServidor() });

// Servidor com o repasse publicado + página aberta e já com o 1º snapshot
async function abrirComRepasse(sis, extra = {}) {
  sis.servidor.dados[NO] = repasseBase();
  const ctx = await abrir({ ...sis, ...extra });
  sis.servidor.emitir(); await esperar(10);
  return ctx;
}

// Preenche e confirma a entrega `i` como o motoboy faria no modal
function confirmar(ctx, i, { nome = 'Dona Maria', foto = FOTO } = {}) {
  ctx.abrirEntrega(i);
  ctx.el('entregaRecebedor').value = nome;
  ctx._fotoDataUrl = foto;
  ctx.validarEntrega();
  ctx.confirmarEntrega();
}

const fila = sis => {
  const chave = [...sis.armazenamento._m.keys()].find(k => k.startsWith('sb_moto_fila_'));
  try { return chave ? JSON.parse(sis.armazenamento.getItem(chave)) : []; } catch (e) { return []; }
};
const no = sis => JSON.parse(sis.servidor.dados[NO]);
const cartoes = ctx => ctx.el('stopsWrap').innerHTML;
const proofs = sis => Object.keys(sis.servidor.dados).filter(k => k.includes('/proofs/'));

// ══════════════════════════════════════════════════════════════
//  1. Sem sinal: a confirmação fica no aparelho e a tela diz a verdade
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  sis.servidor.cair();
  confirmar(ctx, 0);
  await esperar(20);                       // bem antes do timeout

  ok(ctx.repassData.deliveries[0].done === true,
    'sem resposta do servidor, o cartão já aparece como entregue');
  ok(ctx.el('entregaModal').classList.contains('hidden'),
    'e o modal fecha — não fica preso em "Enviando..."');
  ok(/aguardando sinal/.test(cartoes(ctx)),
    'o cartão diz "aguardando sinal"');

  const f = fila(sis);
  ok(f.length === 1 && f[0].stopId === 'a' && f[0].campos.done === true,
    'a confirmação está na fila do aparelho (localStorage), com o id da parada e done');
  ok(f[0] && f[0].campos.receivedBy === 'Dona Maria' && !!f[0].campos.doneAt,
    'com quem recebeu e a hora');
  ok(f[0] && /^PF-/.test(f[0].proofId || '') && sis.armazenamento.getItem('sb_moto_foto_' + f[0].proofId) === FOTO,
    'e com o proofId e a foto — nada depende de memória da página');
  ok(f[0] && !f[0].foto, 'a foto fica numa chave própria do aparelho, fora da fila');

  await esperar(150);                      // passou o timeout
  ok(fila(sis).length === 1 && ctx.repassData.deliveries[0].done === true,
    'timeout NÃO é erro: a entrega segue na fila e marcada na tela');
  ok(/Salva neste aparelho/.test(ctx.el('toast').textContent) && /sinal voltar/.test(ctx.el('toast').textContent),
    'e a mensagem diz que está salva no aparelho e sobe quando o sinal voltar');
  ok(!/Erro|tente de novo/i.test(ctx.el('toast').textContent), 'sem "erro" nem "tente de novo"');

  // A faixa de cima conta a verdade e o número
  const faixa = ctx.el('avisoCache').textContent;
  ok(ctx.el('avisoCache').style.display !== 'none' && /1 confirmação de entrega/.test(faixa),
    'a faixa mostra quantas confirmações estão esperando');
  ok(!/é enviado quando o sinal voltar/.test(faixa),
    'e não promete mais "é enviado quando o sinal voltar" sem ter fila por trás');
}

// ══════════════════════════════════════════════════════════════
//  2. Snapshot do servidor com a entrega ainda "pendente" não a desfaz
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  sis.servidor.cair();
  confirmar(ctx, 0);
  await esperar(20);
  sis.servidor.emitir(); await esperar(10);   // servidor ainda diz done:false
  ok(ctx.repassData.deliveries[0].done === true && /aguardando sinal/.test(cartoes(ctx)),
    'snapshot velho do servidor não desfaz a entrega que está na fila — a fila é reaplicada por cima');
  ok(ctx.repassData.deliveries[1].done === false, 'e não marca a outra parada');
}

// ══════════════════════════════════════════════════════════════
//  3. Recarregar a página: continua marcada e reenvia, com o MESMO proofId
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  sis.servidor.cair();
  confirmar(ctx, 0);
  await esperar(20);
  const proofId = (fila(sis)[0] || {}).proofId;

  // A aba morre: página nova, mesmo aparelho, ainda sem sinal
  const ctx2 = await abrir(sis);
  ok(ctx2.repassData && ctx2.repassData.deliveries[0].done === true && /aguardando sinal/.test(cartoes(ctx2)),
    'recarregar com item na fila mantém a entrega marcada (cache + fila por cima)');
  ok(ctx2.el('avisoCache').style.display !== 'none' && /1 confirmação/.test(ctx2.el('avisoCache').textContent),
    'e a faixa continua contando a confirmação que espera');

  // Sinal volta: a página nova reenvia sozinha ao receber o snapshot
  sis.servidor.voltar();
  await esperar(30);
  sis.servidor.emitir(); await esperar(40);
  const d = no(sis).deliveries[0];
  ok(d.done === true && d.receivedBy === 'Dona Maria' && d.proofId === proofId && !!d.doneAt,
    'o reenvio grava done/doneAt/receivedBy e o MESMO proofId da 1ª tentativa');
  ok(proofs(sis).length === 1 && proofs(sis)[0].endsWith('/' + proofId),
    'um único comprovante no banco — nenhum órfão');
  ok(fila(sis).length === 0, 'a resposta do servidor esvazia a fila');
  ok(!/aguardando sinal/.test(cartoes(ctx2)), 'e a marca "aguardando sinal" some do cartão');
  ok(ctx2.el('avisoCache').style.display === 'none', 'e a faixa some');
}

// ══════════════════════════════════════════════════════════════
//  4. Várias tentativas (timeout, evento `online`, snapshot): idempotente
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  sis.servidor.cair();
  confirmar(ctx, 0);
  await esperar(150);                       // 1ª tentativa estourou o tempo
  ctx.dispara('online');                    // o navegador acha que voltou
  await esperar(150);                       // 2ª tentativa também sem resposta
  if (ctx.enviarFila) ctx.enviarFila();
  await esperar(150);                       // 3ª
  const tentativas = sis.servidor.pendentes.length;
  sis.servidor.voltar();                    // o SDK despeja tudo que acumulou
  await esperar(60);
  sis.servidor.emitir(); await esperar(60);  // e o snapshot do reencontro sobe o resto
  const nos = Object.keys(sis.servidor.dados).filter(k => k.includes('/repass/'));
  const idsDeFoto = new Set(proofs(sis));
  ok(tentativas >= 3, `o sandbox acumulou várias gravações pendentes (${tentativas}) como o SDK faria`);
  ok(idsDeFoto.size === 1, 'todas as tentativas usaram o mesmo proofId (um comprovante só)');
  const d = no(sis).deliveries[0];
  ok(nos.length === 1 && d.done === true && d.proofId && proofs(sis)[0].endsWith('/' + d.proofId),
    'o nó termina com a entrega uma vez só e apontando para esse comprovante');
  ok(no(sis).deliveries.length === 2, 'sem duplicar paradas');
}

// ══════════════════════════════════════════════════════════════
//  5. Chegou snapshot e o sinal voltou: a fila sobe sem precisar de toque
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  sis.servidor.cair();
  confirmar(ctx, 0);
  await esperar(150);
  sis.servidor.online = true;               // só voltou — nenhum evento disparado
  sis.servidor.emitir();                    // mas o listener do banco entrega o snapshot
  await esperar(40);
  ok(no(sis).deliveries[0].done === true && fila(sis).length === 0,
    'o snapshot do servidor também esvazia a fila');
}

// ══════════════════════════════════════════════════════════════
//  6. Com sinal: confirma, o item sai da fila e o nó mantém o formato
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  confirmar(ctx, 0);
  await esperar(40);
  ok(fila(sis).length === 0 && !/aguardando sinal/.test(cartoes(ctx)),
    'com sinal, a resposta do servidor esvazia a fila e tira a marca');
  ok(/Entrega confirmada/.test(ctx.el('toast').textContent), 'e só então diz "Entrega confirmada"');
  ok(typeof sis.servidor.dados[NO] === 'string', 'o nó do repasse continua sendo uma string JSON');
  const d = no(sis).deliveries[0];
  ok(d.done === true && typeof d.doneAt === 'string' && d.receivedBy === 'Dona Maria' && /^PF-/.test(d.proofId),
    'com os campos que o index.html lê: done, doneAt, receivedBy, proofId');
  ok(sis.servidor.dados[proofs(sis)[0]] === FOTO, 'e a foto está em /proofs com o mesmo conteúdo');
  ok(!('problem' in d) && no(sis).motoboy === 'Carlos' && no(sis).deliveries[1].done === false,
    'o resto do repasse fica como estava');
}

// ══════════════════════════════════════════════════════════════
//  7. O dono mexeu no repasse enquanto o motoboy estava sem sinal
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  sis.servidor.cair();
  confirmar(ctx, 0);                         // motoboy entrega a "a"
  await esperar(20);

  // Luan corrige o endereço da "a", remove a "b" e acrescenta a "c"
  const atual = no(sis);
  atual.deliveries[0].address = 'R. A CORRIGIDA, 99';
  atual.deliveries = [atual.deliveries[0], { stopId: 'c', name: 'Caio', address: 'R. C, 3', done: false }];
  sis.servidor.dados[NO] = JSON.stringify(atual);

  sis.servidor.voltar();
  await esperar(60);
  const r = no(sis);
  ok(r.deliveries[0].done === true && r.deliveries[0].address === 'R. A CORRIGIDA, 99',
    'a confirmação entra sem desfazer o endereço que o dono corrigiu');
  ok(!r.deliveries.some(d => d.stopId === 'b'), 'parada removida pelo dono não ressuscita');
  ok(r.deliveries.some(d => d.stopId === 'c') && r.deliveries.length === 2,
    'parada que o dono acrescentou continua lá');
}
{
  // O motoboy confirma uma parada que o dono removeu: a confirmação não a recria
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  sis.servidor.cair();
  confirmar(ctx, 1);                         // "b"
  await esperar(20);
  const atual = no(sis);
  atual.deliveries = atual.deliveries.filter(d => d.stopId !== 'b');
  sis.servidor.dados[NO] = JSON.stringify(atual);
  sis.servidor.voltar();
  await esperar(60);
  ok(no(sis).deliveries.length === 1 && no(sis).deliveries[0].stopId === 'a',
    'confirmar parada removida pelo dono não a recria no nó');
  ok(fila(sis).length === 0, 'e o item que não tem mais onde entrar sai da fila (não trava a fila)');
}

// ══════════════════════════════════════════════════════════════
//  8. Unidades: aplicar um item sobre o JSON do repasse
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  const tem = f => typeof ctx[f] === 'function';
  ok(tem('aplicarItemNoRepasse') && tem('reaplicarFila') && tem('enfileirar'),
    'a fila está em funções pequenas e testáveis (enfileirar, reaplicar, aplicar item)');
  if (tem('aplicarItemNoRepasse')) {
    const item = { tipo: 'confirmar', no: 'RP1', stopId: 'a', campos: { done: true, doneAt: 'X', receivedBy: 'Zé', proofId: 'PF-1', problem: null } };
    const base = JSON.stringify({ motoboy: 'C', deliveries: [{ stopId: 'a', address: 'NOVO', problem: { tipo: 'x' } }] });
    const um = ctx.aplicarItemNoRepasse(base, item);
    ok(um === ctx.aplicarItemNoRepasse(um, item), 'aplicar duas vezes dá o mesmo JSON (idempotente)');
    ok(!('problem' in JSON.parse(um).deliveries[0]), 'confirmar encerra o problema aberto na parada');
    ok(ctx.aplicarItemNoRepasse(base, { ...item, stopId: 'zzz' }) === null,
      'parada que não existe devolve null — nada é criado');
    const ordem = ctx.aplicarItemNoRepasse(
      JSON.stringify({ deliveries: [{ stopId: 'a' }, { stopId: 'c' }] }),
      { tipo: 'ordem', no: 'RP1', ordem: ['b', 'c', 'a'], coords: {} });
    ok(JSON.parse(ordem).deliveries.map(d => d.stopId).join() === 'c,a',
      'reordenar a rota respeita a ordem mas não ressuscita parada removida ("b")');
  }
}

// ══════════════════════════════════════════════════════════════
//  9. Cota do localStorage estourada (foto grande): a confirmação não se perde
// ══════════════════════════════════════════════════════════════
{
  const sis = { armazenamento: criarArmazenamento(3000), servidor: criarServidor() };
  const grande = 'data:image/jpeg;base64,' + 'B'.repeat(20000);
  const ctx = await abrirComRepasse(sis);
  sis.servidor.cair();
  confirmar(ctx, 0, { foto: grande });
  await esperar(20);
  const f = fila(sis);
  ok(f.length === 1 && f[0].campos.done === true && f[0].stopId === 'a' && /^PF-/.test(f[0].proofId),
    'cota estourada: a confirmação é guardada mesmo assim, só que sem a foto');
  ok(f[0] && !f[0].foto, 'a foto grande não vai para o localStorage');
  ok(ctx.repassData.deliveries[0].done === true, 'e o cartão continua marcado');
  ok(/NÃO feche/.test(ctx.el('avisoCache').textContent),
    'a faixa avisa para não fechar a página até o sinal voltar (a foto está só em memória)');
  sis.servidor.voltar();
  await esperar(60);
  ok(sis.servidor.dados[proofs(sis)[0]] === grande && no(sis).deliveries[0].proofId === (f[0] || {}).proofId,
    'com sinal, a foto sobe da memória e a entrega aponta para ela');
  ok(fila(sis).length === 0, 'e a fila esvazia');
}

// ══════════════════════════════════════════════════════════════
//  10. Foto recusada pelo servidor: a entrega fica, o aviso é persistente
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  sis.servidor.recusaFoto = true;
  confirmar(ctx, 0);
  await esperar(60);
  const d = no(sis).deliveries[0];
  ok(d.done === true && !d.proofId, 'a entrega fica registrada, sem apontar para foto que não existe');
  ok(/Sem comprovante/.test(cartoes(ctx)) && /reenviar a foto/.test(cartoes(ctx)),
    'o cartão mostra "sem comprovante — toque para reenviar a foto"');
  ok(/recusou a foto/.test(ctx.el('toast').textContent) && !/Entrega confirmada/.test(ctx.el('toast').textContent),
    'e o aviso de foto NÃO é coberto por "Entrega confirmada!"');
  ok(/sem comprovante/.test(ctx.el('avisoCache').textContent), 'a faixa também fala do comprovante');
  ctx.dispara('online'); await esperar(40);
  ok(proofs(sis).length === 0 && /Sem comprovante/.test(cartoes(ctx)),
    'a foto recusada não fica sendo reenviada em loop: espera o toque');

  sis.servidor.recusaFoto = false;           // o problema foi resolvido
  if (ctx.reenviarFoto) ctx.reenviarFoto(0);
  await esperar(60);
  ok(proofs(sis).length === 1 && no(sis).deliveries[0].proofId && !/Sem comprovante/.test(cartoes(ctx)),
    'tocar para reenviar sobe a foto, liga o proofId no nó e tira o aviso');
}

// ══════════════════════════════════════════════════════════════
//  11. Problema, resolvido e reabrir: entram na fila; texto honesto
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  sis.servidor.cair();
  ctx.abrirProb(0);
  ctx.escolherMotivo(0);
  ctx.el('probTexto').value = 'Número não existe';
  ctx.enviarProblema();
  await esperar(20);
  ok(fila(sis).some(i => i.tipo === 'problema' && i.stopId === 'a'),
    'problema sem sinal entra na fila do aparelho');
  ok(ctx.abertos.length === 1 && /wa\.me/.test(ctx.abertos[0]), 'o WhatsApp abre');
  ok(!/Problema enviado/.test(ctx.el('toast').textContent) && /toque em enviar/.test(ctx.el('toast').textContent),
    'o aviso diz "WhatsApp aberto — toque em enviar", não "Problema enviado"');
  ok(/aguardando sinal/.test(cartoes(ctx)), 'e o cartão mostra que o registro espera sinal');
  sis.servidor.voltar(); await esperar(60);
  const p = no(sis).deliveries[0].problem;
  ok(p && p.detalhe === 'Número não existe' && fila(sis).length === 0,
    'com sinal, o problema é gravado só naquela parada e a fila esvazia');

  // Resolvido sem sinal
  sis.servidor.cair();
  ctx.abrirProb(0); ctx.resolverProblema(); await esperar(20);
  ok(fila(sis).some(i => i.tipo === 'resolvido') && !ctx.repassData.deliveries[0].problem,
    'resolvido sem sinal também entra na fila e some da tela');
  ok(!/Problema encerrado/.test(ctx.el('toast').textContent), 'e não diz "encerrado" antes de gravar');
  sis.servidor.voltar(); await esperar(60);
  ok(!('problem' in no(sis).deliveries[0]), 'com sinal, o problema sai do nó');

  // Reabrir sem sinal
  confirmar(ctx, 1); await esperar(60);
  ok(no(sis).deliveries[1].done === true, '(entregou a segunda com sinal)');
  sis.servidor.cair();
  ctx.toggleDone(1); await esperar(20);
  ok(ctx.repassData.deliveries[1].done === false && fila(sis).some(i => i.tipo === 'reabrir'),
    'reabrir sem sinal entra na fila e reabre na tela');
  sis.servidor.voltar(); await esperar(60);
  const b = no(sis).deliveries[1];
  ok(b.done === false && !b.doneAt && !b.receivedBy && !b.proofId, 'com sinal, o nó reabre e limpa a confirmação');
}

// ══════════════════════════════════════════════════════════════
//  12. Painel fixo: mesma fila, foto e nome obrigatórios, ajuda sempre
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();
  const noFx = `rooms/${SALA}/repass/FX-T1_a`;
  sis.servidor.dados[noFx] = JSON.stringify({ motoboy: 'Márcia', painel: 'FX-T1', createdAt: new Date().toISOString(),
    deliveries: [{ stopId: 'fx_a', name: 'Ana', address: 'R. A, 1', done: false }] });
  const ctx = await abrir({ ...sis, search: `?room=${SALA}&painel=FX-T1&nome=M%C3%A1rcia` });   // SEM tel
  sis.servidor.emitir(); await esperar(10);

  ok(ctx.el('fxAjuda').style.display !== 'none' && /wa\.me\/5527999165959/.test(ctx.el('fxAjuda').href),
    'sem `tel` no link, o botão de ajuda aparece com o telefone padrão da SpeedBoy');

  ctx.toggleDone(0);
  ok(ctx.el('btnConfirmarEntrega').disabled === true, 'no painel fixo não confirma sem foto e nome');
  ctx.el('entregaRecebedor').value = 'Porteiro'; ctx.validarEntrega();
  ok(ctx.el('btnConfirmarEntrega').disabled === true, 'nem só com o nome');
  ctx._fotoDataUrl = FOTO; ctx.validarEntrega();
  ok(ctx.el('btnConfirmarEntrega').disabled === false, 'com foto e nome libera');

  sis.servidor.cair();
  ctx.confirmarEntrega();
  await esperar(20);
  ok(ctx.repassData.deliveries[0].done === true && /aguardando sinal/.test(cartoes(ctx)),
    'painel fixo sem sinal: a entrega fica marcada "aguardando sinal"');
  ok(fila(sis).length === 1 && fila(sis)[0].no === 'FX-T1_a' && fila(sis)[0].stopId === 'fx_a',
    'e entra na fila com o nó e a parada');

  sis.servidor.emitir(); await esperar(10);
  ok(ctx.repassData.deliveries[0].done === true, 'snapshot velho não desfaz a entrega do painel fixo');

  const ctx2 = await abrir({ ...sis, search: `?room=${SALA}&painel=FX-T1&nome=M%C3%A1rcia` });
  ok(ctx2.repassData.deliveries[0].done === true, 'recarregar o painel fixo mantém a entrega marcada');
  sis.servidor.voltar(); await esperar(40);
  sis.servidor.emitir(); await esperar(40);
  const d = JSON.parse(sis.servidor.dados[noFx]).deliveries[0];
  ok(d.done === true && d.receivedBy === 'Porteiro' && /^PF-/.test(d.proofId) && fila(sis).length === 0,
    'com sinal, o painel fixo grava só a entrega e esvazia a fila');
}

// ══════════════════════════════════════════════════════════════
//  13. Abrir sem sinal e sem cache
// ══════════════════════════════════════════════════════════════
{
  const sis = sistema();                     // servidor nunca responde: nada de snapshot
  const ctx = await abrir({ ...sis, tempoSemSinal: 40 });
  ok(!ctx.el('semSinalWrap').classList.contains('show'), 'logo ao abrir ainda é "Carregando"');
  await esperar(90);
  ok(ctx.el('semSinalWrap').classList.contains('show') && /Sem sinal/.test(ctx.el('semSinalTitulo').textContent),
    'depois de um tempo mostra "Sem sinal — tentando de novo" em vez de girar para sempre');
  ok(ctx.el('loadingWrap').style.display === 'none' && !ctx.el('errorWrap').classList.contains('show'),
    'sem o spinner e sem "Link inválido"');
  // E quando o dado chega, o aviso some sozinho
  sis.servidor.dados[NO] = repasseBase(); sis.servidor.emitir(); await esperar(10);
  ok(!ctx.el('semSinalWrap').classList.contains('show') && /Ana/.test(cartoes(ctx)),
    'quando o sinal volta a lista aparece e o aviso some');
}
{
  const sis = sistema();
  const ctx = await abrir({ ...sis, semSdk: true });
  ok(ctx.el('semSinalWrap').classList.contains('show') && /internet/i.test(ctx.el('semSinalTitulo').textContent),
    'SDK do Firebase que não carregou diz que falta internet');
  ok(!ctx.el('errorWrap').classList.contains('show'), '— e NÃO "Link inválido"');
  ok(/onclick="location\.reload\(\)"/.test(lerApp('motoboy.html')), 'com botão para tentar de novo');
}
{
  // Link realmente inválido continua sendo "Link inválido"
  const ctx = await abrir({ ...sistema(), search: '?room=&id=' });
  ok(ctx.el('errorWrap').classList.contains('show'), 'link sem sala continua mostrando "Link inválido"');
}

// ══════════════════════════════════════════════════════════════
//  14. O que o código não pode voltar a fazer (guarda de texto)
// ══════════════════════════════════════════════════════════════
{
  const src = lerApp('motoboy.html');
  ok(!/_salvando/.test(src), 'não há mais "regravar tudo e descartar snapshot enquanto grava"');
  ok(!/repass\/'\+REPASS_ID\)\.set\(/.test(src) && !/\/repass\/'\+s\._no\)\.set\(/.test(src),
    'ninguém regrava o nó do repasse inteiro com a cópia local');
  ok(/\/repass\/'\+item\.no\)\.transaction\(/.test(src), 'o nó é alterado por transaction, sobre o estado atual');
  ok(!/Problema enviado para a loja/.test(src), 'não existe mais "Problema enviado para a loja"');
}

// ══════════════════════════════════════════════════════════════
//  Achados da revisão independente
// ══════════════════════════════════════════════════════════════

/* A segunda foto estoura a cota — e a PRIMEIRA não pode pagar por isso.
   A foto ia dentro do item da fila; quando a cota estourava, a fila inteira
   era regravada sem foto nenhuma, inclusive a que já estava salva. Fechada
   a aba, as duas entregas subiam sem comprovante. (O teste 9 acima usa
   limite por valor e uma foto só — não pegava.) */
{
  // Cota TOTAL, como no aparelho de verdade.
  const cotaTotal = total => {
    const m = new Map();
    const usado = () => [...m.entries()].reduce((t, [k, v]) => t + k.length + v.length, 0);
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem(k, v) {
        const antes = m.has(k) ? k.length + m.get(k).length : 0;
        if (usado() - antes + k.length + String(v).length > total) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
        m.set(k, String(v));
      },
      removeItem: k => m.delete(k), _m: m
    };
  };
  const sis = { armazenamento: cotaTotal(4200), servidor: criarServidor() };
  const foto1 = 'data:image/jpeg;base64,' + 'A'.repeat(1500);
  const foto2 = 'data:image/jpeg;base64,' + 'B'.repeat(1800);
  let ctx = await abrirComRepasse(sis);
  sis.servidor.cair();
  confirmar(ctx, 0, { foto: foto1 });
  await esperar(20);
  confirmar(ctx, 1, { nome: 'Seu Zé', foto: foto2 });
  await esperar(20);
  const f = fila(sis);
  ok(f.length === 2, `as duas confirmações estão na fila do aparelho (${f.length})`);
  ok(sis.armazenamento.getItem('sb_moto_foto_' + f[0].proofId) === foto1,
    'a foto da PRIMEIRA entrega continua guardada quando a segunda não cabe');
  ok(/NÃO feche/.test(ctx.el('avisoCache').textContent), 'e a faixa avisa que a segunda está só na memória');

  // A aba morre (as gravações que ela tinha na fila do SDK morrem junto) e o sinal volta.
  sis.servidor.pendentes.length = 0;
  ctx = await abrirComRepasse(sis);
  sis.servidor.voltar();
  await esperar(80);
  const n = no(sis);
  ok(n.deliveries[0].done === true && !!n.deliveries[0].proofId && sis.servidor.dados[`rooms/${SALA}/proofs/${n.deliveries[0].proofId}`] === foto1,
    'depois de fechar a aba, a primeira entrega sobe COM o comprovante dela');
  ok(n.deliveries[1].done === true && !n.deliveries[1].proofId,
    'a segunda (foto perdida com a aba) sobe registrada, sem apontar para foto que não existe' +
    ' — veio ' + JSON.stringify({ done: n.deliveries[1].done, proofId: n.deliveries[1].proofId, fila: fila(sis).map(i => i.tipo + (i.parado ? '(parado)' : '')) }));
  ok(![...sis.armazenamento._m.keys()].some(k => k === 'sb_moto_foto_' + n.deliveries[0].proofId),
    'e a foto enviada sai do aparelho (não fica ocupando a cota)');
}

/* Modal aberto, parada removida pelo dono: a confirmação NÃO cai na vizinha.
   Havia um "senão, a do índice i" — a foto e o nome de quem recebeu a Ana
   eram gravados no Beto. */
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  ctx.abrirEntrega(0);
  const rp = no(sis);
  const tirada = rp.deliveries.shift();                       // o dono tirou a primeira parada
  sis.servidor.dados[NO] = JSON.stringify(rp);
  ctx.aplicarRepasse(JSON.parse(JSON.stringify(rp)), false);
  ctx.el('entregaRecebedor').value = 'Dona Maria';
  ctx._fotoDataUrl = FOTO;
  ctx.confirmarEntrega();
  await esperar(40);
  ok(fila(sis).length === 0 && no(sis).deliveries.every(d => !d.done),
    `parada removida com o modal aberto: nada é gravado na parada vizinha (removida: ${tirada.name})`);
}

/* "Permissão negada" na foto pode ser só sessão que não abriu. Uma recusa
   seguida de sucesso (depois de refazer o login) não pode custar o
   comprovante. */
{
  const sis = sistema();
  const ctx = await abrirComRepasse(sis);
  let logins = 0;
  ctx.window.speedboyLoginAnonimo = () => { logins++; sis.servidor.recusaFoto = false; return Promise.resolve(); };
  sis.servidor.recusaFoto = true;                              // 1ª tentativa: negada (sem sessão)
  confirmar(ctx, 0);
  await esperar(80);
  const d = no(sis).deliveries[0];
  ok(logins >= 1, 'recusa na foto faz o painel refazer o login');
  ok(d.done === true && !!d.proofId && proofs(sis).length === 1,
    'e a entrega sobe COM o comprovante — a recusa passageira não arranca o proofId');
  ok(!/Sem comprovante/.test(cartoes(ctx)), 'sem aviso de "sem comprovante" no cartão');
}

fim();
