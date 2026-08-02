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
| `solicitacoes.mjs` | editar e cancelar pedido do cliente sem colisão |
| `fechamento.mjs` | histórico do dia e contagem de entregas (veja abaixo) |
| `nucleo.mjs` | `speedboy-core.js` — sobretudo: nenhum bairro se perdeu (veja abaixo) |
| `desfazer.mjs` | desfazer e confirmação (veja abaixo) |
| `lint.mjs` | guarda de regressão (veja abaixo) |
| `smoke.mjs` | o app inteiro num navegador real |

## `fechamento.mjs` — o número que vira fatura

Duas formas de o total sair errado, as duas achadas lendo o código. Nenhuma dá
erro, avisa ou aparece na tela — o número simplesmente sai diferente do que o
dia foi.

- `saveToHistory` **substituía** o dia em vez de fundir. Limpar a lista de manhã
  e de tarde apagava as entregas da manhã: **R$ 67 do dia viravam R$ 20**
- `getReportData` lê hoje de `stops` **e** de `history`; depois de um "limpar o
  dia" a mesma entrega estava nos dois e contava duas vezes: **R$ 30 viravam
  R$ 60**

Rodado contra o `index.html` de antes da correção, o teste reprova em 5
verificações com esses sintomas exatos. Cobre também o que a correção **não**
pode quebrar: três entregas distintas continuam somando, e parada ainda não
entregue continua fora do fechamento.

## `desfazer.mjs` — a lápide precisa sair junto

O teste mais importante do arquivo. Excluir uma parada grava um *tombstone*
(Etapa 3), e no merge ele vence toda versão mais antiga. Se o desfazer
restaurar a parada **sem apagar a lápide**, ela volta na tela e o próximo
snapshot do outro aparelho a mata de novo — o desfazer pareceria funcionar e se
desfaria sozinho segundos depois.

Cobre ainda: a lápide de *outra* parada não pode ser apagada junto; o retrato
não compartilha referência com o array vivo (senão o "antes" muda com o
"depois"); nenhum `confirm()` do navegador sobrou; toda ação destrutiva oferece
desfazer **ou** pede confirmação; e a confirmação resolve com "não" quando
fechada por fora, para não deixar a promessa pendurada.

## `nucleo.mjs` — nenhum bairro pode sumir

`CIDADE_BAIRROS` existia duas vezes, em formatos diferentes, e as duas cópias
divergiram: **93 bairros que o cliente conseguia escolher no `pedido.html` não
existiam na lista do app**. Ao editar a parada, o motoboy não achava o bairro
que o próprio cliente tinha informado.

Unificar só vale se nada se perder no caminho. O teste lê as **duas listas
originais direto do histórico do git** (`git show origin/main:index.html` e
`:pedido.html`) e compara cidade por cidade contra a lista de hoje. Reprova se
algum bairro sumir, e confere que os 93 do cliente realmente entraram.

Cobre também: formato único `{nome, bairros[]}`, os dois escopos de bairro
personalizado (o do app e o de cada loja) sem vazar um no outro, `fmtPhone(null)`
— que quebrava o `motoboy.html` — e a regra de que nenhuma página pode
*reimplementar* o que vem do núcleo (delegar é permitido; copiar não).

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
- nenhuma página redeclara a paleta (`:root{--bg…}`) — ela vem só do
  `speedboy.css` — e a paleta única passa em contraste AA (4,5:1) em todos os
  pares de texto sobre fundo, nos dois temas
- os ícones do PWA são PNG de verdade, do tamanho que o `manifest.json`
  promete, e por caminho relativo (URL absoluta quebra fora do domínio)
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
- o `speedboy-core.js` carrega e o seletor de bairro do app oferece nomes que
  antes só existiam na lista do cliente (`Caratoíra`, `Cobi de Baixo`, …)
- `--muted` chega na página vindo do `speedboy.css`
- excluir uma parada age em um toque, a barra de desfazer aparece dizendo o que
  saiu, e tocar em Desfazer devolve a parada **e apaga a lápide junto**
- a confirmação de apagar histórico abre dentro do app com os números reais, e
  fechá-la pelo botão voltar **não** executa a ação

Erros de rede (Firebase, fontes do Google) são esperados em ambiente isolado e
ficam filtrados — o teste só reprova por erro de código.

### Notas de ambiente

- Rodando como root em container, o Chromium às vezes cai no meio da suíte.
  O teste religa o navegador e tenta de novo; cada seção é isolada, então uma
  queda não apaga o resultado das outras.
- O `Content-Type` do servidor de teste não é detalhe: servido como
  `text/plain`, o navegador **recusa** o `speedboy.css` inteiro e a página abre
  sem paleta. Todo tipo de arquivo novo precisa entrar no mapa `TIPOS`.
- `ctx.setOffline()` corta a rede da **página**, não a do service worker — o
  `fetch` dele ainda chega ao servidor. Por isso o teste de queda de rede
  derruba o servidor de verdade em vez de usar o emulador de offline.
- Se o Chromium estiver fora do caminho padrão, aponte com
  `PLAYWRIGHT_CHROMIUM=/caminho/para/chrome`.
