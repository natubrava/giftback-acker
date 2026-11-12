// telas-extra.js — Telas "Relatórios" (matriz RFM) e "Campanhas".
// Recebe do app.js as ferramentas de tela (h, trocar, avisar...) para não duplicar código.
import * as M from './motor.js?v=20261112083317';
import { SEGMENTOS_RFM, classificarRFM, resumoGrupo, filtrarPublico, descreverPublico, segmentoRFM, limitesRFM, explicarSegmento } from './rfm.js?v=20261112083317';

// Em qual quadradinho da grade 5x5 aparece o nome de cada categoria (coluna = recência R, linha = frequência/valor FM).
const ROTULO = { nao_pode_perder: '2,5', fiel: '4,5', campeao: '5,5', em_risco: '2,4', atencao: '3,3', possivel_fiel: '5,3',
  hibernando: '2,2', quase_hibernando: '3,2', promissor: '4,1', novo: '5,1' };
// Categorias com 2 ou mais colunas de largura: o nome pode ficar numa linha só.
const LARGAS = new Set(['nao_pode_perder', 'fiel', 'em_risco', 'possivel_fiel', 'hibernando']);

export function criarTelasExtras(ctx) {
  const { h, trocar, tentar, avisar, tela, estado, nomeCompleto, dia, hoje, abrirWhatsApp, valorGift } = ctx;
  const dados = () => ctx.dados();
  const config = () => ctx.config();
  const pct = (n, total) => (total ? `${(n * 100 / total).toFixed(1).replace('.', ',')}%` : '0%');

  async function clientesRFM() {
    return classificarRFM(await dados().listarClientes(), hoje()).filter((c) => c.rfm);
  }

  function baixarCsv(nome, lista) {
    const linhas = [['Cliente', 'Telefone', 'Categoria', 'Última compra', 'Dias sem comprar', 'Compras', 'Total gasto', 'Giftback ativo']];
    for (const c of lista) {
      linhas.push([nomeCompleto(c), c.telefone, SEGMENTOS_RFM[c.rfm.segmento].nome, dia(c.ultimaCompra), c.rfm.diasSemComprar, c.compras,
        (c.totalCentavos / 100).toFixed(2).replace('.', ','), c.giftback ? (c.giftback.valorCentavos / 100).toFixed(2).replace('.', ',') : '']);
    }
    const csv = '﻿' + linhas.map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: nome });
    document.body.append(a); a.click(); a.remove();
  }

  // ───────────────────────── RELATÓRIOS: MATRIZ RFM ─────────────────────────
  async function telaRelatorios() {
    const todos = await clientesRFM();
    const porSeg = {};
    for (const c of todos) (porSeg[c.rfm.segmento] ??= []).push(c);
    let atual = estado.segmentoRFM && porSeg[estado.segmentoRFM] ? estado.segmentoRFM : null;
    const geral = resumoGrupo(todos);
    const ativos90 = todos.filter((c) => c.rfm.diasSemComprar <= 90).length;
    const limites = limitesRFM(todos);
    const porCelula = {};
    for (const c of todos) { const k = `${c.rfm.r},${c.rfm.fm}`; porCelula[k] = (porCelula[k] || 0) + 1; }

    // Dica que aparece ao passar o mouse (igual à da Zoppy, com o "por quê")
    const dica = h('div', { class: 'rfm-dica', hidden: true });
    document.querySelector('.rfm-dica')?.remove();
    document.body.append(dica);
    function mostrarDica(id, e) {
      const g = porSeg[id] || [];
      const r = resumoGrupo(g);
      const s = SEGMENTOS_RFM[id];
      trocar(dica,
        h('div', { class: 'linha-flex' }, h('span', { class: 'rfm-ponto', style: `background:${s.cor}` }), h('b', {}, s.nome)),
        h('div', { class: 'pequeno', style: 'margin-top:4px' }, `${r.clientes} clientes · ${pct(r.clientes, todos.length)} da base`),
        h('div', { class: 'pequeno' }, `Ticket médio ${M.formatarReais(r.ticketMedioCentavos)} · ${r.mediaDiasSemComprar ?? '—'} dias sem comprar (média)`),
        h('div', { class: 'pequeno' }, `Frequência: ${r.frequenciaMin} a ${r.frequenciaMax} compras`),
        h('div', { class: 'pequeno suave', style: 'margin-top:6px' }, s.descricao));
      dica.hidden = false;
      mover(e);
    }
    function mover(e) {
      const x = Math.min(e.clientX + 14, window.innerWidth - 300);
      const y = Math.min(e.clientY + 14, window.innerHeight - dica.offsetHeight - 8);
      dica.style.left = `${x}px`; dica.style.top = `${y}px`;
    }

    const detalhe = h('div', { class: 'cartao rfm-detalhe' });
    const lista = h('div', { class: 'cartao', style: 'margin-top:14px' });
    // A grade tem 25 posições (5 notas de recência x 5 de frequência/valor). As posições da mesma
    // categoria são desenhadas coladas, sem linha entre elas, formando uma área só por categoria.
    const blocos = {}; // id -> [pedaços da área]
    const celulas = [];
    for (let fm = 5; fm >= 1; fm--) {
      for (let r = 1; r <= 5; r++) {
        const id = segmentoRFM(r, fm);
        const s = SEGMENTOS_RFM[id];
        const n = (porSeg[id] || []).length;
        const rotulo = ROTULO[id] === `${r},${fm}`;
        const divisaDireita = r < 5 && segmentoRFM(r + 1, fm) !== id;
        const divisaBaixo = fm > 1 && segmentoRFM(r, fm - 1) !== id;
        const el = h('button', {
          class: 'rfm-bloco' + (rotulo ? ' com-rotulo' : '') + (LARGAS.has(id) ? ' larga' : ''), type: 'button',
          style: `background:${s.cor};box-shadow:0 0 0 1px ${s.cor};border-right:${divisaDireita ? 3 : 0}px solid #fff;border-bottom:${divisaBaixo ? 3 : 0}px solid #fff`,
          'aria-label': `${s.nome}: ${n} clientes`, tabIndex: rotulo ? 0 : -1,
          onclick: () => selecionar(id),
          onmouseenter: (e) => { realcar(id); mostrarDica(id, e); }, onmousemove: mover,
          onmouseleave: () => { realcar(null); dica.hidden = true; },
        },
        rotulo ? h('span', { class: 'rfm-rotulo' }, h('span', { class: 'rfm-nome' }, s.nome), h('span', { class: 'rfm-num' }, n), h('span', { class: 'rfm-pct' }, pct(n, todos.length) + ' da base')) : null);
        (blocos[id] ??= []).push(el);
        celulas.push(el);
      }
    }
    const matriz = h('div', { class: 'rfm-matriz' }, celulas);
    function realcar(id) {
      for (const [sid, els] of Object.entries(blocos)) els.forEach((el) => el.classList.toggle('realce', !!id && sid === id));
    }

    function selecionar(id) {
      atual = atual === id ? null : id;
      estado.segmentoRFM = atual;
      desenhar();
    }

    function desenhar() {
      for (const [id, els] of Object.entries(blocos)) els.forEach((el) => el.classList.toggle('apagado', !!atual && id !== atual));
      const grupo = atual ? (porSeg[atual] || []) : todos;
      const r = resumoGrupo(grupo);
      const s = atual ? SEGMENTOS_RFM[atual] : null;
      const numero = (rotulo, valor) => h('div', {}, h('span', { class: 'suave pequeno' }, rotulo), h('b', {}, valor));
      trocar(detalhe,
        h('div', { class: 'linha-flex' }, s ? h('span', { class: 'rfm-ponto', style: `background:${s.cor}` }) : null,
          h('h2', { style: 'font-size:1.15rem' }, s ? s.nome : 'Toda a base'),
          atual ? h('button', { class: 'link pequeno', onclick: () => selecionar(atual) }, 'ver todos') : null),
        h('p', { class: 'suave pequeno', style: 'margin:4px 0 6px' }, s ? s.descricao : 'Clique numa categoria da matriz para ver os clientes dela. Passe o mouse para ver o resumo.'),
        s ? h('div', { class: 'caixa-info cinza pequeno', style: 'margin-bottom:10px' }, h('b', {}, 'Por que estão aqui: '), explicarSegmento(atual, limites, porSeg[atual] || [])) : null,
        h('div', { class: 'rfm-numeros' },
          numero('Clientes', `${r.clientes} (${pct(r.clientes, todos.length)})`),
          numero('Valor total de compras', M.formatarReais(r.totalCentavos)),
          numero('Ticket médio', M.formatarReais(r.ticketMedioCentavos)),
          numero('Tempo médio sem comprar', r.mediaDiasSemComprar != null ? `${r.mediaDiasSemComprar} dias` : '—'),
          numero('Intervalo médio entre compras', r.tempoMedioRecompraDias != null ? `${r.tempoMedioRecompraDias} dias` : '—'),
          numero('Frequência (compras)', r.clientes ? `${r.frequenciaMin} a ${r.frequenciaMax}` : '—'),
          numero('Compra mais recente', r.maisRecente ? dia(r.maisRecente) : '—'),
          numero('Última compra mais antiga', r.maisAntiga ? dia(r.maisAntiga) : '—'),
          numero('Com giftback ativo', r.comGiftback)),
        s ? h('div', { class: 'caixa-info verde', style: 'margin-top:12px' }, h('b', {}, 'O que fazer: '), s.sugestao) : null,
        h('div', { class: 'linha-flex', style: 'margin-top:12px' },
          h('button', { class: 'botao principal', disabled: !grupo.length, onclick: () => { estado.novaCampanha = { segmentos: atual ? [atual] : [] }; location.hash = '#campanhas'; } },
            atual ? `Criar campanha para ${s.nome}` : 'Criar campanha'),
          h('button', { class: 'botao', disabled: !grupo.length, onclick: () => baixarCsv(`clientes-${atual || 'todos'}-${hoje()}.csv`, grupo) }, 'Exportar planilha')));
      desenharLista(grupo);
    }

    function desenharLista(grupo) {
      const filtro = h('input', { type: 'search', class: 'entrada', placeholder: 'Buscar cliente', style: 'max-width:280px' });
      let ordem = 'ultima';
      const corpo = h('tbody');
      const rodape = h('p', { class: 'suave pequeno', style: 'margin-top:8px' });
      const ordenar = {
        ultima: (a, b) => (b.ultimaCompra || '').localeCompare(a.ultimaCompra || ''),
        gasto: (a, b) => b.totalCentavos - a.totalCentavos,
        compras: (a, b) => b.compras - a.compras,
        nome: (a, b) => nomeCompleto(a).localeCompare(nomeCompleto(b), 'pt-BR'),
      };
      function linhas() {
        const v = grupo.filter((c) => M.clienteCombina(c, filtro.value)).sort(ordenar[ordem]);
        trocar(corpo, v.slice(0, 300).map((c) => h('tr', { class: 'clicavel', onclick: () => { estado.clienteId = c.id; estado.resultadoCompra = null; location.hash = '#caixa'; } },
          h('td', {}, h('b', {}, nomeCompleto(c))),
          h('td', {}, M.formatarTelefone(c.telefone)),
          h('td', {}, dia(c.ultimaCompra), h('span', { class: 'suave pequeno' }, ` (${c.rfm.diasSemComprar} d)`)),
          h('td', { class: 'num' }, c.compras),
          h('td', { class: 'num' }, M.formatarReais(Math.round(c.totalCentavos / c.compras))),
          h('td', { class: 'num' }, M.formatarReais(c.totalCentavos)),
          h('td', {}, h('span', { class: 'etiqueta', title: `Recência ${c.rfm.r} · Frequência ${c.rfm.f} · Valor ${c.rfm.m}`, style: `background:${SEGMENTOS_RFM[c.rfm.segmento].cor};color:#fff` }, SEGMENTOS_RFM[c.rfm.segmento].nome)),
          h('td', {}, c.giftback ? valorGift(c.giftback) : ''))));
        rodape.textContent = v.length > 300 ? `Mostrando 300 de ${v.length}. Use a busca ou exporte a planilha para ver todos.` : `${v.length} cliente${v.length === 1 ? '' : 's'}.`;
      }
      const cab = (texto, chave, num) => h('th', { class: (num ? 'num ' : '') + (chave ? 'ordenavel' : ''), onclick: chave ? () => { ordem = chave; linhas(); } : null }, texto);
      filtro.addEventListener('input', linhas);
      trocar(lista,
        h('div', { class: 'linha-flex', style: 'margin-bottom:10px' }, h('h3', {}, 'Clientes'), h('span', { class: 'espaco' }), filtro),
        h('div', { class: 'rolagem' }, h('table', {},
          h('thead', {}, h('tr', {}, cab('Cliente', 'nome'), cab('Telefone'), cab('Última compra', 'ultima'), cab('Compras', 'compras', true), cab('Ticket médio', null, true), cab('Total gasto', 'gasto', true), cab('Categoria'), cab('Giftback'))),
          corpo)),
        rodape);
      linhas();
    }

    trocar(tela,
      h('h1', { class: 'titulo-tela' }, 'Relatórios: matriz RFM'),
      h('div', { class: 'numeros' },
        h('div', { class: 'numero' }, h('b', {}, geral.clientes), h('span', {}, 'clientes no Club')),
        h('div', { class: 'numero' }, h('b', {}, `${ativos90} (${pct(ativos90, todos.length)})`), h('span', {}, 'compraram nos últimos 90 dias')),
        h('div', { class: 'numero' }, h('b', {}, M.formatarReais(geral.ticketMedioCentavos)), h('span', {}, 'ticket médio')),
        h('div', { class: 'numero' }, h('b', {}, M.formatarReais(geral.totalCentavos)), h('span', {}, 'total em compras'))),
      h('div', { class: 'rfm-topo' },
        h('div', {},
          h('div', { class: 'rfm-eixo-y' }, 'compra mais vezes ↑'),
          matriz,
          h('div', { class: 'rfm-eixo-x' }, 'comprou há mais tempo ← → comprou há pouco')),
        detalhe),
      h('p', { class: 'suave pequeno', style: 'margin-top:8px' },
        'Como é calculado (mesmo método da Zoppy, conferido cliente a cliente): cada cliente ganha nota de 1 a 5 em recência (colunas: da esquerda, comprou há mais tempo, para a direita, comprou há pouco) e em frequência e valor gasto (linhas: de baixo para cima). As notas são relativas à sua base: os 20% melhores ganham 5, os 20% seguintes 4, e assim por diante. Cada cor é uma categoria: uma área maior significa que a categoria cobre mais combinações de notas, não que tem mais clientes. Atualiza sozinho a cada compra.'),
      lista);
    desenhar();
  }

  // ───────────────────────── CAMPANHAS ─────────────────────────
  const textoCampanha = (camp, cliente) => M.mensagemCompleta(camp.texto, {
    cliente, config: config(), hoje: hoje(), extras: { data_limite: camp.dataLimite ? M.formatarDia(camp.dataLimite) : '' },
  });

  async function telaCampanhas() {
    if (estado.novaCampanha) { const f = estado.novaCampanha; estado.novaCampanha = null; return formCampanha(f); }
    if (estado.campanhaId) return detalheCampanha(estado.campanhaId);
    const lista = await dados().listarCampanhas();
    trocar(tela,
      h('div', { class: 'linha-flex', style: 'margin-bottom:14px' },
        h('h1', { class: 'titulo-tela', style: 'margin:0' }, 'Campanhas'), h('span', { class: 'espaco' }),
        h('button', { class: 'botao principal', onclick: () => formCampanha({}) }, '+ Nova campanha')),
      h('p', { class: 'suave', style: 'margin-bottom:14px' }, 'Uma campanha é uma mensagem para um grupo de clientes (ex.: quem está hibernando). Você escolhe o grupo e o texto, e depois envia um a um pelo WhatsApp, com um clique em cada. Dá para parar e continuar outro dia.'),
      lista.length ? lista.map((c) => {
        const feito = c.enviadas + c.puladas;
        return h('button', { class: 'cartao campanha', type: 'button', onclick: () => { estado.campanhaId = c.id; telaCampanhas(); } },
          h('div', { class: 'linha-flex' },
            h('b', { style: 'font-size:1.05rem' }, c.nome),
            c.pendentes ? h('span', { class: 'etiqueta ambar' }, `faltam ${c.pendentes}`) : h('span', { class: 'etiqueta verde' }, 'concluída'),
            h('span', { class: 'espaco' }), h('span', { class: 'suave pequeno' }, `criada em ${dia(c.criadaEm)}`)),
          h('div', { class: 'suave pequeno', style: 'margin:4px 0 8px;text-align:left' }, c.publico || ''),
          h('div', { class: 'barra' }, h('div', { class: 'barra-cheia', style: `width:${c.total ? Math.round(feito * 100 / c.total) : 0}%` })),
          h('div', { class: 'suave pequeno', style: 'margin-top:4px;text-align:left' }, `${c.enviadas} enviadas · ${c.puladas} puladas · ${c.pendentes} na fila · ${c.total} no total`));
      }) : h('div', { class: 'cartao vazio' }, 'Nenhuma campanha ainda. Crie a primeira pelo botão acima ou pela matriz RFM em Relatórios.'));
  }

  async function formCampanha(inicial) {
    const todos = await clientesRFM();
    const cont = {};
    for (const c of todos) cont[c.rfm.segmento] = (cont[c.rfm.segmento] || 0) + 1;
    const modelos = config().campanhas || [];
    const marcados = new Set(inicial.segmentos || []);
    const nome = h('input', { type: 'text', class: 'entrada', placeholder: 'Ex.: Resgate hibernando novembro' });
    const diasMin = h('input', { type: 'number', class: 'entrada', min: 0, placeholder: 'ex.: 90' });
    const gastoMin = h('input', { type: 'text', class: 'entrada', inputMode: 'decimal', placeholder: 'ex.: 50' });
    const maiorMin = h('input', { type: 'text', class: 'entrada', inputMode: 'decimal', placeholder: 'ex.: 50' });
    const sexo = h('select', { class: 'entrada' }, h('option', { value: '' }, 'Todos'), h('option', { value: 'F' }, 'Mulheres'), h('option', { value: 'M' }, 'Homens'));
    const semGift = h('input', { type: 'checkbox' });
    const limite = h('input', { type: 'date', class: 'entrada', value: M.somarDias(hoje(), 15) });
    const modelo = h('select', { class: 'entrada' }, h('option', { value: '' }, 'Escrever do zero'), modelos.map((m, i) => h('option', { value: i }, m.nome)));
    const texto = h('textarea', { class: 'entrada', style: 'min-height:190px', placeholder: 'Olá, {primeiro_nome}! ...' });
    const previa = h('div', { class: 'msg-texto' });
    const contagem = h('div', { class: 'caixa-info verde' });
    const criar = h('button', { class: 'botao principal grande', type: 'button' }, 'Criar campanha');

    const filtro = () => ({
      segmentos: [...marcados], diasMin: diasMin.value || null, gastoMinCentavos: M.lerReais(gastoMin.value) || 0,
      maiorCompraMinCentavos: M.lerReais(maiorMin.value) || 0,
      sexo: sexo.value, semGiftback: semGift.checked,
    });
    const publico = () => filtrarPublico(todos, filtro());
    const chips = h('div', { class: 'chips' });
    function desenharChips() {
      trocar(chips, Object.entries(SEGMENTOS_RFM).map(([id, s]) => h('button', {
        type: 'button', class: 'chip' + (marcados.has(id) ? ' ativo' : ''), style: marcados.has(id) ? `background:${s.cor};border-color:${s.cor};color:#fff` : '',
        title: s.descricao, onclick: () => { if (marcados.has(id)) marcados.delete(id); else marcados.add(id); desenharChips(); atualizar(); },
      }, `${s.nome} (${cont[id] || 0})`)));
    }
    function atualizar() {
      const p = publico();
      contagem.textContent = `${p.length} cliente${p.length === 1 ? '' : 's'} vão receber: ${descreverPublico(filtro())}.`;
      criar.textContent = `Criar campanha (${p.length} cliente${p.length === 1 ? '' : 's'})`;
      criar.disabled = !p.length;
      previa.textContent = texto.value.trim()
        ? textoCampanha({ texto: texto.value, dataLimite: limite.value }, p[0] || { nome: 'Ana' }) : 'Escreva a mensagem para ver como fica.';
    }
    modelo.addEventListener('change', () => { if (modelo.value !== '') { texto.value = modelos[Number(modelo.value)].texto; if (!nome.value) nome.value = modelos[Number(modelo.value)].nome; } atualizar(); });
    [diasMin, gastoMin, maiorMin, sexo, semGift, limite, texto].forEach((el) => el.addEventListener('input', atualizar));
    if (modelos.length) { modelo.value = '0'; texto.value = modelos[0].texto; }

    criar.onclick = () => tentar(async () => {
      const p = publico();
      if (!nome.value.trim()) throw new Error('Dê um nome para a campanha.');
      if (!texto.value.trim()) throw new Error('Escreva a mensagem.');
      if (!p.length) throw new Error('Nenhum cliente no grupo escolhido.');
      if (!confirm(`Criar a campanha "${nome.value.trim()}" para ${p.length} clientes?\n\nNada é enviado agora: você envia um a um na próxima tela.`)) return;
      criar.disabled = true;
      const c = await dados().criarCampanha({ nome: nome.value.trim(), texto: texto.value, publico: descreverPublico(filtro()), dataLimite: limite.value || null, clienteIds: p.map((x) => x.id) });
      avisar('Campanha criada.');
      estado.campanhaId = c.id;
      telaCampanhas();
    });

    trocar(tela,
      h('div', { class: 'linha-flex', style: 'margin-bottom:14px' },
        h('button', { class: 'botao', onclick: () => telaCampanhas() }, '← Voltar'), h('h1', { class: 'titulo-tela', style: 'margin:0' }, 'Nova campanha')),
      h('div', { class: 'cartao' }, h('h3', {}, '1. Nome'), h('div', { style: 'margin-top:8px' }, nome)),
      h('div', { class: 'cartao' },
        h('h3', {}, '2. Para quem'),
        h('p', { class: 'suave pequeno', style: 'margin:4px 0 8px' }, 'Clique nas categorias que vão receber. Sem nenhuma marcada, vale para todos os clientes.'),
        chips,
        h('div', { class: 'grade', style: 'margin-top:12px' },
          h('label', { class: 'campo' }, h('span', {}, 'Sem comprar há pelo menos (dias)'), diasMin),
          h('label', { class: 'campo' }, h('span', {}, 'Já gastou pelo menos (R$, somando tudo)'), gastoMin),
          h('label', { class: 'campo', title: 'Tira quem só faz compras pequenas (ex.: R$ 2 ou R$ 3)' }, h('span', {}, 'Fez pelo menos uma compra de (R$)'), maiorMin),
          h('label', { class: 'campo' }, h('span', {}, 'Sexo'), sexo)),
        h('label', { class: 'usar', style: 'margin-top:10px' }, semGift, 'Não mandar para quem já tem giftback ativo'),
        contagem),
      h('div', { class: 'cartao' },
        h('h3', {}, '3. Mensagem'),
        h('div', { class: 'grade', style: 'margin:8px 0' },
          h('label', { class: 'campo' }, h('span', {}, 'Começar de um modelo'), modelo),
          h('label', { class: 'campo' }, h('span', {}, 'Validade da oferta ({data_limite})'), limite)),
        texto,
        h('p', { class: 'suave pequeno', style: 'margin:6px 0' }, 'Use {primeiro_nome} e {data_limite}. A assinatura da loja entra sozinha no fim. Os modelos ficam em Configurações > Modelos de mensagem.'),
        h('details', { open: true }, h('summary', { class: 'pequeno', style: 'cursor:pointer;color:var(--azul)' }, 'Como o cliente vai receber'), previa)),
      h('div', { class: 'barra-salvar' }, criar));
    desenharChips();
    atualizar();
    nome.focus();
  }

  async function detalheCampanha(id) {
    const r = await dados().obterCampanha(id);
    if (!r) { estado.campanhaId = null; return telaCampanhas(); }
    const { campanha, destinatarios } = r;
    const progresso = h('div', {});
    const barra = h('div', { class: 'barra-cheia' });
    const soPendentes = h('input', { type: 'checkbox', checked: true });
    const lista = h('div', {});
    const conta = () => ({
      enviadas: destinatarios.filter((d) => d.status === 'enviada').length,
      puladas: destinatarios.filter((d) => d.status === 'pulada').length,
      pendentes: destinatarios.filter((d) => d.status === 'pendente').length,
    });
    function atualizarProgresso() {
      const c = conta();
      progresso.textContent = `${c.enviadas} enviadas · ${c.puladas} puladas · ${c.pendentes} na fila · ${destinatarios.length} no total`;
      barra.style.width = `${destinatarios.length ? Math.round((c.enviadas + c.puladas) * 100 / destinatarios.length) : 0}%`;
    }
    function linha(d) {
      const cartao = h('div', { class: 'cartao msg' + (d.status !== 'pendente' ? ' feita' : '') });
      const acoes = h('div', { class: 'msg-acoes' });
      const marcar = (status) => tentar(async () => {
        await dados().marcarMensagem(d.id, status);
        d.status = status;
        cartao.classList.toggle('feita', status !== 'pendente');
        botoes();
        atualizarProgresso();
      });
      function botoes(aberta = false) {
        // 2 cliques: abre o WhatsApp; só depois do "✓ Enviei" conta como enviada
        const abrirConversa = () => { if (abrirWhatsApp(d.cliente, textoCampanha(campanha, d.cliente))) botoes(true); };
        if (d.status === 'pendente' && aberta) {
          trocar(acoes,
            h('button', { class: 'botao principal enviei', onclick: () => marcar('enviada') }, '✓ Enviei'),
            h('button', { class: 'link pequeno', onclick: abrirConversa }, 'abrir de novo'));
        } else if (d.status === 'pendente') {
          trocar(acoes,
            h('button', { class: 'botao whats', onclick: abrirConversa }, 'Abrir no WhatsApp'),
            h('button', { class: 'botao', onclick: () => marcar('pulada') }, 'Pular'));
        } else {
          trocar(acoes, h('span', { class: 'etiqueta ' + (d.status === 'enviada' ? 'verde' : 'cinza') }, d.status === 'enviada' ? 'Enviada ✓' : 'Pulada'),
            h('button', { class: 'link pequeno', onclick: () => marcar('pendente') }, 'desfazer'));
        }
      }
      botoes();
      cartao.append(h('div', {}, h('span', { class: 'msg-nome' }, nomeCompleto(d.cliente)), ' ', h('span', { class: 'suave pequeno' }, M.formatarTelefone(d.cliente.telefone))), acoes);
      return cartao;
    }
    function desenharLista() {
      const v = destinatarios.filter((d) => !soPendentes.checked || d.status === 'pendente');
      trocar(lista, v.length ? v.slice(0, 60).map(linha) : h('div', { class: 'cartao vazio' }, 'Todos os clientes desta campanha já foram atendidos. 🌿'),
        v.length > 60 ? h('p', { class: 'suave pequeno', style: 'margin-top:10px;text-align:center' }, `Mostrando 60 de ${v.length}. `, h('button', { class: 'link', onclick: desenharLista }, 'Atualizar a lista')) : null);
    }
    soPendentes.addEventListener('change', desenharLista);
    trocar(tela,
      h('div', { class: 'linha-flex', style: 'margin-bottom:14px' },
        h('button', { class: 'botao', onclick: () => { estado.campanhaId = null; telaCampanhas(); } }, '← Campanhas'),
        h('h1', { class: 'titulo-tela', style: 'margin:0' }, campanha.nome), h('span', { class: 'espaco' }),
        h('button', { class: 'botao perigo', onclick: () => tentar(async () => {
          if (!confirm(`Excluir a campanha "${campanha.nome}"? O histórico de envios dela também é apagado.`)) return;
          await dados().excluirCampanha(id); estado.campanhaId = null; avisar('Campanha excluída.'); telaCampanhas();
        }) }, 'Excluir')),
      h('div', { class: 'cartao' },
        h('div', { class: 'suave pequeno' }, campanha.publico || '', campanha.dataLimite ? ` · oferta válida até ${M.formatarDia(campanha.dataLimite)}` : ''),
        h('div', { class: 'barra', style: 'margin:10px 0 6px' }, barra), progresso,
        h('details', {}, h('summary', { class: 'pequeno', style: 'cursor:pointer;color:var(--azul);margin-top:8px' }, 'Ver a mensagem'),
          h('div', { class: 'msg-texto' }, textoCampanha(campanha, destinatarios[0]?.cliente || { nome: 'Ana' })))),
      h('label', { class: 'linha-flex pequeno', style: 'margin:14px 0 10px' }, soPendentes, 'Mostrar só quem falta enviar'),
      lista);
    atualizarProgresso();
    desenharLista();
  }

  return { telaRelatorios, telaCampanhas };
}
