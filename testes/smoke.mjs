/* Smoke test em navegador real: o app abre, o XSS está fechado,
   o backup funciona e as páginas públicas carregam.
   Requer: npm i playwright   (o Chromium já vem no ambiente) */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { RAIZ, chromiumPath, criarPlacar } from './_util.mjs';

/* O Content-Type importa de verdade aqui. Servido como text/plain, o
   navegador RECUSA o speedboy.css inteiro (checagem estrita de MIME para
   folha de estilo) e a página abre sem paleta nenhuma — foi exatamente
   assim que este mapa ficou incompleto sem ninguém notar. */
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon'
};

// Servidor estático — o app precisa de uma origem http real
const srv = http.createServer((req, res) => {
  const p = path.join(RAIZ, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(RAIZ) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404); res.end('nao encontrado'); return;
  }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(p)] || 'text/plain' });
  res.end(fs.readFileSync(p));
});
await new Promise(r => srv.listen(0, r));
srv.unref();          // se um teste explodir, o servidor não segura o processo vivo
const base = `http://127.0.0.1:${srv.address().port}`;

/* Rodando como root em container, o Chromium às vezes cai no meio da suíte
   (o processo do navegador some e todo goto seguinte falha com "browser has
   been closed"). Em vez de derrubar o teste junto, religamos o navegador.
   --no-sandbox / --disable-dev-shm-usage são os argumentos padrão nesse
   cenário e reduzem bastante a frequência. */
const OPCOES = {
  executablePath: chromiumPath(),
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
};

let browser = await chromium.launch(OPCOES);

async function navegador() {
  if (!browser || !browser.isConnected()) browser = await chromium.launch(OPCOES);
  return browser;
}

async function novoContexto(opts = {}) {
  try {
    return await (await navegador()).newContext(opts);
  } catch (e) {
    browser = null;                       // força religar e tenta de novo
    return await (await navegador()).newContext(opts);
  }
}

const { ok, fim } = criarPlacar();

async function abrir(rota, opts = { serviceWorkers: 'block' }) {
  for (let tentativa = 1; ; tentativa++) {
    const ctx = await novoContexto(opts);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', e => erros.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
    try {
      await page.goto(base + rota, { waitUntil: 'load' });
      await page.waitForTimeout(1200);
      return { page, ctx, erros };
    } catch (e) {
      // Navegador caiu no meio: religa e tenta uma vez mais antes de desistir
      if (tentativa >= 2 || !/has been closed|Target crashed/i.test(e.message)) throw e;
      browser = null;
    }
  }
}

/* Uma seção que exploda não pode engolir o placar das outras — sem isto,
   uma queda do navegador vira exceção não tratada e some com o resultado
   de tudo que já tinha passado. */
async function secao(nome, fn) {
  try { await fn(); }
  catch (e) { ok(false, `${nome}: a seção falhou — ${String(e.message).split('\n')[0]}`); }
}

// Erros de rede/Firebase são esperados no sandbox — só nos importam erros de código
const ruido = t => /net::|Failed to load resource|firebase|Firebase|auth\/|gstatic|fonts\.googleapis|ERR_|Login an/i.test(t);

// ── 1. index.html carrega e as telas existem ──
await secao('index.html carrega e as telas existem', async () => {
  const { page, ctx, erros } = await abrir('/index.html');
  const reais = erros.filter(e => !ruido(e));
  ok(reais.length === 0, 'index.html carrega sem erro de JavaScript' + (reais.length ? '\n     ' + reais.join('\n     ') : ''));

  const telas = await page.$$eval('.screen', els => els.map(e => e.id));
  ok(telas.length === 8, `8 telas presentes (achou ${telas.length}: ${telas.join(', ')})`);

  ok(await page.isVisible('#homeScreen'), 'tela inicial visível ao abrir');

  // as funções críticas existem no escopo global
  const fns = await page.evaluate(() => ['esc','escJs','sbRead','sbAutoBackup','sbListBackups','sbMigrate','goNav','renderHome','renderAutoBackups','restoreAutoBackup']
    .filter(n => typeof window[n] !== 'function'));
  ok(fns.length === 0, 'todas as funções novas existem no escopo global' + (fns.length ? ' — faltando: ' + fns.join(', ') : ''));

  // config compartilhada foi carregada
  ok(await page.evaluate(() => !!(window.SPEEDBOY_FIREBASE_CONFIG && window.SPEEDBOY_FIREBASE_CONFIG.databaseURL)), 'speedboy-firebase.js expõe a configuração');
  ok(await page.evaluate(() => typeof window.speedboyLoginAnonimo === 'function'), 'helper de login anônimo disponível');

  // schema carimbado e viewport liberado
  // Comparado com a constante do app, para não quebrar a cada bump de schema
  ok(await page.evaluate(() => localStorage.getItem('sb_schema_version') === String(SB_SCHEMA_VERSION)),
    'sbMigrate carimbou a versão do schema no boot');
  const vp = await page.getAttribute('meta[name=viewport]', 'content');
  ok(!/user-scalable=no|maximum-scale/.test(vp), 'viewport permite zoom (acessibilidade)');

  // nenhum botão sem type
  const semType = await page.$$eval('button', bs => bs.filter(b => !b.getAttribute('type')).length);
  ok(semType === 0, `nenhum botão sem type (achou ${semType})`);

  await ctx.close();
});

