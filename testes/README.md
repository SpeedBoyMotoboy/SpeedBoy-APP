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
| `documento.mjs` | folha fotografada → campos da parada, com os defeitos reais do OCR (veja abaixo) |
| `desfazer.mjs` | desfazer e confirmação (veja abaixo) |
| `config.mjs` | Config dobrável e primeiro uso (veja abaixo) |
| `full.mjs` | modo FULL: repasse, problema na entrega e autoria (veja abaixo) |
| `regras.mjs` | as regras do banco cobrem tudo que o app grava (veja abaixo) |
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

Cobre também a **correção de entrega já fechada**, que veio depois. Dava para
consertar o valor, e só na lista dos últimos 30 dias da inicial; nome errado não
tinha conserto em lugar nenhum. Como o fechamento vira fatura, nome trocado e
taxa zerada vão inteiros para o PDF que a loja recebe.

O caso mais delicado é a **troca de data**: a entrega precisa sair do dia em que
estava e entrar no dia certo, criando o dia se preciso e removendo o antigo se
ficou vazio — senão o total dos dois dias continua errado. E `getReportData`
passou a devolver `_bucket`/`_si`: a data que o fechamento MOSTRA (`_doneDate`)
pode não ser o dia em que a parada está guardada, e é o dia real que a correção
usa para encontrá-la de volta.

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

## `config.mjs` — a sala não troca em um toque

O botão "🔄 Novo" ficava ao lado de "📋 Copiar", mesmo tamanho e mesmo estilo,
sem confirmação nenhuma. Trocar o código **desconecta o outro celular em
silêncio**: os dois continuam funcionando, gravando em salas diferentes, sem
erro nenhum na tela — as listas simplesmente param de conversar.

O teste exige confirmação marcada como destrutiva, com a consequência escrita,
mais desfazer que volta ao código anterior (e que não é oferecido quando não há
sala anterior, porque não faria nada).

Cobre também a rolagem e o primeiro uso: as sete seções dobram pelo mesmo
mecanismo, com `<button>` e `aria-expanded` — o que se usa todo dia começa
aberto, o resto fechado, e a Sincronização abre sozinha quando não há sala.
E o código da sala passa a existir **antes** de a Config ser aberta: ele só
nascia dentro de `loadConfig()`, e num aparelho recém-instalado ninguém abriu a
Config ainda.

## `full.mjs` — a entrega que sai da sua mão

O repasse existia antes do modo FULL, mas terminava no link: o app gerava e não
voltava a olhar. Três buracos concretos, um por bloco de teste:

- o motoboy marcava **entregue** e a informação morria no nó do repasse. Quem
  despachou continuava vendo pendente, e o dia fechava sem aquela entrega
- travou na portaria? Não havia para onde mandar o problema. A entrega ficava
  parada e a loja descobria por telefone, horas depois
- com terceiro entregando, "foi entregue" deixou de ser resposta: a loja pergunta
  **quem foi, que horas e com quem ficou** — e o fechamento não tinha nenhuma

O teste mais importante é o do listener de confirmação. Ele dispara a cada toque
de **qualquer** motoboy; se gravasse sempre, cada snapshot viraria escrita, que
viraria outro snapshot — ping-pong infinito entre os aparelhos. O teste roda o
mesmo dado duas vezes e exige **zero** gravação na segunda.

Cobre ainda: `stopId` no repasse (sem ele a confirmação não acha o caminho de
volta); o WhatsApp da loja com queda para plantão e depois para o telefone da
fatura, para o motoboy nunca ficar sem destino; as mensagens prontas levando os
dados da entrega junto (sem isso quem recebe pergunta "qual entrega?" antes de
resolver); o problema gravado **antes** de abrir o WhatsApp — abrir tira o
navegador da frente e a aba costuma voltar recarregada; navegação com **um
destino por link**, o único formato que o Waze aceita; e o limite da foto do
comprovante batendo com o teto do `database.rules.json`, senão a gravação falha
depois de o motoboy já ter tirado a foto.

## `regras.mjs` — a recusa silenciosa do banco

`$desconhecido: {".validate": false}` recusa caminho não previsto, e é a regra
mais perigosa do arquivo: a recusa aparece no console do navegador e **não muda
nada na tela**.

Foi o que aconteceu com `tombs`, o caminho das exclusões — nunca esteve nas
regras. Publicadas, apagar uma parada num celular pararia de chegar no outro (ela
voltaria à lista no snapshot seguinte) e o `Promise.all` do `fbPush` rejeitaria em
toda gravação, deixando o ponto de sincronização travado em "⏳ Aguardando envio"
para sempre, mesmo com tudo enviado. Nenhum dos dois dá erro visível.

O teste normaliza os caminhos que as quatro páginas usam — eles aparecem
partidos, `'rooms/' + room + '/stops'` — e exige regra para cada um. Confere
também que toda regra tem teto de tamanho, que as travas de sessão e de formato
de sala continuam lá, e que o teto da foto do comprovante bate com o tamanho que
o `motoboy.html` gera (maior, a foto seria recusada depois de já ter sido tirada).

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

