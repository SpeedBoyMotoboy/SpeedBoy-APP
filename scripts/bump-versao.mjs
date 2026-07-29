#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Grava em sw.js uma VERSION derivada do CONTEÚDO dos arquivos do app.

   Antes disso, a versão do cache era digitada à mão. Esquecer de subir
   significava celular instalado rodando código velho sem ninguém notar —
   e vários commits do histórico existem só para corrigir isso.

   Agora a versão é uma função do conteúdo: se nada mudou, ela não muda;
   se algo mudou, ela muda sozinha.

     node scripts/bump-versao.mjs            grava a versão
     node scripts/bump-versao.mjs --check    só confere (usado no CI)
   ═══════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SW   = path.join(RAIZ, 'sw.js');

/* Arquivos que, mudando, exigem que o app instalado receba a versão nova.
   O próprio sw.js fica de fora — senão a versão dependeria dela mesma. */
const RASTREADOS = [
  'index.html',
  'pedido.html',
  'motoboy.html',
  'fatura.html',
  'offline.html',
  'speedboy-firebase.js',
  'fatura-padrao.js',
  'manifest.json'
];

function calcularVersao() {
  const hash = crypto.createHash('sha256');
  for (const nome of RASTREADOS.sort()) {
    const caminho = path.join(RAIZ, nome);
    if (!fs.existsSync(caminho)) continue;
    hash.update(nome);
    hash.update(fs.readFileSync(caminho));
  }
  const data = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${data}-${hash.digest('hex').slice(0, 8)}`;
}

const RE_VERSION = /^const VERSION = '([^']*)';/m;

function lerVersaoAtual(src) {
  const m = src.match(RE_VERSION);
  if (!m) {
    console.error('ERRO: não achei a linha `const VERSION = \'...\';` em sw.js');
    process.exit(2);
  }
  return m[1];
}

const src   = fs.readFileSync(SW, 'utf8');
const atual = lerVersaoAtual(src);
const nova  = calcularVersao();

/* A data faz parte da versão só para leitura humana. Comparar apenas o
   hash evita que rodar o script em outro dia, sem mudar nada, acuse
   falsa diferença no CI. */
const hashDe = v => String(v).split('-').pop();
const igual  = hashDe(atual) === hashDe(nova);

if (process.argv.includes('--check')) {
  if (igual) {
    console.log(`ok   versão do service worker em dia (${atual})`);
    process.exit(0);
  }
  console.error(
    `FALHOU: os arquivos do app mudaram, mas a versão do service worker não foi atualizada.\n` +
    `  sw.js tem: ${atual}\n` +
    `  deveria:   ${nova}\n\n` +
    `  Rode:  node scripts/bump-versao.mjs   e faça commit do sw.js.\n\n` +
    `  Sem isso, os celulares com o app instalado continuam rodando a versão antiga.`
  );
  process.exit(1);
}

if (igual) {
  console.log(`nada a fazer — versão já em dia (${atual})`);
  process.exit(0);
}

fs.writeFileSync(SW, src.replace(RE_VERSION, `const VERSION = '${nova}';`));
console.log(`versão atualizada: ${atual} → ${nova}`);