// ── 2. XSS: nome vindo do cliente não pode virar HTML ──
await secao('XSS: nome vindo do cliente não pode virar HTML', async () => {
  const { page, ctx } = await abrir('/index.html');
  const resultado = await page.evaluate(() => {
    window.__xss = false;
    const payload = '<img src=x onerror="window.__xss=true">';
    stops = [{ name: payload, store: '<b>LOJA</b>', notes: '<script>window.__xss=true<\/script>',
               street: 'Rua X', number: '1', neighborhood: '<i>Bairro</i>',
               value: '10', done: false, city: 'SER' }];
    renderHome();
    const lista = document.getElementById('stopsList');
    return {
      disparou: window.__xss,
      temImg: !!lista.querySelector('img'),
      temB: !!lista.querySelector('b'),
      temI: !!lista.querySelector('i'),
      mostraTexto: lista.textContent.includes('<img src=x'),
      mostraLoja: lista.textContent.includes('<b>LOJA</b>')
    };
  });
  ok(resultado.disparou === false, 'payload onerror NÃO executou');
  ok(resultado.temImg === false, 'nenhuma tag <img> injetada no DOM');
  ok(resultado.temB === false && resultado.temI === false, 'tags <b>/<i> do cliente não viram HTML');
  ok(resultado.mostraTexto, 'o payload aparece como texto literal na tela');
  ok(resultado.mostraLoja, 'nome de loja com tags aparece como texto literal');
  await ctx.close();
});

// ── 3. escJs: aspas no nome da loja não quebram o onclick do fechamento ──
await secao('escJs: aspas no nome da loja não quebram o onclick do fechamento', async () => {
  const { page, ctx } = await abrir('/index.html');
  const r = await page.evaluate(() => {
    window.__chamado = null;
    window.genFaturaLoja = (nome) => { window.__chamado = nome; };
    const perigoso = "KS' ); window.__xss=true; //";
    stops = [{ name: 'Ana', store: perigoso, value: '10', paid: true, done: true, city: 'SER',
               street: 'R 1', number: '2', _addedDate: new Date().toLocaleDateString('pt-BR') }];
    window.__xss = false;
    setPeriod('week');
    const btn = [...document.querySelectorAll('#reportStores button')].find(b => b.textContent.includes('7 dias'));
    if (!btn) return { erro: 'botão de fatura não encontrado' };
    btn.click();
    return { chamado: window.__chamado, esperado: perigoso, xss: window.__xss };
  });
  ok(!r.erro, 'fechamento renderiza o card da loja' + (r.erro ? ' — ' + r.erro : ''));
  if (!r.erro) {
    ok(r.xss === false, 'aspas no nome da loja não executam código');
    ok(r.chamado === r.esperado, `onclick recebe o nome íntegro (recebeu ${JSON.stringify(r.chamado)})`);
  }
  await ctx.close();
});

// ── 4. Backup automático roda no boot e é restaurável ──
await secao('Backup automático roda no boot e é restaurável', async () => {
  const { page, ctx } = await abrir('/index.html');
  const r = await page.evaluate(() => {
    stops = [{ name: 'Cliente Backup', value: '15', done: false, city: 'SER' }];
    localStorage.setItem('sb_stops', JSON.stringify(stops));
    // limpa a cópia de hoje para forçar nova geração
    sbBackupKeys().forEach(k => localStorage.removeItem(k));
    sbAutoBackup();
    const lista = sbListBackups();
    // agora destrói os dados e restaura
    stops = [];
    localStorage.setItem('sb_stops', '[]');
    return { copias: lista.length, paradas: lista[0] && lista[0].paradas, chave: lista[0] && lista[0].key };
  });
  ok(r.copias === 1, 'backup automático criou uma cópia');
  ok(r.paradas === 1, 'a cópia contém a parada salva');

  /* Restaurar agora pede a confirmação do próprio app, não o confirm() do
     navegador — então o teste responde tocando no botão, como o usuário. */
  const restaurado = await page.evaluate(async (chave) => {
    const promessa = restoreAutoBackup(chave);
    await new Promise(r => setTimeout(r, 100));
    document.getElementById('confirmSim').click();
    await promessa;
    return { n: stops.length, nome: stops[0] && stops[0].name, temPre: !!localStorage.getItem('sb_bkp_antes_restauro') };
  }, r.chave);
  ok(restaurado.n === 1 && restaurado.nome === 'Cliente Backup', 'restaurar traz as paradas de volta');
  ok(restaurado.temPre, 'o estado anterior é guardado antes de restaurar');
  await ctx.close();
});

