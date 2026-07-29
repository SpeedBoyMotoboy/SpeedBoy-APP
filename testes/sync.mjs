/* Merge de sincronização entre os dois aparelhos.
   Antes, sincronizar era "quem escreveu por último venceu" e o listener
   fazia `stops = remote`. Cada teste aqui corresponde a uma forma concreta
   de perder entrega que existia no app.
   O código é extraído do index.html, não copiado. */
import { trecho, criarPlacar } from './_util.mjs';

const bloco = trecho('function hashCurto(str){', 'function saveStops()');

// mergeStops depende de sbRead/localStorage só através de getTombs, que
// recebemos pronto por parâmetro nos testes — aqui basta um localStorage inerte.
const lsFake = {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
  get length() { return 0; }, key: () => null
};
const { mergeStops, idDaParada, carimbarStops, hashCurto, conteudoDaParada } =
  new Function('localStorage', 'sbRead', 'stops',
    bloco + '\nreturn {mergeStops, idDaParada, carimbarStops, hashCurto, conteudoDaParada};'
  )(lsFake, (k, d) => d, []);

const { ok, fim } = criarPlacar();
const nomes = arr => arr.map(s => s.name).sort().join(',');

// ── 1. Adições simultâneas nos dois aparelhos ──────────────
{
  const local  = [{ _id: 'a', name: 'Ana',  _upd: 100 }];
  const remoto = [{ _id: 'b', name: 'Beto', _upd: 100 }];
  const r = mergeStops(local, remoto, {});
  ok(r.length === 2, `os dois lados sobrevivem (achou ${r.length})`);
  ok(nomes(r) === 'Ana,Beto', 'nenhuma das duas adições é perdida');
}

// ── 2. Edição concorrente da mesma parada: vence a mais nova ──
{
  const local  = [{ _id: 'a', name: 'Ana', value: '10', _upd: 200 }];
  const remoto = [{ _id: 'a', name: 'Ana', value: '25', _upd: 300 }];
  ok(mergeStops(local, remoto, {})[0].value === '25', 'edição remota mais nova prevalece');
  ok(mergeStops(remoto, local, {})[0].value === '25', 'e prevalece também na direção oposta');
}

// ── 3. Alteração local ainda não enviada não é destruída ──
// Este era o pior caso: chegava um snapshot e `stops = remote` apagava
// o que o motoboy tinha acabado de marcar.
{
  const local  = [{ _id: 'a', name: 'Ana', done: true,  _upd: 500 }];
  const remoto = [{ _id: 'a', name: 'Ana', done: false, _upd: 100 }];
  ok(mergeStops(local, remoto, {})[0].done === true,
    'marcação local recente sobrevive à chegada de um snapshot antigo');
}

// ── 4. Exclusão não ressuscita ─────────────────────────────
{
  const local  = [];
  const remoto = [{ _id: 'a', name: 'Ana', _upd: 100 }];
  ok(mergeStops(local, remoto, { a: 200 }).length === 0,
    'parada excluída depois da versão remota não volta');
  ok(mergeStops(local, remoto, { a: 50 }).length === 1,
    'mas uma versão remota MAIS NOVA que a exclusão volta (foi recriada)');
}

// ── 5. Dados de uma versão antiga do app (sem _upd) ────────
{
  const local  = [{ _id: 'a', name: 'Ana', value: '30', _upd: 900 }];
  const remoto = [{ _id: 'a', name: 'Ana', value: '10' }];          // sem carimbo
  ok(mergeStops(local, remoto, {})[0].value === '30',
    'parada sem _upd (app antigo) não sobrescreve a carimbada');
}

// ── 6. Identidade ──────────────────────────────────────────
{
  ok(idDaParada({ _id: 'x1' }) === 'x1', '_id é a identidade quando existe');
  ok(idDaParada({ _trackKey: 'k9' }) === 'tk_k9',
    '_trackKey vira identidade — entregas aceitas antes desta versão não duplicam');
  const s = { name: 'Ana', address: 'R 1' };
  ok(idDaParada(s) === idDaParada({ ...s }), 'sem id, a identidade é estável pelo conteúdo');
  ok(idDaParada(s) !== idDaParada({ name: 'Ana', address: 'R 2' }),
    'endereços diferentes geram identidades diferentes');
}

// ── 7. Ordem da lista (é a ordem da rota do dia) ───────────
{
  const local  = [{ _id: 'c', name: 'C', _upd: 1 }, { _id: 'a', name: 'A', _upd: 1 }];
  const remoto = [{ _id: 'a', name: 'A', _upd: 1 }, { _id: 'z', name: 'Z', _upd: 1 }];
  const r = mergeStops(local, remoto, {});
  ok(r[0].name === 'C' && r[1].name === 'A', 'a ordem local é preservada');
  ok(r[2].name === 'Z', 'o que só existe no remoto entra no fim');
}

// ── 8. Convergência: fundir de novo não muda nada ──────────
// Sem isto, dois aparelhos ficariam empurrando dados um para o outro sem parar.
{
  const local  = [{ _id: 'a', name: 'Ana', _upd: 100 }];
  const remoto = [{ _id: 'b', name: 'Beto', _upd: 200 }];
  const um   = mergeStops(local, remoto, {});
  const dois = mergeStops(um, um, {});
  ok(JSON.stringify(um) === JSON.stringify(dois), 'o merge é idempotente');
  const trocado = mergeStops(remoto, local, {});
  ok(nomes(um) === nomes(trocado), 'os dois aparelhos chegam ao mesmo conjunto');
}

// ── 9. Carimbo só avança quando o conteúdo muda ────────────
// Se avançasse a cada gravação, toda parada local pareceria mais nova
// que a do outro aparelho e o merge sempre daria empate a nosso favor.
{
  const arr = [{ name: 'Ana', value: '10' }];
  const api = new Function('localStorage', 'sbRead', 'stops',
    bloco + '\nreturn {carimbarStops, stops};')(lsFake, (k, d) => d, arr);
  api.carimbarStops();
  const id1 = arr[0]._id, upd1 = arr[0]._upd;
  ok(!!id1 && !!upd1, 'carimbarStops põe _id e _upd');

  api.carimbarStops();
  ok(arr[0]._upd === upd1, 'gravar sem mudar nada NÃO avança o carimbo');
  ok(arr[0]._id === id1, 'o id permanece o mesmo');

  arr[0].value = '20';
  api.carimbarStops();
  ok(arr[0]._upd >= upd1, 'mudar o valor avança o carimbo');
  ok(arr[0]._id === id1, 'mudar o conteúdo não troca a identidade');
}

// ── 10. Entradas inválidas não derrubam o merge ────────────
{
  ok(mergeStops(null, null, null).length === 0, 'null de ambos os lados devolve lista vazia');
  ok(mergeStops([{ _id: 'a', name: 'A' }], null, {}).length === 1, 'remoto ausente mantém o local');
  const sujo = mergeStops([{ _id: 'a', name: 'A' }, null, 'lixo'], undefined, {});
  ok(sujo.length === 1, 'itens inválidos no array são ignorados');
}

fim();
