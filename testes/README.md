# Testes

Não há framework de teste — são scripts Node puros, sem dependência além do
Playwright (só para o smoke). Os testes de unidade **extraem o código real do
`index.html`** em vez de manter uma cópia, para não envelhecerem em silêncio.

Tudo isto roda automaticamente a cada push e pull request
(`.github/workflows/ci.yml`).

## Rodar

```bash
npm run teste             # escape + backup + guarda de regressão (segundos, sem dependência)
npm run versao:check      # a versão do service worker está em dia?

npm install               # só na primeira vez
npm run teste:navegador   # abre o app num Chromium de verdade
```

Ou individualmente:

| Arquivo | O que cobre |
|---|---|
| `escape.mjs` | `esc()` e `escJs()` — escape de HTML e de string dentro de `onclick` |
| `backup.mjs` | leitura tolerante, backup rotativo, cota estourada, migração de schema |
| `sync.mjs` | merge entre os dois aparelhos (veja abaixo) |
| `lint.mjs` | guarda de regressão (veja abaixo) |
| `smoke.mjs` | o app inteiro num navegador real |

## `sync.mjs` — ninguém pode perder entrega

Cada teste corresponde a uma forma concreta de perder dado que o app tinha
antes da Etapa 3:

- adições simultâneas nos dois aparelhos: as duas sobrevivem
- edição concorrente da mesma parada: vence a de carimbo mais novo
- alteração local ainda não enviada não é destruída por um snapshot que chega
- exclusão não ressuscita — e uma recriação posterior à exclusão volta
- parada vinda de uma versão antiga (sem `_upd`) não sobrescreve a carimbada
- o merge é idempotente e os dois lados convergem para o mesmo conjunto
- o carimbo só avança quando o conteúdo muda de verdade
- `null` no meio do array (buraco vindo do Realtime Database) não derruba nada

## `lint.mjs` — guarda de regressão

Não é lint de estilo. Cada regra existe porque o problema já esteve no código,
e a regra impede que ele volte sem ninguém notar:

- todo `<button>` tem `type` (sem ele, vira submit dentro de form)
- o viewport não bloqueia o zoom
- nenhum campo preenchido pelo cliente (`name`, `store`, `address`, `notes`, …)
  é interpolado em HTML sem `esc()` — pega tanto `${s.campo}` quanto a forma
  condicional `${s.campo? … }`
- `esc()` escapa os cinco caracteres
- o `install` do service worker **não** chama `skipWaiting()`, e o reload por
  `controllerchange` só acontece com atualização pedida pelo usuário
- Firebase, Nominatim e OSRM continuam na lista de nunca cachear
- todo bloco `<script>` inline tem sintaxe válida

Ele já pegou quatro vazamentos reais de escape que passaram na Etapa 1.

## `smoke.mjs` — navegador de verdade

Sobe um servidor estático na raiz e abre as páginas num Chromium. Verifica:

- o app carrega sem erro de JavaScript e as 7 telas existem
- um nome de cliente com `<img src=x onerror=...>` **não** executa nada
- aspas no nome da loja não quebram o `onclick` do fechamento
- o backup automático é criado e a restauração devolve as paradas
- `localStorage` corrompido não derruba o app
- `pedido.html`, `motoboy.html`, `fatura.html` e `offline.html` carregam
- `offline.html` não depende de nenhum recurso externo
- a faixa de "nova versão" existe, começa escondida e aparece quando chamada
- **o app abre offline, servido do cache** — e carrega o script completo,
  não uma página parcial
- com o servidor fora do ar, uma navegação nova cai no `offline.html`

Erros de rede (Firebase, fontes do Google) são esperados em ambiente isolado e
ficam filtrados — o teste só reprova por erro de código.

### Notas de ambiente

- Rodando como root em container, o Chromium às vezes cai no meio da suíte.
  O teste religa o navegador e tenta de novo; cada seção é isolada, então uma
  queda não apaga o resultado das outras.
- `ctx.setOffline()` corta a rede da **página**, não a do service worker — o
  `fetch` dele ainda chega ao servidor. Por isso o teste de queda de rede
  derruba o servidor de verdade em vez de usar o emulador de offline.
- Se o Chromium estiver fora do caminho padrão, aponte com
  `PLAYWRIGHT_CHROMIUM=/caminho/para/chrome`.
