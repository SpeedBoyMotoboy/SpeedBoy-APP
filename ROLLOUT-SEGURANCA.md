# Endurecimento do Firebase — ordem de aplicação

O código desta etapa **já faz login anônimo**, mas de forma tolerante: se o login
falhar, o app continua funcionando com as regras permissivas que estão publicadas
hoje. Isso é proposital — permite subir o código primeiro e apertar as regras
depois, sem janela em que o app fica fora do ar.

Siga a ordem abaixo. **Não pule para o passo 3 antes de confirmar o passo 2.**

---

## Passo 1 — Subir o código (já feito nesta etapa)

Nada a fazer no console. Após o deploy, o app, `pedido.html`, `motoboy.html` e
`fatura.html` passam a tentar `signInAnonymously()` antes de tocar no banco.

Enquanto o passo 2 não for feito, esse login vai falhar e aparecer no console do
navegador como:

```
Login anônimo falhou (seguindo mesmo assim): FirebaseError: auth/admin-restricted-operation
```

Isso é esperado nesta janela. O app continua funcionando normalmente.

---

## Passo 2 — Habilitar o login anônimo no Firebase

1. Abra <https://console.firebase.google.com> → projeto **speedboy-3c1c6**
2. Menu lateral: **Build → Authentication**
3. Aba **Sign-in method**
4. Em "Provedores adicionais", escolha **Anônimo** → **Ativar** → **Salvar**

### Como confirmar que funcionou

Abra o app no celular ou no navegador, abra o console (ou apenas recarregue) e
confirme que a mensagem de falha **sumiu**. Em **Authentication → Users** deve
começar a aparecer usuário anônimo conforme os aparelhos abrirem o app.

Confirme nos quatro:

- [ ] `index.html` — o app principal sincroniza e o ponto de sincronização fica verde
- [ ] `pedido.html` — abrir um link de loja e enviar um pedido de teste
- [ ] `motoboy.html` — abrir um link de repasse
- [ ] `fatura.html` — abrir um link de fatura publicada

**Só avance quando os quatro estiverem confirmados.** Se algum falhar, pare — as
regras do passo 3 vão bloquear exatamente esse caminho.

---

## Passo 3 — Publicar as regras do banco

Só depois do passo 2 confirmado.

1. Console → **Build → Realtime Database** → aba **Regras**
2. **Antes de colar, copie as regras atuais** para um bloco de notas — é o seu
   caminho de volta
3. Cole o conteúdo de [`database.rules.json`](./database.rules.json), removendo a
   chave `_comentario` (o editor do console aceita JSON com ela, mas ela não faz
   nada além de documentar)
4. **Publicar**

### O que as regras passam a exigir

| Regra | Efeito |
|---|---|
| `auth != null` | Ninguém sem sessão lê ou escreve. Antes, qualquer um com a URL do banco tinha acesso total. |
| `$room.matches(/^SB-[A-Z0-9]{4}$/)` | Só salas no formato real. Impede criar lixo em caminhos inventados. |
| `.read`/`.write` = `false` na raiz | Nada fora de `rooms/` é acessível. |
| `newData.isString()` + teto de tamanho | O app grava tudo como string JSON; qualquer outro formato é recusado, e há limite de tamanho por caminho. |
| `$desconhecido: {".validate": false}` | Caminhos novos não previstos são recusados em vez de aceitos em silêncio. |

> **Republicar ao ativar o modo FULL.** As regras ganharam o caminho `proofs`,
> onde o `motoboy.html` grava a foto do comprovante. Como `$desconhecido` recusa
> tudo que não está previsto, uma sala rodando as regras antigas **rejeita a
> gravação da foto** — a entrega é registrada, mas o comprovante não sobe. Se for
> usar a foto no comprovante, republique as regras deste arquivo antes.

### Se algo quebrar

Volte ao editor de regras e republique as regras antigas que você copiou no
item 2. O efeito é imediato — não precisa fazer deploy de código.

---

## O que isto ainda **não** resolve

Seja claro sobre o limite desta etapa: o login é **anônimo**, então qualquer
pessoa consegue obter uma sessão. O que as regras impedem é acesso *sem sessão
nenhuma*, escrita em caminhos inválidos e entulho no banco. **Quem tiver o código
da sala continua tendo acesso aos dados daquela sala.**

O `uid` anônimo agora disponível (`fbUid` no `index.html`) é o gancho para, no
futuro, promover a sessão para conta real e amarrar cada sala a um dono — sem
migrar dados, porque o `uid` já estará lá.
