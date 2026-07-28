/* ═══════════════════════════════════════════════════════════════
   SPEEDBOY · Padrão único de fatura — schema "speedboy.fatura/v1"
   Porte fiel do render_fatura.py (ReportLab) para jsPDF.

   Usado por:
     • index.html  → gera as faturas por loja e o fechamento do período
     • fatura.html → página do cliente (conferência + download)

   API:
     SBFatura.normalizar(dados)            → preenche defaults e totais
     SBFatura.gerarDoc(dados)              → Promise<jsPDF doc>
     SBFatura.baixar(dados, nomeArquivo)   → Promise<void> (salva o PDF)
     SBFatura.nomeArquivo(dados)           → nome sugerido do arquivo
     SBFatura.preview(dados, el)           → desenha a conferência em HTML
   ═══════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var CDN_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  var EMISSOR_PADRAO = {
    nome: 'SPEEDBOY',
    subtitulo: 'Motoboy Express',
    cnpj: '46.178.859/0001-96',
    telefone: '(27) 99916-5959',
    email: 'speedboymotoboy@gmail.com'
  };

  var CONFIG_PADRAO = {
    cor_destaque: '#FF6B00',
    pagina: 'A4',
    colunas_tabela: 2,
    siglas_cidade: { 'Serra': 'SRR', 'Vitória': 'VIX', 'Vila Velha': 'VV', 'Cariacica': 'CCA', 'Viana': 'VNA' },
    siglas_tipo: { 'Entrega': 'E', 'Coleta': 'C', 'Troca': 'T', 'Cancelada': 'X' }
  };

  var RESUMOS_PADRAO = [
    { titulo: 'POR CIDADE', chave: 'cidade' },
    { titulo: 'POR TIPO DE SERVIÇO', chave: 'tipo' }
  ];

  // ── paleta (idêntica ao render_fatura.py) ──
  var DARK = '#111418', GREY = '#6B7280', LGREY = '#E5E7EB', BG = '#F7F8FA',
      WHITE = '#FFFFFF', GREY2 = '#9CA3AF';

  // ═══════════════ helpers ═══════════════
  function brl(v) {
    var n = (parseFloat(v) || 0).toFixed(2);
    var p = n.split('.');
    return 'R$ ' + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + p[1];
  }

  function dBR(iso) {
    if (!iso) return '';
    var m = String(iso).slice(0, 10).split('-');
    if (m.length !== 3) return String(iso);
    return m[2] + '/' + m[1] + '/' + m[0];
  }

  function rgb(hex) {
    var h = String(hex || '#000').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function loadJS(src) {
    return new Promise(function (res, rej) {
      if (document.querySelector('script[src="' + src + '"]')) { res(); return; }
      var s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  // ═══════════════ normalização ═══════════════
  function normalizar(dados) {
    var d = JSON.parse(JSON.stringify(dados || {}));
    d.schema = d.schema || 'speedboy.fatura/v1';
    d.emissor = Object.assign({}, EMISSOR_PADRAO, d.emissor || {});
    d.fatura = d.fatura || {};
    d.fatura.periodo = d.fatura.periodo || { inicio: '', fim: '' };
    d.fatura.moeda = d.fatura.moeda || 'BRL';
    d.fatura.emissao = d.fatura.emissao || new Date().toISOString();
    d.pagamento = d.pagamento || { recebido: 0 };
    d.config = Object.assign({}, CONFIG_PADRAO, d.config || {});
    d.config.siglas_cidade = Object.assign({}, CONFIG_PADRAO.siglas_cidade, d.config.siglas_cidade || {});
    d.config.siglas_tipo = Object.assign({}, CONFIG_PADRAO.siglas_tipo, d.config.siglas_tipo || {});
    d.resumos = (d.resumos && d.resumos.length) ? d.resumos : RESUMOS_PADRAO;
    d.itens = (d.itens || []).map(function (i, idx) {
      return {
        n: i.n || idx + 1,
        data: i.data || '',
        cliente: i.cliente || '—',
        bairro: i.bairro || '',
        cidade: i.cidade || '',
        tipo: i.tipo || 'Entrega',
        loja: i.loja || '',
        valor: parseFloat(i.valor) || 0,
        cancelado: !!i.cancelado
      };
    });

    var total = d.itens.reduce(function (a, i) { return a + i.valor; }, 0);
    var recebido = parseFloat(d.pagamento.recebido) || 0;
    d.totais = {
      servicos: d.itens.filter(function (i) { return !i.cancelado; }).length,
      cancelados: d.itens.filter(function (i) { return i.cancelado; }).length,
      total: total,
      recebido: recebido,
      a_receber: total - recebido
    };
    return d;
  }

  function agrupar(itens, chave, total) {
    var mapa = {};
    itens.forEach(function (i) {
      var k = i[chave] || '—';
      if (!mapa[k]) mapa[k] = { q: 0, v: 0 };
      mapa[k].q += 1;
      mapa[k].v += i.valor;
    });
    return Object.keys(mapa).map(function (k) {
      return { nome: k, q: mapa[k].q, v: mapa[k].v, pct: total ? (mapa[k].v / total * 100) : 0 };
    }).sort(function (a, b) { return b.v - a.v; });
  }

  // ═══════════════ adaptador ReportLab → jsPDF ═══════════════
  // ReportLab: origem embaixo-esquerda. jsPDF: origem em cima-esquerda.
  function adaptar(doc, H) {
    return {
      // no ReportLab setFillColor vale para formas e texto; no jsPDF são separados
      fill: function (hex) {
        var c = rgb(hex);
        doc.setFillColor(c[0], c[1], c[2]);
        doc.setTextColor(c[0], c[1], c[2]);
      },
      stroke: function (hex) { var c = rgb(hex); doc.setDrawColor(c[0], c[1], c[2]); },
      lw: function (w) { doc.setLineWidth(w); },
      font: function (bold, size) { doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); },
      rect: function (x, y, w, h, fill, strk) {
        var st = fill && strk ? 'FD' : (fill ? 'F' : 'S');
        doc.rect(x, H - y - h, w, h, st);
      },
      text: function (x, y, txt) { doc.text(String(txt), x, H - y); },
      textR: function (x, y, txt) { doc.text(String(txt), x, H - y, { align: 'right' }); },
      width: function (txt, size, bold) {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        return doc.getTextWidth(String(txt));
      }
    };
  }

  // ═══════════════ renderização do PDF ═══════════════
  function render(dadosBrutos, doc) {
    var d = normalizar(dadosBrutos);
    var f = d.fatura, em = d.emissor, cfg = d.config;
    var siglas = cfg.siglas_cidade, siglasTipo = cfg.siglas_tipo;
    var itens = d.itens;
    var total = d.totais.total, aReceber = d.totais.a_receber;

    var ACCENT = cfg.cor_destaque || '#FF6B00';
    var W = doc.internal.pageSize.getWidth();
    var H = doc.internal.pageSize.getHeight();
    var M = 16;
    var c = adaptar(doc, H);

    doc.setProperties({ title: (f.titulo || 'Fatura') + ' - ' + em.nome });

    var resumos = d.resumos.map(function (r) {
      return { titulo: r.titulo, linhas: agrupar(itens, r.chave, total) };
    });

    // ---------- cabeçalho ----------
    var hy = H - M - 52;
    c.fill(DARK); c.rect(M, hy, W - 2 * M, 52, true, false);
    c.fill(ACCENT); c.rect(M, hy, 4, 52, true, false);
    c.fill(WHITE); c.font(true, 15);
    c.text(M + 14, hy + 31, em.nome);
    c.font(false, 7.5); c.fill(GREY2);
    c.text(M + 14, hy + 20, em.subtitulo + '  ·  CNPJ ' + em.cnpj);
    c.text(M + 14, hy + 10, em.telefone + '  ·  ' + em.email);
    c.fill(WHITE); c.font(true, 11);
    c.textR(W - M - 14, hy + 34, f.titulo || '');
    c.font(false, 7.5); c.fill(GREY2);
    c.textR(W - M - 14, hy + 23, (f.numero || '') + '  ·  ' + dBR(f.periodo.inicio) + ' a ' + dBR(f.periodo.fim));
    c.textR(W - M - 14, hy + 12, 'Emitido em ' + dBR(String(f.emissao).slice(0, 10)));

    // ---------- KPIs ----------
    var ky = hy - 42;
    var kw = (W - 2 * M - 18) / 4;
    var kpis = [
      ['SERVIÇOS', String(d.totais.servicos), DARK],
      ['TOTAL', brl(total), DARK],
      ['RECEBIDO', brl(d.totais.recebido), GREY],
      ['A RECEBER', brl(aReceber), ACCENT]
    ];
    kpis.forEach(function (k, i) {
      var x = M + i * (kw + 6);
      c.fill(BG); c.stroke(LGREY); c.lw(0.5);
      c.rect(x, ky, kw, 38, true, true);
      c.fill(GREY); c.font(true, 6);
      c.text(x + 8, ky + 26, k[0]);
      c.fill(k[2]); c.font(true, 13);
      c.text(x + 8, ky + 9, k[1]);
    });

    // ---------- blocos de resumo ----------
    var ry = ky - 8;
    var bw = (W - 2 * M - 8) / 2;
    var maxLinhas = resumos.reduce(function (a, r) { return Math.max(a, r.linhas.length); }, 0);
    var bh = 14 + 11 * maxLinhas + 6;

    function bloco(x, y, w, titulo, linhas) {
      c.fill(WHITE); c.stroke(LGREY); c.lw(0.5);
      c.rect(x, y - bh, w, bh, true, true);
      c.fill(DARK); c.rect(x, y - 13, w, 13, true, false);
      c.fill(WHITE); c.font(true, 6.5);
      c.text(x + 7, y - 9, titulo);
      c.textR(x + w - 100, y - 9, 'QTD');
      c.textR(x + w - 55, y - 9, 'VALOR');
      c.textR(x + w - 7, y - 9, '%');
      var yy = y - 23;
      linhas.forEach(function (l) {
        c.font(false, 7); c.fill(DARK);
        c.text(x + 7, yy, l.nome);
        c.fill(GREY); c.textR(x + w - 100, yy, String(l.q));
        c.fill(DARK); c.font(true, 7);
        c.textR(x + w - 55, yy, brl(l.v));
        c.font(false, 7); c.fill(ACCENT);
        c.textR(x + w - 7, yy, Math.round(l.pct) + '%');
        yy -= 11;
      });
    }

    resumos.slice(0, 2).forEach(function (r, i) {
      bloco(M + i * (bw + 8), ry, bw, r.titulo, r.linhas);
    });

    // ---------- tabela em 2 colunas ----------
    var COLW = (W - 2 * M - 10) / 2;
    var CW = [15, 27, 84, 74, 20, 12, 33];
    var CABECALHOS = ['Nº', 'DATA', 'CLIENTE', 'BAIRRO', 'CID', 'T', 'VALOR'];
    var ROWH_MIN = 6.6, ROWH_MAX = 11.5, RESERVA_RODAPE = 80;

    function trunc(txt, maxw, size) {
      txt = String(txt == null ? '' : txt);
      while (c.width(txt, size, false) > maxw && txt.length > 1) txt = txt.slice(0, -1);
      return txt;
    }

    function capacidade(topo) {
      return Math.max(1, Math.floor(((topo - RESERVA_RODAPE) - 12) / ROWH_MIN));
    }

    function desenha(x, y, linhas, rowh) {
      c.fill(DARK); c.rect(x, y - 12, COLW, 12, true, false);
      c.fill(WHITE); c.font(true, 6.0);
      var cx = x + 4;
      CABECALHOS.forEach(function (lb, i) {
        if (i === 6) c.textR(x + COLW - 4, y - 8.5, lb);
        else c.text(cx, y - 8.5, lb);
        cx += CW[i];
      });
      var yy = y - 12;
      linhas.forEach(function (r, idx) {
        yy -= rowh;
        if (idx % 2 === 0) { c.fill(BG); c.rect(x, yy - 1.5, COLW, rowh, true, false); }
        var corTexto = r.cancelado ? GREY : DARK;
        var cx2 = x + 4;
        c.font(false, 6.3); c.fill(GREY);
        c.text(cx2, yy + 1, String(r.n)); cx2 += CW[0];
        c.text(cx2, yy + 1, dBR(r.data).slice(0, 5)); cx2 += CW[1];
        c.fill(corTexto);
        c.text(cx2, yy + 1, trunc(r.cliente, CW[2] - 3, 6.3)); cx2 += CW[2];
        c.fill(GREY);
        c.text(cx2, yy + 1, trunc(r.bairro, CW[3] - 3, 6.3)); cx2 += CW[3];
        c.text(cx2, yy + 1, siglas[r.cidade] || String(r.cidade || '').slice(0, 3).toUpperCase()); cx2 += CW[4];
        c.fill(r.cancelado ? GREY : (r.tipo !== 'Entrega' ? ACCENT : GREY));
        c.text(cx2, yy + 1, siglasTipo[r.tipo] || String(r.tipo || '').charAt(0));
        c.fill(corTexto); c.font(true, 6.3);
        c.textR(x + COLW - 4, yy + 1, r.cancelado ? '—' : brl(r.valor).replace('R$ ', ''));
      });
      return yy;
    }

    // Distribui os itens entre as páginas (a 1ª tem menos espaço por causa do resumo)
    var topo1 = ry - bh - 10;
    var topoN = H - M - 24;
    var paginas = [];
    var restante = itens.slice();
    var cap1 = capacidade(topo1) * 2;
    paginas.push({ topo: topo1, itens: restante.splice(0, cap1), primeira: true });
    while (restante.length) {
      var capN = capacidade(topoN) * 2;
      paginas.push({ topo: topoN, itens: restante.splice(0, capN), primeira: false });
    }

    paginas.forEach(function (pg, pi) {
      if (pi > 0) {
        doc.addPage();
        // faixa de continuação
        c.fill(DARK); c.rect(M, H - M - 20, W - 2 * M, 20, true, false);
        c.fill(ACCENT); c.rect(M, H - M - 20, 4, 20, true, false);
        c.fill(WHITE); c.font(true, 8);
        c.text(M + 14, H - M - 13, em.nome + '  ·  ' + (f.titulo || ''));
        c.font(false, 7); c.fill(GREY2);
        c.textR(W - M - 14, H - M - 13, (f.numero || '') + '  ·  continuação');
      }
      var metade = Math.ceil(pg.itens.length / 2);
      var espaco = pg.topo - RESERVA_RODAPE;
      var rowh = Math.max(ROWH_MIN, Math.min(ROWH_MAX, (espaco - 12) / Math.max(metade, 1)));
      desenha(M, pg.topo, pg.itens.slice(0, metade), rowh);
      var fim = desenha(M + COLW + 10, pg.topo, pg.itens.slice(metade), rowh);
      pg._fim = fim;
    });

    // ---------- rodapé ----------
    var ultima = paginas[paginas.length - 1];
    var fy = Math.max(M + 22, ultima._fim - 36);
    c.fill(DARK); c.rect(M, fy - 6, W - 2 * M, 26, true, false);
    c.fill(ACCENT); c.rect(M, fy - 6, 4, 26, true, false);
    c.fill(WHITE); c.font(true, 8);
    c.text(M + 14, fy + 4, 'TOTAL A RECEBER');
    c.fill(ACCENT); c.font(true, 15);
    c.textR(W - M - 14, fy + 1, brl(aReceber));

    // numeração (apenas quando há mais de uma página)
    var nPags = doc.internal.getNumberOfPages();
    if (nPags > 1) {
      for (var p = 1; p <= nPags; p++) {
        doc.setPage(p);
        c.fill(GREY); c.font(false, 6);
        c.textR(W - M, M - 4, p + '/' + nPags);
      }
    }

    return d;
  }

  // ═══════════════ API pública ═══════════════
  async function gerarDoc(dados) {
    if (!global.jspdf || !global.jspdf.jsPDF) await loadJS(CDN_JSPDF);
    var jsPDF = global.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    render(dados, doc);
    return doc;
  }

  function nomeArquivo(dados) {
    var d = normalizar(dados);
    var num = (d.fatura.numero || 'FATURA').replace(/[^\w-]+/g, '_');
    return 'fatura_' + num + '.pdf';
  }

  async function baixar(dados, nome) {
    var doc = await gerarDoc(dados);
    doc.save(nome || nomeArquivo(dados));
  }

  // ═══════════════ conferência em HTML (página do cliente) ═══════════════
  function preview(dados, el) {
    var d = normalizar(dados);
    var f = d.fatura, em = d.emissor, cfg = d.config;
    var ACCENT = cfg.cor_destaque || '#FF6B00';
    var total = d.totais.total;

    var kpis = [
      ['SERVIÇOS', String(d.totais.servicos), '#111418'],
      ['TOTAL', brl(total), '#111418'],
      ['RECEBIDO', brl(d.totais.recebido), '#6B7280'],
      ['A RECEBER', brl(d.totais.a_receber), ACCENT]
    ];

    var blocos = d.resumos.map(function (r) {
      var linhas = agrupar(d.itens, r.chave, total);
      return '<div class="fp-bloco"><div class="fp-bloco-h"><span>' + esc(r.titulo) + '</span>' +
        '<span class="fp-bloco-cols"><i>QTD</i><i>VALOR</i><i>%</i></span></div>' +
        linhas.map(function (l) {
          return '<div class="fp-bloco-l"><span>' + esc(l.nome) + '</span>' +
            '<span class="fp-bloco-cols"><i>' + l.q + '</i><b>' + brl(l.v) + '</b>' +
            '<i style="color:' + ACCENT + '">' + Math.round(l.pct) + '%</i></span></div>';
        }).join('') + '</div>';
    }).join('');

    var linhas = d.itens.map(function (i) {
      // .sub só aparece no celular, onde bairro/cidade/tipo saem de colunas próprias
      var sub = [i.bairro, i.cidade, i.tipo].filter(Boolean).join(' · ');
      return '<tr' + (i.cancelado ? ' class="canc"' : '') + '>' +
        '<td>' + i.n + '</td>' +
        '<td>' + esc(dBR(i.data)) + '</td>' +
        '<td>' + esc(i.cliente) + '<i class="sub">' + esc(sub) + '</i></td>' +
        '<td>' + esc(i.bairro) + '</td>' +
        '<td>' + esc(i.cidade) + '</td>' +
        '<td>' + esc(i.tipo) + '</td>' +
        '<td class="v">' + (i.cancelado ? '—' : brl(i.valor)) + '</td></tr>';
    }).join('');

    el.innerHTML =
      '<div class="fp-head">' +
        '<div><div class="fp-nome">' + esc(em.nome) + '</div>' +
        '<div class="fp-sub">' + esc(em.subtitulo) + '  ·  CNPJ ' + esc(em.cnpj) + '</div>' +
        '<div class="fp-sub">' + esc(em.telefone) + '  ·  ' + esc(em.email) + '</div></div>' +
        '<div class="fp-head-r"><div class="fp-titulo">' + esc(f.titulo || '') + '</div>' +
        '<div class="fp-sub">' + esc(f.numero || '') + '  ·  ' + dBR(f.periodo.inicio) + ' a ' + dBR(f.periodo.fim) + '</div>' +
        '<div class="fp-sub">Emitido em ' + dBR(String(f.emissao).slice(0, 10)) + '</div></div>' +
      '</div>' +
      '<div class="fp-kpis">' + kpis.map(function (k) {
        return '<div class="fp-kpi"><div class="fp-kpi-l">' + k[0] + '</div><div class="fp-kpi-v" style="color:' + k[2] + '">' + k[1] + '</div></div>';
      }).join('') + '</div>' +
      '<div class="fp-blocos">' + blocos + '</div>' +
      '<div class="fp-tab-wrap"><table class="fp-tab"><thead><tr>' +
        '<th>Nº</th><th>DATA</th><th>CLIENTE</th><th>BAIRRO</th><th>CIDADE</th><th>TIPO</th><th class="v">VALOR</th>' +
      '</tr></thead><tbody>' + linhas + '</tbody></table></div>' +
      '<div class="fp-total"><span>TOTAL A RECEBER</span><b style="color:' + ACCENT + '">' + brl(d.totais.a_receber) + '</b></div>';

    return d;
  }

  global.SBFatura = {
    normalizar: normalizar,
    agrupar: agrupar,
    render: render,
    gerarDoc: gerarDoc,
    baixar: baixar,
    nomeArquivo: nomeArquivo,
    preview: preview,
    brl: brl,
    dBR: dBR,
    EMISSOR_PADRAO: EMISSOR_PADRAO,
    CONFIG_PADRAO: CONFIG_PADRAO
  };
})(typeof window !== 'undefined' ? window : this);