// ── 5. Dado corrompido no localStorage não derruba o app ──
await secao('Dado corrompido no localStorage não derruba o app', async () => {
  const ctx = await novoContexto({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('sb_stops', '{{{ corrompido');
    localStorage.setItem('sb_cfg', 'nao e json');
  });
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  ok(erros.length === 0, 'localStorage corrompido não gera exceção fatal' + (erros.length ? ': ' + erros[0] : ''));
  ok(await page.isVisible('#homeScreen'), 'app ainda abre na tela inicial com dado corrompido');
  ok(await page.evaluate(() => Array.isArray(stops) && stops.length === 0), 'stops volta para lista vazia');
  await ctx.close();
});

// ── 6. As páginas públicas carregam ──
for (const [rota, nome] of [['/pedido.html?room=SB-TEST&store=KS', 'pedido.html'],
                            ['/motoboy.html?room=SB-TEST&id=abc', 'motoboy.html'],
                            ['/fatura.html?room=SB-TEST&id=abc', 'fatura.html']]) {
  await secao(nome, async () => {
    const { ctx, erros } = await abrir(rota);
    const reais = erros.filter(e => !ruido(e));
    ok(reais.length === 0, `${nome} carrega sem erro de JavaScript` + (reais.length ? '\n     ' + reais.join('\n     ') : ''));
    await ctx.close();
  });
}

// ── 7. offline.html se sustenta sozinha ──────────────────────
await secao('offline.html se sustenta sozinha', async () => {
  const { page, ctx, erros } = await abrir('/offline.html');
  ok(erros.filter(e => !ruido(e)).length === 0, 'offline.html carrega sem erro');
  ok(await page.isVisible('button'), 'offline.html mostra o botão de tentar de novo');
  // Se a página de offline depender da rede para renderizar, ela não serve.
  const externos = await page.evaluate(() =>
    [...document.querySelectorAll('script[src],link[rel=stylesheet],img')]
      .map(e => e.src || e.href).filter(u => u && !u.startsWith(location.origin)));
  ok(externos.length === 0, 'offline.html não depende de nenhum recurso externo' +
    (externos.length ? ': ' + externos.join(', ') : ''));
  await ctx.close();
});

// ── 7b. Navegação pelo histórico ─────────────────────────────
// O botão voltar do Android FECHAVA o app, de qualquer tela.
await secao('Navegação pelo histórico', async () => {
  const { page, ctx } = await abrir('/index.html');
  const telaVisivel = () => page.evaluate(() => {
    const a = document.querySelector('.screen.active');
    return a ? a.id : null;
  });

  ok(await telaVisivel() === 'homeScreen', 'começa na tela de entregas');
  ok((page.url().split('#')[1] || '') === 'entregas', 'a URL reflete a tela inicial');

  // Ir para Ganhos e voltar
  await page.click('#nav-finance');
  ok(await telaVisivel() === 'financeScreen', 'a aba Ganhos abre');
  ok(page.url().includes('#ganhos'), 'a URL acompanha a navegação');

  await page.goBack();
  await page.waitForTimeout(250);
  ok(await telaVisivel() === 'homeScreen', 'VOLTAR retorna para as entregas em vez de fechar o app');

  // Duas telas de profundidade
  await page.click('#nav-report');
  await page.click('#nav-cfg');
  await page.waitForTimeout(200);
  ok(await telaVisivel() === 'configScreen', 'chega em Configurações');
  await page.goBack();
  await page.waitForTimeout(200);
  ok(await telaVisivel() === 'reportScreen', 'voltar desce um nível (Fechamento)');
  await page.goBack();
  await page.waitForTimeout(200);
  ok(await telaVisivel() === 'homeScreen', 'voltar de novo chega nas entregas');

  // Voltar fecha modal aberto
  const modalAberto = async () => page.evaluate(() =>
    !document.getElementById('expenseModal').classList.contains('hidden'));
  await page.evaluate(() => { goNav('financeScreen', 'nav-finance'); openExpenseModal(); });
  await page.waitForTimeout(200);
  ok(await modalAberto(), 'o modal de despesa abre');
  await page.goBack();
  await page.waitForTimeout(250);
  ok(!(await modalAberto()), 'VOLTAR fecha o modal');
  ok(await telaVisivel() === 'financeScreen', 'e mantém a tela onde estava');

  // Fechar pelo X não pode deixar entrada órfã: um voltar já sai da tela
  await page.evaluate(() => { openExpenseModal(); });
  await page.waitForTimeout(150);
  await page.evaluate(() => closeExpenseModal());
  await page.waitForTimeout(250);
  ok(!(await modalAberto()), 'fechar pelo X fecha o modal');
  await page.goBack();
  await page.waitForTimeout(250);
  ok(await telaVisivel() === 'homeScreen',
    'depois de fechar pelo X, um voltar sai da tela (sem entrada órfã no histórico)');

  await ctx.close();
});

