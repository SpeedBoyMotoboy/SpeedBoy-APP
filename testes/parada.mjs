/* ═══════════════════════════════════════════════════════════════
   Editar uma parada — o que NÃO pode mudar junto.

   O formulário montava um objeto novo só com os campos da tela e gravava
   por cima: `stops[idx] = s`. Tudo que não é campo de formulário ia
   embora — e é justamente o que liga a parada ao resto do app:

   • _id          a identidade. Sem ela a confirmação do motoboy
                  (repasse) não acha mais a parada: ele marca ENTREGUE e o
                  app de quem despachou nunca fica sabendo;
   • _trackKey    a ligação com a loja. A loja fica vendo "aceito" para
                  sempre, e o pedido de cancelamento dela cai em "entrega
                  não encontrada";
   • proofId, receivedBy, deliveredBy   o comprovante. No painel fixo, a
                  entrega sem foto e nome NÃO conta como paga;
   • _doneDate    o dia da entrega — é por ele que o fechamento corta o mês;
   • cancelled    a cancelada voltava a valer.

   Bastava corrigir um telefone.

   E gravava pelo ÍNDICE guardado quando o formulário abriu. Se a lista
   mudasse nesse meio-tempo (sincronização, pedido aceito), os dados da
   parada A caíam em cima da parada B.

   Como sempre, o código testado é EXTRAÍDO do index.html.
   ═══════════════════════════════════════════════════════════════ */
