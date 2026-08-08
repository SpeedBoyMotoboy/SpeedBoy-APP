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
/* Os estilos do app saíram de um <style> de 472 linhas dentro do
   index.html. Regra que fala de CSS agora olha o arquivo. */
const CSS_APP = lerApp('speedboy-app.css');

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
    ok(CSS_APP.includes(`.sync-dot.${estado}{`), `existe estilo para o estado "${estado}" do ponto de sincronização`);
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
  ok(/\.bottom-nav\{[^}]*safe-area-inset-bottom/.test(CSS_APP),
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
  /* speedboy-app.css entra na lista porque os estilos do app saíram do
     index.html para lá: sem isso, a regra deixaria de cobrir justamente o
     arquivo onde a paleta duplicada voltaria a ser escrita. */
  const APP = ['index.html', 'pedido.html', 'motoboy.html', 'speedboy-app.css'];

  for (const arq of APP) {
    const src = lerApp(arq);
    if (arq.endsWith('.html')) {
      ok(/<link[^>]+href=["']speedboy\.css["']/.test(src),
        `${arq}: carrega o speedboy.css`);
    }
    // Basta procurar um :root que declare --bg: é a assinatura da paleta.
    const local = /:root\s*\{[^}]*--bg\s*:/.test(src) || /body\.light\s*\{[^}]*--bg\s*:/.test(src);
    ok(!local, `${arq}: não redeclara a paleta localmente`);
  }

  /* A ordem dos <link> não é detalhe: speedboy-app.css usa os tokens que o
     speedboy.css declara. Invertida, o app abre sem cor nenhuma. */
  {
    const idx = lerApp('index.html');
    ok(idx.indexOf('href="speedboy.css"') < idx.indexOf('href="speedboy-app.css"'),
      'index.html: a paleta é carregada ANTES dos estilos que a usam');
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
  /* Dois manifestos: o do app de quem despacha e o do painel do motoboy.
     As mesmas regras valem para os dois — é o mesmo Android lendo. */
  const MANIFESTOS = ['manifest.json', 'manifest-motoboy.json'];
  const starts = new Set();

  for (const nome of MANIFESTOS) {
    const man = JSON.parse(fs.readFileSync(path.join(RAIZ, nome), 'utf8'));

    const remotos = man.icons.filter(i => /^https?:/i.test(i.src));
    ok(remotos.length === 0,
      `${nome}: nenhum ícone por URL absoluta` +
      (remotos.length ? ` — ${remotos.map(i => i.src).join(', ')}` : ''));

    ok(man.icons.some(i => String(i.purpose || '').includes('maskable')),
      `${nome}: existe ícone maskable (o Android recorta em formato próprio)`);

    for (const icone of man.icons) {
      const arq = path.join(RAIZ, icone.src.replace(/^\.\//, ''));
      if (!fs.existsSync(arq)) { ok(false, `${nome}: ${icone.src} não existe`); continue; }
      const buf = fs.readFileSync(arq);
      const assinatura = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      // Largura e altura vivem no IHDR, sempre nos bytes 16..24 de um PNG.
      const larg = buf.readUInt32BE(16), alt = buf.readUInt32BE(20);
      const pedido = Number(String(icone.sizes).split('x')[0]);
      ok(assinatura && larg === pedido && alt === pedido,
        `${nome} · ${icone.src}: PNG ${pedido}x${pedido} de verdade (tem ${larg}x${alt})`);
    }

    /* O start_url é a identidade do app instalado quando não há `id`. Dois
       manifestos com o mesmo start_url viram o MESMO aplicativo para o
       Android: instalar o painel do motoboy substituiria o app de quem
       despacha no aparelho, em silêncio. */
    ok(!starts.has(man.start_url),
      `${nome}: start_url próprio (${man.start_url}) — start_url repetido faz um app substituir o outro`);
    starts.add(man.start_url);

    const alvo = path.join(RAIZ, String(man.start_url).replace(/^\.\//, ''));
    ok(fs.existsSync(alvo), `${nome}: start_url aponta para um arquivo que existe`);
  }

  // Instalado, o app precisa da casca no cache — senão abre em branco offline
  {
    const sw = fs.readFileSync(path.join(RAIZ, 'sw.js'), 'utf8');
    const shell = sw.slice(sw.indexOf('const SHELL'), sw.indexOf('];', sw.indexOf('const SHELL')));
    for (const arq of ['index.html', 'motoboy.html', 'manifest.json', 'manifest-motoboy.json']) {
      ok(shell.includes(arq), `sw.js: ${arq} está na casca cacheada (o app instalado abre sem sinal)`);
    }
  }

  // Convite para instalar: sem ele o navegador só oferece num menu escondido
  {
    for (const [arq, fn] of [['index.html', 'instalarApp'], ['motoboy.html', 'instalarApp']]) {
      const src = lerApp(arq);
      ok(src.includes('beforeinstallprompt'), `${arq}: captura o beforeinstallprompt do Android`);
      ok(new RegExp(`function ${fn}\\(`).test(src), `${arq}: tem o botão de instalar`);
      /* iPhone não dispara beforeinstallprompt. Sem um caminho escrito, o
         botão simplesmente não faria nada em todo iOS. */
      ok(/Adicionar à Tela de Início/.test(src),
        `${arq}: ensina o caminho do iPhone (lá não existe diálogo nativo)`);
    }
    ok(/rel="manifest" href="\.\/manifest-motoboy\.json"/.test(lerApp('motoboy.html')),
      'motoboy.html: aponta para o manifesto próprio, não para o do app principal');
  }

  // O apple-touch-icon é lido do HTML, não do manifest.
  const idx = lerApp('index.html');
  const apple = /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/.exec(idx);
  ok(!!apple && !/^https?:/i.test(apple[1]) && fs.existsSync(path.join(RAIZ, apple[1].replace(/^\.\//, ''))),
    'index.html: apple-touch-icon aponta para um arquivo local existente');
}

// ── 7d. O índice das seções não pode apodrecer ────────────────
/* O script do index.html tem 4.400 linhas porque o app não tem build. O que
   dá para ter é um índice — e um índice desatualizado é pior que nenhum:
   manda a pessoa para a seção errada e ela conclui que o mapa não serve.

   Estas regras exigem que numeração e índice andem juntos. Renomear uma
   seção ou acrescentar outra sem mexer no índice reprova aqui. */
{
  const src = lerApp('index.html');

  // Banners: `§ N — Título`, na ordem em que aparecem no arquivo
  const banners = [...src.matchAll(/§ (\d+) — (.+)$/gm)]
    .map(m => ({ n: Number(m[1]), titulo: m[2].trim() }));

  ok(banners.length > 20,
    `o script está seccionado (achou ${banners.length} seções)`);

  // O índice fica no topo do próprio script, antes da primeira seção
  const inicioIndice = src.indexOf('ÍNDICE DAS SEÇÕES');
  ok(inicioIndice > 0, 'existe um índice das seções no começo do script');
  const indice = src.slice(inicioIndice, src.indexOf('§ 1 —', inicioIndice));

  /* Numeração sequencial na ordem do arquivo. Pulo ou repetição fazem o
     "procure por § 26" cair no lugar errado. */
  const foraDeOrdem = banners.filter((b, i) => b.n !== i + 1);
  ok(foraDeOrdem.length === 0,
    'as seções são numeradas em sequência, na ordem do arquivo' +
    (foraDeOrdem.length ? ` — primeira divergência: § ${foraDeOrdem[0].n} ("${foraDeOrdem[0].titulo}") na posição ${banners.indexOf(foraDeOrdem[0]) + 1}` : ''));

  /* Todo banner está listado no índice. Compara pelo começo do título:
     o índice usa caixa e pontuação próprias, mas a primeira palavra
     significativa tem de bater. */
  const normal = t => t.toLowerCase().replace(/[^a-zà-ú0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim();
  const semIndice = banners.filter(b => {
    const chave = normal(b.titulo).split(' ').slice(0, 2).join(' ');
    return !normal(indice).includes(chave);
  });
  ok(semIndice.length === 0,
    'toda seção aparece no índice' +
    (semIndice.length ? ` — faltando: ${semIndice.map(b => '§ ' + b.n + ' ' + b.titulo).join('; ')}` : ''));

  // E o índice não lista seção que não existe mais
  const numerosIndice = [...indice.matchAll(/§ (\d+)\s/g)].map(m => Number(m[1]));
  const inexistentes = numerosIndice.filter(n => !banners.some(b => b.n === n));
  ok(inexistentes.length === 0,
    'o índice não aponta para seção que não existe' +
    (inexistentes.length ? ` — sobrando: § ${inexistentes.join(', § ')}` : ''));

  /* O README é o mapa de quem chega no projeto: se ele cita um arquivo que
     não existe, manda a pessoa procurar no lugar errado. */
  const readme = lerApp('README.md');
  const citados = [...readme.matchAll(/`([\w.-]+\.(?:html|css|js|json|mjs))`/g)].map(m => m[1]);
  const sumidos = [...new Set(citados)].filter(f =>
    !fs.existsSync(path.join(RAIZ, f)) &&
    !fs.existsSync(path.join(RAIZ, 'testes', f)) &&
    !fs.existsSync(path.join(RAIZ, 'scripts', f)));
  ok(sumidos.length === 0,
    'README.md: todo arquivo citado existe' +
    (sumidos.length ? ` — não achei: ${sumidos.join(', ')}` : ''));
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