// ── 7c. Link direto e memória de rolagem ─────────────────────
await secao('Link direto e rolagem', async () => {
  const { page, ctx } = await abrir('/index.html#fechamento');
  ok(await page.evaluate(() => document.querySelector('.screen.active').id) === 'reportScreen',
    'abrir com #fechamento cai direto no Fechamento');
  await ctx.close();

  const b = await abrir('/index.html');
  // Enche a lista para haver rolagem de verdade
  const rolou = await b.page.evaluate(async () => {
    stops = Array.from({ length: 40 }, (_, i) => ({ name: 'Cliente ' + i, value: '10', city: 'SER' }));
    renderHome();
    const tela = document.getElementById('homeScreen');
    tela.scrollTop = 400;
    return tela.scrollTop;
  });
  ok(rolou > 0, 'a lista rola');
  await b.page.click('#nav-cfg');
  await b.page.waitForTimeout(200);
  await b.page.goBack();
  await b.page.waitForTimeout(400);
  const voltou = await b.page.evaluate(() => document.getElementById('homeScreen').scrollTop);
  ok(Math.abs(voltou - rolou) < 40, `voltar devolve a rolagem onde estava (${rolou} → ${voltou})`);
  await b.ctx.close();
});

// ── 7d. Núcleo compartilhado, no navegador de verdade ────────
/* Os testes de nucleo.mjs rodam o speedboy-core.js isolado. Aqui a
   pergunta é outra: o APP, carregado de verdade, oferece os bairros que
   antes só existiam no formulário do cliente? Era o bug de campo — o
   cliente escolhia "Caratoíra", o pedido chegava, e ao editar a parada o
   motoboy não achava o bairro no seletor. */
await secao('Núcleo compartilhado no app', async () => {
  const { page, ctx } = await abrir('/index.html');

  ok(await page.evaluate(() => typeof window.SpeedBoy === 'object'),
    'o app carrega o speedboy-core.js');

  // A paleta tem de vir do arquivo externo, não de um :root local.
  const muted = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--muted').trim());
  ok(muted === '#aaa', `--muted vem do speedboy.css (${muted})`);

  /* Um por cidade, entre os 93 que existiam só na lista do cliente.
     Se a unificação regredir, isto quebra antes de chegar ao celular. */
  const RECUPERADOS = {
    VIX: 'Caratoíra',
    VV:  'Cobi de Baixo',
    CCA: 'Boa Sorte',
    SRR: 'Estância Monazítica'
  };
  for (const [cidade, bairro] of Object.entries(RECUPERADOS)) {
    const achou = await page.evaluate(([c, b]) => {
      document.getElementById('fCity').value = c;
      document.getElementById('fBairro').value = b;
      filterBairros();
      const lista = document.getElementById('fBairroList');
      return lista.classList.contains('show') &&
             [...lista.querySelectorAll('.bairro-item')].some(e => e.textContent === b);
    }, [cidade, bairro]);
    ok(achou, `o seletor do app sugere "${bairro}" (${cidade}) — só existia na lista do cliente`);
  }

  await ctx.close();
});

// ── 7e. Desfazer e confirmação, no navegador ─────────────────
await secao('Desfazer e confirmação', async () => {
  const { page, ctx } = await abrir('/index.html');

  // Excluir uma parada agora age em UM toque e oferece saída
  const estado = await page.evaluate(() => {
    stops = [{ _id: 'a', name: 'Cliente A', value: '10' },
             { _id: 'b', name: 'Cliente B', value: '20' }];
    saveStops(); renderHome();
    delStop(0);
    return {
      sobraram: stops.length,
      barraVisivel: document.getElementById('snack').classList.contains('show'),
      texto: document.getElementById('snackMsg').textContent,
      lapide: !!(JSON.parse(localStorage.getItem('sb_tombs') || '{}').a)
    };
  });
  ok(estado.sobraram === 1, 'excluir remove a parada sem pedir confirmação');
  ok(estado.barraVisivel, 'a barra de desfazer aparece');
  ok(/Cliente A/.test(estado.texto), `a barra diz o que saiu (${estado.texto})`);
  ok(estado.lapide, 'a exclusão gerou lápide, como manda a sincronização');

  // Tocar em Desfazer devolve a parada E limpa a lápide
  await page.click('#snackUndo');
  await page.waitForTimeout(150);
  const depois = await page.evaluate(() => ({
    total: stops.length,
    voltou: stops.some(s => s._id === 'a'),
    lapide: !!(JSON.parse(localStorage.getItem('sb_tombs') || '{}').a),
    barraVisivel: document.getElementById('snack').classList.contains('show')
  }));
  ok(depois.total === 2 && depois.voltou, 'Desfazer devolve a parada');
  ok(!depois.lapide,
    'a lápide sumiu junto — sem isso o outro aparelho apagaria a parada de novo');
  ok(!depois.barraVisivel, 'a barra some depois de usada');

  // E não dá para desfazer duas vezes
  const duplicou = await page.evaluate(() => { desfazerAgora(); return stops.length; });
  ok(duplicou === 2, 'chamar desfazer de novo não duplica nada');

  /* A confirmação em massa precisa dizer os números — e o botão voltar do
     aparelho tem que fechá-la SEM executar a ação. */
  const conf = await page.evaluate(async () => {
    history = [{ date: '01/01/2026', stops: [{ _id: 'x', name: 'X', value: '30', done: true }] }];
    const promessa = clearHist();
    await new Promise(r => setTimeout(r, 100));
    const visivel = !document.getElementById('confirmModal').classList.contains('hidden');
    const texto = document.getElementById('confirmTexto').textContent;
    const detalhe = document.getElementById('confirmDetalhe').textContent;
    window.history.back();                       // botão voltar do aparelho
    await promessa;
    return { visivel, texto, detalhe, diasRestantes: history.length };
  });
  ok(conf.visivel, 'a confirmação abre dentro do app, não no diálogo do navegador');
  ok(/1 dia\(s\) e 1 entrega\(s\)/.test(conf.texto),
    `a confirmação conta o que vai sumir (${conf.texto})`);
  ok(/R\$ 30/.test(conf.detalhe), `e diz quanto vale (${conf.detalhe})`);
  ok(conf.diasRestantes === 1,
    'fechar pelo botão voltar NÃO executa a ação — o histórico continua lá');

  await ctx.close();
});

