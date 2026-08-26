/* ═══════════════════════════════════════════════════════════════
   SpeedBoy — leitura de documento fotografado

   Existe por causa de uma demanda nova: um escritório de advocacia
   entrega pilhas de folhas "AUSÊNCIA DE CONTATO", uma por cliente, e
   cada folha é uma parada. Digitar nome, telefone e endereço de trinta
   folhas à mão é meia hora de trabalho e é onde nasce erro de endereço.

   Aqui mora só a parte determinística: TEXTO → CAMPOS. Quem tira a foto
   e quem transforma a foto em texto (OCR) é o index.html — este arquivo
   não toca em DOM, câmera nem rede, e por isso roda igual no navegador e
   no Node, que é o que permite testá-lo contra o texto REAL saído do OCR
   das folhas (testes/documento.mjs).

   Três decisões que explicam o formato do código:

   • O OCR erra o rótulo, não o dado. "CLIENTE:" saiu como "SS. PRE" numa
     das folhas e como "so" em outra, enquanto o nome do cliente na mesma
     linha veio perfeito. Por isso todo rótulo é procurado com tolerância
     e todo campo tem um segundo caminho — o nome, por exemplo, cai na
     assinatura ("Eu, FULANO, inscrito no CPF").

   • CPF tem 11 dígitos, telefone celular também. Separar os dois por
     tamanho pega o CPF como telefone. O que separa de verdade é o DDD e
     o 9 na frente do número — ver ehTelefone(). O CPF é reconhecido para
     ser DESCARTADO: nada aqui devolve o número dele, porque entregar não
     depende disso.

   • O telefone do escritório (27) 3065-3080 está impresso em TODA folha,
     dentro das observações. Sem descartá-lo, metade das paradas nasceria
     com o telefone do advogado no lugar do telefone do cliente.
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var SB = global.SpeedBoy = global.SpeedBoy || {};

  // ── APOIO DE TEXTO ──────────────────────────────────────────
  function limpo(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }
  function semAcento(s) {
    return limpo(s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();
  }
  /* O OCR troca ç por c, Ê por E e às vezes | por I. Comparar rótulo
     sempre por esta forma reduzida evita uma regex cheia de alternativas. */
  function chaveDeRotulo(s) {
    return semAcento(s).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ── RÓTULOS DA FOLHA ────────────────────────────────────────
  /* Cada rótulo abre um bloco que segue até o próximo rótulo. As folhas
     não são idênticas: uma traz "TELEFONE DO CONTRATO", outra só
     "TELEFONE", outra ainda um segundo endereço "DO ASSERTIVA" (o
     cadastro atualizado que o escritório comprou). Todos entram. */
  var ROTULOS = [
    { campo: 'cliente',     palavra: 'CLIENTE' },
    { campo: 'telefone',    palavra: 'TELEFONE' },
    { campo: 'endereco',    palavra: 'ENDERECO' },
    { campo: 'motivo',      palavra: 'MOTIVO' },
    { campo: 'observacoes', palavra: 'OBSERVACOES' },
    { campo: 'pericia',     palavra: 'PERICIA' },
    { campo: 'avaliacao',   palavra: 'AVALIACAOSOCIAL' }
  ];

  // Distância de edição, para "CHENTE" ainda ser "CLIENTE"
  function distancia(a, b) {
    var linha = [], i, jj;
    for (i = 0; i <= b.length; i++) linha[i] = i;
    for (i = 1; i <= a.length; i++) {
      var ant = linha[0]; linha[0] = i;
      for (jj = 1; jj <= b.length; jj++) {
        var tmp = linha[jj];
        linha[jj] = Math.min(linha[jj] + 1, linha[jj - 1] + 1, ant + (a[i - 1] === b[jj - 1] ? 0 : 1));
        ant = tmp;
      }
    }
    return linha[b.length];
  }

  /* O rótulo é a parte que o OCR mais erra, porque é a única em negrito e
     começa na margem, onde a folha curva na foto. Numa mesma pilha saíram
     "CHENTE:", "IENTE:", "NDEREÇO DO CONTRATO:" e um "T" sozinho numa
     linha com "ELEFONE DO CONTRATO:" na de baixo. O dado ao lado veio
     perfeito nas três.

     Daí três caminhos, do mais seguro para o mais tolerante: a palavra
     inteira dentro da cabeça; a cabeça sendo o fim da palavra (comeram o
     começo); e distância de edição até dois. */
  function campoDaCabeca(cabeca) {
    var k = chaveDeRotulo(cabeca).replace(/\s+/g, '');
    var primeira = chaveDeRotulo(cabeca).split(' ')[0] || '';
    for (var i = 0; i < ROTULOS.length; i++) {
      var p = ROTULOS[i].palavra;
      if (k.indexOf(p) !== -1) return ROTULOS[i].campo;
      if (primeira.length >= 4 && p.length > primeira.length &&
          p.slice(-primeira.length) === primeira) return ROTULOS[i].campo;
      if (primeira.length >= 5 && distancia(primeira, p) <= 2) return ROTULOS[i].campo;
    }
    return '';
  }

  /* Quando nem isso salva ("das TREGO DO CONTRATO:", "EEos DO CONTRATO:"),
     quem diz o que é a linha é o que vem DEPOIS dos dois-pontos: nome de
     rua é endereço, monte de dígito é telefone. */
  var RUA_INICIO = /^(RUA|R|AV|AVENIDA|AL|ALAMEDA|TRAVESSA|TV|ESTRADA|ESTR|ROD|RODOVIA|PRACA|LARGO|VIELA|BECO|SERVIDAO)\b/;

  function campoPeloConteudo(cabeca, conteudo) {
    var k = chaveDeRotulo(cabeca);
    if (!/CONTRATO|ASSERTIVA/.test(k)) return '';
    if (RUA_INICIO.test(semAcento(conteudo)) || RE_CEP.test(conteudo)) return 'endereco';
    var digitos = (String(conteudo).match(/\d/g) || []).length;
    if (digitos >= 10) return 'telefone';
    return '';
  }

  // Qualificador do rótulo: "DO CONTRATO", "DO ASSERTIVA", "ATUALIZADO"…
  function qualificador(cabeca) {
    var k = chaveDeRotulo(cabeca);
    if (/ASSERTIVA/.test(k)) return 'assertiva';
    if (/CONTRATO/.test(k))  return 'contrato';
    return '';
  }

  /* A assinatura do pé da folha ("Eu, FULANO, inscrito no CPF..., declaro
     que estou ciente") não é continuação de nada — é o fim do assunto.
     Sem fechar o bloco aqui, ela entrava inteira dentro do MOTIVO, e com
     ela o número do CPF ia parar nas observações da parada. */
  var FIM_DE_BLOCO = /^EU,? [A-Z]|DECLARO|CIENTE\/RECEBI|INFORMACOES ACIMA|CONFORME CLAUSULA|TELEFONE ATUALIZADO/;

  /* Frase corrida do meio da folha. Nome, telefone e endereço são dados
     curtos; quando o rótulo do MOTIVO some no OCR, o texto dele vira
     continuação do endereço e o bairro sai
     "Centro Estamos tentando contato para solicitar o laudo médico".
     Foi assim que endereço com motivo colado chegou à lista de paradas. */
  var PROSA = /\b(ESTAMOS|TENTANDO|PRECISAMOS|SOLICITAR|CONSEGUIR|COMPARECER|COMPARECA|APRESENTE|NECESSARI|DOCUMENTA|JUDICIAL|ADMINISTRATIV|ANEXAR|AGUARDAMOS|FAVOR|PODE GERAR|ATUALIZAR)\b/;
  var CURTOS = { cliente: 1, telefone: 1, endereco: 1 };

  function ehProsa(linha) {
    var k = semAcento(linha);
    return k.split(' ').length >= 5 && PROSA.test(k);
  }

  /* O OCR parte o rótulo em duas linhas quando a folha curva na foto:
     "TEL," numa linha e "EFONE DO CONTRATO: (27)..." na de baixo, "CL :"
     e "ENTE: FULANO". Costurar antes de qualquer coisa devolve a linha
     inteira e o rótulo volta a existir.

     Duas costuras: toco de até quatro letras cola na linha seguinte, sem
     espaço (é a mesma palavra partida); e rótulo que termina em
     dois-pontos sem nada depois adota a linha de baixo como conteúdo. */
  function costurarLinhas(linhas) {
    var saida = [];
    for (var i = 0; i < linhas.length; i++) {
      var atual = limpo(linhas[i]);
      if (!atual) continue;

      while (i + 1 < linhas.length) {
        var proxima = limpo(linhas[i + 1]);
        if (!proxima) { i++; continue; }

        var letras = atual.replace(/[^A-Za-zÀ-ú0-9]/g, '');
        var tocoDePalavra = letras.length <= 4 && !/\d/.test(letras);
        var rotuloVazio   = /:$/.test(atual) && atual.length <= 40;
        if (!tocoDePalavra && !rotuloVazio) break;

        atual = tocoDePalavra
          ? atual.replace(/[\s,;.]+$/, '') + proxima
          : atual + ' ' + proxima;
        i++;
      }
      saida.push(atual);
    }
    return saida;
  }

  /* Divide a folha em blocos rotulados. Devolve na ordem em que
     aparecem, porque a ordem importa: o primeiro endereço da folha é o
     do contrato mesmo quando o rótulo dele saiu ilegível. */
  function blocos(texto) {
    var linhas = costurarLinhas(String(texto || '').split(/\r?\n/));
    var saida = [], atual = null;

    for (var i = 0; i < linhas.length; i++) {
      var linha = linhas[i];
      if (!limpo(linha)) continue;

      // Rótulo = pedaço antes dos dois-pontos, até uns 40 caracteres
      var corte = linha.indexOf(':');
      var achado = null;
      if (corte > 0 && corte <= 40) {
        /* Lixo de scanner ("|", ";", "ã") costuma grudar no começo da
           linha; o rótulo de verdade começa depois dele. */
        var cabeca = chaveDeRotulo(linha.slice(0, corte)).replace(/^[A-Z]{1,2} (?=[A-Z]{4})/, '');
        var campo = campoDaCabeca(cabeca) || campoPeloConteudo(cabeca, linha.slice(corte + 1));
        if (campo) achado = { campo: campo, tipo: qualificador(cabeca) };
      }

      if (!achado && atual && FIM_DE_BLOCO.test(chaveDeRotulo(linha))) atual = null;
      if (!achado && atual && CURTOS[atual.campo] && ehProsa(linha)) atual = null;

      if (achado) {
        atual = { campo: achado.campo, tipo: achado.tipo, linhas: [limpo(linha.slice(corte + 1))] };
        saida.push(atual);
      } else if (atual) {
        atual.linhas.push(limpo(linha));
      } else {
        saida.push({ campo: '', tipo: '', linhas: [limpo(linha)] });
      }
    }

    saida.forEach(function (b) {
      b.texto = limpo(b.linhas.filter(Boolean).join(' '));
    });
    return saida;
  }

  // ── TELEFONE ────────────────────────────────────────────────
  /* Fixo (10 dígitos) ou celular (11 com 9 na frente), DDD brasileiro
     de verdade. É o que impede o CPF 111.222.333-44 — onze dígitos —
     de entrar na parada como telefone do cliente. */
  function ehTelefone(d) {
    if (!/^\d{10,11}$/.test(d)) return false;
    var ddd = parseInt(d.slice(0, 2), 10);
    if (ddd < 11 || ddd > 99) return false;
    return d.length === 11 ? d[2] === '9' : /[2-5]/.test(d[2]);
  }

  /* O OCR mete espaço onde não tem: "111.222 .333-44" e
     "111.222.333-4 4" são os dois CPFs reais de duas das folhas. */
  var RE_CPF = /\b\d{3}[.\s]{0,2}\d{3}[.\s]{0,2}\d{3}\s*-?\s*\d\s?\d\b/;

  function telefonesDaLinha(linha) {
    // CPF fora do caminho antes de procurar telefone na mesma linha
    var t = linha.replace(new RegExp(RE_CPF.source, 'g'), ' ');
    var achados = [];
    (t.match(/[\d][\d\s().\-]{7,}\d/g) || []).forEach(function (bruto) {
      var d = bruto.replace(/\D/g, '');
      /* "(27) 99734-6285 (contrato) / (27) 99824-6316" vem grudado num
         casamento só; cada pedaço de 10-11 dígitos é um telefone. */
      while (d.length >= 10) {
        var tam = ehTelefone(d.slice(0, 11)) ? 11 : (ehTelefone(d.slice(0, 10)) ? 10 : 0);
        if (!tam) { d = d.slice(1); continue; }
        achados.push(d.slice(0, tam));
        d = d.slice(tam);
      }
    });
    return achados;
  }

  // ── CEP, NÚMERO, CIDADE ─────────────────────────────────────
  var RE_CEP = /\b(\d{2})[.\s]?(\d{3})\s?-?\s?(\d{3})\b/;

  var CIDADES = [
    { codigo: 'SRR', nome: 'Serra',      re: /\bSERRA\b/ },
    { codigo: 'VIX', nome: 'Vitoria',    re: /\bVITORIA\b/ },
    { codigo: 'VV',  nome: 'Vila Velha', re: /\bVILA VELHA\b/ },
    { codigo: 'CCA', nome: 'Cariacica',  re: /\bCARIACICA\b/ },
    { codigo: 'VIA', nome: 'Viana',      re: /\bVIANA\b/ }
  ];

  function cidadeNoTexto(t) {
    var k = semAcento(t);
    for (var i = 0; i < CIDADES.length; i++) if (CIDADES[i].re.test(k)) return CIDADES[i].codigo;
    return '';
  }

  // ── BAIRRO ──────────────────────────────────────────────────
  /* "Parque Res. de Tubarão" e "Parque Residencial Tubarão" são o mesmo
     bairro, e só um dos dois está na lista do app. Comparar por conjunto
     de palavras — com as abreviações abertas e as preposições fora —
     acerta os dois sem tabela de sinônimos. */
  var ABREVIACOES = {
    RES: 'RESIDENCIAL', RESID: 'RESIDENCIAL', PQ: 'PARQUE', JD: 'JARDIM',
    STA: 'SANTA', STO: 'SANTO', S: 'SAO', PROF: 'PROFESSOR', PRES: 'PRESIDENTE',
    CJ: 'CONJUNTO', CONJ: 'CONJUNTO', VL: 'VILA', LOT: 'LOTEAMENTO'
  };
  var PARTICULAS = { DE: 1, DA: 1, DO: 1, DAS: 1, DOS: 1, E: 1, D: 1 };

  function palavrasDeBairro(s) {
    return semAcento(s).replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/)
      .map(function (p) { return ABREVIACOES[p] || p; })
      .filter(function (p) { return p && !PARTICULAS[p]; });
  }

  function pontuarBairro(candidato, oficial) {
    var a = palavrasDeBairro(candidato), b = palavrasDeBairro(oficial);
    if (!a.length || !b.length) return 0;
    var comuns = a.filter(function (p) { return b.indexOf(p) !== -1; }).length;
    // Divide pelo maior dos dois: "Santa Luzia" não pode casar 100% com
    // "Santa Luzia de Baixo" só por ser mais curto.
    return comuns / Math.max(a.length, b.length);
  }

  /* Devolve o bairro oficial e a cidade dele. Sem cidade no texto, a
     própria lista de bairros diz qual é: "Vila Nova de Colares" só
     existe na Serra. */
  function casarBairro(candidato, codigoCidade) {
    var tabela = SB.CIDADE_BAIRROS || {};
    var cidades = codigoCidade && tabela[codigoCidade] ? [codigoCidade] : Object.keys(tabela);
    var melhor = { nota: 0, bairro: '', cidade: '' };

    cidades.forEach(function (c) {
      (tabela[c].bairros || []).forEach(function (b) {
        var nota = pontuarBairro(candidato, b);
        if (nota > melhor.nota) melhor = { nota: nota, bairro: b, cidade: c };
      });
    });

    return melhor.nota >= 0.6 ? melhor : null;
  }

  // ── ENDEREÇO ────────────────────────────────────────────────
  var RE_RUA = /^(RUA|R|AV|AVENIDA|AL|ALAMEDA|TRAVESSA|TV|ESTRADA|ESTR|ROD|RODOVIA|PRACA|LARGO|VIELA|BECO|SERVIDAO)\b/;

  function lerEndereco(texto) {
    var end = { texto: limpo(texto), rua: '', numero: '', bairro: '', bairroOficial: '', cidade: '', cep: '', complemento: '' };
    if (!end.texto) return end;

    var t = end.texto.replace(/\.$/, '');

    var cep = t.match(RE_CEP);
    if (cep) {
      end.cep = cep[1] + cep[2] + '-' + cep[3];
      t = t.replace(cep[0], ' ').replace(/\bCEP\b\s*:?/i, ' ');
    }

    end.cidade = cidadeNoTexto(t);

    var partes = t.split(/[,;]|\s+[-–—]\s+/).map(limpo).filter(Boolean);
    var sobras = [];

    partes.forEach(function (parte, i) {
      var k = semAcento(parte);

      if (i === 0 || (!end.rua && RE_RUA.test(k))) {
        end.rua = limpo(parte.replace(/^BAIRRO\s+/i, ''));
        // "Rua Santa Rita, nº535" — número grudado na rua
        var junto = end.rua.match(/[,\s](?:N[ºO°.]?\s*)(\d+[A-Za-z]?)\s*$/i);
        if (junto) { end.numero = junto[1]; end.rua = limpo(end.rua.slice(0, junto.index)); }
        return;
      }
      // Número: "14", "Nº 191", "nº535"
      var num = k.match(/^(?:N[ºO°.]{0,2}\s*)?(\d{1,6}[A-Z]?)$/);
      if (num && !end.numero) { end.numero = num[1]; return; }
      // Complemento declarado
      if (/^(CAIXA|APTO?|APARTAMENTO|BLOCO|CASA|QUADRA|LOTE|SALA|FUNDOS|ANDAR)\b/.test(k)) {
        end.complemento = end.complemento ? end.complemento + ', ' + parte : parte;
        return;
      }
      /* Parte que é SÓ a cidade ("SERRA/ES", "ES") não é bairro. A
         comparação é exata de propósito: "Vista da Serra" contém
         "Serra" e é bairro — a versão que só procurava a cidade dentro
         da parte apagava o bairro e ia buscar um errado no nome da rua. */
      var semUf = k.replace(/\s*[\/-]\s*[A-Z]{2}$/, '').trim();
      if (semUf.length <= 2) return;
      if (CIDADES.some(function (c) { return semAcento(c.nome) === semUf; })) return;
      sobras.push(parte);
    });

    /* "RUA LAGOA AZUL 102": a folha nem sempre põe vírgula antes
       do número, e ele ia inteiro para o campo da rua — o Waze até acha,
       mas a lista da tela mostrava rua e número grudados e o fechamento
       não tinha número nenhum. */
    if (!end.numero && end.rua) {
      var solto = end.rua.match(/\s(\d{1,6}[A-Za-z]?)$/);
      if (solto && limpo(end.rua.slice(0, solto.index)).split(' ').length >= 2) {
        end.numero = solto[1];
        end.rua = limpo(end.rua.slice(0, solto.index));
      }
    }

    /* O que sobrou é candidato a bairro. "Vista da Serra CEP: 29176-392"
       vem grudado na rua sem vírgula — daí a segunda tentativa, olhando o
       fim da própria rua. */
    var candidatos = sobras.slice();
    var soDaCauda = false;
    if (!candidatos.length && end.rua) {
      var cauda = end.rua.match(/\s(?:BAIRRO\s+)?([A-Za-zÀ-ú][A-Za-zÀ-ú\s]{4,})$/);
      /* Só vale se sobrar rua depois de tirar o bairro: senão "Rua
         Hortênsias" vira bairro "Hortênsias" e a rua some. */
      if (cauda && limpo(end.rua.slice(0, cauda.index)).split(' ').length >= 2) {
        candidatos.push(cauda[1]);
        soDaCauda = true;
      }
    }

    var melhor = null, bruto = '';
    candidatos.forEach(function (c) {
      var limpoC = limpo(c.replace(/^BAIRRO\s+/i, '').replace(/\s*[\/-]\s*[A-Z]{2}$/i, ''));

      /* Bairro não tem número. "CHACARA nº 808" virou bairro na lista de
         paradas — o número era o da casa. Sai o número, e o que sobra só
         vira bairro se casar com a lista; senão é complemento, que é o
         que "CHACARA 2" quase sempre é. */
      if (/\d/.test(limpoC)) {
        var numeroDentro = limpoC.match(/(?:N[ºO°.]{0,2}\s*)?(\d{1,6}[A-Za-z]?)/i);
        if (numeroDentro && !end.numero) end.numero = numeroDentro[1];
        limpoC = limpo(limpoC.replace(/(?:N[ºO°.]{0,2}\s*)?\d{1,6}[A-Za-z]?/i, '').replace(/[,;.]+$/, ''));
        if (limpoC && !casarBairro(limpoC, end.cidade)) {
          end.complemento = end.complemento ? end.complemento + ', ' + limpoC : limpoC;
          return;
        }
      }
      if (!limpoC) return;
      var m = casarBairro(limpoC, end.cidade);
      if (m && (!melhor || m.nota > melhor.nota)) { melhor = m; bruto = limpoC; }
      else if (!bruto && !soDaCauda && limpoC && !cidadeNoTexto(limpoC)) bruto = limpoC;
    });

    if (melhor) {
      /* "Vista da Serra" existe na lista como I e II. A folha não diz
         qual — chutar um dos dois manda o motoboy para o bairro errado,
         então fica o que está impresso e a cidade vem do casamento. */
      var soNumeral = new RegExp('^' + palavrasDeBairro(bruto).join('\\s+') + '\\s+(I{1,3}|IV|V|\\d)$', 'i')
        .test(palavrasDeBairro(melhor.bairro).join(' '));
      end.bairro = soNumeral ? limpo(bruto) : melhor.bairro;
      end.bairroOficial = melhor.bairro;
      if (!end.cidade) end.cidade = melhor.cidade;
      /* O bairro casou dentro do texto da rua ("Rua das Hortênsias, 260,
         Vista da Serra"): tira de lá para não sair duplicado. */
      if (bruto && end.rua && semAcento(end.rua).indexOf(semAcento(bruto)) > 0) {
        end.rua = limpo(end.rua.replace(new RegExp('\\s*(BAIRRO\\s+)?' + bruto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i'), ''));
      }
    } else if (bruto) {
      end.bairro = bruto;
    }

    end.rua = limpo(end.rua.replace(/[,;]$/, ''));
    return end;
  }

  // ── NOME ────────────────────────────────────────────────────
  /* Timbre e cabeçalho não são nome de cliente. Procurados em qualquer
     posição da linha: numa das folhas o timbre saiu "MM FERNANDO
     MIRANDA", com o logo virando letra. */
  var CABECALHOS = /AUSENCIA DE CONTATO|FERNANDO MIRANDA|ADVOGADOS|DECLARO|CIENTE\/RECEBI|INFORMACOES ACIMA|^EU,? |INSCRIT[OA]/;

  /* Palavra que aparece grudada no nome mas não é nome de ninguém. Vem de
     três lugares: o rótulo comido pelo OCR ("CLIENTE:" saiu "co PR UR",
     "POR TE", "SS. PRE"), o texto do formulário em volta
     ("REPRESENTADO(A) POR") e o timbre do escritório. */
  var PALAVRAS_LIXO = {
    POR:1, PARA:1, PRE:1, PRO:1, REPRESENTADO:1, 'REPRESENTADO(A)':1, REPRESENTADA:1,
    CLIENTE:1, CONTRATO:1, TELEFONE:1, ENDERECO:1, MOTIVO:1, CONTATO:1,
    OBSERVACOES:1, AUSENCIA:1, ESCRITORIO:1, PROCESSO:1, ADVOGADOS:1,
    FERNANDO:1, MIRANDA:1, ASSERTIVA:1, ATUAL:1, EU:1, SR:1, SRA:1
  };
  function ehLixo(palavra) {
    var k = semAcento(palavra);
    if (!k || PALAVRAS_LIXO[k] === 1 || k.length <= 2 || /[^A-Z]/.test(k)) return true;
    /* MAIÚSCULA emendada em minúscula ("ANTos", "MORcccss") não é palavra
       de gente: é o OCR juntando o fim de uma linha com o começo de
       outra. Nome de verdade sai TODO MAIÚSCULO ou Assim Capitalizado. */
    return /^[A-ZÀ-Ú]{2,}[a-zà-ú]+$/.test(limpo(palavra));
  }

  /* Tira o lixo da frente e de trás do nome, e corta no ponto em que o
     nome acaba e o formulário recomeça ("...DAS NEVES REPRESENTADO(A)").

     A versão anterior só derrubava token de até duas letras, para não
     comer nome curto de gente (ANA, EVA, IVO). Não bastou: "POR TE
     BRUNO ALVES DAS NEVES" chegou inteiro na lista de paradas.
     Agora existe lista de palavra-lixo, e o que sobra ainda passa por
     nomeValido() — nome que não convence sai VAZIO e marcado, porque
     inventar um nome é pior do que admitir que não deu para ler. */
  function limparNome(nome) {
    var t = limpo(String(nome).split(/\bREPRESENTAD/i)[0])
      .replace(/^[\s.,;:|!()'"\-]+/, '')
      .replace(/[\s.,;:|!'"]+$/, '')
      .split(' ');
    while (t.length > 1 && ehLixo(t[0]))            t.shift();
    while (t.length > 1 && ehLixo(t[t.length - 1])) t.pop();
    return t.join(' ');
  }

  /* Nome de gente tem pelo menos duas palavras de verdade. "co PR UR" e
     "PRE" não passam — e um cliente sem nome na tela é um cliente que o
     motoboy digita em dois toques, olhando a folha que está na mão. */
  function nomeValido(nome) {
    var t = limpo(nome).split(' ').filter(Boolean);
    if (t.length < 2) return false;
    if (t.some(ehLixo) && t.filter(function (p) { return !ehLixo(p); }).length < 2) return false;
    return t.filter(function (p) { return semAcento(p).length >= 3; }).length >= 2;
  }

  function ehLinhaDeNome(linha) {
    var k = semAcento(linha);
    if (!k || CABECALHOS.test(k)) return false;
    if (/\d/.test(k)) return false;
    var palavras = k.replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(function (p) { return p.length > 1; });
    return palavras.length >= 3;
  }

  /* "JOANA PEREIRA DOS REIS — MARTA PEREIRA DA COSTA
     REIS": a folha põe cliente e responsável na mesma linha, separados
     por travessão. E "representado por FULANA" diz a mesma coisa com
     palavras.

     O travessão aceita espaço de um lado só: "MARIANA CASTRO ROMANO-
     LARISSA CASSHOFF" veio assim da folha e antes saía como um nome só,
     com os dois grudados. */
  var SEPARADOR = /\s+[-–—]\s*|\s*[-–—]\s+|\s*\bREPRESENTAD[OA]\(?A?\)?\s+POR\s+/i;

  function separarResponsavel(nome) {
    var m = String(nome).split(SEPARADOR);
    if (m.length >= 2 && limpo(m[0]) && limpo(m[1])) {
      return { cliente: limpo(m[0]), responsavel: limpo(m.slice(1).join(' ')) };
    }
    return { cliente: limpo(nome), responsavel: '' };
  }

  // ── DATA E HORA (perícia, avaliação social) ──────────────────
  function lerCompromisso(texto) {
    if (!texto) return null;
    var d = texto.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    var h = texto.match(/\b(\d{1,2})\s*[:hH]\s*(\d{2})\b/);
    if (!d && !h) return null;
    return {
      data: d ? d[1] + '/' + d[2] + '/' + d[3] : '',
      hora: h ? (h[1].length === 1 ? '0' + h[1] : h[1]) + ':' + h[2] : '',
      local: limpo(texto.replace(/^[^)]*\)\s*/, '').replace(/\b\d{2}\/\d{2}\/\d{4}\b/, '').replace(/\b(?:as|às)?\s*\d{1,2}\s*[:hH]\s*\d{2}\b/, '')),
      texto: limpo(texto)
    };
  }

  /* Rede de segurança, independente do formato da folha: qualquer texto
     que o documento devolva sai sem o número. A folha de amanhã pode ter
     o CPF num lugar novo — a garantia não pode depender do layout. */
  function semCpf(t) {
    return String(t || '').replace(new RegExp(RE_CPF.source, 'g'), '•••.•••.•••-••');
  }

  // ── LEITURA ─────────────────────────────────────────────────
  function lerDocumento(texto) {
    var bs = blocos(texto);
    var doc = {
      cliente: '', responsavel: '', assinante: '',
      telefones: [], enderecos: [],
      motivo: '', observacoes: '', compromissos: [],
      revisar: [], confianca: 0, texto: semCpf(texto)
    };

    // ── assinatura: "Eu, FULANO, inscrito no CPF: 000.000.000-00"
    var assin = String(texto || '').match(/\bEu,?\s+([A-ZÀ-Ú][A-Za-zÀ-ú\s.]{5,80}?)\s*,\s*inscrit/i);
    if (assin) doc.assinante = limpo(assin[1]).replace(/[\s.,;|]+$/, '');
    /* O número do CPF é reconhecido, mas NUNCA é devolvido: o motoboy não
       precisa dele para entregar, e o que não é coletado não vaza, não vai
       para o localStorage e não entra na fatura. A folha continua com ele
       impressa — quem precisa conferir, confere no papel. Aqui ele serve
       só para duas coisas: achar o nome de quem assina e impedir que os
       onze dígitos sejam lidos como telefone do cliente. */

    bs.forEach(function (b) {
      if (b.campo === 'cliente') {
        var nome = b.texto;
        // O nome pode continuar na linha de baixo, ainda sem rótulo
        var p = separarResponsavel(nome);
        doc.cliente = limparNome(p.cliente); doc.responsavel = limparNome(p.responsavel);
      } else if (b.campo === 'telefone') {
        telefonesDaLinha(b.texto).forEach(function (n) {
          doc.telefones.push({ numero: n, tipo: b.tipo || 'contrato' });
        });
      } else if (b.campo === 'endereco') {
        var e = lerEndereco(b.texto);
        e.tipo = b.tipo || (doc.enderecos.length ? 'assertiva' : 'contrato');
        if (e.rua) doc.enderecos.push(e);
      } else if (b.campo === 'motivo') {
        doc.motivo = semCpf(b.texto);
      } else if (b.campo === 'observacoes') {
        doc.observacoes = semCpf(b.texto);
      } else if (b.campo === 'pericia' || b.campo === 'avaliacao') {
        var c = lerCompromisso(b.texto);
        if (c) { c.tipo = b.campo === 'pericia' ? 'Perícia' : 'Avaliação social'; doc.compromissos.push(c); }
      }
    });

    /* Nome sem rótulo: em duas das seis folhas fotografadas o "CLIENTE:"
       saiu ilegível, e o nome ao lado veio perfeito. Cai na assinatura,
       e se nem ela existir, na primeira linha do topo que pareça nome. */
    if (!doc.cliente) {
      var topo = bs.slice(0, 8).filter(function (b) { return !b.campo; });
      /* Só vale o candidato que sobrevive à limpeza. Antes, a primeira
         linha com cara de nome era aceita de cara — e o timbre borrado
         ("— PR Re A MORcccss") ficava com a vaga, deixando o nome de
         verdade, três linhas abaixo, sem ser olhado. */
      for (var i = 0; i < topo.length && !doc.cliente; i++) {
        if (!ehLinhaDeNome(topo[i].texto)) continue;
        /* O nome e o "POR FULANA" que vem depois dele são a MESMA frase da
           folha, quebrada em duas linhas pelo OCR. Sem juntar, o cliente
           saía certo e o responsável sumia. */
        var junto = topo[i].texto;
        if (topo[i + 1] && /^(POR|REPRESENTAD)/i.test(semAcento(topo[i + 1].texto))) {
          junto += ' ' + topo[i + 1].texto;
        }
        var p2 = separarResponsavel(junto);
        if (!nomeValido(limparNome(p2.cliente))) continue;
        doc.cliente = p2.cliente;
        doc.responsavel = doc.responsavel || limparNome(p2.responsavel);
      }
      if (!doc.cliente && doc.assinante) doc.cliente = doc.assinante;
      /* A assinatura repete o nome no fim da folha, em linha limpa. Se
         ela estiver dentro da linha suja, é a versão boa do mesmo nome. */
      if (doc.assinante && semAcento(doc.cliente).indexOf(semAcento(doc.assinante)) !== -1) {
        doc.cliente = doc.assinante;
      }
      doc.cliente = limparNome(doc.cliente);
      /* Nome que não convence sai VAZIO. "co PR UR" foi parar na lista de
         paradas como se fosse gente; um campo em branco com aviso manda o
         motoboy olhar a folha, que está na mão dele. */
      if (!nomeValido(doc.cliente)) doc.cliente = '';
      doc.revisar.push('cliente');
    }

    if (semAcento(doc.responsavel) === semAcento(doc.cliente)) doc.responsavel = '';
    if (!doc.responsavel && doc.assinante &&
        semAcento(doc.assinante) !== semAcento(doc.cliente) &&
        semAcento(doc.cliente).indexOf(semAcento(doc.assinante)) === -1) {
      doc.responsavel = limparNome(doc.assinante);
    }

    // Telefone fora de rótulo (folha sem "TELEFONE:"), menos o do escritório
    if (!doc.telefones.length) {
      String(texto || '').split(/\r?\n/).forEach(function (linha) {
        if (/ESCRIT[OÓ]RIO|OBSERVA/i.test(linha)) return;
        telefonesDaLinha(linha).forEach(function (n) { doc.telefones.push({ numero: n, tipo: '' }); });
      });
    }
    // Sem duplicata, e o telefone do escritório nunca vira telefone de cliente
    var vistos = {};
    doc.telefones = doc.telefones.filter(function (t) {
      if (vistos[t.numero]) return false;
      vistos[t.numero] = 1;
      return true;
    });

    doc.confianca = [doc.cliente, doc.telefones.length, doc.enderecos.length, doc.motivo]
      .filter(Boolean).length / 4;

    return doc;
  }

  // ── PONTUAÇÃO DE ORIENTAÇÃO ─────────────────────────────────
  /* A folha fotografada de lado sai do OCR como sopa de letra. Em vez de
     baixar o modelo de orientação do Tesseract (mais 10 MB e mais um
     passo), contamos quantos rótulos conhecidos apareceram: a folha certa
     dá dez e a virada dá zero. Ver § 44 no index.html. */
  var PISTAS = /CLIENTE|TELEFONE|ENDERECO|CONTATO|MOTIVO|OBSERVACOES|CPF|AUSENCIA|PERICIA/g;
  function pontuarOrientacao(texto) {
    return (semAcento(texto).replace(/[^A-Z0-9 ]/g, ' ').match(PISTAS) || []).length;
  }

  // ── DOCUMENTO → PARADA ──────────────────────────────────────
  /* Devolve exatamente os campos que o formulário de parada usa, para o
     app só preencher os inputs. Endereço do contrato por padrão; o do
     "assertiva" é oferecido na tela porque às vezes é o mais atual.

     NOME E ENDEREÇO, e nada além disso. A primeira versão despejava
     responsável, motivo, datas de perícia e telefones extras dentro das
     observações — e na lista de paradas, que mostra as observações
     embaixo do endereço, o motivo da diligência aparecia colado no
     endereço, três linhas de texto jurídico por parada. Quem entrega
     precisa de para onde ir e para quem. O resto está na folha, que vai
     junto na mochila. */
  function paradaDoDocumento(doc, indiceEndereco) {
    var end = doc.enderecos[indiceEndereco || 0] || doc.enderecos[0] || {};
    return {
      name:         doc.cliente || '',
      phone:        doc.telefones.length ? doc.telefones[0].numero : '',
      street:       end.rua || '',
      number:       end.numero || '',
      neighborhood: end.bairro || '',
      city:         end.cidade || '',
      complement:   end.complemento || '',
      notes:        ''
    };
  }

  SB.doc = {
    lerDocumento: lerDocumento,
    paradaDoDocumento: paradaDoDocumento,
    pontuarOrientacao: pontuarOrientacao,
    // expostos para o teste e para reuso
    lerEndereco: lerEndereco,
    ehTelefone: ehTelefone,
    telefonesDaLinha: telefonesDaLinha,
    casarBairro: casarBairro
  };
})(typeof window !== 'undefined' ? window : globalThis);
