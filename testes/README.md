# Testes

Não há framework de teste — são scripts Node puros, sem dependência além do
Playwright (só para o smoke). Os testes de unidade **extraem o código real do
`index.html`** em vez de manter uma cópia, para não envelhecerem em silêncio.

A automação no CI entra na Etapa 2 do roadmap. Por enquanto, rode à mão.

## Rodar

```bash
node testes/escape.mjs     # escape de HTML e de string JS (não precisa de nada)
node testes/backup.mjs     # persistência, rotação de backup e migração de schema

npm i playwright           # só na primeira vez, para o smoke
node testes/smoke.mjs      # abre o app num Chromium de verdade
```

O smoke sobe um servidor estático na raiz do repositório e abre as quatro
páginas num navegador real. Ele verifica, entre outras coisas:

- o app carrega sem erro de JavaScript e as 7 telas existem
- um nome de cliente com `<img src=x onerror=...>` **não** executa nada
- aspas no nome da loja não quebram o `onclick` do fechamento
- o backup automático é criado e a restauração devolve as paradas
- `localStorage` corrompido não derruba o app
- `pedido.html`, `motoboy.html` e `fatura.html` carregam

Erros de rede (Firebase, fontes do Google) são esperados em ambiente isolado e
são filtrados — o teste só reprova por erro de código.

Se o Chromium estiver fora do caminho padrão, aponte com
`PLAYWRIGHT_CHROMIUM=/caminho/para/chrome`.