// ── 7f. Config dobrável e primeiro uso ───────────────────────
await secao('Config dobrável e primeiro uso', async () => {
  const { page, ctx } = await abrir('/index.html');

  /* A Config tinha 1899px de conteúdo em 713px de tela — 2,7 telas de
     rolagem — com tudo sempre aberto. */
  const medida = await page.evaluate(() => {
    cfg.stores = ['KS', 'Padaria'];
    localStorage.setItem('sb_room_code', 'SB-RWZ4');
    goNav('configScreen', 'nav-cfg');
    loadConfig();
    const corpo = document.querySelector('#configScreen .config-body');
    return { total: corpo.scrollHeight, tela: corpo.clientHeight };
  });
  ok(medida.total < 1000,
    `a Config cabe em pouco mais de uma tela (${medida.total}px, antes eram 1899px)`);

  // O resumo diz o que tem dentro sem precisar abrir
  const resumos = await page.evaluate(() => ({
    lojas: document.getElementById('resumo-lojas').textContent,
    sync:  document.getElementById('resumo-sync').textContent,
    links: document.getElementById('resumo-links').textContent
  }));
  ok(resumos.sync === 'SB-RWZ4', `a Sincronização mostra a sala no cabeçalho (${resumos.sync})`);
  ok(resumos.lojas.startsWith('2 lojas'), `Minhas lojas mostra a contagem (${resumos.lojas})`);
  /* Loja sem WhatsApp manda o problema do motoboy para o plantão em vez da
     própria loja. Isso precisa aparecer com a seção FECHADA — senão só se
     descobre abrindo, que é justamente o que ninguém faz. */
  ok(resumos.lojas.includes('2 sem WhatsApp'),
    `e avisa quantas ainda não têm WhatsApp (${resumos.lojas})`);
  ok(resumos.links === 'nenhuma', `Links mostra que está vazio (${resumos.links})`);

  // Dobrar guarda o estado
  const dobra = await page.evaluate(() => {
    dobrarSecao('fatura');
    const aberta = document.querySelector('[aria-controls="cfg-fatura"]').getAttribute('aria-expanded');
    const salvo = JSON.parse(localStorage.getItem('sb_cfg_abertas') || '{}');
    return { aberta, salvo: salvo.fatura };
  });
  ok(dobra.aberta === 'true' && dobra.salvo === true,
    'abrir uma seção guarda o estado para a próxima vez');

  /* Primeiro uso: aparelho zerado precisa ter caminho até a sala do outro
     celular. Antes o campo do código ficava a 1116px do topo da Config. */
  const bemvindo = await page.evaluate(() => {
    stops = []; history = []; cfg.stores = [];
    localStorage.removeItem('sb_ja_comecou');
    localStorage.removeItem('sb_room_code');
    goNav('homeScreen', 'nav-home');
    renderHome();
    const campo = document.getElementById('bvCodigo');
    return {
      temCampo: !!campo,
      // O código tem que existir mesmo sem ninguém ter aberto a Config
      codigoNaTela: /SB-[A-Z0-9]{4}/.test(document.querySelector('.bemvindo').textContent),
      guardado: localStorage.getItem('sb_room_code')
    };
  });
  ok(bemvindo.temCampo, 'aparelho novo mostra o campo do código na PRIMEIRA tela');
  ok(bemvindo.codigoNaTela && /^SB-[A-Z0-9]{4}$/.test(bemvindo.guardado || ''),
    `o código próprio já existe sem abrir a Config (${bemvindo.guardado})`);

  // Código malformado não passa
  const invalido = await page.evaluate(() => {
    document.getElementById('bvCodigo').value = 'ABC';
    entrarPeloBemVindo();
    return { sala: localStorage.getItem('sb_room_code'), aviso: document.getElementById('toast').textContent };
  });
  ok(!/^ABC$/.test(invalido.sala) && /inválido/i.test(invalido.aviso),
    `código malformado é recusado com aviso (${invalido.aviso})`);

  // Código válido entra na sala e o cartão some
  const entrou = await page.evaluate(() => {
    document.getElementById('bvCodigo').value = 'sb-a1b2';    // minúsculo de propósito
    entrarPeloBemVindo();
    return { sala: localStorage.getItem('sb_room_code'), cartao: !!document.querySelector('.bemvindo') };
  });
  ok(entrou.sala === 'SB-A1B2', `o código digitado em minúsculo é aceito (${entrou.sala})`);
  ok(!entrou.cartao, 'depois de entrar, o cartão de boas-vindas não volta');

  await ctx.close();
});

