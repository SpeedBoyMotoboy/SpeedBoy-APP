/* ═══════════════════════════════════════════════════════════════
   Desfazer.

   O teste que mais importa aqui é o do tombstone. Excluir uma parada grava
   uma lápide (Etapa 3), e no merge a lápide vence toda versão mais antiga
   que ela. Se o desfazer restaurar a parada sem apagar a lápide junto, ela
   volta na tela — e o próximo snapshot vindo do outro aparelho a mata de
   novo. O desfazer pareceria funcionar e se desfaria sozinho segundos
   depois, que é o pior tipo de bug: o que devolve a confiança e depois
   tira.

   Como sempre, o código é EXTRAÍDO do index.html — não é cópia.
   ═══════════════════════════════════════════════════════════════ */
import { trecho, lerApp, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();

/* Sandbox: o desfazer mexe em `stops`, nas lápides e manda salvar.
   Guardamos o que foi salvo para poder verificar. */
function montar(paradas = []) {
  const ctx = {
    stops: JSON.parse(JSON.stringify(paradas)),
    _tombs: {},
    _salvou: 0,
    _renderizou: 0,
    getTombs() { return this._tombs; },
    saveTombs(t) { this._tombs = t; },
    saveStops() { this._salvou++; },
    renderHome() { this._renderizou++; },
    idDaParada(s) { return s._id || ('h_' + s.name); }
  };

  const fonte =
    trecho('function restaurarParadas(retrato){', '\n// Retrato das paradas', 'index.html') +
    trecho('function retratoParadas(){', '\n/* Limpar o dia', 'index.html');

  const fabrica = new Function('ctx', `with (ctx) { ${fonte}; return { restaurarParadas, retratoParadas }; }`);
  return { ctx, ...fabrica(ctx) };
}

// ── 1. A LÁPIDE PRECISA SAIR JUNTO ───────────────────────────
{
  const { ctx, restaurarParadas } = montar([{ _id: 'a', name: 'Cliente A' }]);
  const antes = JSON.parse(JSON.stringify(ctx.stops));

  // Simula o que o app faz ao excluir: some da lista e ganha lápide
  ctx.stops = [];
  ctx._tombs = { a: Date.now() };

  restaurarParadas(antes);

  ok(ctx.stops.length === 1 && ctx.stops[0]._id === 'a', 'a parada volta para a lista');
  ok(ctx._tombs.a === undefined,
    'a lápide da parada restaurada é apagada — sem isso o outro aparelho a mataria de novo');
  ok(ctx._salvou === 1, 'restaurar grava o estado novo');
}

// ── 2. Lápide de OUTRA parada não pode ser apagada ───────────
// Restaurar uma exclusão não pode ressuscitar as outras.
{
  const { ctx, restaurarParadas } = montar();
  ctx.stops = [];
  ctx._tombs = { a: 111, b: 222 };

  restaurarParadas([{ _id: 'a', name: 'Cliente A' }]);

  ok(ctx._tombs.a === undefined, 'a lápide da parada restaurada sai');
  ok(ctx._tombs.b === 222, 'a lápide de outra parada excluída CONTINUA lá');
}

// ── 3. O retrato não pode ser o próprio array ────────────────
/* Se retratoParadas() devolvesse a referência viva, o "antes" mudaria
   junto com o "depois" e o desfazer restauraria exatamente o estado que
   queria descartar. */
{
  const { ctx, retratoParadas } = montar([{ _id: 'a', name: 'Original' }]);
  const foto = retratoParadas();
  ctx.stops[0].name = 'Alterado depois';
  ctx.stops.push({ _id: 'b', name: 'Nova' });

  ok(foto.length === 1, 'o retrato não cresce quando a lista cresce');
  ok(foto[0].name === 'Original', 'o retrato guarda o valor de quando foi tirado');
}

// ── 4. Restaurar também não pode compartilhar referência ─────
{
  const { ctx, restaurarParadas } = montar();
  const retrato = [{ _id: 'a', name: 'Cliente A' }];
  restaurarParadas(retrato);
  ctx.stops[0].name = 'Mexido depois de restaurar';

  ok(retrato[0].name === 'Cliente A',
    'mexer na lista depois de restaurar não altera o retrato guardado');
}

// ── 5. A barra de desfazer é um componente próprio ───────────
/* O toast tem pointer-events:none e white-space:nowrap — não recebe toque
   e não cabe botão. Por isso o desfazer não podia ser um toast. */
{
  const src = lerApp('index.html');

  const toastCss = /\.toast\{([^}]*)\}/.exec(src);
  ok(!!toastCss && /pointer-events:\s*none/.test(toastCss[1]),
    'o toast continua sem receber toque (é aviso, não ação)');

  const snackCss = /\.snack\.show\{([^}]*)\}/.exec(src);
  ok(!!snackCss && /pointer-events:\s*auto/.test(snackCss[1]),
    'a barra de desfazer recebe toque quando visível');

  ok(/id="snackUndo"/.test(src), 'existe o botão Desfazer');
  ok(/role="status"/.test(src) && /aria-live="polite"/.test(src),
    'a barra é anunciada pelo leitor de tela sem roubar o foco');
}