import { trecho, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();
const HOJE = new Date().toLocaleDateString('pt-BR');

function montar(campos = {}) {
  const base = {
    fName: 'Ana Lima', fRua: 'Rua das Flores', fNumero: '10', fBairro: 'Jacaraípe', fCity: 'SER',
    fDelivDate: '', fStore: 'KS', fServiceType: 'entrega', fComplement: '', fReference: '',
    fTimeFrom: '', fTimeTo: '', fPhone: '(27) 99916-5959', fValue: '35,00', fPaid: '0',
    fProductValue: '', fProductPaid: '0', fNotes: '', editIdx: '-1'
  };
  const valores = { ...base, ...campos };
  const els = {};
  let n = 0;
  const ctx = {
    stops: [], editingId: null, avisos: [], gravou: 0, foiPara: '',
    document: { getElementById(id) { return els[id] || (els[id] = { value: valores[id] !== undefined ? valores[id] : '' }); } },
    toast(m, tipo) { ctx.avisos.push({ m, tipo }); },
    cityName(c) { return ({ SER: 'Serra', VIX: 'Vitória' })[c] || ''; },
    parseMoney(v) { return parseFloat(String(v == null ? '' : v).replace(/[^\d,.-]/g, '').replace(',', '.')) || 0; },
    addCustomBairro() {},
    saveStops() { ctx.gravou++; },
    goNav(t) { ctx.foiPara = t; },
    idDaParada(s) { return s._id || (s._trackKey ? 'tk_' + s._trackKey : 'h_x'); },
    novoId() { return 'novo' + (++n); }
  };
  const fonte = trecho('function saveStop(){', '\n// ═══', 'index.html');
  const fabrica = new Function('ctx', `with (ctx) { ${fonte}; return { saveStop }; }`);
  return { ctx, ...fabrica(ctx) };
}

const completa = () => ({
  _id: 'sabc', _upd: 111, _h: 'h', _trackKey: 'k9', _repassId: 'RP1', repassadaPara: 'Márcia', repassValor: 8,
  name: 'Ana Lima', address: 'Rua das Flores, 10, Jacaraípe - Serra', street: 'Rua das Flores', number: '10',
  neighborhood: 'Jacaraípe', city: 'SER', store: 'KS', value: 35, phone: '27000000000',
  done: true, paid: true, cancelled: false, _doneDate: '10/11/2026', _addedDate: '09/11/2026', _order: 4,
  deliveredBy: 'Márcia', deliveredAt: '2026-11-10T15:00:00.000Z', receivedBy: 'Porteiro José', proofId: 'PF1'
});

// ── 1. Corrigir o telefone não apaga o resto ─────────────────
{
  const { ctx, saveStop } = montar({ fPaid: '1' });
  ctx.stops = [completa()];
  ctx.editingId = 'sabc';
  saveStop();
  const s = ctx.stops[0];
  ok(ctx.stops.length === 1 && ctx.gravou === 1, 'editar grava a mesma parada, não cria outra');
  ok(s.phone === '27999165959', 'o campo editado muda');
  ok(s._id === 'sabc', `a identidade continua a mesma (ficou ${s._id}) — o repasse acha a parada de volta`);
  ok(s._trackKey === 'k9', 'a ligação com a loja (_trackKey) sobrevive — a loja continua sendo avisada');
  ok(s._repassId === 'RP1' && s.repassadaPara === 'Márcia' && s.repassValor === 8, 'os dados do repasse sobrevivem');
  ok(s.proofId === 'PF1' && s.receivedBy === 'Porteiro José' && s.deliveredBy === 'Márcia',
    'o comprovante sobrevive — sem ele a entrega do painel fixo deixa de contar como paga');
  ok(s._doneDate === '10/11/2026' && s.done === true, 'o dia da entrega sobrevive — o fechamento não muda de mês');
  ok(s._addedDate === '09/11/2026' && s._order === 4, 'data de cadastro e posição na lista também');
}

// ── 2. Cancelada continua cancelada ──────────────────────────
{
  const { ctx, saveStop } = montar({ fValue: '' });
  ctx.stops = [{ ...completa(), cancelled: true, value: 0, paid: false }];
  ctx.editingId = 'sabc';
  saveStop();
  ok(ctx.stops[0].cancelled === true, 'editar uma entrega cancelada não a "descancela"');
}

// ── 3. Grava na parada certa mesmo que a lista tenha mudado ──
{
  const { ctx, saveStop } = montar({ fName: 'Ana Corrigida' });
  // O formulário abriu com Ana no índice 0. Enquanto isso chegou um pedido novo na frente.
  ctx.stops = [{ _id: 'novo-pedido', name: 'Beto', value: 20 }, completa()];
  ctx.editingId = 'sabc';
  saveStop();
  ok(ctx.stops[0].name === 'Beto', 'a parada que entrou na frente NÃO é sobrescrita');
  ok(ctx.stops[1].name === 'Ana Corrigida' && ctx.stops[1]._id === 'sabc', 'a edição cai na parada que estava sendo editada');
}

// ── 4. A parada sumiu enquanto era editada ───────────────────
{
  const { ctx, saveStop } = montar({ fName: 'Ana Corrigida' });
  ctx.stops = [{ _id: 'outra', name: 'Beto', value: 20 }];
  ctx.editingId = 'sabc';   // foi removida no outro celular
  saveStop();
  ok(ctx.stops.length === 2 && ctx.stops[0].name === 'Beto', 'nenhuma outra parada é sobrescrita');
  ok(ctx.stops[1].name === 'Ana Corrigida', 'o que foi digitado não se perde: entra como parada nova');
  ok(ctx.avisos.some(a => /outro aparelho/.test(a.m)), 'e o app avisa o que aconteceu');
}

// ── 5. Parada nova nasce com identidade própria ──────────────
{
  const { ctx, saveStop } = montar();
  saveStop();
  ctx.editingId = null;
  saveStop();
  ok(ctx.stops.length === 2, 'duas paradas novas iguais são duas paradas');
  ok(ctx.stops[0]._id && ctx.stops[1]._id && ctx.stops[0]._id !== ctx.stops[1]._id,
    'cada uma com o seu _id — iguais no conteúdo, diferentes na identidade');
  ok(ctx.stops[0].done === false && ctx.stops[0]._addedDate === HOJE, 'nasce pendente, com a data de hoje');
  ok(ctx.foiPara === 'homeScreen', 'e o app volta para a lista');
}

// ── 6. Telefone pela metade não vira link de WhatsApp ────────
{
  const { ctx, saveStop } = montar({ fPhone: '99916-5959' });   // sem DDD
  saveStop();
  ok(ctx.stops.length === 0 && ctx.avisos.some(a => /DDD/.test(a.m)),
    'telefone sem DDD é recusado com aviso (o WhatsApp abriria outra pessoa)');
  const b = montar({ fPhone: '' });
  b.saveStop();
  ok(b.ctx.stops.length === 1, 'telefone em branco continua permitido');
}

/* ── 7. A taxa na lista: tocar não é apagar ───────────────────
   O campo de taxa da lista vem escrito "R$ 35,00". Qualquer saída do
   campo gravava o que estava nele — e "R$ 35,00" era lido como zero. */
{
  const fmt = v => 'R$ ' + (parseFloat(v) || 0).toFixed(2).replace('.', ',');
  const parse = s => {
    if (typeof s === 'number') return s;
    const t = String(s == null ? '' : s).replace(/[^\d,.\-]/g, '');
    return parseFloat(t.indexOf(',') >= 0 ? t.replace(/\./g, '').replace(',', '.') : t) || 0;
  };
  const { taxaDigitada } = new Function('parseMoney', 'fmtMoney',
    trecho('function taxaDigitada(', '\nfunction updateStopValue', 'index.html') + '\nreturn { taxaDigitada };')(parse, fmt);

  const campo = { value: '' };
  ok(taxaDigitada('R$ 35,00', 35, campo) === null, 'tocar na taxa e sair sem digitar NÃO grava nada');
  ok(taxaDigitada('', 35, campo) === null && campo.value === 'R$ 35,00',
    'apagar o campo não zera a taxa — e o campo volta a mostrar o valor que vale');
  ok(taxaDigitada('abc', 35, campo) === null, 'texto sem número é ignorado');
  ok(taxaDigitada('40', 35, campo) === 40 && campo.value === 'R$ 40,00', 'valor novo é gravado e o campo mostra formatado');
  ok(taxaDigitada('R$ 42,50', 35, campo) === 42.5, 'corrigir por cima do texto que já estava também funciona');
  ok(taxaDigitada('0', 35, campo) === 0, 'zerar de propósito (digitando 0) continua possível');
}

/* ── 8. Otimizar a rota não pode apagar parada ────────────────
   O cálculo demora (geocodificação, GPS, OSRM). No fim a lista era
   trocada por uma montada a partir da cópia do começo — parada que
   chegasse no meio (pedido aceito, o outro celular) era apagada. */
{
  const id = s => s._id;
  const amanha = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('pt-BR'); })();
  const parseDate = d => { const [a, b, c] = String(d).split('/'); return new Date(+c, +b - 1, +a); };
  const lista = [];
  const { ordenarPelaRota, ehAgendada, paradasDaRota } = new Function('idDaParada', 'parseDate', 'stops',
    trecho('function ehAgendada(s){', '\nasync function openRoute', 'index.html') +
    '\nreturn { ordenarPelaRota, ehAgendada, paradasDaRota };')(id, parseDate, lista);

  // A rota foi calculada com A, B, C. Enquanto isso: chegou D, B foi removida, C foi entregue.
  const viva = [
    { _id: 'a', name: 'A' }, { _id: 'c', name: 'C', done: true }, { _id: 'd', name: 'D (chegou durante o cálculo)' },
    { _id: 'f', name: 'Feita antes', done: true }
  ];
  const r = ordenarPelaRota(viva, ['c', 'b', 'a']);
  const nomes = r.map(s => s._id).join('');
  ok(r.some(s => s._id === 'd'), 'parada que chegou durante o cálculo continua na lista');
  ok(!r.some(s => s._id === 'b'), 'parada removida durante o cálculo não ressuscita');
  ok(nomes === 'adcf', `ordem: roteadas, depois as que ficaram de fora, entregues no fim (ficou ${nomes})`);
  ok(r.every((s, i) => s._order === i), 'e _order acompanha a posição');
  ok(ordenarPelaRota([{ _id: 'x' }, { _id: 'y' }, { _id: 'z' }], ['z', 'x', 'y']).map(s => s._id).join('') === 'zxy',
    'a ordem calculada é a que vale');

  // A rota de hoje não leva entrega de outro dia
  lista.push({ _id: '1', name: 'Hoje' }, { _id: '2', name: 'Amanhã', deliveryDate: amanha },
             { _id: '3', name: 'Feita', done: true }, { _id: '4', name: 'Data de hoje', deliveryDate: new Date().toLocaleDateString('pt-BR') });
  ok(ehAgendada(lista[1]) && !ehAgendada(lista[0]) && !ehAgendada(lista[3]), 'agendada é só a que tem data DEPOIS de hoje');
  ok(paradasDaRota().map(s => s._id).join('') === '14', 'a rota leva as pendentes de hoje — sem a de amanhã e sem a já entregue');
}