// ── 7g. Modo FULL: aba de repasses e painel do motoboy ───────
await secao('Modo FULL num navegador de verdade', async () => {
  const { page, ctx } = await abrir('/index.html');

  const inicio = await page.evaluate(() => {
    alternarModoFull(false);
    return { aba: document.getElementById('nav-repasses').classList.contains('hidden') };
  });
  ok(inicio.aba, 'em dia normal a aba Repasses não ocupa lugar na barra');

  const ligado = await page.evaluate(() => {
    alternarModoFull(true);
    goNav('repassesScreen', 'nav-repasses');
    return {
      visivel: !document.getElementById('nav-repasses').classList.contains('hidden'),
      tela: document.querySelector('.screen.active').id,
      vazio: document.getElementById('repassesList').textContent
    };
  });
  ok(ligado.visivel, 'ligar o FULL faz a aba Repasses aparecer');
  ok(ligado.tela === 'repassesScreen', 'e a aba abre');
  ok(/Nenhum repasse ativo/.test(ligado.vazio), 'sem repasse, a aba explica o que fazer');

  /* Um repasse em andamento, como chega do Firebase. O nome do motoboy é
     digitado à mão e vira innerHTML — a mesma porta de XSS do resto. */
  const emAndamento = await page.evaluate(() => {
    window.__xss = false;
    repassesData = { RP1: {
      motoboy: '<img src=x onerror="window.__xss=true">Carlos',
      phone: '27999998888', createdAt: new Date().toISOString(),
      deliveries: [
        { stopId: 'a', name: 'Ana', address: 'R. 1', taxa: 9, done: true,
          doneAt: new Date().toISOString(), receivedBy: 'Porteiro João' },
        { stopId: 'b', name: 'Beto', address: 'R. 2', taxa: 8, done: false,
          problem: { titulo: 'Portaria não aceita a entrega', detalhe: 'Sem autorização', at: new Date().toISOString() } }
      ]
    } };
    renderRepasses();
    atualizarBarraFull();
    const txt = document.getElementById('repassesList').textContent;
    return {
      xss: window.__xss,
      progresso: /1\/2/.test(txt),
      recebedor: txt.includes('Porteiro João'),
      problema: txt.includes('Portaria não aceita'),
      alerta: !!document.querySelector('#nav-repasses .alerta'),
      barra: document.getElementById('fullBar').classList.contains('visible'),
      barraTxt: document.getElementById('fullBarTxt').textContent
    };
  });
  ok(!emAndamento.xss, 'nome de motoboy com marcação NÃO executa nada');
  ok(emAndamento.progresso, 'a aba mostra o andamento (1/2)');
  ok(emAndamento.recebedor, 'e quem recebeu cada entrega');
  ok(emAndamento.problema, 'o problema relatado aparece sem precisar abrir nada');
  ok(emAndamento.alerta, 'a barra inferior ganha a bolinha de alerta');
  ok(emAndamento.barra && /problema/.test(emAndamento.barraTxt),
    `a inicial avisa do problema (${emAndamento.barraTxt})`);

  /* Desligar o FULL estando na aba: sem isto a pessoa fica numa tela sem
     nenhum item aceso na barra, sem caminho de volta. */
  const desligado = await page.evaluate(() => {
    goNav('repassesScreen', 'nav-repasses');
    alternarModoFull(false);
    return document.querySelector('.screen.active').id;
  });
  ok(desligado === 'homeScreen', 'desligar o FULL na aba Repasses devolve para a inicial');

  await ctx.close();
});