// ── 6. A chance de desfazer some depois de usada ─────────────
{
  const src = lerApp('index.html');
  const corpo = trecho('function esconderDesfazer(){', '\nfunction desfazerAgora', 'index.html');
  ok(/_desfazerFn\s*=\s*null/.test(corpo),
    'esconder a barra descarta a ação — não dá para desfazer duas vezes');

  const agora = trecho('function desfazerAgora(){', '\n/* Restaura um retrato', 'index.html');
  ok(agora.indexOf('esconderDesfazer()') < agora.indexOf('fn()'),
    'desfazerAgora limpa o estado ANTES de executar (toque duplo não repete a ação)');
}

// ── 7. Nenhum confirm() nativo sobrou no código ──────────────
/* O confirm() do navegador não deixa dizer o que se perde, trava a thread
   e no Android abre um diálogo do sistema que não parece parte do app. */
{
  const semComentarios = lerApp('index.html')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
  const sobrou = semComentarios.match(/(?<![\w.])confirm\s*\(/g) || [];
  ok(sobrou.length === 0,
    `nenhum confirm() do navegador sobrou (${sobrou.length} encontrado(s))`);
}

// ── 8. Toda ação destrutiva tem saída ────────────────────────
/* Cada uma destas apagava dado. Três delas — delExpense, rmStore e
   rmQsAddr — não confirmavam NEM avisavam: você tocava e sumia. */
{
  const src = lerApp('index.html');
  const COM_DESFAZER = ['delStop', 'delExpense', 'rmStore', 'delLink', 'rmQuickStore', 'rmQsAddr'];
  const COM_CONFIRMACAO = ['clearDay', 'clearHist', 'rejectAll', 'importBackup', 'restoreAutoBackup'];

  for (const nome of COM_DESFAZER) {
    const m = new RegExp(`function ${nome}\\(([\\s\\S]{0,700}?)\\n\\}`).exec(src);
    ok(!!m && m[1].includes('comDesfazer('), `${nome}: oferece desfazer`);
  }
  for (const nome of COM_CONFIRMACAO) {
    const m = new RegExp(`function ${nome}\\(([\\s\\S]{0,1400}?)\\n\\}`).exec(src);
    ok(!!m && m[1].includes('confirmarAcao('), `${nome}: pede confirmação`);
  }
}

// ── 9. A confirmação não pode ficar pendurada ────────────────
/* Se a confirmação sumir pelo botão voltar sem resolver a promessa, quem
   chamou espera para sempre: a ação nunca acontece nem é cancelada. */
{
  const corpo = trecho('function _mostrarModal(id, mostrar){', '\nfunction abrirModal', 'index.html');
  ok(corpo.includes('confirmModal') && /resolve\(false\)/.test(corpo),
    '_mostrarModal resolve a confirmação com "não" quando o modal é fechado por fora');
}

fim();
