/* ═══════════════════════════════════════════════════════════════
   SpeedBoy — service worker

   Duas regras que guiam este arquivo:

   1. O app nunca troca de versão sozinho. O SW novo instala e ESPERA.
      Quem decide a hora é o motoboy, tocando em "Atualizar" na faixa —
      porque a versão anterior recarregava a página sozinha, inclusive no
      meio do preenchimento de uma parada.

   2. A casca do app é servida do cache primeiro. O app abre instantâneo
      mesmo sem sinal, e a rede atualiza o cache em segundo plano.

   A constante VERSION é gerada por scripts/bump-versao.mjs a partir do
   conteúdo dos arquivos — não edite à mão.
   ═══════════════════════════════════════════════════════════════ */

const VERSION = '20260808-ed20c0d9';                       // gerado por scripts/bump-versao.mjs
const CACHE   = 'speedboy-' + VERSION;

// Casca do app: o que precisa estar disponível para abrir offline.
/* motoboy.html e o manifesto dele entram aqui porque o painel do motoboy
   também é instalável, e instalado ele precisa abrir sem sinal. O custo é
   que o cache é um só e compartilhado: o celular do motoboy guarda também
   a casca do app de quem despacha. Um service worker só pode controlar
   este caminho, então não há como separar as duas listas. */
const SHELL = [
  './index.html',
  './motoboy.html',
  './manifest.json',
  './manifest-motoboy.json',
  './speedboy-firebase.js',
  './speedboy-core.js',
  './speedboy-graficos.js',
  './speedboy.css',
  './speedboy-app.css',
  './fatura-padrao.js',
  './fatura.html',
  './offline.html',
  './icones/icone-192.png',
  './icones/icone-512.png',
  './icones/icone-180.png'
];

/* Hosts cujas respostas NUNCA podem ir para o cache: são dados vivos.
   Cachear uma resposta do Firebase é o caminho para mostrar entrega
   errada, ou uma rota calculada para o trajeto de ontem. */
const NUNCA_CACHEAR = [
  'firebaseio.com',
  'firebasedatabase.app',
  'googleapis.com',
  'identitytoolkit',
  'nominatim.openstreetmap.org',
  'router.project-osrm.org',
  'wa.me'
];

const ehDinamico = url => NUNCA_CACHEAR.some(h => url.includes(h));

// ── INSTALL ────────────────────────────────────────────────────
// Sem skipWaiting(): o SW novo fica em waiting até o usuário mandar trocar.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      // allSettled: um arquivo que falhe não pode abortar a instalação inteira
      Promise.allSettled(SHELL.map(url => c.add(url)))
    )
  );
});

// ── ACTIVATE ───────────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('speedboy-') && k !== CACHE)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── MENSAGENS DA PÁGINA ────────────────────────────────────────
self.addEventListener('message', e => {
  const tipo = e.data && e.data.type;
  if (tipo === 'SKIP_WAITING') {
    // O usuário tocou em "Atualizar": agora sim assume o controle.
    self.skipWaiting();
  } else if (tipo === 'QUAL_VERSAO' && e.ports && e.ports[0]) {
    e.ports[0].postMessage({ versao: VERSION });
  }
});

// ── ESTRATÉGIAS ────────────────────────────────────────────────

/* Stale-while-revalidate: devolve o cache na hora e atualiza atrás.
   A versão anterior deste arquivo tentava fazer isto mas escrevia
   `return network || cached` — como `network` é uma Promise (sempre
   truthy), o cache só era usado quando a rede REJEITAVA. Na prática era
   network-first: cada abertura do app esperava a rede responder. */
async function staleWhileRevalidate(req) {
  const cache  = await caches.open(CACHE);
  const cached = await cache.match(req);

  const rede = fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  if (cached) return cached;                 // instantâneo

  const res = await rede;
  if (res) return res;
  throw new Error('sem rede e sem cache');
}

/* Network-first para o resto do mesmo domínio: prefere o dado fresco,
   mas cai no cache quando a rede falha. */
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw e;
  }
}

// ── FETCH ──────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // Dados vivos passam direto, sem tocar no cache
  if (ehDinamico(url)) return;

  const mesmaOrigem = url.startsWith(self.location.origin);

  // Navegação (abrir o app / uma página): cache primeiro, offline.html
  // como último recurso para não cair na tela de dinossauro do navegador.
  if (req.mode === 'navigate') {
    e.respondWith(
      staleWhileRevalidate(req).catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match('./offline.html'))
            || new Response('Você está offline.', {
                 status: 503,
                 headers: { 'Content-Type': 'text/plain; charset=utf-8' }
               });
      })
    );
    return;
  }

  if (!mesmaOrigem) return;                  // fontes, SDKs: deixa o navegador cuidar

  // Casca do app: cache primeiro
  const caminho = new URL(url).pathname.split('/').pop() || 'index.html';
  const ehShell = SHELL.some(s => s.replace('./', '') === caminho);

  e.respondWith(ehShell ? staleWhileRevalidate(req) : networkFirst(req));
});

// ── NOTIFICAÇÕES ───────────────────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(ws => {
      if (ws.length) return ws[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