// ── 7h. Painel do motoboy: sem taxa, com todo o resto ────────
await secao('Painel do motoboy no modo FULL', async () => {
  /* Sem Firebase no sandbox a página cai na tela de erro, mas as funções
     de render existem. Injetamos o repasse na mão — é exatamente o que o
     listener faria — e conferimos o que vai para a tela. */
  const { page, ctx } = await abrir('/motoboy.html?room=SB-TEST&id=RP1');

  const r = await page.evaluate(() => {
    window.__xss = false;
    repassData = {
      motoboy: 'Carlos', hideTaxa: true, askReceiver: true, askPhoto: false,
      deliveries: [
        { name: '<img src=x onerror="window.__xss=true">Ana', address: 'R. das Flores, 10',
          complement: 'ap 202', reference: 'portão azul', phone: '27999998888',
          store: 'KS', neighborhood: 'Centro', timeFrom: '14:00', timeTo: '16:00',
          notes: 'entregar na portaria', taxa: 9, storePhone: '2733334444', done: false },
        { name: 'Beto', address: 'R. B, 5', taxa: 8, done: true, doneAt: new Date().toISOString(), receivedBy: 'Beto' }
      ]
    };
    document.getElementById('mainWrap').style.display = 'block';
    renderStops();
    const wrap = document.getElementById('stopsWrap');
    return {
      xss: window.__xss,
      html: wrap.innerHTML,
      texto: wrap.textContent,
      resumo: document.getElementById('summaryBar').textContent,
      proxima: document.getElementById('proximaBar').classList.contains('visible'),
      proximaNome: document.getElementById('proximaNome').textContent
    };
  });

  ok(!r.xss, 'nome de cliente com marcação NÃO executa nada no painel do motoboy');
  ok(!/R\$\s*9,00/.test(r.texto), 'com hideTaxa, a taxa da entrega não aparece');
  ok(!/Ganho/.test(r.resumo), 'e o resumo não mostra o ganho do dia');
  // ...mas nada do que serve para entregar pode sumir junto
  for (const [rotulo, valor] of [['complemento', 'ap 202'], ['referência', 'portão azul'],
                                 ['bairro', 'Centro'], ['janela', '14:00'],
                                 ['loja', 'KS'], ['observação', 'entregar na portaria'],
                                 ['telefone', '99999-8888']]) {
    ok(r.texto.includes(valor), `o painel continua mostrando ${rotulo}`);
  }
  ok(/Waze/.test(r.texto) && /Maps/.test(r.texto), 'cada parada abre no Waze ou no Google Maps');
  ok(/Problema/.test(r.texto), 'e tem o botão de relatar problema');
  ok(r.proxima && /Ana/.test(r.proximaNome),
    'a barra fixa aponta a próxima parada pendente, uma por vez');

  // O modal de problema abre com as mensagens prontas
  const prob = await page.evaluate(() => {
    abrirProb(0);
    const t = document.getElementById('probLista').textContent;
    return { aberto: !document.getElementById('probModal').classList.contains('hidden'), texto: t };
  });
  ok(prob.aberto, 'o modal de problema abre');
  for (const m of ['Endereço errado', 'contato com o cliente', 'Portaria não aceita', 'Mercadoria errada']) {
    ok(prob.texto.includes(m), `a lista de motivos oferece "${m}"`);
  }

  // Confirmar entrega exige quem recebeu quando o repasse pede
  const conf = await page.evaluate(() => {
    fecharProb();
    abrirEntrega(0);
    const antes = document.getElementById('btnConfirmarEntrega').disabled;
    document.getElementById('entregaRecebedor').value = 'Maria';
    validarEntrega();
    return { antes, depois: document.getElementById('btnConfirmarEntrega').disabled };
  });
  ok(conf.antes === true, 'sem o nome de quem recebeu, não dá para confirmar');
  ok(conf.depois === false, 'com o nome preenchido, o botão libera');

  /* Otimizar sem rede: o Nominatim e o OSRM não respondem no sandbox. O que
     não pode acontecer é o botão ficar preso em "Calculando..." — foi assim
     que a rota do app já travou uma vez. */
  const rota = await page.evaluate(async () => {
    fecharEntrega();
    otimizarRota();
    await new Promise(r => setTimeout(r, 6000));
    const b = document.getElementById('btnOtimizar');
    return { texto: b.textContent, travado: b.disabled };
  });
  ok(!rota.travado && /Otimizar rota/.test(rota.texto),
    `serviço de rota fora do ar devolve o botão (${rota.texto})`);

  await ctx.close();
});

// ── 8. Faixa de atualização e controles de versão ────────────
await secao('Faixa de atualização e controles de versão', async () => {
  const { page, ctx } = await abrir('/index.html');
  ok(await page.locator('#updateBar').count() === 1, 'a faixa de atualização existe no HTML');
  ok(await page.locator('#updateBar.hidden').count() === 1, 'a faixa começa escondida');
  const fns = await page.evaluate(() =>
    ['aplicarAtualizacao', 'forcarAtualizacao', 'mostrarVersaoApp']
      .filter(n => typeof window[n] !== 'function'));
  ok(fns.length === 0, 'funções de atualização disponíveis' + (fns.length ? ' — faltando: ' + fns.join(', ') : ''));

  // A faixa aparece quando um worker fica em espera
  const visivel = await page.evaluate(() => {
    mostrarFaixaUpdate({ postMessage() {} });
    return !document.getElementById('updateBar').classList.contains('hidden');
  });
  ok(visivel, 'mostrarFaixaUpdate revela a faixa');
  await ctx.close();
});

// ── 9. O app abre offline, do cache ──────────────────────────
// A promessa central desta etapa. Aqui o service worker roda de verdade.
await secao('O app abre offline, do cache', async () => {
  const ctx = await novoContexto();          // sem bloquear o SW
  const page = await ctx.newPage();
  await page.goto(base + '/index.html', { waitUntil: 'load' });

  // serviceWorker.ready nunca rejeita: sem corrida contra um timer, um SW
  // que não ativa deixa o teste pendurado para sempre.
  const ativou = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise(r => setTimeout(() => r(false), 8000))
  ]));
  ok(ativou, 'o service worker ativa');

  // Espera o shell entrar no cache
  const cacheado = await page.waitForFunction(async () => {
    const nomes = await caches.keys();
    for (const n of nomes) {
      const c = await caches.open(n);
      if (await c.match('./index.html')) return true;
    }
    return false;
  }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  ok(cacheado, 'o index.html entra no cache do service worker');

  // Agora corta a rede e recarrega
  await ctx.setOffline(true);
  let abriu = false;
  try {
    await page.reload({ waitUntil: 'load', timeout: 10000 });
    abriu = await page.isVisible('#homeScreen');
  } catch (e) { abriu = false; }
  ok(abriu, 'o app abre OFFLINE, servido do cache');

  if (abriu) {
    ok(await page.evaluate(() => typeof renderHome === 'function'),
      'offline o app carrega o script completo, não uma página parcial');
  }

  await ctx.setOffline(false);
  await ctx.close();
});

