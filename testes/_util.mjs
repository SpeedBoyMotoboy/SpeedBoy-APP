import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function lerApp(arquivo = 'index.html') {
  return fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
}

/* Extrai um trecho literal do index.html para ser testado.
   Testamos o código que roda de verdade, não uma cópia que pode envelhecer. */
export function trecho(de, ate, arquivo = 'index.html') {
  const src = lerApp(arquivo);
  const i = src.indexOf(de);
  if (i < 0) throw new Error(`trecho não encontrado em ${arquivo}: ${de}`);
  const f = src.indexOf(ate, i);
  if (f < 0) throw new Error(`fim do trecho não encontrado em ${arquivo}: ${ate}`);
  return src.slice(i, f);
}

/* Caminho do Chromium. Deixe o Playwright resolver sozinho quando possível;
   PLAYWRIGHT_CHROMIUM define explicitamente em ambientes com browser fora do padrão. */
export function chromiumPath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (base && fs.existsSync(base)) {
    const dir = fs.readdirSync(base).find(d => d.startsWith('chromium-'));
    if (dir) {
      const p = path.join(base, dir, 'chrome-linux', 'chrome');
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;   // usa o download padrão do Playwright
}

export function criarPlacar() {
  let falhas = 0;
  return {
    ok(cond, rotulo) {
      console.log((cond ? 'ok   ' : 'FALHOU ') + rotulo);
      if (!cond) falhas++;
    },
    fim() {
      console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTodos os testes passaram');
      process.exit(falhas ? 1 : 0);
    }
  };
}