/* ── 9. Taxa automática da Aritana ────────────────────────────
   Casava por pedaço de texto, com a rua junto, e ignorava a cidade. A
   taxa errada entrava preenchida e anunciada como certa. */
{
  const tabela = trecho('const ARITANA_TAXAS = {', '\nfunction detectarTaxaAritana', 'index.html');
  const { detectarTaxaAritana } = new Function(
    tabela + trecho('function detectarTaxaAritana(', '\n// A mesma regra para parada', 'index.html') +
    '\nreturn { detectarTaxaAritana };')();
  const taxa = (b, r, c) => { const m = detectarTaxaAritana(b, r, c); return m ? m.taxa : null; };

  ok(taxa('Praia da Costa', 'Rua Sete', 'Vila Velha') === 20, 'bairro da tabela continua casando');
  ok(taxa('Bairro Que Não Existe', 'Rua Paulo Freire', 'Serra') === null,
    'a rua não vira bairro: "Rua Paulo Freire" não casa com o bairro "Paul"');
  ok(taxa('Jardim Camburi', 'Rua Centro Comercial', 'Vitória') === 30,
    'com bairro preenchido, só o bairro decide (a rua "Centro Comercial" não puxa a taxa do Centro)');
  ok(taxa('Paul', '', 'Vila Velha') === 20, 'e o bairro "Paul" de verdade continua valendo');
  ok(taxa('Centro', 'Av. Getúlio Vargas', 'Serra') === 55,
    `"Centro" em Serra é o "centro da serra" da tabela (R$ 55), não o Centro de Vila Velha (deu ${taxa('Centro', '', 'Serra')})`);
  ok(taxa('Centro', '', 'Vila Velha') === 20, 'Centro sem chave própria da cidade fica com o valor da tabela');
  /* A cidade só decide quando existe uma chave que É "bairro + cidade".
     Procurar a chave dentro do texto montado fazia "Boa Vista" + "da Serra"
     casar com "vista da serra" (R$ 55) — pego comparando a regra antiga e a
     nova nos 419 bairros oficiais. */
  ok(taxa('Boa Vista', 'Rua A', 'Serra') === 20,
    `"Boa Vista" em Serra não vira "Vista da Serra" (deu ${taxa('Boa Vista', 'Rua A', 'Serra')})`);
  ok(taxa('Vista da Serra', '', 'Serra') === 55, 'e "Vista da Serra" continua valendo R$ 55');
  ok(taxa('Centro Industrial do Município', '', 'Serra') === 25,
    'bairro que só CONTÉM "centro" não recebe a taxa do "serra centro"');
  ok(taxa('', 'Rua A, Praia da Costa', 'Vila Velha') === 20, 'sem bairro, o endereço ainda serve — por palavra inteira');
  ok(taxa('', '', '') === null, 'sem nada, não inventa taxa');
}

fim();
