/* Leitura da folha fotografada (speedboy-documento.js).

   As folhas de teste NÃO são as folhas de verdade. O repositório é
   público e a folha real traz nome, CPF e endereço de gente que não
   pediu para aparecer no GitHub — o que está aqui é fictício.

   O que foi copiado do original, e é o que faz o teste valer, são os
   DEFEITOS do OCR, um por um, medidos nas fotos reais:

   • o rótulo "CLIENTE:" sai ilegível ("| VE", "so", "SS. PRE") enquanto
     o nome do cliente na mesma linha sai perfeito;
   • o timbre do escritório vira uma linha de texto ("MM FERNANDO
     MIRANDA") logo acima do nome, candidata a ser lida como cliente;
   • o CPF ganha espaço no meio: "147.267 .777-73", "...067-4 6" — e
     mesmo assim precisa ser reconhecido, para ser descartado;
   • o nome quebra no meio da linha e continua na de baixo;
   • o telefone do escritório está impresso em TODA folha;
   • o CEP tem 8 dígitos e o CPF 11, iguais em forma a telefone;
   • o bairro vem abreviado ("Parque Res. de Tubarão") ou sem o numeral
     que a lista oficial tem ("Vista da Serra" x "Vista da Serra I").

   Cada caso abaixo é um desses defeitos, não um exemplo bonito. */
import fs from 'fs';
import path from 'path';
import { RAIZ, criarPlacar } from './_util.mjs';

const { ok, fim } = criarPlacar();

// Carrega núcleo + leitor do jeito que o navegador carrega
const janela = { localStorage: (() => {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) };
})() };
for (const arq of ['speedboy-core.js', 'speedboy-documento.js']) {
  new Function('window', 'localStorage', 'document',
    fs.readFileSync(path.join(RAIZ, arq), 'utf8')
  )(janela, janela.localStorage, undefined);
}
const doc = janela.SpeedBoy.doc;
ok(!!doc && typeof doc.lerDocumento === 'function', 'speedboy-documento.js expõe SpeedBoy.doc');

