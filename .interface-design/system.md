# SpeedBoy — sistema visual do app (index.html)

## Direção
Painel de moto à noite. Quem usa está em pé, capacete no braço, entre uma
entrega e outra: a tela diz em um olhar **qual é a próxima parada** e **o que
falta no dia**. Denso o bastante para caber o dia inteiro; alvos grandes
(48px+) porque o dedo pode estar de luva.

## Cores (tokens em `speedboy.css`, nunca redeclarar em outro arquivo)
- Superfícies: `--bg` → `--card` → `--card2`, um matiz só, degraus pequenos.
  Inputs usam `--campo` (um tom ABAIXO do card — afundados).
- Bordas: `--linha` (padrão) e `--linha-2` (ênfase/controles), translúcidas.
  `--border` sólido só para trilho/divisória.
- **Uma cor de ação: `--accent`** (amarelo de faixa de pista). Texto sobre ele:
  `--sobre-accent`.
- Estado, não enfeite: `--green` entregue/recebido · `--red` problema/perigo ·
  `--violeta` agendada · `--accent2` loja/repasse · `--blue` só navegação/links.
- Fundos tingidos: `--*-suave`.
- Texto em 4 níveis: `--text` · `--muted` (#aaa, testado AA) · `--apagado`
  (metadado curto) · desabilitado via `--apagado` em fundo `--card2`.

## Tipo
- Barlow Condensed 800 para números e títulos (placa de rua); Barlow para leitura.
- Escala 1,25 a partir de 14: 11 · 12 · 14 · 16 · 18 · 22 · 28 · 36.
- Título de tela 28px/800, sem emoji. Rótulo 11px/600 caixa-alta +0,6px.
- Dinheiro e contagem: `tabular-nums`.

## Espaço e forma
- Grade de 4px. Calha da tela 16px. Padding de cartão 14px.
- Raio: `--radius-sm` 10 (botões/inputs) · `--radius` 14 (cartões) ·
  `--radius-lg` 20 (folha de modal).
- Profundidade: borda translúcida + degrau de superfície. Sombra só no que
  flutua (toast, snack, lista de bairros).

## Assinatura: o trilho da rota
- Cada parada é um marco redondo numerado (`.stop-num`, 32px), ligado à
  vizinha por linha tracejada (`.stop-card + .stop-card::before`).
- A próxima acende: cartão `.prox` (borda amarela, marco cheio, "PRÓXIMA").
- Entregue: marco verde com ✓, cartão a 55%.
- Agendada: marco violeta.
- O resumo do dia (`#homeResumo`) repete o trilho em barra: um trecho por
  parada — verde feito, amarelo próxima.

## Componentes
- Botão primário — 52px · `--accent` · Condensed 800 18px (`.btn-add`, `.btn-pdf`, `.btn-folha`).
- Confirmação positiva — 52px · `--green` (`.btn-save`, `.btn-quick-done`).
- Ação de cartão — 48px · `--card2` + `--linha-2`, cor só no texto (`.btn-act`).
- Ação quieta — 44px, sem borda (`.btn-act-sec`, `.btn-texto`).
- Segmentado — trilho `--card` 3px, item ativo `--card2` + anel (`.sort-bar`, `.period-tabs`).
- Etiqueta — 12px/600, `--card2` cinza; cor só em loja, cobrar, data, repasse, problema (`.tag-*`).
- Estado de botão sempre por classe (`.on`), nunca `style=` no JS.
- Navegação: ícones SVG traço 1,8px; ativo = traço amarelo no topo + ícone amarelo.
- Barra de rota: encaixada, opaca, acima da navegação (nunca por cima da lista).
