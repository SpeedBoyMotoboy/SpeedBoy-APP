/* Smoke test em navegador real: o app abre, o XSS está fechado,
   o backup funciona e as páginas públicas carregam.
   Requer: npm i playwright   (o Chromium já vem no ambiente) */
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { RAIZ, chromiumPath, criarPlacar } from './_util.mjs';

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
const base = `http://127.0.0.1:${srv.address().port}`;

const browser = await chromium.launch({ executablePath: chromiumPath() });
const { ok, fim } = criarPlacar();

async function abrir(rota) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const erros = [];
  page.on('pageerror', e => erros.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push('console: ' + m.text()); });
  await page.goto(base + rota, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  return { page, ctx, erros };
}

// Erros de rede/Firebase são esperados no sandbox — só nos importam erros de código
const ruido = t => /net::|Failed to load resource|firebase|Firebase|auth\/|gstatic|fonts\.googleapis|ERR_|Login an/i.test(t);

// ── 1. index.html carrega e as telas existem ──
{
  const { page, ctx, erros } = await abrir('/index.html');
  const reais = erros.filter(e => !ruido(e));
  ok(reais.length === 0, 'index.html carrega sem erro de JavaScript' + (reais.length ? '\n     ' + reais.join('\n     ') : ''));

  const telas = await page.$$eval('.screen', els => els.map(e => e.id));
  ok(telas.length === 7, `7 telas presentes (achou ${telas.length}: ${telas.join(', ')})`);

  ok(await page.isVisible('#homeScreen'), 'tela inicial visível ao abrir');

  // as funções críticas existem no escopo global
  const fns = await page.evaluate(() => ['esc','escJs','sbRead','sbAutoBackup','sbListBackups','sbMigrate','goNav','renderHome','renderAutoBackups','restoreAutoBackup']
    .filter(n => typeof window[n] !== 'function'));
  ok(fns.length === 0, 'todas as funções novas existem no escopo global' + (fns.length ? ' — faltando: ' + fns.join(', ') : ''));

  // config compartilhada foi carregada
  ok(await page.evaluate(() => !!(window.SPEEDBOY_FIREBASE_CONFIG && window.SPEEDBOY_FIREBASE_CONFIG.databaseURL)), 'speedboy-firebase.js expõe a configuração');
  ok(await page.evaluate(() => typeof window.speedboyLoginAnonimo === 'function'), 'helper de login anônimo disponível');

  // schema carimbado e viewport liberado
  ok(await page.evaluate(() => localStorage.getItem('sb_schema_version') === '1'), 'sbMigrate carimbou a versão do schema no boot');
  const vp = await page.getAttribute('meta[name=viewport]', 'content');
  ok(!/user-scalable=no|maximum-scale/.test(vp), 'viewport permite zoom (acessibilidade)');

  // nenhum botão sem type
  const semType = await page.$$eval('button', bs => bs.filter(b => !b.getAttribute('type')).length);
  ok(semType === 0, `nenhum botão sem type (achou ${semType})`);

  await ctx.close();
}

// ── 2. XSS: nome vindo do cliente não pode virar HTML ──
{
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
}

// ── 3. escJs: aspas no nome da loja não quebram o onclick do fechamento ──
{
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
}

// ── 4. Backup automático roda no boot e é restaurável ──
{
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

  const restaurado = await page.evaluate((chave) => {
    window.confirm = () => true;      // aceita o diálogo de confirmação
    restoreAutoBackup(chave);
    return { n: stops.length, nome: stops[0] && stops[0].name, temPre: !!localStorage.getItem('sb_bkp_antes_restauro') };
  }, r.chave);
  ok(restaurado.n === 1 && restaurado.nome === 'Cliente Backup', 'restaurar traz as paradas de volta');
  ok(restaurado.temPre, 'o estado anterior é guardado antes de restaurar');
  await ctx.close();
}

// ── 5. Dado corrompido no localStorage não derruba o app ──
{
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
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
}

// ── 6. As páginas públicas carregam ──
for (const [rota, nome] of [['/pedido.html?room=SB-TEST&store=KS', 'pedido.html'],
                            ['/motoboy.html?room=SB-TEST&id=abc', 'motoboy.html'],
                            ['/fatura.html?room=SB-TEST&id=abc', 'fatura.html']]) {
  const { ctx, erros } = await abrir(rota);
  const reais = erros.filter(e => !ruido(e));
  ok(reais.length === 0, `${nome} carrega sem erro de JavaScript` + (reais.length ? '\n     ' + reais.join('\n     ') : ''));
  await ctx.close();
}

await browser.close();
srv.close();
fim();