// ── FOLHAS FICTÍCIAS, DEFEITOS REAIS ─────────────────────────
const FOLHAS = [
  {
    nome: 'folha limpa, nome quebrado em duas linhas',
    texto: `AUSÊNCIA DE CONTATO
CLIENTE: JOANA PEREIRA DOS REIS — MARTA PEREIRA DA
COSTA REIS
TELEFONE DO CONTRATO: (27) 9818-91234
ENDEREÇO DO CONTRATO: RUA GOVERNADOR
VALADARES, 14, 29171-727, PARQUE RESIDENCIAL DE
TUBARÃO.
MOTIVO DO CONTATO: Processo Previdenciário
Estamos tentando contato para conseguir o laudo e o cadunico.
OBSERVAÇÕES: É MUITO IMPORTANTE QUE ENTRE EM
CONTATO COM O ESCRITORIO O MAIS RAPIDO POSSIVEL
(27)3065-3080.
Eu, MARTA PEREIRA DA COSTA REIS, inscrito no CPF: 111.222.333-44,
declaro que estou ciente/recebi as informações acima.`,
    espera: {
      cliente: 'JOANA PEREIRA DOS REIS',
      responsavel: 'MARTA PEREIRA DA COSTA REIS',
      telefones: ['27981891234'],
      rua: 'RUA GOVERNADOR VALADARES', numero: '14',
      bairro: 'Parque Residencial Tubarão', cidade: 'SRR', cep: '29171-727'
    }
  },
  {
    nome: 'rótulo CLIENTE comido pelo OCR, com lixo na frente do nome',
    texto: `AUSÊNCIA DE CONTATO
e ;
SS. PRE ANTONIO BATISTA NEVES - LUCIA BATISTA NEVES
| TELEFONE DO CONTRATO: (27) 9884-83123
ENDEREÇO DO CONTRATO: R. Lisboa, 238, 29171-710,
Parque Res. de Tubarão, Serra — ES.
MOTIVO DO CONTATO: Processo Previdenciário
Estamos tentando contato para conseguir o laudo médico.
OBSERVAÇÕES: É MUITO IMPORTANTE QUE ENTRE EM
CONTATO COM O ESCRITORIO O MAIS RAPIDO POSSIVEL
; (27)3065.3080.
Eu, LUCIA BATISTA NEVES , inscrito no CPF: 111.222 .333-
44, declaro
que estou ciente/recebi as informações acima.`,
    /* "PRE" sobrevive de propósito. Cai fora o que tem não-letra ("SS.")
       e o que tem até duas letras; três letras já pode ser nome de gente
       — ANA, EVA, IVO — e apagar o primeiro nome do cliente sem ninguém
       ver é pior do que deixar um fragmento à vista, que o motoboy tira
       num toque. É por isso que o campo sai marcado para revisão. */
    espera: {
      cliente: 'PRE ANTONIO BATISTA NEVES',
      responsavel: 'LUCIA BATISTA NEVES',
      telefones: ['27988483123'],
      rua: 'R. Lisboa', numero: '238',
      bairro: 'Parque Residencial Tubarão', cidade: 'SRR', cep: '29171-710',
      revisar: true
    }
  },
  {
    nome: 'timbre virou texto e engoliu o rótulo do cliente',
    texto: `|]
] —
MM FERNANDO MIRANDA
ADVOGADOS
| AUSÊNCIA DE CONTATO
so PAULO SERGIO DE ALMEIDA
É AA
| TELEFONE DO CONTRATO: 27 988041234 / 27 996211234
| ENDEREÇO DO CONTRATO: Rua das Palmeiras, 260, Vista da Serra CEP: 29176-392
TELEFONE DO ASSERTIVA: É o mesmo do contrato
27 998961234 — temporariamente indisponivel
] ENDEREÇO. DO ASSERTIVA: R SALDANHA DA GAMA, 21, ARIBIRI, VILA VELHA - ES - 29120-320
; (mais atual)
ã MOTIVO DO CONTATO: . COMPARECIMENTO AO ESCRITORIO OU CONTATO ATUAL
Eu, PAULO SERGIO DE ALMEIDA, inscrito no CPF: 111.222.333-4 4, declaro
que estou ciente/recebi as informações acima.`,
    espera: {
      cliente: 'PAULO SERGIO DE ALMEIDA',
      responsavel: '',
      telefones: ['27988041234', '27996211234', '27998961234'],
      rua: 'Rua das Palmeiras', numero: '260',
      bairro: 'Vista da Serra', cidade: 'SRR', cep: '29176-392',
      segundoEndereco: { rua: 'R SALDANHA DA GAMA', bairro: 'Aribiri', cidade: 'VV' },
      revisar: true
    }
  },
  {
    nome: 'folha de perícia: datas, dois endereços e telefone sem rótulo de contrato',
    texto: `CLIENTE: RENATO LIMA SOARES

ENDEREÇO DO CONTRATO: Rua Alfredo Galeno, Nº 191, Bairro

Vila Nova de Colares, Serra

| ENDEREÇO DO ASSERTIVA: ALFRESO GALENO, 1824, VILA

NOVA, SERRA

| TELEFONE: (27) 9996-23123 / 27 99698-1234

MOTIVO DO CONTATO: PERÍCIA E AVALIAÇÃO SOCIAL INSS

PERÍCIA: 29/07/2026 (Quarta-feira) às 12:00
AGÊNCIA DA PREVIDÊNCIA SOCIAL SERRA- AV DESEMB MARIO
DA SILVA NUNES 200, JARDIM LIMOEIRO - SERRA - ES - CEP:
29.164-044

AVALIAÇÃO SOCIAL: 17/11/2026 (Terça-feira) às 11:00`,
    espera: {
      cliente: 'RENATO LIMA SOARES',
      responsavel: '',
      telefones: ['27999623123', '27996981234'],
      rua: 'Rua Alfredo Galeno', numero: '191',
      bairro: 'Vila Nova de Colares', cidade: 'SRR', cep: '',
      compromissos: [
        { tipo: 'Perícia', data: '29/07/2026', hora: '12:00' },
        { tipo: 'Avaliação social', data: '17/11/2026', hora: '11:00' }
      ]
    }
  },
  {
    nome: 'cinco telefones numa linha só, complemento e "representado por"',
    texto: `AA FERNANDO MIRANDA
ADVOGADOS
AUSÊNCIA DE CONTATO
CLIENTE: CARLOS EDUARDO NUNES
' representado por BEATRIZ NUNES DA CRUZ
TELEFONE: (27) 99734-1234 (contrato) / (27) 99824-1234 / (27) 99970-1234 /
| (27) 99293-1234 / (27) 99956-1234
! ; ENDEREÇO DO CONTRATO: Rua Santa Cecília, nº535, caixa 2,
São Francisco, Serra/ES, CEP: 29.190-000.
| MOTIVO DO CONTATO: O processo do cliente foi indeferido na via
administrativa.
Eu, BEATRIZ NUNES DA CRUZ, inscrita no
CPF: 111.222.333-4 4, declaro que estou ciente/recebi as
informações acima. ;`,
    espera: {
      cliente: 'CARLOS EDUARDO NUNES',
      responsavel: 'BEATRIZ NUNES DA CRUZ',
      telefones: ['27997341234', '27998241234', '27999701234', '27992931234', '27999561234'],
      rua: 'Rua Santa Cecília', numero: '535', complemento: 'caixa 2',
      bairro: 'São Francisco', cidade: 'SRR', cep: '29190-000'
    }
  }
];

