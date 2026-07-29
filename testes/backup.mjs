/* Persistência tolerante a falha, backup automático rotativo e migração de schema.
   O código testado é extraído do index.html, não copiado. */
import { trecho, criarPlacar } from './_util.mjs';

const bloco = trecho('var SB_SCHEMA_VERSION', 'sbMigrate();');
const { ok, fim } = criarPlacar();

/* localStorage de mentira, com cota configurável para simular "sem espaço" */
function criarLS(cota = Infinity) {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { const k = [...m.keys()][i]; return k === undefined ? null : k; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    removeItem(k) { m.delete(k); },
    setItem(k, v) {
      v = String(v);
      let usado = 0;
      for (const [kk, vv] of m) if (kk !== k) usado += vv.length;
      if (usado + v.length > cota) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      m.set(k, v);
    }
  };
}

function carregar(ls) {
  const erros = [];
  const fn = new Function('localStorage', 'sbLogError',
    bloco + '\nreturn {sbRead,sbAutoBackup,sbListBackups,sbMigrate,sbBackupKeys,SB_BACKUP_DAYS,SB_SCHEMA_VERSION};');
  return { api: fn(ls, (origem) => erros.push(origem)), erros };
}

// ── 1. Leitura tolerante a dado corrompido ──
{
  const ls = criarLS();
  ls.setItem('sb_stops', '{{{ nao e json');
  const { api, erros } = carregar(ls);
  ok(JSON.stringify(api.sbRead('sb_stops', [])) === '[]', 'JSON corrompido devolve o fallback em vez de derrubar o app');
  ok(erros.length === 1, 'a corrupcao e registrada no log de erros');
  ok(api.sbRead('sb_inexistente', 'padrao') === 'padrao', 'chave ausente devolve o padrao');
  ls.setItem('sb_cfg', 'null');
  ok(JSON.stringify(api.sbRead('sb_cfg', {})) === '{}', 'valor null gravado devolve o fallback');
}

// ── 2. Um snapshot por dia, sem duplicar ──
{
  const ls = criarLS();
  ls.setItem('sb_stops', JSON.stringify([{ name: 'Ana' }]));
  const { api } = carregar(ls);
  api.sbAutoBackup(); api.sbAutoBackup(); api.sbAutoBackup();
  ok(api.sbBackupKeys().length === 1, 'chamadas repetidas no mesmo dia geram so uma copia');
  ok(api.sbListBackups()[0].paradas === 1, 'a copia guarda as paradas');
}

// ── 3. Nao gera copia de estado vazio ──
{
  const { api } = carregar(criarLS());
  api.sbAutoBackup();
  ok(api.sbBackupKeys().length === 0, 'app vazio nao gera copia inutil');
}

// ── 4. Rotacao mantem no maximo SB_BACKUP_DAYS ──
{
  const ls = criarLS();
  for (let d = 1; d <= 10; d++) {
    ls.setItem('sb_bkp_2026-07-' + String(d).padStart(2, '0'), JSON.stringify({ stops: [], history: [] }));
  }
  ls.setItem('sb_stops', JSON.stringify([{ name: 'Bia' }]));
  const { api } = carregar(ls);
  api.sbAutoBackup();
  const chaves = api.sbBackupKeys();
  ok(chaves.length === api.SB_BACKUP_DAYS, `rotacao mantem ${api.SB_BACKUP_DAYS} copias (achou ${chaves.length})`);
  ok(!chaves.includes('sb_bkp_2026-07-01'), 'a copia mais antiga e descartada primeiro');
  ok(chaves.includes('sb_bkp_2026-07-10'), 'as copias recentes sobrevivem');
}

// ── 5. Cota estourada: sacrifica antigas em vez de perder a copia de hoje ──
{
  const ls = criarLS(900);
  for (let d = 1; d <= 5; d++) {
    ls.setItem('sb_bkp_2026-07-0' + d, JSON.stringify({ stops: new Array(20).fill({ n: 1 }) }));
  }
  ls.setItem('sb_stops', JSON.stringify([{ name: 'Caio' }]));
  const { api } = carregar(ls);
  api.sbAutoBackup();
  const hoje = 'sb_bkp_' + new Date().toISOString().slice(0, 10);
  ok(ls.getItem(hoje) !== null, 'com a cota cheia, a copia de hoje ainda e gravada');
}

// ── 6. Migracao carimba a versao do schema ──
{
  const ls = criarLS();
  const { api } = carregar(ls);
  const esperada = String(api.SB_SCHEMA_VERSION);   // lido do código, não fixado aqui
  api.sbMigrate();
  ok(ls.getItem('sb_schema_version') === esperada, `sbMigrate grava a versao do schema (v${esperada})`);
  api.sbMigrate();
  ok(ls.getItem('sb_schema_version') === esperada, 'rodar de novo e idempotente');

  // Uma instalacao vinda de uma versao anterior sobe sem perder nada
  const antiga = criarLS();
  antiga.setItem('sb_schema_version', '1');
  antiga.setItem('sb_stops', JSON.stringify([{ name: 'Ana' }]));
  const { api: api2 } = carregar(antiga);
  api2.sbMigrate();
  ok(antiga.getItem('sb_schema_version') === esperada, 'instalacao antiga migra para a versao atual');
  ok(api2.sbRead('sb_stops', [])[0].name === 'Ana', 'a migracao nao mexe nas paradas existentes');
}

fim();
