/* ═══════════════════════════════════════════════════════════════
   Modo FULL — repasse, problema na entrega e fechamento com autoria.

   O repasse existia antes: gerava um link e acabava ali. O app não
   voltava a olhar para ele. Três consequências reais, e é contra elas
   que cada teste deste arquivo existe:

   1. O motoboy marcava "entregue" no painel dele e a informação MORRIA
      no nó do repasse. Quem despachou continuava vendo a parada como
      pendente e o fechamento do dia saía sem ela.

   2. Travou na porta do prédio? Não havia para onde mandar o problema.
      A entrega ficava parada e a loja descobria horas depois, ligando.

   3. Com terceiro entregando, "foi entregue" deixou de ser resposta.
      A loja pergunta quem foi, que horas chegou e com quem ficou — e o
      fechamento não tinha nenhuma das três.

   O código é extraído do index.html e do motoboy.html, não copiado.
   ═══════════════════════════════════════════════════════════════ */
import { trecho, lerApp, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();
const app  = lerApp('index.html');
const moto = lerApp('motoboy.html');

// ── Montagem do ambiente ──────────────────────────────────────
const lsFake = {
  _d: {},
  getItem(k) { return k in this._d ? this._d[k] : null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
  get length() { return Object.keys(this._d).length; },
  key(i) { return Object.keys(this._d)[i] ?? null; }
};

const blocoId = trecho('function hashCurto(str){', 'function saveStops()');
const { idDaParada } = new Function('localStorage', 'sbRead', 'stops',
  blocoId + '\nreturn {idDaParada};')(lsFake, (k, d) => d, []);

// ══════════════════════════════════════════════════════════════
//  1. O interruptor
// ══════════════════════════════════════════════════════════════
{
  const corpo = trecho('function alternarModoFull(valor){', '\nfunction aplicarModoFull');
  ok(/cfg\.full\s*=\s*novo/.test(corpo) && /saveCfg\(\)/.test(corpo),
    'ligar/desligar o FULL é gravado — não se perde ao fechar o app');
  ok(/valor === undefined/.test(corpo),
    'o mesmo botão liga e desliga (sem argumento, alterna)');

  const aplicar = trecho('function aplicarModoFull(){', '\n/* Resumo de uma linha');
  ok(/nav-repasses/.test(aplicar) && /classList\.toggle\('hidden'/.test(aplicar),
    'a aba Repasses só existe no modo FULL');
  /* Sair do FULL estando na aba Repasses deixava a pessoa numa tela sem
     nenhum item de barra aceso — sem caminho de volta pelo rodapé. */
  ok(/_telaAtual === 'repassesScreen'/.test(aplicar) && /goNav\('homeScreen'/.test(aplicar),
    'desligar o FULL estando na aba Repasses devolve a pessoa para a inicial');

  const nav = trecho('function navPelaURL(){', '\n}');
  ok(/repassesScreen' && !modoFull\(\)/.test(nav),
    'abrir #repasses fora do FULL cai na inicial em vez de numa tela sem barra');

  ok(/id="btnFull"/.test(app) && /class="btn-full"/.test(app),
    'o interruptor fica no cabeçalho, alcançável de qualquer tela');
  ok(/aria-pressed/.test(app), 'o interruptor anuncia o próprio estado (aria-pressed)');
}

// ══════════════════════════════════════════════════════════════
//  2. Contato da loja: o motoboy nunca fica sem para quem mandar
// ══════════════════════════════════════════════════════════════
{
  const bloco = trecho('function getStorePhones(){', 'function setStorePhone(');
  const criar = cfg => new Function('cfg',
    bloco + '\nreturn {telefoneDaLoja, telefonePlantao, contatoDaLoja};')(cfg);

  const comFone = criar({ storePhones: { KS: '27999998888' }, plantaoTel: '27911112222' });
  ok(comFone.contatoDaLoja('KS').phone === '27999998888',
    'loja com WhatsApp cadastrado recebe o problema direto');
  ok(comFone.contatoDaLoja('KS').plantao === false,
    'e o painel do motoboy sabe que é a loja, não o plantão');

  ok(comFone.contatoDaLoja('Aritana').phone === '27911112222',
    'loja sem número cadastrado cai no plantão');
  ok(comFone.contatoDaLoja('Aritana').plantao === true,
    'e fica marcado como plantão — a mensagem diz para onde foi');

  const soFatura = criar({ emiTel: '2733334444' });
  ok(soFatura.contatoDaLoja('X').phone === '2733334444',
    'sem plantão configurado, sobra o telefone da fatura');

  const vazio = criar({});
  ok(vazio.contatoDaLoja('X').phone === '',
    'sem nenhum número, devolve vazio — o painel abre o WhatsApp para escolher o contato');

  ok(/só dígitos|replace\(\/\\D\/g,''\)/.test(bloco.replace(/\s/g, '')) || /\\D/.test(bloco),
    'o número é normalizado (o campo aceita máscara)');
}

// ══════════════════════════════════════════════════════════════
//  3. A confirmação precisa achar o caminho de volta
// ══════════════════════════════════════════════════════════════
/* Sem stopId no repasse, o "entregue" do motoboy fica no nó dele e o
   fechamento aqui nunca fica sabendo. Era exatamente o que acontecia. */
{
  const bloco = trecho('function montarEntregaRepasse(x){', '\nlet lastRepassLink');
  const montar = new Function('idDaParada', 'contatoDaLoja', 'cityName', 'resolveCityCode', 'parseMoney',
    bloco + '\nreturn montarEntregaRepasse;'
  )(idDaParada, n => ({ phone: n === 'KS' ? '2799999' : '', plantao: n !== 'KS' }),
    c => c, c => c, v => parseFloat(String(v).replace(',', '.')) || 0);

  const parada = { _id: 's123', name: 'Ana', address: 'R. 1, 10', store: 'KS', value: 12, productValue: 40 };
  const e = montar({ stop: parada, taxa: 9 });

  ok(e.stopId === 's123',
    'a entrega carrega o stopId — é por ele que a confirmação volta para a parada');
  ok(e.storePhone === '2799999',
    'e carrega o WhatsApp da loja já resolvido (o painel do motoboy não tem a lista de lojas)');
  ok(e.taxa === 9, 'a taxa vai no repasse (o app precisa dela para saber quanto pagar)');
  ok(e.productValue === 40, 'o valor a cobrar do cliente vai junto — é o motoboy que recebe');
  ok(e.done === false, 'toda entrega nasce pendente');

  for (const campo of ['name', 'address', 'complement', 'reference', 'phone',
                       'neighborhood', 'timeFrom', 'timeTo', 'notes', 'deliveryDate']) {
    ok(campo in e, `o repasse leva "${campo}" — esconder a taxa não pode esconder o resto`);
  }
}

// ══════════════════════════════════════════════════════════════
//  4. A volta: quem entregou, quando e quem recebeu
// ══════════════════════════════════════════════════════════════
{
  const bloco = trecho('function aplicarConfirmacoesRepasse(){', '\n/* Problema relatado');

  function rodar(stops, repassesData) {
    const chamou = { saveStops: 0, toast: [], notify: 0 };
    new Function('stops', 'repassesData', 'idDaParada', 'saveStops', '_telaAtual',
                 'renderHome', 'renderReport', 'toast', 'sendNotify',
      bloco + '\naplicarConfirmacoesRepasse();'
    )(stops, repassesData, idDaParada,
      () => chamou.saveStops++, 'homeScreen',
      () => {}, () => {}, m => chamou.toast.push(m), () => chamou.notify++);
    return chamou;
  }

  // 4a. Entrega confirmada pelo motoboy chega na parada certa
  {
    const stops = [{ _id: 'a', name: 'Ana', done: false }, { _id: 'b', name: 'Beto', done: false }];
    const rp = { RP1: { motoboy: 'Carlos', deliveries: [
      { stopId: 'b', done: true, doneAt: '2026-08-08T14:35:00.000Z', receivedBy: 'Porteiro João', proofId: 'PF-9' }
    ] } };
    const c = rodar(stops, rp);
    ok(stops[1].done === true, 'a parada certa é marcada como entregue');
    ok(stops[0].done === false, 'e só ela — a outra parada não é tocada');
    ok(stops[1].deliveredBy === 'Carlos', 'fica gravado QUEM entregou');
    ok(stops[1].deliveredAt === '2026-08-08T14:35:00.000Z', 'fica gravado QUANDO');
    ok(stops[1].receivedBy === 'Porteiro João', 'fica gravado QUEM RECEBEU');
    ok(stops[1].proofId === 'PF-9', 'e o comprovante fica ligado à parada');
    ok(stops[1]._doneDate === new Date('2026-08-08T14:35:00.000Z').toLocaleDateString('pt-BR'),
      'a data do fechamento é a da entrega, não a de quando o app soube');
    ok(c.saveStops === 1, 'grava uma vez');
    ok(c.notify === 1, 'e avisa quem despachou');
  }

  // 4b. Rodar de novo com o mesmo dado não pode gravar nada
  /* Este listener dispara a cada toque de QUALQUER motoboy. Se ele
     gravasse sempre, cada snapshot viraria uma escrita, que viraria
     outro snapshot — ping-pong infinito entre os aparelhos. */
  {
    const stops = [{ _id: 'a', name: 'Ana', done: true, deliveredBy: 'Carlos',
                     deliveredAt: '2026-08-08T14:00:00.000Z', receivedBy: 'Ana',
                     _doneDate: new Date('2026-08-08T14:00:00.000Z').toLocaleDateString('pt-BR'),
                     _repassId: 'RP1' }];
    const rp = { RP1: { motoboy: 'Carlos', deliveries: [
      { stopId: 'a', done: true, doneAt: '2026-08-08T14:00:00.000Z', receivedBy: 'Ana' }
    ] } };
    const c = rodar(stops, rp);
    ok(c.saveStops === 0, 'snapshot repetido não grava nada (sem ping-pong de escrita)');
    ok(c.notify === 0, 'e não avisa de novo de uma entrega que já era conhecida');
  }

  // 4c. Problema relatado entra na parada e some quando resolvido
  {
    const stops = [{ _id: 'a', name: 'Ana', done: false }];
    const prob = { tipo: 'portaria', titulo: 'Portaria não aceita a entrega', at: '2026-08-08T15:00:00.000Z' };
    rodar(stops, { RP1: { motoboy: 'Carlos', deliveries: [{ stopId: 'a', done: false, problem: prob }] } });
    ok(stops[0].problema && stops[0].problema.tipo === 'portaria',
      'problema relatado pelo motoboy aparece na parada de quem despachou');

    const c = rodar(stops, { RP1: { motoboy: 'Carlos', deliveries: [{ stopId: 'a', done: false }] } });
    ok(!stops[0].problema, 'e some quando o motoboy marca como resolvido');
    ok(c.saveStops === 1, 'a remoção também é gravada');
  }

  // 4d. Reabrir desfaz o que o repasse fechou — e só isso
  {
    /* Marcada como feita AQUI, pela dona do app, sem motoboy nenhum. Um
       repasse ainda pendente não pode desmarcá-la. */
    const propria = [{ _id: 'a', name: 'Ana', done: true, _doneDate: '01/08/2026' }];
    rodar(propria, { RP1: { motoboy: 'Carlos', deliveries: [{ stopId: 'a', done: false }] } });
    ok(propria[0].done === true,
      'repasse pendente não reabre uma entrega que já foi dada como feita aqui');

    /* Mas o motoboy que marcou entregue por engano precisa poder voltar
       atrás — senão o fechamento fica com uma entrega que não aconteceu. */
    const doMoto = [{ _id: 'a', name: 'Ana', done: true, _doneDate: '08/08/2026',
                      deliveredBy: 'Carlos', deliveredAt: '2026-08-08T14:00:00.000Z',
                      receivedBy: 'Ana', proofId: 'PF-1', _repassId: 'RP1' }];
    rodar(doMoto, { RP1: { motoboy: 'Carlos', deliveries: [{ stopId: 'a', done: false }] } });
    ok(doMoto[0].done === false, 'o motoboy consegue reabrir a entrega que ele mesmo fechou');
    ok(!doMoto[0].deliveredBy && !doMoto[0].receivedBy && !doMoto[0].proofId && !doMoto[0]._doneDate,
      'e a autoria some junto — o fechamento não fica com resto de uma entrega desfeita');
  }

  // 4e. Entrega de um repasse cujo stopId não existe mais é ignorada
  {
    const stops = [{ _id: 'a', name: 'Ana', done: false }];
    const c = rodar(stops, { RP1: { motoboy: 'Carlos', deliveries: [{ stopId: 'zzz', done: true }] } });
    ok(c.saveStops === 0, 'confirmação órfã (parada apagada) não derruba nem inventa nada');
  }
}

// ══════════════════════════════════════════════════════════════
//  5. Aviso de problema não pode repetir a cada snapshot
// ══════════════════════════════════════════════════════════════
{
  const bloco = trecho('function avisarProblemasNovos(){', '\nconst SEL_REPASSE');
  const vistos = {};
  const chamadas = [];
  const rodar = repassesData => new Function('repassesData', '_problemasVistos', 'localStorage', 'toast', 'sendNotify',
    bloco + '\navisarProblemasNovos();'
  )(repassesData, vistos, lsFake, () => chamadas.push('toast'), () => chamadas.push('notify'));

  const rp = { RP1: { motoboy: 'Carlos', deliveries: [
    { name: 'Ana', done: false, problem: { titulo: 'Endereço errado', at: '2026-08-08T10:00:00.000Z' } }
  ] } };
  rodar(rp);
  ok(chamadas.length === 2, 'problema novo avisa na hora (toast + notificação)');
  chamadas.length = 0;
  rodar(rp);
  ok(chamadas.length === 0, 'o mesmo problema não volta a avisar a cada snapshot');
}

// ══════════════════════════════════════════════════════════════
//  6. Fechamento: a linha de autoria
// ══════════════════════════════════════════════════════════════
{
  const bloco = trecho('function horaDeISO(iso){', '\n/* Quanto cada motoboy');
  const { linhaQuemEntregou, horaDeISO } = new Function('esc', 'escJs',
    bloco + '\nreturn {linhaQuemEntregou, horaDeISO};'
  )(s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
    s => String(s == null ? '' : s).replace(/'/g, "\\'"));

  ok(horaDeISO('') === '' && horaDeISO('nao-e-data') === '',
    'data ausente ou inválida não vira "Invalid Date" na tela do fechamento');

  const s = { deliveredBy: 'Carlos', deliveredAt: '2026-08-08T14:35:00.000Z',
              receivedBy: 'Porteiro João', proofId: 'PF-9', name: 'Ana' };
  const html = linhaQuemEntregou(s);
  ok(html.includes('Carlos'),        'o fechamento mostra quem entregou');
  ok(/\d{2}:\d{2}/.test(html),       'mostra a hora da entrega');
  ok(html.includes('Porteiro João'), 'mostra quem recebeu');
  ok(html.includes('abrirProva'),    'e dá acesso ao comprovante');

  ok(linhaQuemEntregou({ name: 'Ana', done: true }) === '',
    'entrega feita pelo próprio dono não ganha linha vazia no fechamento');

  // O nome de quem recebeu é digitado por terceiro e vira innerHTML
  const xss = linhaQuemEntregou({ deliveredBy: '<img src=x onerror=alert(1)>' });
  ok(!xss.includes('<img'), 'nome vindo do painel do motoboy passa por esc()');

  ok(/id="reportMotoboys"/.test(app) && /_renderMotoboys\(d\)/.test(app),
    'o fechamento tem um resumo por motoboy');
}

// ══════════════════════════════════════════════════════════════
//  7. motoboy.html — taxa escondida, resto inteiro
// ══════════════════════════════════════════════════════════════
{
  const blocoOculta = trecho('function ocultarTaxa(){', '\nfunction renderStops', 'motoboy.html');
  const ocultar = rd => new Function('repassData', blocoOculta + '\nreturn ocultarTaxa();')(rd);
  ok(ocultar({ hideTaxa: true }) === true && ocultar({}) === false && ocultar(null) === false,
    'ocultarTaxa lê a opção do repasse e aguenta payload vazio');

  const render = trecho('function renderStops(){', '\n// ── PRÓXIMA PARADA', 'motoboy.html');
  ok(/ocultarTaxa\(\)\s*&&|!ocultarTaxa\(\)/.test(render),
    'a taxa por entrega só é montada quando o repasse não pede para escondê-la');
  ok(/ocultarTaxa\(\)\s*\?/.test(render),
    'o resumo troca "Ganho" por outra coluna quando as taxas estão escondidas');

  // Esconder a taxa não pode esconder o que o motoboy precisa para entregar
  for (const campo of ['phone', 'complement', 'reference', 'neighborhood', 'timeFrom', 'store', 'notes']) {
    ok(render.includes('s.' + campo), `o painel continua mostrando "${campo}" com a taxa escondida`);
  }
}

// ══════════════════════════════════════════════════════════════
//  8. Uma rota por vez, com Waze ou Google Maps
// ══════════════════════════════════════════════════════════════
{
  const bloco = trecho('function navegarParada(i,app){', '\n// ── ROTA OTIMIZADA', 'motoboy.html');
  const abertas = [];
  const rd = { deliveries: [
    { name: 'Ana',  address: 'R. das Flores, 10', complement: 'ap 202' },
    { name: 'Beto', address: 'R. B, 5', _lat: -20.31, _lng: -40.29 }
  ] };
  const navegar = new Function('repassData', 'window',
    bloco + '\nreturn navegarParada;')(rd, { open: u => abertas.push(u) });

  navegar(0, 'waze');
  ok(/^https:\/\/waze\.com\/ul\?/.test(abertas[0]), 'Waze abre pelo link universal do próprio app');
  ok(abertas[0].includes('navigate=yes'), 'e já entra em modo de navegação');
  ok(abertas[0].includes(encodeURIComponent('R. das Flores, 10, ap 202')),
    'sem coordenada, manda o endereço com complemento');

  navegar(1, 'waze');
  ok(abertas[1].includes('ll=-20.31,-40.29'),
    'com coordenada da otimização, o Waze vai no ponto exato — não depende de interpretar o endereço');

  navegar(0, 'gmaps');
  ok(abertas[2].includes('google.com/maps/dir/') && abertas[2].includes('travelmode=driving'),
    'Google Maps abre em rota de carro');

  /* "Uma rota por vez": o encadeamento +to: do app monta a rota inteira de
     uma vez. Aqui é sempre um destino — é o que serve na rua, e é o único
     formato que o Waze aceita. */
  ok(abertas.every(u => !u.includes('+to:')),
    'nenhuma navegação encadeia várias paradas de uma vez');
  ok(abertas.filter(u => u.includes('destination=')).every(u => u.split('destination=').length === 2),
    'cada link leva exatamente um destino');

  ok(/function indiceProxima\(\)/.test(moto) && /id="proximaBar"/.test(moto),
    'a barra fixa aponta a próxima parada pendente');
}

// ══════════════════════════════════════════════════════════════
//  9. Problema na entrega: mensagens prontas com os dados juntos
// ══════════════════════════════════════════════════════════════
{
  const blocoMot = trecho('var MOTIVOS=[', '\nvar _probIdx', 'motoboy.html');
  const blocoTxt = trecho('function textoDoProblema(s,motivo,detalhe){', '\nfunction enviarProblema', 'motoboy.html');
  const rd = { motoboy: 'Carlos' };
  const { MOTIVOS, textoDoProblema } = new Function('repassData', 'fmtPhone',
    blocoMot + blocoTxt + '\nreturn {MOTIVOS, textoDoProblema};'
  )(rd, p => String(p || ''));

  // Os casos que o dia a dia produz — cada um vira um toque, não um texto escrito na rua
  for (const id of ['endereco', 'semcontato', 'portaria', 'mercadoria',
                    'ausente', 'recusa', 'pagamento', 'acesso', 'outro']) {
    ok(MOTIVOS.some(m => m.id === id), `existe mensagem pronta para "${id}"`);
  }
  ok(MOTIVOS.every(m => m.titulo && m.sub), 'todo motivo tem título e uma linha explicando');
  ok(MOTIVOS.filter(m => m.id !== 'outro').every(m => m.corpo && m.corpo.length > 30),
    'as mensagens já vêm escritas — o motoboy não redige nada parado na porta');

  const s = { name: 'Ana Souza', phone: '27999998888', address: 'R. das Flores, 10',
              complement: 'ap 202', reference: 'portão azul', store: 'KS',
              timeFrom: '14:00', timeTo: '16:00', productValue: 45.5 };
  const txt = textoDoProblema(s, MOTIVOS.find(m => m.id === 'portaria'), 'Porteiro não libera sem autorização.');

  /* Sem os dados junto, quem recebe precisa perguntar "qual entrega?" antes
     de poder resolver — e o motoboy fica parado esperando. */
  for (const [rotulo, valor] of [['cliente', 'Ana Souza'], ['endereço', 'R. das Flores, 10'],
                                 ['complemento', 'ap 202'], ['referência', 'portão azul'],
                                 ['loja', 'KS'], ['janela de horário', '14:00'],
                                 ['valor a cobrar', '45,50'], ['motoboy', 'Carlos']]) {
    ok(txt.includes(valor), `a mensagem leva ${rotulo} junto`);
  }
  ok(txt.includes('Portaria não aceita a entrega'), 'e o motivo escolhido no título');
  ok(txt.includes('Porteiro não libera'), 'mais o que o motoboy escreveu');

  // Campo ausente não pode virar "undefined" na mensagem que a loja lê
  const magro = textoDoProblema({ name: 'Zé' }, MOTIVOS[0], 'teste');
  ok(!/undefined|null/.test(magro), 'entrega sem complemento/referência não gera "undefined" na mensagem');

  const envio = trecho('function enviarProblema(){', '\nfunction resolverProblema', 'motoboy.html');
  /* Abrir o WhatsApp tira o navegador da frente e em muitos celulares a aba
     volta recarregada. Se o registro fosse depois, ele simplesmente não
     acontecia — e quem despachou nunca ficava sabendo do problema. */
  ok(envio.indexOf('salvarRepasse()') < envio.indexOf('window.open'),
    'o problema é registrado ANTES de abrir o WhatsApp');
  ok(/s\.problem\s*=\s*\{/.test(envio) && /at:new Date\(\)\.toISOString\(\)/.test(envio),
    'o registro guarda tipo, título, texto e hora');
  ok(/storePhone/.test(envio), 'a mensagem vai para o WhatsApp da loja daquela entrega');
  ok(/wa\.me\/\?text=/.test(envio),
    'sem número cadastrado, ainda abre o WhatsApp com a mensagem pronta para escolher o contato');
}

// ══════════════════════════════════════════════════════════════
//  10. Comprovante: foto com data, hora e local carimbados
// ══════════════════════════════════════════════════════════════
{
  const bloco = trecho('function carimbarFoto(file,pos){', '\nfunction confirmarEntrega', 'motoboy.html');
  ok(/toLocaleDateString\('pt-BR'\)/.test(bloco) && /toLocaleTimeString\('pt-BR'\)/.test(bloco),
    'o carimbo traz data e hora');
  ok(/pos\.lat\.toFixed\(6\)/.test(bloco) && /pos\.lng\.toFixed\(6\)/.test(bloco),
    'e as coordenadas de onde a foto foi tirada');
  ok(/Localização indisponível/.test(bloco),
    'GPS negado não impede o comprovante — fica escrito que não havia localização');
  ok(/s\.address/.test(bloco) && /s\.name/.test(bloco) && /repassData&&repassData\.motoboy/.test(bloco),
    'o carimbo identifica a entrega e quem entregou');
  ok(/ctx\.fillText/.test(bloco),
    'o carimbo é desenhado na imagem — metadado se perde ao encaminhar, pixel não');

  /* O teto do carimbo e o teto das regras do banco precisam ser o mesmo
     número. Se a foto puder ser maior que a regra aceita, a gravação falha
     e o motoboy vê "erro" depois de já ter tirado a foto. */
  const teto = Number((bloco.match(/var LIMITE=(\d+)/) || [])[1]);
  const regras = JSON.parse(lerApp('database.rules.json'));
  const regraProof = regras.rules.rooms.$room.proofs.$item['.validate'];
  const tetoRegra = Number((regraProof.match(/<=\s*(\d+)/) || [])[1]);
  ok(!!teto && !!tetoRegra && teto <= tetoRegra,
    `o limite da foto (${teto}) cabe no limite das regras do banco (${tetoRegra})`);
  ok(/q-=0\.1/.test(bloco) && /q>0\.28/.test(bloco),
    'foto grande demais baixa a qualidade até caber, em vez de falhar na gravação');
  ok(/imageOrientation:'from-image'/.test(bloco.replace(/\s/g, '')) ||
     /imageOrientation/.test(trecho('function carregarImagem(file){', '\nfunction carimbarFoto', 'motoboy.html')),
    'a orientação do EXIF é respeitada — comprovante deitado não serve de comprovante');

  const conf = trecho('function confirmarEntrega(){', '\n// ── PROBLEMA NA ENTREGA', 'motoboy.html');
  ok(/rooms\/'\+ROOM\+'\/proofs\//.test(conf),
    'a foto vai para /proofs, não junto do repasse (senão todo snapshot arrastaria as fotos do dia)');
  ok(/entrega registrada mesmo assim/.test(conf),
    'falha ao subir a foto não perde a entrega');
  ok(/delete s\.problem/.test(conf),
    'entregar encerra o problema que estava aberto naquela parada');
  ok(/askReceiver&&!recebedor/.test(conf.replace(/\s/g, '')),
    'com "pedir quem recebeu" ligado, não dá para confirmar sem o nome');
}

// ══════════════════════════════════════════════════════════════
//  11. O painel do motoboy não pode virar porta de XSS
// ══════════════════════════════════════════════════════════════
{
  /* Nome do cliente e observação da loja são digitados por gente e viram
     innerHTML no painel. É o mesmo risco que o index.html já cobre. */
  const render = trecho('function renderStops(){', '\n// ── PRÓXIMA PARADA', 'motoboy.html');
  const CAMPOS = ['name', 'address', 'complement', 'reference', 'notes', 'store', 'neighborhood'];
  const crus = [];
  for (const campo of CAMPOS) {
    const re = new RegExp(`(?<!esc\\()\\bs\\.${campo}\\b(?!\\s*[?:)&|.])`, 'g');
    for (const m of render.match(re) || []) crus.push(`${campo}: ${m}`);
  }
  ok(crus.length === 0,
    'nenhum campo de texto entra cru no HTML do painel' +
    (crus.length ? ' — ' + [...new Set(crus)].join(', ') : ''));

  const esc = new Function('return ' + trecho('function esc(s){', '\nfunction hora(', 'motoboy.html')
    .replace('function esc(s){', 'function(s){'))();
  ok(esc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;',
    'esc() do painel escapa marcação');
  ok(esc(null) === '' && esc(undefined) === '', 'esc() aguenta nulo');
}

fim();