// ── 1. CAMPO A CAMPO ─────────────────────────────────────────
for (const folha of FOLHAS) {
  const d = doc.lerDocumento(folha.texto);
  const e = folha.espera;
  const end = d.enderecos[0] || {};
  const rotulo = `[${folha.nome}]`;

  ok(d.cliente === e.cliente, `${rotulo} cliente = "${e.cliente}" (leu "${d.cliente}")`);
  ok(d.responsavel === e.responsavel, `${rotulo} responsável = "${e.responsavel}" (leu "${d.responsavel}")`);

  const tels = d.telefones.map(t => t.numero);
  ok(JSON.stringify(tels) === JSON.stringify(e.telefones),
    `${rotulo} telefones = ${e.telefones.join(', ')} (leu ${tels.join(', ') || '—'})`);

  ok(end.rua === e.rua,               `${rotulo} rua = "${e.rua}" (leu "${end.rua}")`);
  ok(end.numero === e.numero,         `${rotulo} número = "${e.numero}" (leu "${end.numero}")`);
  ok(end.bairro === e.bairro,         `${rotulo} bairro = "${e.bairro}" (leu "${end.bairro}")`);
  ok(end.cidade === e.cidade,         `${rotulo} cidade = ${e.cidade} (leu ${end.cidade || '—'})`);
  ok((end.cep || '') === (e.cep || ''), `${rotulo} CEP = "${e.cep || ''}" (leu "${end.cep || ''}")`);
  if (e.complemento) ok(end.complemento === e.complemento, `${rotulo} complemento = "${e.complemento}"`);

  if (e.segundoEndereco) {
    const s = d.enderecos[1] || {};
    ok(s.rua === e.segundoEndereco.rua && s.bairro === e.segundoEndereco.bairro && s.cidade === e.segundoEndereco.cidade,
      `${rotulo} segundo endereço (assertiva) lido: ${e.segundoEndereco.rua}, ${e.segundoEndereco.bairro}`);
    ok(s.tipo === 'assertiva', `${rotulo} o segundo endereço é marcado como "assertiva"`);
  }

  if (e.compromissos) {
    const bate = e.compromissos.every((c, i) =>
      d.compromissos[i] && d.compromissos[i].tipo === c.tipo &&
      d.compromissos[i].data === c.data && d.compromissos[i].hora === c.hora);
    ok(bate, `${rotulo} perícia e avaliação social com data e hora ` +
      `(leu ${d.compromissos.map(c => c.tipo + ' ' + c.data + ' ' + c.hora).join(' | ') || '—'})`);
  }

  if (e.revisar) ok(d.revisar.indexOf('cliente') !== -1,
    `${rotulo} o nome lido sem rótulo é marcado para revisão`);
}

// ── 2. O TELEFONE DO ESCRITÓRIO NUNCA VIRA TELEFONE DE CLIENTE ─
/* (27) 3065-3080 está impresso em toda folha, dentro das observações.
   Sem esta regra, metade das paradas nasceria com o telefone do
   advogado — e o motoboy ligaria para o escritório na porta do cliente. */
for (const folha of FOLHAS) {
  const d = doc.lerDocumento(folha.texto);
  const tem = d.telefones.some(t => t.numero.indexOf('3065') !== -1);
  ok(!tem, `[${folha.nome}] o telefone do escritório ficou de fora`);
}

// ── 2b. O CPF NÃO PODE SAIR DA FOLHA ─────────────────────────
/* Entregar não depende do CPF, então o app não o coleta: ele não volta no
   documento lido, não vai para as observações da parada e não chega ao
   localStorage. O que não é guardado não vaza. Reconhecer o número
   continua sendo necessário — é o que impede que os onze dígitos entrem
   como telefone do cliente e que o nome de quem assina se perca. */
for (const folha of FOLHAS) {
  const d = doc.lerDocumento(folha.texto);
  const p = doc.paradaDoDocumento(d);
  const numeros = JSON.stringify(d) + ' ' + JSON.stringify(p);
  ok(numeros.indexOf('111.222.333-44') === -1 && numeros.indexOf('11122233344') === -1,
    `[${folha.nome}] o CPF não aparece em lugar nenhum do que o app guarda`);
  ok(d.cpf === undefined, `[${folha.nome}] o documento lido não tem campo de CPF`);
}

