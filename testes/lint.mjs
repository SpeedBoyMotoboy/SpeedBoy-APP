/* ═══════════════════════════════════════════════════════════════
   Guarda de regressão.

   Não é lint de estilo — é a rede que impede as correções da Etapa 1 de
   voltarem atrás sem ninguém notar. Cada regra aqui existe porque o
   problema correspondente já esteve no código.
   ═══════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { RAIZ, lerApp, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();
const PAGINAS = ['index.html', 'pedido.html', 'motoboy.html', 'fatura.html', 'offline.html'];

// ── 1. Todo <button> precisa de type ──────────────────────────
// Sem type, um botão dentro de <form> vira submit e recarrega a página.
for (const arq of PAGINAS) {
  const src = lerApp(arq);
  const semType = (src.match(/<button(?:\s[^>]*)?>/g) || [])
    .filter(t => !/\btype\s*=/.test(t));
  ok(semType.length === 0,
    `${arq}: todo <button> tem type` +
    (semType.length ? ` — ${semType.length} sem: ${semType.slice(0, 3).join(' ')}` : ''));
}

// ── 2. O viewport não pode bloquear o zoom ────────────────────
for (const arq of PAGINAS) {
  const src = lerApp(arq);
  const m = src.match(/<meta\s+name=["']viewport["'][^>]*>/i);
  const trava = m && /user-scalable\s*=\s*no|maximum-scale/i.test(m[0]);
  ok(!trava, `${arq}: viewport permite zoom` + (trava ? ` — ${m[0]}` : ''));
}

// ── 3. Campos preenchidos pelo cliente nunca cru em innerHTML ──
// Esses vêm de pedido.html. Interpolar sem esc() reabre o XSS armazenado.
// Só interessa contexto HTML: a mesma interpolação numa mensagem de
// WhatsApp é inofensiva, porque vai por encodeURIComponent.
{
  const src = lerApp('index.html');
  const CAMPOS = ['name', 'store', 'address', 'neighborhood', 'notes', 'reference', 'complement'];
  const crus = [];

  src.split('\n').forEach((linha, i) => {
    if (!/<\w+[\s>]/.test(linha)) return;            // linha sem marcação HTML
    for (const campo of CAMPOS) {
      // Forma direta:  ${s.campo}  /  ${s.campo||'...'}
      const direto = new RegExp(`\\$\\{s\\.${campo}(?:\\s*\\|\\|\\s*'[^']*')?\\}`, 'g');
      for (const a of linha.match(direto) || []) crus.push(`linha ${i + 1}: ${a}`);

      // Forma condicional que emite o campo cru:  ${s.campo? ... +s.campo ... }
      // Aceita quando toda menção emissora está dentro de esc(...).
      const cond = new RegExp(`\\$\\{s\\.${campo}\\?[^}]*\\}`, 'g');
      for (const a of linha.match(cond) || []) {
        const semEsc = new RegExp(`(?<!esc\\()\\bs\\.${campo}\\b(?!\\s*[?)])`);
        if (semEsc.test(a.replace(new RegExp(`^\\$\\{s\\.${campo}\\?`), ''))) {
          crus.push(`linha ${i + 1}: ${a.slice(0, 70)}`);
        }
      }
    }
  });

  ok(crus.length === 0,
    'index.html: nenhum campo de cliente interpolado sem esc()' +
    (crus.length ? '\n     ' + [...new Set(crus)].join('\n     ') : ''));
}

// ── 4. esc() precisa escapar os cinco caracteres ──────────────
{
  const src = lerApp('index.html');
  const corpo = src.slice(src.indexOf('function esc(s){'), src.indexOf('function escJs('));
  const faltando = ['&', '<', '>', '"', "'"].filter(c => !corpo.includes(`/${c}/g`));
  ok(faltando.length === 0,
    'esc() escapa &, <, >, aspas e apostrofo' +
    (faltando.length ? ` — faltando: ${faltando.join(' ')}` : ''));
}

// ── 5. O service worker não pode assumir sozinho ──────────────
// skipWaiting() no install era o que fazia a página recarregar no meio
// do uso. Só pode ser chamado a pedido do usuário, no handler de message.
{
  const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  const noInstall = sw.slice(sw.indexOf("addEventListener('install'"), sw.indexOf("addEventListener('activate'"));
  ok(!noInstall.includes('skipWaiting'),
    'sw.js: install NÃO chama skipWaiting (o usuário decide a hora de trocar)');
  ok(sw.includes("'SKIP_WAITING'"),
    'sw.js: existe o handler de mensagem SKIP_WAITING');

  const idx = lerApp('index.html');
  // O reload só pode acontecer atrás da trava swAtualizando
  const bloco = idx.slice(idx.indexOf("addEventListener('controllerchange'"));
  const trecho = bloco.slice(0, bloco.indexOf('}'));
  ok(trecho.includes('swAtualizando'),
    'index.html: reload por controllerchange só com atualização pedida pelo usuário');
}

// ── 5b. A sincronização não pode voltar a perder dados ────────
{
  const src = lerApp('index.html');

  // `if(fbPushing)return` descartava a escrita: duas alteracoes rapidas e a
  // segunda nunca chegava ao Firebase. Tem de reagendar, nao descartar.
  const corpoPush = src.slice(src.indexOf('function fbPush(){'), src.indexOf('window.addEventListener(\'online\''));
  ok(!/if\s*\(\s*!?fbDb[^)]*\|\|\s*fbPushing\s*\)\s*return/.test(corpoPush),
    'fbPush não descarta escrita concorrente (usa fbSujo para reenviar)');
  ok(corpoPush.includes('fbSujo'), 'fbPush reagenda o envio pendente');

  // `stops = remote` destruia alteracao local ainda nao enviada.
  // Comentarios saem antes: varios deles citam o padrao antigo para explicar
  // por que ele foi trocado, e nao podem contar como reincidencia.
  const semComentarios = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
  ok(!/\bstops\s*=\s*remote\b/.test(semComentarios),
    'o listener não sobrescreve o estado local (usa mergeStops)');
  ok(src.includes('mergeStops(stops, remote'), 'o listener funde local e remoto');

  // Exclusao precisa viajar, senao a parada ressuscita no outro aparelho.
  ok(src.includes("'/tombs'"), 'exclusões são publicadas em /tombs');
  ok(/function registrarExclusoes\(/.test(src), 'exclusões são detectadas por diferença no saveStops');

  // Status honesto: sem isto o ponto ficava verde com alteracao pendente.
  for (const estado of ['offline', 'pending']) {
    ok(src.includes(`.sync-dot.${estado}{`), `existe estilo para o estado "${estado}" do ponto de sincronização`);
  }
  ok(src.includes("addEventListener('online'"), 'o app reage à volta do sinal');
}

// ── 5c. A navegação não pode voltar a fechar o app ────────────
{
  const src = lerApp('index.html');
  ok(/window\.addEventListener\('popstate'/.test(src),
    'existe listener de popstate (sem ele o voltar fecha o app)');
  ok(/window\.history\.pushState/.test(src), 'a navegação empilha no histórico');

  /* O app declara `let history` (o histórico de entregas), que SOMBREIA o
     window.history dentro deste script. Sem qualificar, pushState/back
     caem no array e a navegação quebra inteira, em silêncio. */
  const semComent = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
  const naoQualificados = semComent.match(/(?<!window\.)\bhistory\.(pushState|replaceState|back|go|state)\b/g) || [];
  ok(naoQualificados.length === 0,
    'toda API de histórico é chamada como window.history (o app tem um `let history` que a sombreia)' +
    (naoQualificados.length ? ` — ${[...new Set(naoQualificados)].join(', ')}` : ''));

  // Modais precisam passar pelo histórico, senão voltar sai da tela
  // em vez de fechar o modal que está na frente.
  const MODAIS = ['wppModal', 'quickPanel', 'qsModal', 'expenseModal', 'notifyHelpModal', 'provaModal'];
  const direto = MODAIS.filter(id =>
    new RegExp(`getElementById\\('${id}'\\)\\.classList\\.(add|remove)\\('hidden'\\)`).test(src));
  ok(direto.length === 0,
    'todos os modais abrem/fecham via abrirModal/fecharModal' +
    (direto.length ? ` — ainda diretos: ${direto.join(', ')}` : ''));

  // Barra inferior sob a faixa do iPhone / gesto do Android
  ok(/\.bottom-nav\{[^}]*safe-area-inset-bottom/.test(src),
    'a barra inferior respeita a área segura do aparelho');
}

