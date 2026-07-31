#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Gera os ícones do PWA.

   Antes disto o manifest.json apontava os três tamanhos (48, 192 e 512)
   para o MESMO favicon.ico, por URL absoluta do GitHub Pages — e esse
   arquivo nem existe no repositório. Resultado: o Android instalava o app
   com um ícone genérico, e um `purpose: maskable` declarado sobre um .ico
   de 48px, que o sistema recorta e estica.

   Aqui os PNG são desenhados de verdade, em código, sem dependência
   nenhuma: o ambiente não tem ImageMagick nem Pillow, e o projeto não tem
   build. São ~150 linhas de encoder PNG contra uma dependência binária
   que alguém teria que reinstalar todo ano.

   Desenho: raio preto sobre o amarelo da marca (#f5c518, o mesmo
   theme_color). Amarelo sangrando até a borda porque ícone maskable é
   recortado pelo sistema em formato variável (círculo, squircle,
   losango) — só o miolo é garantido. O raio ocupa 52% do lado, dentro
   da zona segura de 80% que a especificação exige.

     node scripts/gerar-icones.mjs
   ═══════════════════════════════════════════════════════════════ */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const RAIZ  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SAIDA = path.join(RAIZ, 'icones');

const AMARELO = [0xf5, 0xc5, 0x18];
const PRETO   = [0x0a, 0x0a, 0x0a];

/* Raio, em coordenadas de 0 a 1 dentro do próprio desenho.
   Traçado em zigue-zague: desce pela esquerda, volta e desce de novo. */
const RAIO = [
  [0.60, 0.02], [0.19, 0.56], [0.44, 0.56],
  [0.37, 0.98], [0.81, 0.43], [0.55, 0.43]
];

// ── ponto dentro do polígono (ray casting) ────────────────────
function dentro(px, py, pol) {
  let d = false;
  for (let i = 0, j = pol.length - 1; i < pol.length; j = i++) {
    const [xi, yi] = pol[i], [xj, yj] = pol[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) d = !d;
  }
  return d;
}

/* Desenha o ícone em RGBA. Amostra 4x4 por pixel: sem isso a diagonal do
   raio fica serrilhada, e num ícone de 192px isso se vê. */
function desenhar(lado) {
  const AMOSTRAS = 4;
  const px = Buffer.alloc(lado * lado * 4);

  const escala = 0.52;                    // lado do raio / lado do ícone
  const desloc = (1 - escala) / 2;        // centraliza
  const pol = RAIO.map(([x, y]) => [x * escala + desloc, y * escala + desloc]);

  for (let y = 0; y < lado; y++) {
    for (let x = 0; x < lado; x++) {
      let acertos = 0;
      for (let sy = 0; sy < AMOSTRAS; sy++) {
        for (let sx = 0; sx < AMOSTRAS; sx++) {
          const u = (x + (sx + 0.5) / AMOSTRAS) / lado;
          const v = (y + (sy + 0.5) / AMOSTRAS) / lado;
          if (dentro(u, v, pol)) acertos++;
        }
      }
      const a = acertos / (AMOSTRAS * AMOSTRAS);
      const i = (y * lado + x) * 4;
      for (let c = 0; c < 3; c++) {
        px[i + c] = Math.round(AMARELO[c] * (1 - a) + PRETO[c] * a);
      }
      px[i + 3] = 255;                    // opaco: maskable não pode ter buraco
    }
  }
  return px;
}

// ── encoder PNG (RGBA, sem filtro) ────────────────────────────
const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pedaco(tipo, dados) {
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tam, corpo, crc]);
}

function png(lado, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8;      // 8 bits por canal
  ihdr[9] = 6;      // RGBA
  // 10,11,12 = compressão / filtro / entrelaçamento, todos 0

  // Cada linha leva um byte de filtro na frente; 0 = sem filtro.
  const linhas = Buffer.alloc(lado * (lado * 4 + 1));
  for (let y = 0; y < lado; y++) {
    const de = y * lado * 4;
    linhas[y * (lado * 4 + 1)] = 0;
    px.copy(linhas, y * (lado * 4 + 1) + 1, de, de + lado * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', zlib.deflateSync(linhas, { level: 9 })),
    pedaco('IEND', Buffer.alloc(0))
  ]);
}

// ── gera ──────────────────────────────────────────────────────
fs.mkdirSync(SAIDA, { recursive: true });
for (const lado of [192, 512, 180]) {          // 180 = apple-touch-icon
  const arquivo = path.join(SAIDA, `icone-${lado}.png`);
  const dados = png(lado, desenhar(lado));
  fs.writeFileSync(arquivo, dados);
  console.log(`icones/icone-${lado}.png  ${lado}x${lado}  ${(dados.length / 1024).toFixed(1)} KB`);
}