// ── 3. CPF E CEP NÃO PODEM VIRAR TELEFONE ────────────────────
/* CPF tem 11 dígitos, igual a celular. O que separa é o DDD e o 9. */
{
  ok(!doc.ehTelefone('14726777773'), 'CPF de 11 dígitos não é telefone (DDD 14, mas sem o 9)');
  ok(!doc.ehTelefone('07936458751'), 'CPF começando com 0 não é telefone (não existe DDD 07)');
  ok(!doc.ehTelefone('2917172'),     'CEP não é telefone');
  ok(doc.ehTelefone('27998053801'),  'celular com DDD é telefone');
  ok(doc.ehTelefone('2730653080'),   'fixo com DDD é telefone');

  const linha = 'Eu, FULANO, inscrito no CPF: 111.222.333-44, declaro';
  ok(doc.telefonesDaLinha(linha).length === 0, 'linha de CPF não devolve telefone nenhum');
}

// ── 4. BAIRRO ABREVIADO CASA COM O OFICIAL ───────────────────
/* A folha escreve "Parque Res. de Tubarão"; a lista do app tem "Parque
   Residencial Tubarão". Sem casar os dois, a parada nasce com um bairro
   que não existe na lista e a taxa automática por bairro não roda. */
{
  /* A quarta coluna é a cidade que o texto da folha já revelou. Sem ela
     "VILA NOVA" casa com o bairro "Vila Nova", de Viana, que é nome
     exato — e é o comportamento certo: quem não sabe a cidade não pode
     preferir um casamento parcial de outra. */
  const casos = [
    ['Parque Res. de Tubarão', 'Parque Residencial Tubarão', 'SRR', ''],
    ['PARQUE SANTA FÉ',        'Parque Santa Fé',            'SRR', ''],
    ['VILA NOVA',              'Vila Nova de Colares',       'SRR', 'SRR'],
    ['VILA NOVA',              'Vila Nova',                  'VIA', ''],
    ['ARIBIRI',                'Aribiri',                    'VV',  '']
  ];
  for (const [escrito, oficial, cidade, dica] of casos) {
    const m = doc.casarBairro(escrito, dica);
    ok(m && m.bairro === oficial && m.cidade === cidade,
      `"${escrito}" casa com "${oficial}" (${cidade})` + (m ? ` — leu "${m.bairro}" (${m.cidade})` : ' — não casou'));
  }
  ok(doc.casarBairro('Rua Qualquer Coisa', '') === null,
    'texto que não é bairro não casa com bairro nenhum');
}

// ── 5. ORIENTAÇÃO: A FOLHA DE LADO TEM DE PERDER ─────────────
/* É assim que o app escolhe girar a foto: OCR barato nas quatro
   posições e fica a de mais pistas. A folha virada sai como sopa de
   letra e não pontua. */
{
  const certa = doc.pontuarOrientacao(FOLHAS[0].texto);
  const virada = doc.pontuarOrientacao('ouwseu “sIentenuos soMesouoy on e sayueBbja souejes');
  ok(certa >= 5, `folha na posição certa pontua alto (${certa})`);
  ok(virada === 0, `folha virada pontua zero (${virada})`);
  ok(certa > virada, 'a posição certa ganha da virada');
}

// ── 6. DOCUMENTO → PARADA ────────────────────────────────────
/* O que a tela preenche no formulário. Sai igual aos campos de
   saveStop(): name, phone, street, number, neighborhood, city. */
{
  const d = doc.lerDocumento(FOLHAS[0].texto);
  const p = doc.paradaDoDocumento(d);
  ok(p.name === 'JOANA PEREIRA DOS REIS' && p.phone === '27981891234', 'a parada leva nome e telefone');
  ok(p.street === 'RUA GOVERNADOR VALADARES' && p.number === '14' &&
     p.neighborhood === 'Parque Residencial Tubarão' && p.city === 'SRR',
    'a parada leva rua, número, bairro e cidade');
  ok(p.notes.indexOf('MARTA') !== -1,
    'as observações levam o responsável, que é quem assina o recebimento');

  // Segundo endereço: a tela oferece, esta função entrega
  const d3 = doc.lerDocumento(FOLHAS[2].texto);
  const p2 = doc.paradaDoDocumento(d3, 1);
  ok(p2.street === 'R SALDANHA DA GAMA' && p2.city === 'VV',
    'dá para montar a parada com o segundo endereço da folha');
  ok(p2.notes.indexOf('Outros telefones') !== -1, 'os telefones que sobraram vão para as observações');
}

// ── 7. TEXTO QUE NÃO É A FOLHA ───────────────────────────────
/* Foto do chão, print de conversa, folha em branco: tem de sair vazio e
   com confiança baixa, não com um nome inventado. */
{
  for (const lixo of ['', '   ', 'oi bom dia tudo bem', 'AAAA BBBB CCCC']) {
    const d = doc.lerDocumento(lixo);
    ok(d.confianca < 0.5, `texto sem folha tem confiança baixa ("${lixo.slice(0, 20)}" → ${d.confianca})`);
  }
  const d = doc.lerDocumento('foto do chão');
  ok(!d.enderecos.length, 'texto sem endereço não inventa endereço');
}

fim();
