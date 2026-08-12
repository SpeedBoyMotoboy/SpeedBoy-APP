# SpeedBoy

App de entregas do SpeedBoy. Quatro páginas, três públicos, sem build.

Este arquivo existe para responder **"onde é que eu mexo?"** sem precisar
abrir cinco arquivos para descobrir.

---

## O app não tem build

`index.html`, `pedido.html`, `motoboy.html`, `fatura.html` e os `.js` soltos
vão **crus** para o GitHub Pages. Não há empacotador, transpilador nem passo
de compilação: o que está no repositório é o que roda no celular.

Duas consequências que explicam quase todas as decisões estranhas do código:

- **os `.js` são scripts clássicos, não módulos.** Uma função declarada no
  topo de um deles fica no escopo global, e é assim que os `onclick=` do HTML
  a alcançam. Por isso `let`/`const` de topo **não** podem ser compartilhados
  entre arquivos — só `function`. É a razão de o script do `index.html` ainda
  ser um arquivo grande: `stops`, `history` e `cfg` são `let` e precisam ficar
  no mesmo escopo de quem os usa.
- **editar é publicar.** Qualquer commit na branch de produção chega nos
  celulares instalados na atualização seguinte. Daí a suíte de testes e o
  `sw.js` que nunca troca de versão sozinho.

```bash
npm install               # só na primeira vez (Playwright, para o smoke)
npm run teste             # segundos, sem navegador
npm run teste:navegador   # o app inteiro num Chromium de verdade
npm run versao            # regrava a VERSION do service worker
```

**Depois de mexer em qualquer arquivo do app, rode `npm run versao`.** Sem
isso o celular instalado continua servindo o código antigo do cache.

---

## As quatro páginas

| Página | Quem abre | Para quê |
|---|---|---|
| `index.html` | você | O app. Paradas, ganhos, fechamento, configuração. |
| `pedido.html` | as lojas | Pedem entrega por um link, acompanham o status, veem hora / quem recebeu / comprovante. |
| `motoboy.html` | os motoboys | Painel de um repasse: lista, rota, problema na entrega, confirmação com foto. |
| `fatura.html` | as lojas | Conferem uma fatura publicada e baixam o PDF. |

Nenhuma delas tem login. O que separa os dados é o **código da sala**
(`SB-XXXX`), que viaja no link.

---

## Arquivos compartilhados

| Arquivo | O que tem dentro |
|---|---|
| `speedboy.css` | **A paleta.** Cores e escalas (`--bg`, `--card`, `--accent`, `--radius`) das quatro páginas. Antes cada página tinha o seu `:root`, com os mesmos nomes e valores diferentes — o `--muted` do formulário reprovava contraste AA. Redeclarar a paleta em qualquer outro arquivo é regressão, e o `testes/lint.mjs` reprova. |
| `speedboy-app.css` | Estilos só do `index.html`. Saíram de um `<style>` de 472 linhas que ficava dentro dele. |
| `speedboy-core.js` | Dinheiro, telefone, cidades e bairros, tema, aviso rápido. Existe porque nove símbolos viviam duplicados entre as páginas e as cópias divergiram: 93 bairros que o cliente escolhia no `pedido.html` não existiam na lista do app. |
| `speedboy-graficos.js` | Os cinco gráficos de canvas. Não dependem do estado do app: recebem os dados apurados e devolvem um canvas. |
| `speedboy-firebase.js` | Configuração do Firebase e login anônimo. |
| `fatura-padrao.js` | Layout único de fatura e de fechamento em PDF (`speedboy.fatura/v1`), compartilhado entre o app e a página do cliente. |
| `sw.js` | Service worker: abre offline, e **nunca** troca de versão sozinho. A `VERSION` é gerada por `scripts/bump-versao.mjs` a partir do conteúdo — não edite à mão. |
| `manifest.json` | O app instalável de quem despacha. |
| `manifest-motoboy.json` | O painel instalável do motoboy. `start_url` diferente de propósito: repetido, um app substituiria o outro no aparelho. |
| `database.rules.json` | Regras do Realtime Database. Publicar exige a ordem de `ROLLOUT-SEGURANCA.md`. |

---

## Onde mexer no `index.html`

O script tem um **índice numerado** no começo. Procure por `§ 26` para cair
no fechamento, `§ 29` para o modo FULL, e assim por diante. Atalhos para o
que se procura mais:

| Quero mexer em… | Vá para |
|---|---|
| a lista de entregas na tela | `§ 12` |
| o formulário de nova parada | `§ 13` |
| taxa que se preenche sozinha | `§ 14` (KS) e `§ 15` (Aritana) |
| rota / Waze / Google Maps | `§ 17` e `§ 18` |
| o fechamento e o PDF | `§ 26`, `§ 27` |
| corrigir uma entrega antiga | `§ 25b` |
| o modo FULL e os repasses | `§ 29`, `§ 30`, `§ 31` |
| sincronizar entre os celulares | `§ 7` (merge) e `§ 35` (Firebase) |
| o que acontece ao abrir o app | `§ 43`, no fim do arquivo |

**`§ 43` é a única parte do arquivo em que a ordem das linhas muda o
comportamento.** O resto são declarações de função, que o JavaScript iça
para o topo — mover uma função de lugar é seguro; mover uma linha de
`§ 43`, não.

---

## Os dados

Tudo no `localStorage`, espelhado no Realtime Database por sala.

```
rooms/SB-XXXX/
  stops            lista de paradas do dia (string JSON)
  history          fechamento por dia
  tombs            exclusões, para uma parada apagada não ressuscitar
  pending          pedidos das lojas esperando aceite
  client_requests  pedidos de edição/cancelamento vindos da loja
  tracking         o que a loja vê: status, hora, quem recebeu, comprovante
  repass           um nó por repasse: as entregas de um motoboy
  proofs           foto do comprovante, por referência (nunca embutida)
  faturas          faturas publicadas para conferência
  location         última posição conhecida
```

Cada parada tem `_id` e `_upd`: identidade e carimbo da última alteração.
É o que permite os dois celulares mexerem na mesma lista sem uma adição
apagar a outra — ver `§ 7` e `testes/sync.mjs`.

---

## Testes

Não há framework. São scripts Node que **extraem o código real** dos HTML em
vez de manter uma cópia, para não envelhecerem em silêncio. Cada regra existe
porque o problema correspondente já esteve no código, e a explicação de cada
um está em [`testes/README.md`](./testes/README.md).

```bash
npm run teste             # unidade + guarda de regressão
npm run teste:navegador   # Chromium real: XSS, offline, navegação, instalação
npm run versao:check      # a versão do service worker está em dia?
```

Roda tudo a cada push e pull request (`.github/workflows/ci.yml`).