## `documento.mjs` — o que o OCR erra, e o que não pode errar

A aba Documento lê a folha "AUSÊNCIA DE CONTATO" que o escritório de advocacia
manda e monta a parada sozinha. O teste cobre a metade determinística
(`speedboy-documento.js`): **texto → campos**.

As folhas do teste são fictícias — o repositório é público e a folha real traz
nome, CPF e endereço de gente que não pediu para aparecer aqui. O que foi
copiado das fotos reais, e é o que faz o teste valer, são os **defeitos do
OCR**, um a um:

- o rótulo `CLIENTE:` sai ilegível (`| VE`, `so`, `SS. PRE`) **enquanto o nome
  ao lado sai perfeito** — daí o segundo caminho pela assinatura do fim da folha
- o timbre do escritório vira uma linha de texto logo acima do nome, candidata
  a ser lida como cliente
- o CPF ganha espaço no meio: `111.222 .333-44`, `...333-4 4` — e mesmo
  assim precisa ser reconhecido, **para ser descartado**
- o nome quebra no fim da linha e continua na de baixo
- o bairro vem abreviado (`Parque Res. de Tubarão`) ou sem o numeral que a
  lista oficial tem (`Vista da Serra` × `Vista da Serra I`)

Quatro regras valem por si:

- **o CPF não sai da folha.** Entregar não depende dele, então o app não o
  coleta: o número não volta no documento lido, não entra nas observações da
  parada e não chega ao `localStorage`. O que não é guardado não vaza. A
  assinatura do pé da folha (`Eu, FULANO, inscrito no CPF..., declaro`) fecha o
  bloco anterior — sem isso ela entrava inteira dentro do MOTIVO, com CPF e
  tudo —, e há ainda uma rede de segurança que apaga o número de qualquer texto
  devolvido, independente do layout da folha de amanhã.
- **o telefone do escritório nunca vira telefone do cliente.** O (27) 3065-3080
  está impresso em toda folha, dentro das observações. Sem descartá-lo, metade
  das paradas nasceria com o telefone do advogado — e o motoboy ligaria para o
  escritório parado na porta do cliente.
- **CPF não é telefone.** Os dois têm 11 dígitos. O que separa é o DDD (não
  existe DDD 07) e o 9 na frente do celular.
- **a folha virada tem de perder.** É assim que o app escolhe girar a foto: OCR
  barato nas quatro posições, fica a que reconhece mais rótulos. A folha de
  lado pontua zero.

Texto que não é folha — foto do chão, print de conversa, folha em branco — tem
de sair vazio e com confiança baixa. Entrar na lista com um nome inventado é
pior que não entrar.

### As cinco regressões vindas da tela

Estas não saíram de leitura de código: saíram do app em uso, com trinta e
tantas folhas já lidas. Cada uma é um jeito de o erro passar despercebido —
nome plausível mas errado, endereço que parece completo:

| O que chegou na lista | O que era | Por quê |
|---|---|---|
| `POR TE BRUNO ALVES DAS NEVE…` | `BRUNO ALVES DAS NEVES` | rótulo `CLIENTE:` comido pelo OCR; sobrou lixo na frente do nome |
| `co PR UR` | nome ilegível | idem — e o app inventava um nome em vez de admitir que não leu |
| `MARIANA CASTRO ROMANO- LARISSA CAS…` | cliente **e** responsável | o travessão vinha sem espaço antes |
| `RUA LAGOA AZUL 102` | rua + número 102 | a folha nem sempre põe vírgula antes do número |
| bairro `CHACARA nº 808` | número 808 | bairro não tem número — aquele era o da casa |
| bairro `Centro Estamos tentando contato para…` | bairro `Centro` | rótulo do MOTIVO sumiu e a prosa virou continuação do endereço |

Daí duas regras que valem por si: **nome que não convence sai vazio e marcado**
(inventar é pior que admitir), e **bairro nunca leva número**.

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

- o app carrega sem erro de JavaScript e as 8 telas existem
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
- a Config cabe em pouco mais de uma tela (o orçamento é 1100px; eram 1899px),
  cada seção fechada mostra um resumo do que tem dentro, e abrir uma guarda o
  estado
- um aparelho zerado mostra o campo do código da sala na **primeira** tela, com
  o próprio código já gerado; código malformado é recusado com aviso
- a aba Repasses só existe no modo FULL, mostra o andamento e o problema
  relatado, e desligar o modo estando nela devolve a pessoa para a inicial
- o fechamento avisa quantas entregas do período podem sair erradas na fatura
  (sem nome, sem valor, sem loja), corrigir uma delas tira o aviso e muda o
  total, salvar sem nome é recusado, desfazer devolve o nome anterior, e mudar
  a entrega de mês avisa antes de salvar
- o painel do motoboy com as taxas escondidas **continua** mostrando
  complemento, referência, bairro, janela de horário, loja, observação e
  telefone; nome de cliente com marcação não executa nada

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
