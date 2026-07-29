/* Escape de HTML e de string JS — as duas defesas contra dados de cliente
   que chegam por pedido.html e acabam dentro de innerHTML.
   O código testado é extraído do index.html, não copiado. */
import { trecho, criarPlacar } from './_util.mjs';

const bloco = trecho('function esc(s){', 'function parseDate(');
const { esc, escJs } = new Function(bloco + '\nreturn {esc, escJs};')();

const { ok, fim } = criarPlacar();
const eq = (got, want, label) => {
  const bate = got === want;
  ok(bate, label + (bate ? '' : `\n     recebeu:  ${got}\n     esperava: ${want}`));
};

// ── esc(): contexto HTML ──
eq(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;', 'tag de XSS e neutralizada');
eq(esc('Padaria "Pao & Cia"'), 'Padaria &quot;Pao &amp; Cia&quot;', 'aspas e E comercial escapados');
eq(esc("O'Brien"), 'O&#39;Brien', 'apostrofo escapado');
eq(esc('&lt;'), '&amp;lt;', 'o E comercial e escapado primeiro, sem escape duplo invertido');
eq(esc(null), '', 'null vira string vazia');
eq(esc(undefined), '', 'undefined vira string vazia');
eq(esc(0), '0', 'zero e preservado (o esc antigo transformava em vazio)');
eq(esc(false), 'false', 'false e preservado');
eq(esc('texto normal'), 'texto normal', 'texto sem caractere especial passa intacto');

// ── escJs(): string JS dentro de atributo inline ──
// O navegador decodifica a entidade HTML ANTES de o JS ser interpretado.
// Simulamos essa decodificacao para conferir o literal que o JS realmente recebe.
const htmlDecode = s => s
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

const casos = [
  "KS'; alert(1); //",                   // injecao classica
  "KS' ); window.x=1; //",               // fechando a chamada da funcao
  'Pao & Cia',
  'a"b',
  'linha1\nlinha2',
  'C:\\temp',
  '</scr' + 'ipt><scr' + 'ipt>alert(1)</scr' + 'ipt>'
];

for (const nome of casos) {
  const attr = `onclick="fn('${escJs(nome)}')"`;
  const jsCode = htmlDecode(attr.slice('onclick="'.length, -1));   // vira: fn('...')
  let capturado = null;
  const fn = v => { capturado = v; };
  try {
    eval(jsCode);
    eq(capturado, nome, `escJs entrega o valor intacto: ${JSON.stringify(nome)}`);
  } catch (e) {
    ok(false, `escJs gerou JS invalido para ${JSON.stringify(nome)}: ${e.message}`);
  }
}

fim();