// ── 6. Dados vivos nunca podem ser cacheados ──────────────────
{
  const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
  for (const host of ['firebaseio.com', 'nominatim.openstreetmap.org', 'router.project-osrm.org']) {
    ok(sw.includes(host), `sw.js: ${host} está na lista de nunca cachear`);
  }
}

// ── 7. Sintaxe válida em todo bloco <script> inline ───────────
{
  const tmp = fs.mkdtempSync(path.join(RAIZ, '.lint-'));
  try {
    for (const arq of PAGINAS) {
      const blocos = [...lerApp(arq).matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]
        .map(m => m[1]).filter(b => b.trim());
      blocos.forEach((b, i) => {
        const f = path.join(tmp, `${arq}.${i}.js`);
        fs.writeFileSync(f, b);
        try {
          execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
          ok(true, `${arq}: bloco <script> #${i + 1} tem sintaxe valida`);
        } catch (e) {
          ok(false, `${arq}: bloco <script> #${i + 1} com erro de sintaxe — ${String(e.stderr).split('\n')[2] || ''}`);
        }
      });
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── 7b. Uma paleta só, e ela precisa passar em contraste ──────
/* index, pedido e motoboy tinham TRÊS blocos :root com os mesmos nomes de
   token e valores diferentes. Pior: o --muted do pedido/motoboy era #666
   sobre um card #13131a — 3,22:1, reprova AA para texto normal, e é
   justamente a cor dos rótulos do formulário que o cliente preenche.

   Estas duas regras seguram as duas metades do problema: ninguém volta a
   declarar a paleta localmente, e a paleta única não pode escurecer a
   ponto de reprovar de novo. */
{
  const APP = ['index.html', 'pedido.html', 'motoboy.html'];

  for (const arq of APP) {
    const src = lerApp(arq);
    ok(/<link[^>]+href=["']speedboy\.css["']/.test(src),
      `${arq}: carrega o speedboy.css`);
    // Basta procurar um :root que declare --bg: é a assinatura da paleta.
    const local = /:root\s*\{[^}]*--bg\s*:/.test(src) || /body\.light\s*\{[^}]*--bg\s*:/.test(src);
    ok(!local, `${arq}: não redeclara a paleta localmente`);
  }

  const css = fs.readFileSync(path.join(RAIZ, 'speedboy.css'), 'utf8');
  const bloco = sel => {
    const m = new RegExp(sel.replace('.', '\\.') + '\\s*\\{([^}]*)\\}').exec(css);
    return m ? m[1] : '';
  };
  const tokens = corpo => Object.fromEntries(
    [...corpo.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));

  // Luminância relativa e razão de contraste (WCAG 2.1, 1.4.3)
  const canal = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const lum = hex => {
    let h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
  };
  const razao = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  const escuro = tokens(bloco(':root'));
  const claro  = { ...escuro, ...tokens(bloco('body.light')) };

  /* 4,5:1 é o mínimo de AA para texto normal. --muted é usado em rótulo e
     texto secundário, tamanho normal — não vale a folga de texto grande. */
  const PARES = [['text', 'bg'], ['text', 'card'], ['muted', 'bg'], ['muted', 'card'], ['muted', 'card2']];
  for (const [tema, paleta] of [['escuro', escuro], ['claro', claro]]) {
    for (const [frente, fundo] of PARES) {
      const r = razao(paleta[frente], paleta[fundo]);
      ok(r >= 4.5,
        `contraste ${tema}: --${frente} sobre --${fundo} = ${r.toFixed(2)}:1 (AA pede 4,5:1)`);
    }
  }
}

// ── 7c. Ícones do PWA de verdade ──────────────────────────────
/* Os três tamanhos declarados apontavam para o MESMO favicon.ico, por URL
   absoluta do GitHub Pages — e o arquivo nem está no repositório. Instalado
   no celular, o app ficava com ícone genérico.
   Aqui conferimos o que o Android realmente lê: caminho relativo (URL
   absoluta quebra em qualquer outro domínio), arquivo presente, PNG de
   verdade e com a dimensão que o manifest promete. */
{
  const man = JSON.parse(fs.readFileSync(path.join(RAIZ, 'manifest.json'), 'utf8'));

  const remotos = man.icons.filter(i => /^https?:/i.test(i.src));
  ok(remotos.length === 0,
    'manifest.json: nenhum ícone por URL absoluta' +
    (remotos.length ? ` — ${remotos.map(i => i.src).join(', ')}` : ''));

  ok(man.icons.some(i => String(i.purpose || '').includes('maskable')),
    'manifest.json: existe ícone maskable (o Android recorta em formato próprio)');

  for (const icone of man.icons) {
    const arq = path.join(RAIZ, icone.src.replace(/^\.\//, ''));
    if (!fs.existsSync(arq)) { ok(false, `manifest.json: ${icone.src} não existe`); continue; }
    const buf = fs.readFileSync(arq);
    const assinatura = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // Largura e altura vivem no IHDR, sempre nos bytes 16..24 de um PNG.
    const larg = buf.readUInt32BE(16), alt = buf.readUInt32BE(20);
    const pedido = Number(String(icone.sizes).split('x')[0]);
    ok(assinatura && larg === pedido && alt === pedido,
      `${icone.src}: PNG ${pedido}x${pedido} de verdade (tem ${larg}x${alt})`);
  }

  // O apple-touch-icon é lido do HTML, não do manifest.
  const idx = lerApp('index.html');
  const apple = /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/.exec(idx);
  ok(!!apple && !/^https?:/i.test(apple[1]) && fs.existsSync(path.join(RAIZ, apple[1].replace(/^\.\//, ''))),
    'index.html: apple-touch-icon aponta para um arquivo local existente');
}

// ── 8. Arquivos .js soltos ────────────────────────────────────
for (const arq of ['sw.js', 'speedboy-firebase.js', 'speedboy-core.js', 'fatura-padrao.js', 'scripts/bump-versao.mjs', 'scripts/gerar-icones.mjs']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(RAIZ, arq)], { stdio: 'pipe' });
    ok(true, `${arq}: sintaxe valida`);
  } catch (e) {
    ok(false, `${arq}: erro de sintaxe`);
  }
}

fim();
