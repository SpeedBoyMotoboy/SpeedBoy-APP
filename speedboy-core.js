/* ═══════════════════════════════════════════════════════════════
   SpeedBoy — núcleo compartilhado

   Antes deste arquivo, nove símbolos existiam duplicados entre
   index.html, pedido.html e motoboy.html. Duas consequências reais:

   • CIDADE_BAIRROS tinha DOIS formatos e as listas divergiram — 93
     bairros que o cliente conseguia escolher não existiam no app, e o
     motoboy não achava o bairro ao editar a parada. Aqui a lista é uma
     só, com a união das duas.

   • fmtPhone do motoboy.html não tinha proteção contra nulo e quebrava
     com telefone vazio; o do index.html tinha. Agora é a mesma função.

   Onde as cópias eram legitimamente diferentes, a diferença virou
   parâmetro em vez de sumir — ver bairros personalizados e tema.

   Carregado por todas as páginas, junto de speedboy-firebase.js.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var SB = global.SpeedBoy = global.SpeedBoy || {};

  // ── DINHEIRO ────────────────────────────────────────────────
  function parseMoney(s) { return parseFloat(String(s == null ? '' : s).replace(',', '.')) || 0; }
  function fmtMoney(v)   { return 'R$ ' + (parseFloat(v) || 0).toFixed(2).replace('.', ','); }

  function maskMoney(el) {
    var v = el.value.replace(/[^0-9,]/g, '');
    var p = v.split(',');
    if (p.length > 2) v = p[0] + ',' + p.slice(1).join('');
    if (p[1] && p[1].length > 2) v = p[0] + ',' + p[1].substring(0, 2);
    el.value = v;
  }

  // ── TELEFONE ────────────────────────────────────────────────
  function maskPhone(el) {
    var v = el.value.replace(/\D/g, '');
    if (v.length > 11) v = v.substring(0, 11);
    if (v.length > 7)       v = '(' + v.substring(0, 2) + ') ' + v.substring(2, 7) + '-' + v.substring(7);
    else if (v.length > 2)  v = '(' + v.substring(0, 2) + ') ' + v.substring(2);
    el.value = v;
  }

  // String(p||'') e não p.replace: o motoboy.html quebrava com telefone vazio
  function fmtPhone(p) {
    var d = String(p == null ? '' : p).replace(/\D/g, '');
    return d.length === 11
      ? '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7)
      : (p || '');
  }

  // ── CIDADES E BAIRROS ───────────────────────────────────────
  // Formato único {codigo:{nome,bairros:[]}} — o do pedido.html, que já
  // trazia o nome da cidade junto do dado.
  var CIDADE_BAIRROS = {
    CCA: { nome: 'Cariacica', bairros: [
      "Alice Coutinho", "Alto Boa Vista", "Alto Lage", "Alzira Ramos",
      "Antônio Ferreira Borges", "Aparecida", "Bandeirantes", "Bela Aurora", "Bela Vista",
      "Boa Sorte", "Bubu", "Campina Grande", "Campo Belo", "Campo Grande", "Campo Verde",
      "Cangaíba", "Cariacica Sede", "Castelo Branco", "Caçaroca", "Chácaras União",
      "Cruzeiro do Sul", "Dom Bosco", "Expedito", "Flexal I", "Flexal II", "Formate",
      "Foz do Rio Bubu", "Graúna", "Ibiapaba", "Itacibá", "Itanguá", "Itapemirim", "Itaquari",
      "Jardim América", "Jardim Botânico", "Jardim Campo Grande", "Jardim de Alah", "Maracanã",
      "Morada de Santa Fé", "Mucuri", "Nova Brasília", "Nova Campo Grande", "Nova Canaã",
      "Nova Esperança", "Nova Rosa da Penha", "Nova Valverde", "Novo Brasil", "Novo Horizonte",
      "Operário", "Oriente", "Padre Gabriel", "Padre Mathias", "Palestina", "Parque Gramado",
      "Piranema", "Planeta", "Porto de Cariacica", "Porto de Santana", "Porto Novo",
      "Presidente Médice", "Prolar", "Retiro Saudoso", "Rio Branco", "Rio Marinho",
      "Rosa da Penha", "Santa Bárbara", "Santa Cecília", "Santa Luzia", "Santa Paula",
      "Santana", "Santo André", "Santo Antônio", "Serra do Anil", "Sotelândia", "Sotema",
      "São Benedito", "São Conrado", "São Francisco", "São Geraldo I", "São Geraldo II",
      "São Gonçalo", "São João Batista", "Tabajara", "Tiradentes", "Tucum", "Vale dos Reis",
      "Vale Esperança", "Valparaíso", "Vera Cruz", "Vila Cajueiro", "Vila Capixaba",
      "Vila Independência", "Vila Isabel", "Vila Merlo", "Vila Progresso", "Vila Prudêncio",
      "Vista Dourada", "Vista Linda", "Vista Mar"
    ] },
    SRR: { nome: 'Serra', bairros: [
      "Alterosas", "André Carloni", "Bairro das Laranjeiras", "Bairro de Fátima",
      "Bairro Novo", "Balneário Carapebus", "Barcelona", "Barro Branco", "Belvedere",
      "Bicanga", "Boa Vista", "Campinho da Serra I", "Campinho da Serra II", "Cantinho do Céu",
      "Carapina Grande", "Carapina I", "Castelândia", "Caçaroca", "Central Carapina", "Centro",
      "Centro Industrial do Município", "Chácara Parreiral", "Cidade Continental",
      "Cidade Pomar", "CIVIT I", "CIVIT II", "Colina da Serra",
      "Condomínio Ecológico Parque da Lagoa", "Conjunto Jacaraípe", "Costa Dourada",
      "Costabella", "Câmara", "Diamantina", "Divinópolis", "Eldorado", "Enseada de Jacaraípe",
      "Estância Monazítica", "Eurico Salles", "Fazenda Cascata", "Feu Rosa", "Guaraciaba",
      "Hélio Ferraz", "Jardim Atlântico", "Jardim Bela Vista", "Jardim Carapina",
      "Jardim da Serra", "Jardim Guanabara", "Jardim Limoeiro", "Jardim Primavera",
      "Jardim Tropical", "José de Anchieta", "José de Anchieta III", "Laranjeiras Velha",
      "Loteamento Fonte Limpa", "Loteamento Potiguara", "Manguinhos", "Manoel Plaza",
      "Marbella", "Maringá", "Mata da Serra", "Morada de Laranjeiras", "Niobe",
      "Nossa Senhora da Conceição", "Nova Carapina I", "Nova Carapina II", "Nova Zelândia",
      "Novo Horizonte", "Novo Porto Canoa", "Ourimar", "Parque das Gaivotas",
      "Parque Jacaraípe", "Parque Residencial Laranjeiras", "Parque Residencial Mestre Álvaro",
      "Parque Residencial Nova Almeida", "Parque Residencial Tubarão", "Parque Santa Fé",
      "Pitanga", "Planalto de Carapina", "Planalto Serrano", "Planície da Serra",
      "Portal dos Laranjais", "Portal Jacaraípe", "Porto Canoa", "Praia de Capuba",
      "Praia de Carapebus", "Praiamar", "Reis Magos", "Residencial Centro da Serra",
      "Residencial Jacaraípe", "Rosário de Fátima", "Santa Luzia", "Santa Rita de Cássia",
      "Santo Antônio", "Serra Dourada I", "Serra Dourada II", "Serra Dourada III", "Serramar",
      "Solar de Anchieta", "São Diogo I", "São Diogo II", "São Domingos", "São Francisco",
      "São Geraldo", "São João", "São Judas Tadeu", "São Lourenço", "São Marcos",
      "São Patrício", "São Pedro", "Sítio Irema", "Taquara I", "Taquara II", "Valparaíso",
      "Vila Maria", "Vila Nova de Colares", "Vista da Serra I", "Vista da Serra II"
    ] },
    VIA: { nome: 'Viana', bairros: [
      "Areinha", "Arlindo Villaschi", "Bom Pastor", "Campo Verde", "Canaã", "Caxias do Sul",
      "Industrial", "Ipanema", "Jucu", "Marcílio de Noronha", "Morada de Bethânia",
      "Nova Belém", "Nova Bethânia", "Nova Viana", "Primavera", "Ribeira", "Santa Terezinha",
      "Santo Agostinho", "Soteco", "Universal", "Verona", "Vila Bethânia", "Vila Nova"
    ] },
    VIX: { nome: 'Vitória', bairros: [
      "Aeroporto", "Andorinhas", "Antônio Honório", "Ariovaldo Favalessa", "Barro Vermelho",
      "Bela Vista", "Bento Ferreira", "Boa Vista", "Bonfim", "Caratoíra", "Centro", "Comdusa",
      "Conquista", "Consolação", "Cruzamento", "Da Penha", "De Lourdes", "Do Cabral",
      "Do Moscoso", "Do Quadro", "Enseada do Suá", "Estrelinha", "Fonte Grande",
      "Forte São João", "Fradinhos", "Goiabeiras", "Grande Vitória", "Guaçuí", "Gurigica",
      "Horácio Bento", "Ilha das Caieiras", "Ilha de Monte Belo", "Ilha de Santa Maria",
      "Ilha do Boi", "Ilha do Frade", "Ilha do Príncipe", "Inhanguetá", "Itararé", "Jabour",
      "Jardim Camburi", "Jardim da Penha", "Jesus de Nazareth", "Joana D'arc", "Jucutuquara",
      "Maria Ortiz", "Maruípe", "Mata da Praia", "Monte Belo", "Morada de Camburi",
      "Mário Cypreste", "Nazareth", "Nova Palestina", "Parque Moscoso", "Piedade",
      "Pontal de Camburi", "Praia do Canto", "Praia do Suá", "Redenção", "República",
      "Resistência", "Romão", "Santa Cecília", "Santa Clara", "Santa Helena", "Santa Luíza",
      "Santa Lúcia", "Santa Martha", "Santa Teresa", "Santo André", "Santo Antônio",
      "Santos Dumont", "Santos Reis", "Segurança do Lar", "Solon Borges", "São Benedito",
      "São Cristóvão", "São José", "São Pedro", "Tabuazeiro", "Universitário", "Vila Rubim"
    ] },
    VV: { nome: 'Vila Velha', bairros: [
      "23 de Maio", "Alecrim", "Alvorada", "Araçás", "Argolas", "Aribiri", "Atalaia", "Ataíde",
      "Balneário Ponta da Fruta", "Barra do Jucú", "Barramares", "Boa Vista 01",
      "Boa Vista 02", "Brisamar", "Capuaba", "Cavalieri", "Chácara do Conde",
      "Cidade da Barra", "Cobi de Baixo", "Cobi de Cima", "Cobilândia", "Cocal",
      "Coqueiral de Itaparica", "Cristóvão Colombo", "Darcy Santos", "Divino Espírito Santo",
      "Dom João Batista", "Garoto", "Glória", "Guadalupe", "Guaranhuns", "Ibes",
      "Ilha da Conceição", "Ilha das Flores", "Ilha dos Ayres", "Ilha dos Bentos",
      "Industrial", "Interlagos", "Ipessa", "Itapoã", "Jaburuna", "Jardim Asteca",
      "Jardim Colorado", "Jardim do Vale", "Jardim Guadalajara", "Jardim Guaranhuns",
      "Jardim Marilândia", "Jardim São Paulo", "Jockey de Itaparica", "João Goulart",
      "Morada da Barra", "Morada do Sol", "Morro da Lagoa", "Morro da Philips",
      "Morro do Cruzeiro", "Normília da Cunha", "Nossa Senhora da Penha II", "Nova América",
      "Nova Itaparica", "Nova Ponta da Fruta", "Novo México", "Olaria", "Parque das Gaivotas",
      "Paul", "Pedra dos Búzios", "Planalto", "Ponta da Fruta", "Pontal das Garças",
      "Praia da Costa", "Praia de Itaparica", "Praia dos Recifes", "Prainha da Glória",
      "Primeiro de Maio", "Residencial Coqueiral", "Residencial Jabaeté", "Rio Marinho",
      "Riviera da Barra", "Sagrada Família", "Santa Clara", "Santa Inês", "Santa Mônica",
      "Santa Mônica Popular", "Santa Paula I", "Santa Paula II", "Santa Rita", "Santos Dumont",
      "Soteco", "São Conrado", "São Torquato", "Terra Vermelha", "Ulisses Guimarães",
      "Vale Encantado", "Vila Batista", "Vila Garrido", "Vila Guaranhuns", "Vila Nova",
      "Vila Velha - Centro", "Vista da Penha", "Zumbi dos Palmares"
    ] }  };

  function nomeDaCidade(codigo) {
    var c = CIDADE_BAIRROS[codigo];
    return c ? c.nome : (codigo === 'OUT' ? 'Outra' : (codigo || ''));
  }
  function codigosDeCidade() { return Object.keys(CIDADE_BAIRROS); }

  /* Bairros digitados à mão ficam guardados por ESCOPO, e isso não é
     detalhe: o app guarda todos juntos ('sb_custom_bairros'), enquanto o
     formulário guarda por loja ('sb_custom_bairros_<loja>'). Eram duas
     funções diferentes com o mesmo nome — a diferença virou parâmetro
     para nenhum dos dois perder o que já tem gravado. */
  function chaveCustom(escopo) {
    return escopo ? 'sb_custom_bairros_' + escopo : 'sb_custom_bairros';
  }
  function getCustomBairros(escopo) {
    try { return JSON.parse(localStorage.getItem(chaveCustom(escopo)) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function saveCustomBairros(obj, escopo) {
    try { localStorage.setItem(chaveCustom(escopo), JSON.stringify(obj || {})); } catch (e) {}
  }
  function addCustomBairro(cidade, bairro, escopo) {
    if (!cidade || !bairro) return false;
    var cb = getCustomBairros(escopo);
    if (!cb[cidade]) cb[cidade] = [];
    bairro = String(bairro).trim();
    if (!bairro || cb[cidade].indexOf(bairro) !== -1) return false;
    cb[cidade].push(bairro);
    cb[cidade].sort();
    saveCustomBairros(cb, escopo);
    return true;
  }

  // Oficiais + os que o usuário acrescentou, sem repetir
  function bairrosDaCidade(codigo, escopo) {
    if (!codigo || !CIDADE_BAIRROS[codigo]) return [];
    var oficiais = CIDADE_BAIRROS[codigo].bairros || [];
    var extras   = getCustomBairros(escopo)[codigo] || [];
    var vistos = {}, saida = [];
    oficiais.concat(extras).forEach(function (b) {
      var k = String(b).toLowerCase();
      if (!vistos[k]) { vistos[k] = 1; saida.push(b); }
    });
    return saida.sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
  }

  // ── TEMA ────────────────────────────────────────────────────
  /* Cada página guarda o tema na sua própria chave e tem um botão com
     rótulo diferente — por isso escopo e rótulos são parâmetros. */
  function aplicarTema(chave, botaoId, rotulos) {
    var claro = localStorage.getItem(chave) === 'light';
    if (claro) document.body.classList.add('light');
    var b = botaoId && document.getElementById(botaoId);
    if (b && rotulos) b.textContent = claro ? rotulos.paraEscuro : rotulos.paraClaro;
    return claro;
  }
  function alternarTema(chave, botaoId, rotulos) {
    var claro = document.body.classList.toggle('light');
    var b = botaoId && document.getElementById(botaoId);
    if (b && rotulos) b.textContent = claro ? rotulos.paraEscuro : rotulos.paraClaro;
    try { localStorage.setItem(chave, claro ? 'light' : 'dark'); } catch (e) {}
    return claro;
  }

  // ── AVISO RÁPIDO ────────────────────────────────────────────
  var _timerToast;
  function toast(msg, tipo, ms) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (tipo ? ' ' + tipo : '');
    clearTimeout(_timerToast);
    _timerToast = setTimeout(function () { t.className = 'toast'; }, ms || 3000);
  }

  // ── EXPOSIÇÃO ───────────────────────────────────────────────
  SB.parseMoney = parseMoney;   SB.fmtMoney = fmtMoney;   SB.maskMoney = maskMoney;
  SB.maskPhone  = maskPhone;    SB.fmtPhone = fmtPhone;
  SB.CIDADE_BAIRROS = CIDADE_BAIRROS;
  SB.nomeDaCidade = nomeDaCidade; SB.codigosDeCidade = codigosDeCidade;
  SB.bairrosDaCidade = bairrosDaCidade;
  SB.getCustomBairros = getCustomBairros;
  SB.saveCustomBairros = saveCustomBairros;
  SB.addCustomBairro = addCustomBairro;
  SB.aplicarTema = aplicarTema; SB.alternarTema = alternarTema;
  SB.toast = toast;

  /* Também no escopo global: as páginas chamam esses nomes direto de
     atributos onclick/oninput, que só enxergam o global. */
  global.parseMoney = parseMoney;
  global.fmtMoney   = fmtMoney;
  global.maskMoney  = maskMoney;
  global.maskPhone  = maskPhone;
  global.fmtPhone   = fmtPhone;
  global.CIDADE_BAIRROS = CIDADE_BAIRROS;
})(window);
