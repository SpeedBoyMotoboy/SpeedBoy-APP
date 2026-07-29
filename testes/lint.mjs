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

// ── 8. Arquivos .js soltos ────────────────────────────────────
for (const arq of ['sw.js', 'speedboy-firebase.js', 'fatura-padrao.js', 'scripts/bump-versao.mjs']) {
  try {
    execFileSync(process.execPath, ['--check', path.join(RAIZ, arq)], { stdio: 'pipe' });
    ok(true, `${arq}: sintaxe valida`);
  } catch (e) {
    ok(false, `${arq}: erro de sintaxe`);
  }
}

fim();