// ── 9b. Sincronização: pendência e status honesto ────────────
await secao('Sincronização offline', async () => {
  const { page, ctx } = await abrir('/index.html');

  const fns = await page.evaluate(() =>
    ['mergeStops', 'carimbarStops', 'idDaParada', 'getTombs', 'temPendencia', 'atualizarStatusSync']
      .filter(n => typeof window[n] !== 'function'));
  ok(fns.length === 0, 'funções de sincronização disponíveis' + (fns.length ? ' — faltando: ' + fns.join(', ') : ''));

  // Toda parada salva ganha identidade e carimbo
  const carimbo = await page.evaluate(() => {
    stops = [{ name: 'Ana', value: '10' }, { name: 'Beto', value: '20' }];
    saveStops();
    return { comId: stops.every(s => !!s._id), comUpd: stops.every(s => !!s._upd),
             idsUnicos: new Set(stops.map(s => s._id)).size === 2 };
  });
  ok(carimbo.comId && carimbo.comUpd, 'salvar carimba _id e _upd em toda parada');
  ok(carimbo.idsUnicos, 'cada parada recebe identidade própria');

  // Excluir deixa tombstone — sem isso a parada volta do outro aparelho
  const exclusao = await page.evaluate(() => {
    const alvo = stops[0]._id;
    stops.splice(0, 1);            // qualquer ponto que remova, sem avisar ninguém
    saveStops();
    return { tombstoneCriado: !!getTombs()[alvo], restou: stops.length };
  });
  ok(exclusao.tombstoneCriado, 'remover uma parada gera tombstone automaticamente');
  ok(exclusao.restou === 1, 'a lista fica com o restante');

  // Sem sala configurada não há o que enviar, e o app não pode fingir sincronia
  const semSala = await page.evaluate(() => {
    fbDb = null; fbRoomPath = null;
    atualizarStatusSync();
    return document.getElementById('syncDot').className;
  });
  ok(!/synced/.test(semSala), 'sem sala, o ponto não mostra "sincronizado"');

  // Com sala e sem sinal, a alteração fica guardada e o status diz a verdade
  const offline = await page.evaluate(() => {
    fbDb = {}; fbRoomPath = 'rooms/SB-TEST/stops';
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    stops.push({ name: 'Carla', value: '30' });
    saveStops();                                   // chama fbPush por dentro
    return { pendente: temPendencia(), ponto: document.getElementById('syncDot').className,
             rotulo: document.getElementById('syncLabel').textContent };
  });
  ok(offline.pendente, 'alteração sem sinal fica marcada como pendente');
  ok(/offline/.test(offline.ponto), 'o ponto mostra o estado offline');
  ok(/sinal/i.test(offline.rotulo), `o rótulo avisa que está sem sinal (${offline.rotulo})`);

  // A pendência precisa sobreviver a fechar o app sem sinal
  await page.reload({ waitUntil: 'load' });
  ok(await page.evaluate(() => temPendencia()),
    'a pendência sobrevive ao fechamento do app');

  await ctx.close();
});

/* ── 10. Servidor fora do ar: navegação nova cai no offline.html ──
   Precisa derrubar o servidor de verdade. O setOffline() do Playwright
   corta a rede da PÁGINA, mas não a do service worker — o fetch dele
   ainda chega ao servidor, e um 404 devolvido não é falta de conexão
   (nesse caso o SW repassa o 404 mesmo, que é o comportamento certo).
   Por isso esta seção é a última: ela encerra o servidor. */
await secao('Servidor fora do ar cai no offline.html', async () => {
  const ctx = await novoContexto();
  const page = await ctx.newPage();
  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready,
    new Promise(r => setTimeout(r, 8000))
  ]));
  await page.waitForTimeout(1500);          // deixa o shell entrar no cache

  await new Promise(r => { srv.closeAllConnections?.(); srv.close(r); });

  let texto = '';
  try {
    await page.goto(base + '/uma-rota-que-nao-existe', { waitUntil: 'load', timeout: 10000 });
    texto = await page.textContent('body');
  } catch (e) { texto = 'ERRO: ' + e.message; }

  const caiuNoOffline = /Sem conexão/i.test(texto);
  ok(caiuNoOffline,
    'com o servidor fora do ar, a navegação cai na página de offline' +
    (caiuNoOffline ? '' : ` — recebeu: ${texto.slice(0, 90)}`));
  await ctx.close();
});

await browser.close();
try { srv.close(); } catch (e) {}
fim();
