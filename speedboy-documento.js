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
     o 9 na frente do número — ver ehTelefone().

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
    { campo: 'cliente',     re: /^C[LI1|]{1,2}[EF]NTE\b/ },
    { campo: 'telefone',    re: /^TELEFONES?\b/ },
    { campo: 'endereco',    re: /^ENDERE[CG]O\b/ },
    { campo: 'motivo',      re: /^MOTIVO\b/ },
    { campo: 'observacoes', re: /^OBSERVA[CG][OA]ES\b/ },
    { campo: 'pericia',     re: /^PERICIA\b/ },
    { campo: 'avaliacao',   re: /^AVALIACAO SOCIAL\b/ }
  ];

  // Qualificador do rótulo: "DO CONTRATO", "DO ASSERTIVA", "ATUALIZADO"…
  function qualificador(cabeca) {
    var k = chaveDeRotulo(cabeca);
    if (/ASSERTIVA/.test(k)) return 'assertiva';
    if (/CONTRATO/.test(k))  return 'contrato';
    return '';
  }

  /* Divide a folha em blocos rotulados. Devolve na ordem em que
     aparecem, porque a ordem importa: o primeiro endereço da folha é o
     do contrato mesmo quando o rótulo dele saiu ilegível. */
  function blocos(texto) {
    var linhas = String(texto || '').split(/\r?\n/);
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
        for (var r = 0; r < ROTULOS.length; r++) {
          if (ROTULOS[r].re.test(cabeca)) {
            achado = { campo: ROTULOS[r].campo, tipo: qualificador(cabeca) };
            break;
          }
        }
      }

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
     de verdade. É o que impede o CPF 147.267.777-73 — onze dígitos —
     de entrar na parada como telefone do cliente. */
  function ehTelefone(d) {
    if (!/^\d{10,11}$/.test(d)) return false;
    var ddd = parseInt(d.slice(0, 2), 10);
    if (ddd < 11 || ddd > 99) return false;
    return d.length === 11 ? d[2] === '9' : /[2-5]/.test(d[2]);
  }

  /* O OCR mete espaço onde não tem: "147.267 .777-73" e
     "136.868.067-4 6" são os dois CPFs reais de duas das folhas. */
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
        // "Rua Santa Cecília, nº535" — número grudado na rua
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

    /* O que sobrou é candidato a bairro. "Vista da Serra CEP: 29176-392"
       vem grudado na rua sem vírgula — daí a segunda tentativa, olhando o
       fim da própria rua. */
    var candidatos = sobras.slice();
    var soDaCauda = false;
    if (!candidatos.length && end.rua) {
      var cauda = end.rua.match(/\s(?:BAIRRO\s+)?([A-Za-zÀ-ú][A-Za-zÀ-ú\s]{4,})$/);
      /* Só vale se sobrar rua depois de tirar o bairro: senão "Rua
         Marataizes" vira bairro "Marataizes" e a rua some. */
      if (cauda && limpo(end.rua.slice(0, cauda.index)).split(' ').length >= 2) {
        candidatos.push(cauda[1]);
        soDaCauda = true;
      }
    }

    var melhor = null, bruto = '';
    candidatos.forEach(function (c) {
      var limpoC = limpo(c.replace(/^BAIRRO\s+/i, '').replace(/\s*[\/-]\s*[A-Z]{2}$/i, ''));
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
      /* O bairro casou dentro do texto da rua ("Rua Marataizes, 260,
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
  var CABECALHOS = /AUSENCIA DE CONTATO|FERNANDO MIRANDA|ADVOGADOS|DECLARO|CIENTE\/RECEBI|INFORMACOES ACIMA/;

  /* "| VE RIQUELMY DA CRUZ DA SILVA": quando o rótulo CLIENTE é comido
     pelo OCR, sobra lixo na frente do nome. Só caem fora tokens com
     não-letra ou de até duas letras — três já pode ser nome de gente
     ("ANA MARIA DA SILVA"), e apagar nome de cliente é pior que deixar
     um "PRE" para o motoboy tirar na revisão. */
  function limparNome(nome) {
    var t = limpo(nome).replace(/^[\s.,;:|!()'"\-]+/, '').replace(/[\s.,;:|!'"]+$/, '').split(' ');
    while (t.length > 3 && (/[^A-Za-zÀ-ú]/.test(t[0]) || t[0].length <= 2)) t.shift();
    return t.join(' ');
  }

  function ehLinhaDeNome(linha) {
    var k = semAcento(linha);
    if (!k || CABECALHOS.test(k)) return false;
    if (/\d/.test(k)) return false;
    var palavras = k.replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(function (p) { return p.length > 1; });
    return palavras.length >= 3;
  }

  /* "MIRIAN SOARES BARBOSA DOS SANTOS — FABIANA SOARES DA SILVA DOS
     SANTOS": a folha põe cliente e responsável na mesma linha, separados
     por travessão. E "representado por FULANA" diz a mesma coisa com
     palavras. */
  function separarResponsavel(nome) {
    var m = String(nome).split(/\s+(?:[-–—]|REPRESENTADO\(?A?\)?\s+POR|REPRESENTADA\s+POR|REPRESENTADO\s+POR)\s+/i);
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

  // ── LEITURA ─────────────────────────────────────────────────
  function lerDocumento(texto) {
    var bs = blocos(texto);
    var doc = {
      cliente: '', responsavel: '', cpf: '', assinante: '',
      telefones: [], enderecos: [],
      motivo: '', observacoes: '', compromissos: [],
      revisar: [], confianca: 0, texto: String(texto || '')
    };

    // ── assinatura: "Eu, FULANO, inscrito no CPF: 000.000.000-00"
    var assin = String(texto || '').match(/\bEu,?\s+([A-ZÀ-Ú][A-Za-zÀ-ú\s.]{5,80}?)\s*,\s*inscrit/i);
    if (assin) doc.assinante = limpo(assin[1]).replace(/[\s.,;|]+$/, '');
    var cpf = String(texto || '').match(new RegExp('CPF\\s*:?\\s*(' + RE_CPF.source.replace(/\\b/g, '') + ')', 'i'));
    if (cpf) {
      var d = cpf[1].replace(/\D/g, '');
      if (d.length === 11) doc.cpf = d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
    }

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
        doc.motivo = b.texto;
      } else if (b.campo === 'observacoes') {
        doc.observacoes = b.texto;
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
      for (var i = 0; i < topo.length && !doc.cliente; i++) {
        if (!ehLinhaDeNome(topo[i].texto)) continue;
        var p2 = separarResponsavel(topo[i].texto);
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
      if (doc.cliente) doc.revisar.push('cliente');
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
     "assertiva" é oferecido na tela porque às vezes é o mais atual. */
  function paradaDoDocumento(doc, indiceEndereco) {
    var end = doc.enderecos[indiceEndereco || 0] || doc.enderecos[0] || {};
    var notas = [];
    if (doc.responsavel) notas.push('Responsável: ' + doc.responsavel);
    if (doc.cpf)         notas.push('CPF ' + doc.cpf);
    if (doc.motivo)      notas.push(doc.motivo.replace(/\s+/g, ' ').slice(0, 160));
    doc.compromissos.forEach(function (c) {
      notas.push(c.tipo + ' ' + [c.data, c.hora].filter(Boolean).join(' às '));
    });
    if (doc.telefones.length > 1) {
      notas.push('Outros telefones: ' + doc.telefones.slice(1).map(function (t) {
        return SB.fmtPhone ? SB.fmtPhone(t.numero) : t.numero;
      }).join(' / '));
    }

    return {
      name:         doc.cliente || '',
      phone:        doc.telefones.length ? doc.telefones[0].numero : '',
      street:       end.rua || '',
      number:       end.numero || '',
      neighborhood: end.bairro || '',
      city:         end.cidade || '',
      complement:   end.complemento || '',
      notes:        notas.join(' · ')
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
