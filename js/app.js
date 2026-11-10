// app.js — Telas do Giftback Acker (Caixa, Mensagens, Clientes, Configurações) e login.
// As regras ficam em motor.js; os dados, em dados-supabase.js (online) ou dados-local.js (modo teste).
import * as M from './motor.js';
import { criarDadosLocal } from './dados-local.js';
import { criarDadosSupabase } from './dados-supabase.js';
import { SUPABASE_URL, SUPABASE_CHAVE_PUBLICA } from './config-online.js';
import { criarTelasExtras } from './telas-extra.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const MODO_TESTE = new URLSearchParams(location.search).get('modo') === 'teste' || !SUPABASE_URL;
const ENDERECO_APP = location.origin + location.pathname;

let dados = null;

const tela = document.getElementById('tela');
let config = M.CONFIG_PADRAO;
const estado = { clienteId: null, busca: '', resultadoCompra: null };

// ───────────────────────── utilidades de tela ─────────────────────────

/** Cria um elemento. Texto sempre entra como texto (nunca como HTML). */
function h(tag, attrs = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el && k !== 'list' && k !== 'form') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) {
    if (f == null || f === false) continue;
    el.append(f.nodeType ? f : document.createTextNode(String(f)));
  }
  return el;
}

/** Troca o conteúdo de um elemento. Aceita listas e ignora vazios (null/false). */
function trocar(el, ...filhos) {
  el.replaceChildren(...filhos.flat(Infinity).filter((f) => f != null && f !== false));
}

let avisoTimer = null;
function avisar(texto, erro = false) {
  const el = document.getElementById('aviso');
  el.textContent = texto;
  el.className = 'aviso' + (erro ? ' erro' : '');
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => { el.hidden = true; }, erro ? 6000 : 3000);
}

async function tentar(acao) {
  try { return await acao(); } catch (e) { console.error(e); avisar(e.message || 'Algo deu errado.', true); return undefined; }
}

const nomeCompleto = (c) => `${c.nome ?? ''} ${c.sobrenome ?? ''}`.trim();
const dia = (iso) => (iso ? M.formatarDia(M.diaSP(iso)) : '');
const hoje = () => M.diaSP(new Date());
const ehCelular = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

function textoPrazo(giftback) {
  const faltam = M.diasEntre(hoje(), M.diaSP(giftback.expiraEm));
  if (faltam <= 0) return 'vence HOJE';
  if (faltam === 1) return 'vence amanhã';
  return `faltam ${faltam} dias`;
}

const valorGift = (g) => (g.percentual ? `${g.percentual}% de desconto` : M.formatarReais(g.valorCentavos));

function abrirWhatsApp(cliente, texto) {
  const link = M.linkWhatsApp(cliente.telefone, texto, ehCelular() ? 'app' : 'web');
  if (!link) { avisar('Telefone do cliente inválido para WhatsApp.', true); return false; }
  window.open(link, 'whatsapp-giftback-acker');
  return true;
}

// Quantas mensagens estão esperando envio. Atualiza o número na aba, o título da janela,
// a faixa de aviso no topo e, se permitido, avisa o computador (notificação do Windows).
let ultimoAviso = 0;
async function atualizarContador() {
  if (!dados) return;
  const fila = await dados.filaMensagens();
  const n = fila.length;
  const atrasadas = fila.filter((m) => m.atrasada).length;
  const el = document.getElementById('contador-mensagens');
  el.textContent = n;
  el.hidden = n === 0;
  el.classList.toggle('atrasado', atrasadas > 0);
  document.title = n ? `(${n}) Giftback Acker` : 'Giftback Acker';
  const faixa = document.getElementById('faixa-mensagens');
  if (faixa) {
    const naTelaMensagens = (location.hash || '#caixa') === '#mensagens';
    faixa.hidden = n === 0 || naTelaMensagens;
    trocar(faixa, n ? h('a', { href: '#mensagens' },
      atrasadas ? `⚠ ${atrasadas} mensage${atrasadas > 1 ? 'ns' : 'm'} de giftback ATRASADA${atrasadas > 1 ? 'S' : ''}` : `${n} mensage${n > 1 ? 'ns' : 'm'} de giftback para enviar hoje`,
      atrasadas && n > atrasadas ? ` (e mais ${n - atrasadas} de hoje)` : '', ' → abrir a fila') : null);
  }
  // Notificação do computador: no máximo 1 por hora, só com mensagens pendentes.
  if (n && 'Notification' in window && Notification.permission === 'granted' && Date.now() - ultimoAviso > 3600000) {
    ultimoAviso = Date.now();
    try {
      const aviso = new Notification('Giftback Acker', {
        body: atrasadas ? `${atrasadas} mensagem(ns) ATRASADA(S). Total na fila: ${n}.` : `${n} mensagem(ns) de giftback para enviar hoje.`,
        tag: 'giftback-fila',
      });
      aviso.onclick = () => { window.focus(); location.hash = '#mensagens'; };
    } catch { /* navegador sem suporte */ }
  }
}

// Confere a fila a cada 10 minutos e quando a janela volta a ficar visível (ex.: virou o dia).
setInterval(() => { atualizarContador().catch(() => {}); }, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizarContador().catch(() => {}); });

/** Campo "% de giftback desta venda": começa no padrão das Configurações e vale só para esta venda. */
function campoPercentual(aoMudar) {
  const campo = h('input', { type: 'number', class: 'pct', min: 0.5, max: 100, step: 0.5, value: config.percentual, 'aria-label': '% de giftback desta venda' });
  const aviso = h('span', { class: 'suave pequeno' });
  const valor = () => {
    const n = Number(String(campo.value).replace(',', '.'));
    return n > 0 && n <= 100 ? n : config.percentual;
  };
  const marcar = () => {
    const mudou = valor() !== config.percentual;
    campo.classList.toggle('alterado', mudou);
    aviso.textContent = mudou ? `só nesta venda (padrão ${config.percentual}%)` : '';
  };
  campo.addEventListener('input', () => { marcar(); aoMudar(); });
  const el = h('label', { class: 'linha-pct' }, 'Giftback desta venda:', campo, '%', aviso);
  return { el, valor, configDaVenda: () => ({ ...config, percentual: valor() }), mudou: () => valor() !== config.percentual };
}

// ───────────────────────── CAIXA ─────────────────────────

function telaCaixa() {
  const campo = h('input', {
    type: 'search', id: 'busca', placeholder: 'Nome, celular ou código do giftback', autocomplete: 'off',
    value: estado.busca, 'aria-label': 'Buscar cliente',
  });
  const resultados = h('div', { class: 'resultados' });
  const painel = h('div', { id: 'painel', style: 'margin-top:16px' });
  let lista = [];
  let timer = null;

  async function buscar() {
    estado.busca = campo.value;
    const q = campo.value.trim();
    trocar(resultados);
    if (!q) return;
    lista = (await dados.buscarClientes(q)) || [];
    if (!lista.length) {
      const tel = M.normalizarTelefone(q);
      resultados.append(h('div', { class: 'cartao vazio' },
        h('p', {}, 'Nenhum cliente encontrado para “', q, '”.'),
        h('p', { style: 'margin-top:10px' }, h('button', { class: 'botao principal', onclick: () => abrirNovo(tel ? { telefone: tel } : { nome: q }) }, '+ Cadastrar cliente novo'))));
      return;
    }
    lista.forEach((c, i) => resultados.append(h('button', { class: 'resultado' + (i === 0 ? ' destaque' : ''), onclick: () => abrirCliente(c.id) },
      h('span', {}, h('span', { class: 'nome' }, nomeCompleto(c)), h('br'), h('span', { class: 'suave pequeno' }, M.formatarTelefone(c.telefone))),
      h('span', { class: 'espaco' }),
      c.giftback
        ? h('span', { class: 'etiqueta verde' }, valorGift(c.giftback), ' até ', dia(c.giftback.expiraEm).slice(0, 5))
        : h('span', { class: 'etiqueta cinza' }, 'sem giftback'))));
  }

  campo.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(buscar, 140); });
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && lista.length) abrirCliente(lista[0].id);
    if (e.key === 'Escape') { campo.value = ''; buscar(); }
  });
  // Esc em qualquer lugar da tela do caixa fecha o cliente aberto e volta para a busca
  const aoTeclar = (e) => {
    if (e.key !== 'Escape' || (location.hash || '#caixa') !== '#caixa' || !estado.clienteId) return;
    if (document.activeElement && document.activeElement !== campo && document.activeElement.tagName === 'INPUT' && document.activeElement.value) return;
    fechar();
  };
  document.removeEventListener('keydown', window.__gbEsc || (() => {}));
  window.__gbEsc = aoTeclar;
  document.addEventListener('keydown', aoTeclar);

  const fechar = () => { campo.value = ''; estado.busca = ''; estado.clienteId = null; trocar(painel); desenharResumoDoDia(painel); campo.focus(); };

  function abrirCliente(id) {
    estado.clienteId = id; estado.resultadoCompra = null;
    trocar(resultados);
    painelCliente(painel, fechar);
  }

  function abrirNovo(prefill = {}) {
    estado.clienteId = null;
    trocar(resultados);
    painelNovoCliente(painel, prefill, (c) => abrirCliente(c.id), fechar);
  }

  trocar(tela,
    h('h1', { class: 'titulo-tela' }, 'Caixa'),
    h('div', { class: 'busca' }, campo, h('button', { class: 'botao', onclick: () => abrirNovo() }, h('span', { class: 'longo' }, '+ Cliente novo'), h('span', { class: 'curto' }, '+ Novo'))),
    resultados, painel);
  if (!estado.clienteId && !estado.busca && !estado.novoPrefill) desenharResumoDoDia(painel);

  if (estado.clienteId) painelCliente(painel, fechar);
  else if (estado.busca) buscar().then(() => { if (estado.abrirUnico && lista.length === 1) abrirCliente(lista[0].id); estado.abrirUnico = false; });
  if (estado.novoPrefill) { const p = estado.novoPrefill; estado.novoPrefill = null; abrirNovo(p); }
  else if (!estado.clienteId) campo.focus();
}

/** Resumo do dia na tela do caixa (aparece quando nenhum cliente está aberto). */
async function desenharResumoDoDia(painel) {
  if (!dados.resumoDoDia) return;
  let r;
  try { r = await dados.resumoDoDia(); } catch { return; }
  if (estado.clienteId || painel.childElementCount) return; // o usuário já abriu um cliente
  const fila = (await dados.filaMensagens().catch(() => [])).length;
  trocar(painel,
    h('div', { class: 'numeros' },
      h('div', { class: 'numero' }, h('b', {}, r.compras), h('span', {}, 'compras lançadas hoje')),
      h('div', { class: 'numero' }, h('b', {}, M.formatarReais(r.totalCentavos)), h('span', {}, 'valor lançado hoje')),
      h('div', { class: 'numero' }, h('b', {}, r.giftbacksGerados), h('span', {}, 'giftbacks gerados hoje')),
      h('a', { class: 'numero' + (fila ? ' alerta' : ''), href: '#mensagens', style: 'text-decoration:none;color:inherit' }, h('b', {}, fila), h('span', {}, 'mensagens para enviar'))),
    r.ultimas.length ? h('div', { class: 'cartao' },
      h('h3', { style: 'margin-bottom:8px' }, 'Últimas compras de hoje'),
      h('table', {}, h('tbody', {}, r.ultimas.map((c) => h('tr', { class: 'clicavel', onclick: () => { estado.clienteId = c.clienteId; estado.resultadoCompra = null; telaCaixa(); } },
        h('td', {}, String(c.data).slice(11, 16) ? new Date(c.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''),
        h('td', {}, c.cliente ? `${c.cliente.nome ?? ''} ${c.cliente.sobrenome ?? ''}`.trim() : ''),
        h('td', { class: 'num' }, M.formatarReais(c.valorFinalCentavos)),
        h('td', {}, c.giftbackUsadoId ? h('span', { class: 'etiqueta azul' }, 'usou giftback') : ''))))))
      : h('p', { class: 'suave', style: 'text-align:center;margin-top:18px' }, 'Busque o cliente pelo nome, celular ou código do giftback para lançar a compra.'));
}

function painelNovoCliente(painel, prefill, aoSalvar, aoCancelar) {
  const fTel = h('input', { type: 'tel', value: prefill.telefone ? M.formatarTelefone(prefill.telefone) : '', placeholder: '(47) 99999-9999', autocomplete: 'off' });
  const fNome = h('input', { type: 'text', value: prefill.nome ? prefill.nome.split(/\s+/)[0] : '', autocomplete: 'off' });
  const fSobrenome = h('input', { type: 'text', value: prefill.nome ? prefill.nome.split(/\s+/).slice(1).join(' ') : (prefill.sobrenome || ''), autocomplete: 'off' });
  const fSexo = h('select', {}, h('option', { value: '' }, 'Não informar'), h('option', { value: 'F' }, 'Feminino'), h('option', { value: 'M' }, 'Masculino'));
  const fEmail = h('input', { type: 'email', placeholder: 'opcional', autocomplete: 'off' });
  const jaExiste = h('div', {});

  fTel.addEventListener('blur', async () => {
    trocar(jaExiste);
    const c = await dados.clientePorTelefone(fTel.value);
    if (c) jaExiste.append(h('div', { class: 'caixa-info ambar', style: 'margin-top:10px' }, 'Este telefone já é de ', h('b', {}, nomeCompleto(c)), '. ',
      h('button', { class: 'link', onclick: () => aoSalvar(c) }, 'Abrir cadastro')));
  });

  const salvar = () => tentar(async () => {
    const c = await dados.criarCliente({ nome: fNome.value, sobrenome: fSobrenome.value, telefone: fTel.value, sexo: fSexo.value || null, email: fEmail.value.trim() || null });
    avisar('Cliente cadastrado no Club NatuBrava.');
    aoSalvar(c);
  });

  trocar(painel, h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); salvar(); } },
    h('h2', { class: 'titulo-tela' }, 'Cliente novo'),
    h('div', { class: 'grade' },
      h('label', { class: 'campo' }, h('span', {}, 'WhatsApp (obrigatório)'), fTel),
      h('label', { class: 'campo' }, h('span', {}, 'Nome'), fNome),
      h('label', { class: 'campo' }, h('span', {}, 'Sobrenome'), fSobrenome),
      h('label', { class: 'campo' }, h('span', {}, 'Sexo'), fSexo),
      h('label', { class: 'campo' }, h('span', {}, 'E-mail'), fEmail)),
    jaExiste,
    h('div', { class: 'linha-flex', style: 'margin-top:14px' },
      h('button', { class: 'botao principal', type: 'submit' }, 'Cadastrar e lançar compra'),
      h('button', { class: 'botao', type: 'button', onclick: aoCancelar }, 'Cancelar'))));
  (prefill.telefone ? fNome : fTel).focus();
}

async function painelCliente(painel, aoFechar) {
  const c = await dados.obterCliente(estado.clienteId);
  if (!c) { trocar(painel); return; }
  const g = c.giftback;
  const redesenhar = () => painelCliente(painel, aoFechar);

  // Cabeçalho: nome, telefone e a última compra bem visível
  const diasDesde = c.ultimaCompra ? M.diasEntre(M.diaSP(c.ultimaCompra), hoje()) : null;
  const ultima = c.ultimaCompra
    ? `Última compra ${dia(c.ultimaCompra)} (${diasDesde === 0 ? 'hoje' : diasDesde === 1 ? 'ontem' : `há ${diasDesde} dias`}) · ${c.compras} compra${c.compras > 1 ? 's' : ''} · ${M.formatarReais(c.totalCentavos)}`
    : 'Primeira compra';
  const historico = h('div', { class: 'cartao historico', id: 'historico' });
  const cabecalho = h('div', { class: 'cliente-topo' },
    h('div', { class: 'cliente-id' },
      h('h2', { class: 'cliente-nome' }, nomeCompleto(c)),
      h('div', { class: 'cliente-dados' }, M.formatarTelefone(c.telefone)),
      h('div', { class: 'cliente-ultima' }, ultima)),
    h('div', { class: 'cliente-acoes' },
      h('button', { class: 'botao', onclick: () => historico.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 'Histórico'),
      h('button', { class: 'botao', onclick: () => editarCliente(painel, c, redesenhar) }, 'Editar'),
      h('button', { class: 'botao', onclick: aoFechar, title: 'Fechar (Esc)' }, '✕')));

  // Giftback
  let cartaoGift;
  if (g) {
    const faltam = M.diasEntre(hoje(), M.diaSP(g.expiraEm));
    cartaoGift = h('div', { class: 'gift' + (faltam <= 3 ? ' alerta' : '') },
      h('div', { class: 'gift-linha' },
        h('div', {},
          h('div', { class: 'gift-rotulo' }, g.tipo === 'resgate' ? 'Cupom de resgate ativo' : 'Tem giftback'),
          h('div', { class: 'gift-valor' }, valorGift(g))),
        h('div', { class: 'gift-lado' },
          h('div', {}, 'Vale até ', h('b', {}, dia(g.expiraEm))),
          h('div', { class: faltam <= 3 ? 'urgente' : '' }, textoPrazo(g)),
          g.minimoCentavos ? h('div', {}, 'Compra mín. ', h('b', {}, M.formatarReais(g.minimoCentavos))) : null)),
      h('div', { class: 'gift-codigo' }, 'Código ', h('span', { class: 'codigo' }, g.codigo)));
  } else {
    const ultimoGift = c.historicoGiftbacks[0];
    const motivo = !ultimoGift ? 'Ainda não ganhou giftback.'
      : ultimoGift.status === 'usado' ? `Último giftback (${valorGift(ultimoGift)}) foi usado em ${dia(ultimoGift.usadoEm)}.`
        : ultimoGift.status === 'expirado' ? `Último giftback (${valorGift(ultimoGift)}) venceu em ${dia(ultimoGift.expiraEm)}.`
          : '';
    cartaoGift = h('div', { class: 'gift sem' }, h('b', {}, 'Sem giftback no momento.'), motivo ? h('div', { class: 'pequeno' }, motivo) : null);
  }

  // Resultado da compra recém-lançada ou formulário
  const area = h('div', { class: 'lancar' });
  if (estado.resultadoCompra) desenharSucesso(area, estado.resultadoCompra, c, aoFechar, redesenhar);
  else desenharFormulario(area, c, g, redesenhar);

  desenharHistorico(historico, c, redesenhar);
  trocar(painel, h('div', { class: 'cartao' }, cabecalho, cartaoGift, area), historico);
}

const STATUS_GIFT = { ativo: ['verde', 'ativo'], usado: ['azul', 'usado'], expirado: ['vermelha', 'venceu'], substituido: ['cinza', 'trocado por um maior'], cancelado: ['cinza', 'cancelado'] };
const STATUS_MSG = { enviada: ['verde', 'enviada'], pendente: ['ambar', 'na fila'], pulada: ['cinza', 'pulada'], cancelada: ['cinza', 'não precisou'] };

/** Histórico do cliente em 3 abas: compras, giftbacks e mensagens (para tirar dúvida do cliente no balcão). */
function desenharHistorico(caixa, c, redesenhar) {
  const abas = [['compras', `Compras (${c.historicoCompras.length})`], ['giftbacks', `Giftbacks (${c.historicoGiftbacks.length})`], ['mensagens', `Mensagens (${(c.historicoMensagens || []).length})`]];
  let atual = estado.abaHistorico || 'compras';
  const corpo = h('div', { class: 'rolagem' });
  const ultimaOk = c.historicoCompras.find((p) => p.status === 'ok');
  const gifts = new Map(c.historicoGiftbacks.map((g) => [g.id, g]));

  function mostrar() {
    estado.abaHistorico = atual;
    trocar(barra, abas.map(([id, nome]) => h('button', { class: 'subaba' + (id === atual ? ' ativa' : ''), type: 'button', onclick: () => { atual = id; mostrar(); } }, nome)));
    if (atual === 'compras') {
      trocar(corpo, c.historicoCompras.length ? h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Data'), h('th', { class: 'num' }, 'Compra'), h('th', { class: 'num' }, 'Desconto'), h('th', { class: 'num' }, 'Pagou'), h('th', {}, 'Giftback gerado'), h('th', {}, ''))),
        h('tbody', {}, c.historicoCompras.map((p) => {
          const gerado = p.giftbackGeradoId ? gifts.get(p.giftbackGeradoId) : null;
          return h('tr', { class: p.status === 'ok' ? '' : 'cancelada' },
            h('td', {}, dia(p.data)),
            h('td', { class: 'num' }, M.formatarReais(p.valorCentavos)),
            h('td', { class: 'num' }, p.descontoCentavos ? '− ' + M.formatarReais(p.descontoCentavos) : '—'),
            h('td', { class: 'num' }, M.formatarReais(p.valorFinalCentavos)),
            h('td', {}, gerado ? `${valorGift(gerado)}` : ''),
            h('td', {}, p.status !== 'ok' ? 'cancelada'
              : (p.id === ultimaOk?.id && p.origem !== 'zoppy'
                ? h('button', { class: 'link', onclick: () => desfazerCompra(p, redesenhar) }, 'desfazer') : '')));
        }))) : h('p', { class: 'suave' }, 'Nenhuma compra registrada.'));
    } else if (atual === 'giftbacks') {
      trocar(corpo, c.historicoGiftbacks.length ? h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Ganhou em'), h('th', { class: 'num' }, 'Valor'), h('th', {}, 'Validade'), h('th', {}, 'Situação'), h('th', {}, 'Código'))),
        h('tbody', {}, c.historicoGiftbacks.map((g) => {
          const [cor, texto] = STATUS_GIFT[g.status] || ['cinza', g.status];
          return h('tr', {},
            h('td', {}, dia(g.criadoEm)),
            h('td', { class: 'num' }, valorGift(g)),
            h('td', {}, dia(g.expiraEm)),
            h('td', {}, h('span', { class: 'etiqueta ' + cor }, texto), g.status === 'usado' && g.usadoEm ? ` em ${dia(g.usadoEm)}` : ''),
            h('td', {}, h('span', { class: 'codigo' }, g.codigo)));
        }))) : h('p', { class: 'suave' }, 'Nenhum giftback ainda.'));
    } else {
      const msgs = c.historicoMensagens || [];
      trocar(corpo, msgs.length ? h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Mensagem'), h('th', {}, 'Prevista para'), h('th', {}, 'Situação'), h('th', {}, 'Giftback'))),
        h('tbody', {}, msgs.map((m) => {
          const [cor, texto] = STATUS_MSG[m.status] || ['cinza', m.status];
          const g = gifts.get(m.giftbackId);
          return h('tr', {},
            h('td', {}, M.TIPOS_MENSAGEM[m.tipo] || m.tipo),
            h('td', {}, M.formatarDia(m.devidaEm)),
            h('td', {}, h('span', { class: 'etiqueta ' + cor }, texto),
              m.status === 'enviada' && m.enviadaEm ? ` em ${dia(m.enviadaEm)}` : m.status === 'enviada' && m.origem === 'zoppy' ? ' (pela Zoppy)' : ''),
            h('td', {}, g ? `${valorGift(g)} até ${dia(g.expiraEm)}` : ''));
        }))) : h('p', { class: 'suave' }, 'Nenhuma mensagem registrada.'));
    }
  }
  const barra = h('div', { class: 'subabas' });
  trocar(caixa, h('h3', { style: 'margin-bottom:8px' }, 'Histórico do cliente'), barra, corpo,
    h('p', { class: 'suave pequeno', style: 'margin-top:8px' }, 'Mensagens enviadas pela Zoppy antes da troca aparecem como "enviada (pela Zoppy)", sem a data exata.'));
  mostrar();
}

function desenharFormulario(area, cliente, g, redesenhar) {
  const fValor = h('input', { type: 'text', inputMode: 'decimal', placeholder: 'valor', title: 'Valor dos produtos que NÃO estão em promoção', autocomplete: 'off', 'aria-label': 'Valor da compra (itens não promocionais)' });
  const previa = h('div', { class: 'previa' });
  const confirmar = h('button', { class: 'botao principal grande', disabled: true }, 'Confirmar compra');
  let usar = null; // null = ainda não decidiu (segue o padrão: usar sempre que puder)
  const pct = campoPercentual(() => atualizar());

  function atualizar() {
    const valor = M.lerReais(fValor.value);
    trocar(previa);
    confirmar.disabled = true;
    if (!valor || valor <= 0) return;
    const uso = M.podeUsarGiftback(g, valor, new Date());
    const vaiUsar = uso.ok && (usar ?? true);
    const r = M.calcularCompra({ valorCentavos: valor, giftbackAtivo: g, usarGiftback: vaiUsar, config: pct.configDaVenda(), agora: new Date() });

    if (g && uso.ok) {
      const marca = h('input', { type: 'checkbox', checked: vaiUsar, onchange: (e) => { usar = e.target.checked; atualizar(); } });
      previa.append(h('label', { class: 'usar' }, marca, `Usar o ${g.tipo === 'resgate' ? 'cupom' : 'giftback'} de ${valorGift(g)} nesta compra`));
    } else if (g && uso.motivo === 'abaixo_minimo') {
      previa.append(h('div', { class: 'caixa-info ambar' }, `Ainda não dá para usar o giftback: faltam ${M.formatarReais(uso.faltamCentavos)} para a compra mínima de ${M.formatarReais(g.minimoCentavos)}.`));
    }

    previa.append(h('div', { class: 'conta' + (vaiUsar ? ' com-desconto' : '') },
      h('span', {}, 'Compra'), h('span', { class: 'direita' }, M.formatarReais(valor)),
      vaiUsar ? [h('span', {}, 'Desconto no PDV'), h('span', { class: 'direita desconto' }, '− ' + M.formatarReais(r.descontoCentavos))] : null,
      h('span', { class: 'total' }, 'Cliente paga'), h('span', { class: 'total direita' }, M.formatarReais(r.valorFinalCentavos))));
    if (r.novoGiftback) {
      previa.append(h('div', { class: 'caixa-info verde' }, 'Vai ganhar ', h('b', {}, M.formatarReais(r.novoGiftback.valorCentavos)),
        ` de giftback (${pct.valor()}%), válido até ${dia(r.novoGiftback.expiraEm)}.`));
    } else if (r.novoDescartado) {
      previa.append(h('div', { class: 'caixa-info verde' }, `O cliente continua com o giftback atual de ${valorGift(g)}, que é maior que o desta compra (${M.formatarReais(r.novoDescartado.valorCentavos)}). Giftback não acumula: fica sempre o maior.`));
    } else {
      previa.append(h('div', { class: 'caixa-info cinza' }, `Valor final abaixo de ${M.formatarReais(config.compraMinimaCentavos)}: esta compra não gera giftback.`));
    }
    if (r.giftbackAnterior === 'substituido') {
      previa.append(h('div', { class: 'caixa-info ambar' }, `O giftback atual de ${valorGift(g)} não será usado e será trocado pelo novo de ${M.formatarReais(r.novoGiftback.valorCentavos)} (giftback não acumula: fica o maior).`));
    }
    confirmar.disabled = false;
    confirmar.onclick = () => tentar(async () => {
      confirmar.disabled = true;
      estado.resultadoCompra = await dados.lancarCompra({ clienteId: cliente.id, valorCentavos: valor, usarGiftback: vaiUsar, percentual: pct.mudou() ? pct.valor() : null });
      await atualizarContador();
      redesenhar();
    });
  }

  fValor.addEventListener('input', atualizar);
  fValor.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !confirmar.disabled) { e.preventDefault(); confirmar.focus(); } });

  trocar(area,
    h('h3', {}, 'Lançar compra'),
    h('p', { class: 'suave pequeno', style: 'margin-bottom:8px' }, 'Digite só o valor dos produtos que NÃO estão em promoção.'),
    h('div', { class: 'valor-linha' }, h('span', { class: 'prefixo' }, 'R$'), fValor, confirmar),
    pct.el,
    previa);
  fValor.focus();
}

function desenharSucesso(area, r, cliente, aoFechar, redesenhar) {
  const passos = [];
  let n = 1;
  if (r.giftbackUsado) {
    passos.push(h('div', { class: 'passo' }, h('span', { class: 'num' }, n++), h('div', {},
      'No PDV, dê o desconto de ', h('span', { class: 'destaque-valor' }, M.formatarReais(r.compra.descontoCentavos)),
      h('div', { class: 'suave pequeno' }, `Cliente paga ${M.formatarReais(r.compra.valorFinalCentavos)}. Giftback ${r.giftbackUsado.codigo} baixado.`))));
  }
  if (r.novoGiftback) {
    const texto = M.mensagemCompleta('envio', { cliente, giftback: r.novoGiftback, config });
    const botao = h('button', { class: 'botao whats grande' }, 'Enviar giftback pelo WhatsApp');
    const situacao = h('span', { class: 'suave pequeno' });
    botao.onclick = () => tentar(async () => {
      if (!abrirWhatsApp(cliente, texto)) return;
      if (r.mensagemEnvio) await dados.marcarMensagem(r.mensagemEnvio.id, 'enviada');
      situacao.textContent = 'Conversa aberta. Confira e aperte Enter no WhatsApp.';
      await atualizarContador();
    });
    passos.push(h('div', { class: 'passo' }, h('span', { class: 'num' }, n++), h('div', {},
      'Cliente ganhou ', h('span', { class: 'destaque-valor' }, M.formatarReais(r.novoGiftback.valorCentavos)),
      ` de giftback (código ${r.novoGiftback.codigo}, até ${dia(r.novoGiftback.expiraEm)}).`,
      h('div', { class: 'linha-flex', style: 'margin-top:8px' }, botao, situacao),
      h('details', {}, h('summary', { class: 'pequeno', style: 'cursor:pointer;color:var(--azul);margin-top:6px' }, 'Ver a mensagem'), h('div', { class: 'msg-texto' }, texto)),
      h('div', { class: 'suave pequeno', style: 'margin-top:4px' }, 'Se não enviar agora, ela fica na aba Mensagens.'))));
  } else if (r.giftbackMantidoMaior) {
    passos.push(h('div', { class: 'passo' }, h('span', { class: 'num' }, n++), h('div', {},
      `O cliente continua com o giftback de ${valorGift(r.giftbackMantidoMaior)} (código ${r.giftbackMantidoMaior.codigo}), que é maior que o desta compra. Nenhuma mensagem nova.`)));
  } else {
    passos.push(h('div', { class: 'passo' }, h('span', { class: 'num' }, n++), h('div', {}, 'Esta compra não gerou giftback novo.')));
  }
  trocar(area, h('div', { class: 'sucesso' },
    h('h3', {}, `Compra de ${M.formatarReais(r.compra.valorCentavos)} registrada ✓`),
    passos,
    h('div', { class: 'linha-flex', style: 'margin-top:16px' },
      h('button', { class: 'botao principal', onclick: aoFechar }, 'Próximo cliente'),
      h('button', { class: 'botao perigo', onclick: () => desfazerCompra(r.compra, () => { estado.resultadoCompra = null; redesenhar(); }) }, 'Lancei errado, desfazer'))));
}

async function desfazerCompra(compra, depois) {
  if (!confirm(`Desfazer a compra de ${M.formatarReais(compra.valorCentavos)}? O giftback gerado é cancelado e o usado volta para o cliente.`)) return;
  await tentar(async () => {
    await dados.cancelarCompra(compra.id);
    estado.resultadoCompra = null;
    avisar('Compra desfeita.');
    await atualizarContador();
    depois();
  });
}

function editarCliente(painel, c, depois) {
  const fNome = h('input', { type: 'text', value: c.nome || '' });
  const fSobrenome = h('input', { type: 'text', value: c.sobrenome || '' });
  const fTel = h('input', { type: 'tel', value: M.formatarTelefone(c.telefone) });
  const fSexo = h('select', {}, h('option', { value: '' }, 'Não informar'), h('option', { value: 'F' }, 'Feminino'), h('option', { value: 'M' }, 'Masculino'));
  fSexo.value = c.sexo || '';
  const fEmail = h('input', { type: 'email', value: c.email || '' });
  const fNasc = h('input', { type: 'date', value: c.nascimento || '' });
  trocar(painel, h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); tentar(async () => {
    await dados.atualizarCliente(c.id, { nome: fNome.value, sobrenome: fSobrenome.value, telefone: fTel.value, sexo: fSexo.value || null, email: fEmail.value, nascimento: fNasc.value || null });
    avisar('Cadastro atualizado.'); depois();
  }); } },
    h('h2', { class: 'titulo-tela' }, 'Editar cliente'),
    h('div', { class: 'grade' },
      h('label', { class: 'campo' }, h('span', {}, 'Nome'), fNome),
      h('label', { class: 'campo' }, h('span', {}, 'Sobrenome'), fSobrenome),
      h('label', { class: 'campo' }, h('span', {}, 'WhatsApp'), fTel),
      h('label', { class: 'campo' }, h('span', {}, 'Sexo'), fSexo),
      h('label', { class: 'campo' }, h('span', {}, 'E-mail (opcional)'), fEmail),
      h('label', { class: 'campo' }, h('span', {}, 'Nascimento (opcional)'), fNasc)),
    h('div', { class: 'linha-flex', style: 'margin-top:14px' },
      h('button', { class: 'botao principal', type: 'submit' }, 'Salvar'),
      h('button', { class: 'botao', type: 'button', onclick: depois }, 'Cancelar'),
      h('span', { class: 'espaco' }),
      h('button', { class: 'botao perigo', type: 'button', onclick: () => tentar(async () => {
        const nome = nomeCompleto(c);
        const resp = prompt(`Excluir ${nome} e TODO o histórico (compras, giftbacks e mensagens)?
Isso não tem volta.

Para confirmar, digite: EXCLUIR`);
        if (resp == null) return;
        if (resp.trim().toUpperCase() !== 'EXCLUIR') { avisar('Nada foi excluído.'); return; }
        await dados.excluirCliente(c.id);
        estado.clienteId = null; estado.resultadoCompra = null; estado.busca = '';
        avisar(`${nome} foi excluído.`);
        await atualizarContador();
        telaCaixa();
      }) }, 'Excluir cliente'))));
}

// ───────────────────────── MENSAGENS ─────────────────────────

async function telaMensagens() {
  const [fila, proximas, enviadas] = await Promise.all([dados.filaMensagens(), dados.proximasMensagens(7), dados.enviadasHoje()]);
  const etiquetas = { envio: 'verde', lembrete: 'azul', vencendo: 'ambar' };
  const atrasadas = fila.filter((m) => m.atrasada).length;
  const textoAgora = (m) => M.mensagemCompleta(m.tipo, { cliente: m.cliente, giftback: m.giftback, config, hoje: hoje() });

  const itens = fila.map((m) => {
    const cartao = h('div', { class: 'cartao msg' + (m.atrasada ? ' atrasada' : '') });
    const acoes = h('div', { class: 'msg-acoes' });
    const previa = h('div', { class: 'msg-texto' }, textoAgora(m));
    const marcar = (status) => tentar(async () => {
      await dados.marcarMensagem(m.id, status, m.substituidas);
      cartao.classList.toggle('feita', status !== 'pendente');
      desenharAcoes(status);
      await atualizarContador();
    });
    function desenharAcoes(status) {
      if (status === 'pendente') {
        trocar(acoes,
          // o texto é montado de novo NA HORA do clique: se a tela ficou aberta de um dia para o outro, o prazo continua certo
          h('button', { class: 'botao whats', onclick: () => { const t = textoAgora(m); previa.textContent = t; if (abrirWhatsApp(m.cliente, t)) marcar('enviada'); } }, 'Enviar no WhatsApp'),
          h('button', { class: 'botao', onclick: () => marcar('pulada') }, 'Pular'));
      } else {
        trocar(acoes, h('span', { class: 'etiqueta ' + (status === 'enviada' ? 'verde' : 'cinza') }, status === 'enviada' ? 'Enviada ✓' : 'Pulada'),
          h('button', { class: 'link pequeno', onclick: () => marcar('pendente') }, 'desfazer'));
      }
    }
    desenharAcoes('pendente');
    cartao.append(
      h('div', {},
        h('div', { class: 'linha-flex' },
          m.atrasada ? h('span', { class: 'etiqueta vermelha' }, m.diasAtraso === 1 ? 'Atrasada 1 dia' : `Atrasada ${m.diasAtraso} dias`) : null,
          h('span', { class: 'etiqueta ' + etiquetas[m.tipo] }, M.TIPOS_MENSAGEM[m.tipo]),
          h('span', { class: 'msg-nome' }, nomeCompleto(m.cliente)),
          h('span', { class: 'suave pequeno' }, M.formatarTelefone(m.cliente.telefone))),
        h('div', { class: 'suave pequeno', style: 'margin-top:4px' },
          `Giftback de ${valorGift(m.giftback)} · vale até ${dia(m.giftback.expiraEm)} (${textoPrazo(m.giftback)})`,
          m.substituidas.length ? ' · substitui o lembrete que ficou para trás (o cliente recebe só esta)' : ''),
        h('details', {}, h('summary', {}, 'Ver a mensagem'), previa)),
      acoes);
    return cartao;
  });

  const permissao = 'Notification' in window ? Notification.permission : 'indisponivel';
  trocar(tela,
    h('h1', { class: 'titulo-tela' }, 'Mensagens para enviar'),
    h('div', { class: 'numeros' },
      h('div', { class: 'numero' + (atrasadas ? ' alerta' : '') }, h('b', {}, atrasadas), h('span', {}, 'atrasadas')),
      h('div', { class: 'numero' }, h('b', {}, fila.length - atrasadas), h('span', {}, 'para hoje')),
      h('div', { class: 'numero' }, h('b', {}, enviadas), h('span', {}, 'enviadas hoje')),
      h('div', { class: 'numero' }, h('b', {}, proximas), h('span', {}, 'nos próximos 7 dias'))),
    h('p', { class: 'suave', style: 'margin-bottom:14px' },
      'Cada botão abre o WhatsApp Web da loja com o texto pronto: é só conferir e apertar Enter. ',
      'Mensagem não enviada continua aqui no dia seguinte, marcada como atrasada, e o prazo no texto ("vence amanhã", "em 2 dias") é recalculado na hora do envio.'),
    permissao === 'default' ? h('div', { class: 'caixa-info ambar', style: 'margin-bottom:14px' },
      'Quer que o computador avise quando houver mensagens para enviar? ',
      h('button', { class: 'link', onclick: () => Notification.requestPermission().then(() => { avisar('Pronto: o computador vai avisar.'); atualizarContador(); telaMensagens(); }) }, 'Ativar avisos')) : null,
    itens.length ? itens : h('div', { class: 'cartao vazio' }, 'Nenhuma mensagem pendente. Tudo em dia! 🌿'));
  atualizarContador();
}

// ───────────────────────── VENDAS DO PDV (Uniplus) ─────────────────────────

let vendasUniplus = null; // última busca, para não buscar de novo ao trocar de aba

async function telaUniplus() {
  if (!dados.puxarVendasUniplus) {
    trocar(tela, h('div', { class: 'cartao vazio' }, 'As vendas do PDV só aparecem na versão online.'));
    return;
  }
  const dias = h('select', {}, [1, 2, 3, 5, 7].map((d) => h('option', { value: d, selected: d === 3 }, d === 1 ? 'hoje e ontem' : `últimos ${d} dias`)));
  const situacao = h('p', { class: 'suave pequeno', style: 'margin-top:8px' });
  const lista = h('div', { style: 'margin-top:14px' });
  const botao = h('button', { class: 'botao principal grande' }, 'Puxar vendas do Uniplus');
  botao.onclick = () => tentar(async () => {
    botao.disabled = true;
    situacao.textContent = 'Lendo as vendas no Uniplus… (leva de 20 a 60 segundos)';
    try {
      vendasUniplus = await dados.puxarVendasUniplus(Number(dias.value));
      desenharLista();
    } finally { botao.disabled = false; }
  });

  function desenharLista() {
    const v = vendasUniplus || [];
    const fid = v.filter((x) => x.cliente.fidelidade || x.clienteAcker);
    const outras = v.filter((x) => !(x.cliente.fidelidade || x.clienteAcker));
    situacao.textContent = vendasUniplus ? `${fid.length} venda${fid.length === 1 ? '' : 's'} de clientes do Club para lançar. ${outras.length} de outros clientes (sem cartão fidelidade).` : '';
    trocar(lista,
      fid.length ? fid.map((x) => cartaoVenda(x)) : (vendasUniplus ? h('div', { class: 'cartao vazio' }, 'Nenhuma venda nova de cliente do Club. Tudo lançado! 🌿') : null),
      outras.length ? h('details', { class: 'cartao', style: 'margin-top:14px' },
        h('summary', { style: 'cursor:pointer;font-weight:600' }, `Vendas de clientes SEM cartão fidelidade (${outras.length})`),
        h('p', { class: 'suave pequeno', style: 'margin:8px 0' }, 'Só entram no Club se você quiser: abra a venda e lance (o cliente é cadastrado).'),
        outras.map((x) => cartaoVenda(x))) : null);
  }

  function cartaoVenda(v) {
    const cartao = h('div', { class: 'cartao venda' });
    const marcados = new Set(v.itens.map((i, k) => (i.promocional ? null : k)).filter((k) => k != null));
    const g = v.clienteAcker?.giftback || null;
    const usar = h('input', { type: 'checkbox' });
    const previa = h('div', {});
    const fTel = h('input', { type: 'tel', class: 'entrada', style: 'max-width:200px', value: v.telefone ? M.formatarTelefone(v.telefone) : '', placeholder: 'WhatsApp do cliente' });
    const acoes = h('div', { class: 'linha-flex', style: 'margin-top:12px' });
    let usarDecidido = false;
    const pct = campoPercentual(() => recalcular());

    function recalcular() {
      const base = M.baseDosItens(v.itens, marcados);
      const agora = new Date(M.horaUniplus(v.hora, v.data));
      if (!usarDecidido) usar.checked = M.descontoPareceGiftback(v.desconto_subtotal_centavos, g, base);
      const uso = g && base > 0 ? M.podeUsarGiftback(g, base, agora) : { ok: false };
      usar.disabled = !uso.ok;
      if (!uso.ok) usar.checked = false;
      trocar(previa,
        h('div', { class: 'conta' },
          h('span', {}, 'Base do giftback (itens marcados)'), h('span', { class: 'direita' }, M.formatarReais(base)),
          v.desconto_subtotal_centavos ? [h('span', {}, 'Desconto dado no PDV'), h('span', { class: 'direita' }, '− ' + M.formatarReais(v.desconto_subtotal_centavos))] : null,
          h('span', {}, 'Total pago no PDV'), h('span', { class: 'direita' }, M.formatarReais(v.valor_liquido_centavos))),
        g ? h('label', { class: 'usar' + (uso.ok ? '' : ' suave') }, usar,
          `O cliente usou o giftback de ${valorGift(g)} nesta compra`,
          !uso.ok && g.minimoCentavos ? ` (não dá: compra mínima ${M.formatarReais(g.minimoCentavos)})` : '') : null);
      if (base <= 0) { previa.append(h('div', { class: 'caixa-info cinza' }, 'Nenhum item marcado: esta venda não gera giftback.')); return; }
      try {
        const r = M.calcularCompra({ valorCentavos: base, giftbackAtivo: g, usarGiftback: usar.checked, config: pct.configDaVenda(), agora });
        previa.append(r.novoGiftback
          ? h('div', { class: 'caixa-info verde' }, 'Vai ganhar ', h('b', {}, M.formatarReais(r.novoGiftback.valorCentavos)), ` de giftback, válido até ${dia(r.novoGiftback.expiraEm)}.`)
          : r.novoDescartado
            ? h('div', { class: 'caixa-info verde' }, `Continua com o giftback atual de ${valorGift(g)} (maior que o desta compra).`)
            : h('div', { class: 'caixa-info cinza' }, `Valor final abaixo de ${M.formatarReais(config.compraMinimaCentavos)}: não gera giftback.`));
      } catch (e) { previa.append(h('div', { class: 'caixa-info vermelha' }, e.message)); }
    }
    usar.addEventListener('change', () => { usarDecidido = true; recalcular(); });

    const linhas = v.itens.map((i, k) => {
      const caixa = h('input', { type: 'checkbox', checked: marcados.has(k), onchange: (e) => { if (e.target.checked) marcados.add(k); else marcados.delete(k); recalcular(); } });
      return h('tr', { class: i.promocional ? 'promo' : '' },
        h('td', {}, caixa),
        h('td', {}, i.nome, i.promocional ? h('span', { class: 'etiqueta ambar', style: 'margin-left:6px' }, `promoção (cadastro ${M.formatarReais(i.precoCadastroCentavos)})`) : null),
        h('td', { class: 'num' }, String(i.quantidade).replace('.', ',')),
        h('td', { class: 'num' }, M.formatarReais(i.totalCentavos)));
    });

    const lancar = () => tentar(async () => {
      const base = M.baseDosItens(v.itens, marcados);
      if (base <= 0) throw new Error('Marque pelo menos um item, ou clique em Ignorar.');
      let clienteId = v.clienteAcker?.id;
      if (!clienteId) {
        const tel = M.normalizarTelefone(fTel.value);
        if (!tel) throw new Error('Informe o WhatsApp do cliente para cadastrar no Club.');
        const existente = await dados.clientePorTelefone(tel);
        if (existente) clienteId = existente.id;
        else {
          const partes = v.cliente.nome.trim().split(/\s+/);
          const novo = await dados.criarCliente({ nome: partes[0], sobrenome: partes.slice(1).join(' '), telefone: tel, cpf: v.cliente.cpf || null, uniplusCodigo: v.cliente.codigo || null });
          clienteId = novo.id;
        }
      }
      const excluidos = v.itens.filter((_, k) => !marcados.has(k)).map((i) => ({ codigo: i.codigo, nome: i.nome, totalCentavos: i.totalCentavos, promocional: i.promocional }));
      const r = await dados.lancarCompra({
        clienteId, valorCentavos: base, usarGiftback: usar.checked && !usar.disabled,
        data: M.horaUniplus(v.hora, v.data), uniplusOperacaoId: v.operacao_id, itensExcluidos: excluidos.length ? excluidos : null,
        percentual: pct.mudou() ? pct.valor() : null,
      });
      vendasUniplus = vendasUniplus.filter((x) => x.operacao_id !== v.operacao_id);
      const area = h('div', { class: 'lancar' });
      trocar(cartao, h('div', { class: 'linha-flex' }, h('b', {}, nomeCompleto(r.cliente)), h('span', { class: 'etiqueta verde' }, 'Lançada ✓')), area);
      desenharSucesso(area, r, r.cliente, () => cartao.remove(), () => {});
      await atualizarContador();
    });
    const ignorar = () => tentar(async () => {
      await dados.ignorarVendaUniplus(v.operacao_id, 'ignorada na revisão');
      vendasUniplus = vendasUniplus.filter((x) => x.operacao_id !== v.operacao_id);
      cartao.remove();
      avisar('Venda ignorada.');
    });

    trocar(acoes,
      h('button', { class: 'botao principal', onclick: lancar }, 'Lançar no Giftback Acker'),
      h('button', { class: 'botao', onclick: ignorar }, 'Ignorar esta venda'));

    cartao.append(
      h('div', { class: 'linha-flex' },
        h('b', { style: 'font-size:1.1rem' }, v.cliente.nome || 'Cliente sem nome'),
        v.cliente.fidelidade ? h('span', { class: 'etiqueta verde' }, 'Cliente fidelidade') : h('span', { class: 'etiqueta cinza' }, 'Sem cartão fidelidade'),
        v.clienteAcker ? h('span', { class: 'etiqueta azul' }, 'já está no Club') : h('span', { class: 'etiqueta ambar' }, 'cliente novo no Club'),
        h('span', { class: 'espaco' }),
        h('span', { class: 'suave pequeno' }, `${M.formatarDia(v.data)} ${String(v.hora || '').slice(11, 16)} · NFC-e ${String(v.nfce || '').replace(/^0+/, '')}`)),
      !v.clienteAcker ? h('div', { class: 'linha-flex pequeno', style: 'margin-top:8px' }, 'WhatsApp para o cadastro:', fTel) : null,
      v.clienteAcker && g ? h('div', { class: 'suave pequeno', style: 'margin-top:4px' }, `Giftback ativo: ${valorGift(g)} até ${dia(g.expiraEm)}`) : null,
      h('div', { class: 'rolagem', style: 'margin-top:10px' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Conta'), h('th', {}, 'Item'), h('th', { class: 'num' }, 'Qtd'), h('th', { class: 'num' }, 'Valor'))),
        h('tbody', {}, linhas))),
      h('p', { class: 'suave pequeno', style: 'margin-top:6px' }, 'Itens em promoção (preço menor que o do cadastro) já vêm desmarcados. Desmarque qualquer outro que não deva contar.'),
      pct.el, previa, acoes);
    recalcular();
    return cartao;
  }

  trocar(tela,
    h('h1', { class: 'titulo-tela' }, 'Vendas do PDV (Uniplus)'),
    h('p', { class: 'suave', style: 'margin-bottom:12px' }, 'Puxa as vendas feitas no caixa com cliente identificado. Confira os itens, desmarque o que não conta para o giftback e lance com um clique. Cada venda só pode ser lançada uma vez.'),
    h('div', { class: 'linha-flex' }, botao, dias),
    situacao, lista);
  if (vendasUniplus) desenharLista();
}

// ───────────────────────── CLIENTES ─────────────────────────

async function telaClientes() {
  const [todos, resumo] = [await dados.listarClientes(), await dados.resumoGeral()];
  todos.sort((a, b) => (b.ultimaCompra || '').localeCompare(a.ultimaCompra || ''));
  const filtro = h('input', { type: 'search', class: 'entrada', placeholder: 'Filtrar por nome ou celular', style: 'max-width:340px' });
  const soGift = h('input', { type: 'checkbox' });
  const corpo = h('tbody');
  const rodape = h('p', { class: 'suave pequeno', style: 'margin-top:8px' });

  function desenhar() {
    const lista = todos.filter((c) => M.clienteCombina(c, filtro.value) && (!soGift.checked || c.giftback));
    trocar(corpo, lista.slice(0, 200).map((c) => h('tr', { class: 'clicavel', onclick: () => { estado.clienteId = c.id; estado.resultadoCompra = null; location.hash = '#caixa'; } },
      h('td', {}, h('b', {}, nomeCompleto(c))),
      h('td', {}, M.formatarTelefone(c.telefone)),
      h('td', { class: 'num' }, c.compras),
      h('td', { class: 'num' }, M.formatarReais(c.totalCentavos)),
      h('td', {}, dia(c.ultimaCompra)),
      h('td', {}, c.giftback ? h('span', { class: 'etiqueta verde' }, valorGift(c.giftback), ' até ', dia(c.giftback.expiraEm).slice(0, 5)) : ''))));
    rodape.textContent = lista.length > 200 ? `Mostrando 200 de ${lista.length}. Use o filtro para achar os demais.` : `${lista.length} cliente${lista.length === 1 ? '' : 's'}.`;
  }
  filtro.addEventListener('input', desenhar);
  soGift.addEventListener('change', desenhar);

  trocar(tela,
    h('h1', { class: 'titulo-tela' }, 'Clientes do Club NatuBrava'),
    h('div', { class: 'numeros' },
      h('div', { class: 'numero' }, h('b', {}, resumo.clientes), h('span', {}, 'clientes com compra')),
      h('div', { class: 'numero' }, h('b', {}, resumo.giftbacksAtivos), h('span', {}, 'giftbacks ativos')),
      h('div', { class: 'numero' }, h('b', {}, M.formatarReais(resumo.saldoCentavos)), h('span', {}, 'em giftback a resgatar')),
      h('div', { class: 'numero' }, h('b', {}, resumo.cuponsResgate), h('span', {}, 'cupons de resgate ativos'))),
    h('div', { class: 'cartao' },
      h('div', { class: 'linha-flex', style: 'margin-bottom:10px' }, filtro, h('label', { class: 'linha-flex pequeno' }, soGift, 'Só quem tem giftback ativo')),
      h('div', { class: 'rolagem' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Cliente'), h('th', {}, 'Celular'), h('th', { class: 'num' }, 'Compras'), h('th', { class: 'num' }, 'Total'), h('th', {}, 'Última compra'), h('th', {}, 'Giftback'))),
        corpo)),
      rodape));
  desenhar();
}

// ───────────────────────── CONFIGURAÇÕES ─────────────────────────

async function telaConfig() {
  config = await dados.obterConfig();
  const secoes = [['regras', 'Regras do giftback'], ['modelos', 'Modelos de mensagem'], ['dados', dados.modo === 'online' ? 'Dados' : 'Modo teste']];
  const atual = secoes.some(([id]) => id === estado.secaoConfig) ? estado.secaoConfig : 'regras';
  const abas = h('div', { class: 'subabas' }, secoes.map(([id, nome]) =>
    h('button', { class: 'subaba' + (id === atual ? ' ativa' : ''), type: 'button', onclick: () => { estado.secaoConfig = id; telaConfig(); } }, nome)));
  const conteudo = atual === 'regras' ? configRegras() : atual === 'modelos' ? configModelos()
    : (dados.modo === 'online' ? cartaoDadosOnline() : cartaoModoTeste());
  trocar(tela, h('h1', { class: 'titulo-tela' }, 'Configurações'), abas, conteudo);
}

function configRegras() {
  const num = (valor, extra = {}) => h('input', { type: 'number', value: valor, min: 0, step: 'any', ...extra });
  const f = {
    percentual: num(config.percentual, { max: 100 }),
    minimo: h('input', { type: 'text', inputMode: 'decimal', value: (config.compraMinimaCentavos / 100).toFixed(2).replace('.', ',') }),
    validade: num(config.validadeDias, { step: 1, min: 1 }),
    multiplo: num(config.multiploUsoMinimo, { min: 1 }),
    lembrete: num(config.diasLembrete, { step: 1 }),
    avisoFinal: num(config.diasAntesAvisoFinal, { step: 1 }),
    loja: h('input', { type: 'text', value: config.nomeLoja }),
  };
  const exemplo = h('div', { class: 'caixa-info verde', style: 'margin-top:12px' });
  function atualizarExemplo() {
    const pct = Number(f.percentual.value) || 0, mult = Number(f.multiplo.value) || 0;
    const gift = Math.round(10000 * pct / 100);
    exemplo.textContent = `Exemplo: compra de R$ 100,00 gera ${M.formatarReais(gift)} de giftback, que vale por ${f.validade.value} dias e pode ser usado em compras a partir de ${M.formatarReais(gift * mult)}.`;
  }
  [f.percentual, f.multiplo, f.validade].forEach((el) => el.addEventListener('input', atualizarExemplo));
  atualizarExemplo();
  const salvar = () => tentar(async () => {
    const minimo = M.lerReais(f.minimo.value);
    const pct = Number(f.percentual.value);
    if (!(pct > 0 && pct <= 100)) throw new Error('Percentual deve ficar entre 0 e 100.');
    if (minimo == null) throw new Error('Valor mínimo inválido.');
    if (!(Number(f.validade.value) >= 1)) throw new Error('Validade deve ser de pelo menos 1 dia.');
    config = await dados.salvarConfig({
      percentual: pct, compraMinimaCentavos: minimo, validadeDias: Math.round(Number(f.validade.value)),
      multiploUsoMinimo: Number(f.multiplo.value) || 1, diasLembrete: Math.round(Number(f.lembrete.value) || 0),
      diasAntesAvisoFinal: Math.round(Number(f.avisoFinal.value) || 0), nomeLoja: f.loja.value.trim() || M.CONFIG_PADRAO.nomeLoja,
    });
    avisar('Regras salvas. Valem para as próximas compras.');
  });
  return h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); salvar(); } },
    h('div', { class: 'grade' },
      h('label', { class: 'campo' }, h('span', {}, 'Giftback padrão (% da compra)'), f.percentual),
      h('label', { class: 'campo' }, h('span', {}, 'Compra mínima para ganhar (R$)'), f.minimo),
      h('label', { class: 'campo' }, h('span', {}, 'Validade (dias)'), f.validade),
      h('label', { class: 'campo' }, h('span', {}, 'Para usar: compra de quantas vezes o giftback'), f.multiplo),
      h('label', { class: 'campo' }, h('span', {}, 'Lembrete após quantos dias'), f.lembrete),
      h('label', { class: 'campo' }, h('span', {}, 'Aviso final: quantos dias antes de vencer'), f.avisoFinal),
      h('label', { class: 'campo' }, h('span', {}, 'Nome da loja nas mensagens'), f.loja)),
    exemplo,
    h('p', { class: 'suave pequeno', style: 'margin-top:8px' }, 'O % pode ser mudado em cada venda, na tela do Caixa, sem alterar este padrão. Mudanças aqui valem para os giftbacks novos: os já gerados continuam como foram combinados com o cliente.'),
    h('div', { class: 'linha-flex', style: 'margin-top:14px' }, h('button', { class: 'botao principal grande', type: 'submit' }, 'Salvar regras')));
}

function configModelos() {
  const exemploCliente = { nome: 'Ana', sobrenome: 'Exemplo' };
  const exemploGift = { valorCentavos: 500, minimoCentavos: 2500, codigo: 'natubravaabc23', expiraEm: M.fimDoDiaSP(M.somarDias(hoje(), 3)) };
  const exemploExtras = { data_limite: M.formatarDia(M.somarDias(hoje(), 15)) };
  const campos = {};
  const previaDe = (area, tipoOuTexto) => {
    const p = h('div', { class: 'msg-texto' });
    const atualizar = () => { p.textContent = M.mensagemCompleta(area.value, { cliente: exemploCliente, giftback: exemploGift, config: { ...config, rodape: rodape.value }, hoje: hoje(), extras: exemploExtras }); };
    area.addEventListener('input', atualizar);
    return { p, atualizar };
  };
  const rodape = h('textarea', { value: config.rodape ?? '', style: 'min-height:60px' });
  const previas = [];
  const blocoModelo = (chave, titulo, explica, ativo) => {
    const area = h('textarea', { value: config.modelos[chave] ?? '' });
    campos[chave] = area;
    const pv = previaDe(area);
    previas.push(pv);
    return h('div', { class: 'cartao modelo' },
      h('div', { class: 'linha-flex' }, h('h3', {}, titulo), ativo ? h('span', { class: 'etiqueta verde' }, 'automática') : h('span', { class: 'etiqueta cinza' }, 'ainda não automática')),
      h('p', { class: 'suave pequeno', style: 'margin:4px 0 8px' }, explica),
      h('div', { class: 'grade-modelo' }, area, h('details', { open: false }, h('summary', {}, 'Ver como fica'), pv.p)));
  };
  const campanhas = (config.campanhas || []).map((c) => ({ ...c }));
  const listaCampanhas = h('div', {});
  function desenharCampanhas() {
    trocar(listaCampanhas, campanhas.map((c, i) => {
      const nome = h('input', { type: 'text', class: 'entrada', value: c.nome, oninput: (e) => { c.nome = e.target.value; } });
      const area = h('textarea', { value: c.texto, oninput: (e) => { c.texto = e.target.value; } });
      const pv = previaDe(area);
      previas.push(pv);
      pv.atualizar();
      return h('div', { class: 'cartao modelo' },
        h('div', { class: 'linha-flex' }, nome,
          h('button', { class: 'botao', type: 'button', onclick: () => tentar(async () => { await navigator.clipboard.writeText(M.mensagemCompleta(c.texto, { cliente: { nome: '' }, config: { ...config, rodape: rodape.value } }).replace(/\{primeiro_nome\}|,\s*!/g, '')); avisar('Texto copiado.'); }) }, 'Copiar texto'),
          h('button', { class: 'botao perigo', type: 'button', onclick: () => { if (confirm(`Remover o modelo "${c.nome}"?`)) { campanhas.splice(i, 1); desenharCampanhas(); } } }, 'Remover')),
        h('div', { class: 'grade-modelo', style: 'margin-top:8px' }, area, h('details', {}, h('summary', {}, 'Ver como fica'), pv.p)));
    }));
  }
  desenharCampanhas();

  const salvar = () => tentar(async () => {
    config = await dados.salvarConfig({
      rodape: rodape.value,
      modelos: Object.fromEntries(Object.entries(campos).map(([k, el]) => [k, el.value])),
      campanhas: campanhas.filter((c) => c.nome.trim() && c.texto.trim()).map((c, i) => ({ id: c.id || `campanha-${Date.now()}-${i}`, nome: c.nome.trim(), texto: c.texto })),
    });
    avisar('Modelos salvos.');
  });

  const blocos = [
    h('h2', { class: 'secao' }, 'Mensagens automáticas do giftback'),
    blocoModelo('envio', '1. Giftback novo', 'Sai na hora da compra (botão no caixa) ou fica na fila de Mensagens.', true),
    blocoModelo('lembrete', '2. Lembrete', `Entra na fila ${config.diasLembrete} dias depois da compra, se o giftback ainda não foi usado.`, true),
    blocoModelo('vencendo', '3. Vence em breve', `Entra na fila ${config.diasAntesAvisoFinal} dias antes de vencer. Use {prazo} para "em 2 dias", "amanhã" ou "hoje", sempre certo no dia do envio.`, true),
    h('h2', { class: 'secao' }, 'Outras mensagens (usadas na Zoppy)'),
    blocoModelo('aniversario', 'Aniversário', 'Na Zoppy ia para o Painel do Vendedor. Fica guardada para quando o aniversário for automático.', false),
    blocoModelo('recompra90', 'Recompra 90 dias', 'Cliente sem comprar há 90 dias (cupom de 10%). Fica guardada para a próxima etapa.', false),
    blocoModelo('recompra180', 'Recompra 180 dias', 'Cliente sem comprar há 180 dias (cupom de 15%). Fica guardada para a próxima etapa.', false),
    h('h2', { class: 'secao' }, 'Assinatura no fim de toda mensagem'),
    h('div', { class: 'cartao' }, h('p', { class: 'suave pequeno', style: 'margin-bottom:6px' }, 'Deixe em branco para não usar.'), rodape),
    h('h2', { class: 'secao' }, 'Modelos de campanha'),
    h('p', { class: 'suave pequeno', style: 'margin-bottom:8px' }, 'Textos para mandar a um grupo de clientes (ex.: quem não compra há 90 dias). Vieram das campanhas que você fez na Zoppy. {data_limite} é a data final da campanha.'),
    listaCampanhas,
    h('button', { class: 'botao', type: 'button', style: 'margin-top:10px', onclick: () => { campanhas.push({ id: '', nome: 'Nova campanha', texto: 'Olá, {primeiro_nome}! ' }); desenharCampanhas(); } }, '+ Novo modelo de campanha'),
  ];
  rodape.addEventListener('input', () => previas.forEach((p) => p.atualizar()));
  previas.forEach((p) => p.atualizar());
  return h('form', { onsubmit: (e) => { e.preventDefault(); salvar(); } },
    h('div', { class: 'cartao' },
      h('p', { class: 'suave pequeno' }, 'As palavras entre chaves são trocadas sozinhas pelos dados do cliente. Asteriscos deixam o texto em *negrito* no WhatsApp.'),
      h('div', { class: 'variaveis' }, M.VARIAVEIS_MENSAGEM.map(([v, d]) => h('code', { title: d }, v)))),
    blocos,
    h('div', { class: 'barra-salvar' }, h('button', { class: 'botao principal grande', type: 'submit' }, 'Salvar modelos')));
}

function cartaoModoTeste() {
  return h('div', { class: 'cartao' },
    h('h3', {}, 'Modo teste'),
    h('p', { class: 'suave', style: 'margin:6px 0 12px' }, 'Você está usando uma cópia dos dados da Zoppy guardada só neste navegador. Pode lançar compras e cadastrar clientes à vontade: nada vai para a Zoppy nem para os clientes (a mensagem só sai se você apertar Enter no WhatsApp).'),
    h('button', { class: 'botao perigo', onclick: () => { if (confirm('Apagar tudo que foi feito no teste e voltar aos dados da Zoppy?')) tentar(async () => { await dados.restaurarDadosZoppy(); config = await dados.obterConfig(); estado.clienteId = null; estado.resultadoCompra = null; avisar('Dados restaurados.'); await atualizarContador(); telaConfig(); }); } }, 'Apagar testes e recarregar dados da Zoppy'));
}

function cartaoDadosOnline() {
  const arquivo = h('input', { type: 'file', accept: '.json,application/json' });
  const situacao = h('p', { class: 'suave pequeno', style: 'margin-top:8px' });
  const importar = () => tentar(async () => {
    const f = arquivo.files?.[0];
    if (!f) throw new Error('Escolha o arquivo seed.json (pasta GIFTBACK ACKER > dados_migrados).');
    const seed = JSON.parse(await f.text());
    if (!confirm(`Importar ${seed.clientes?.length ?? 0} clientes, ${seed.compras?.length ?? 0} compras e ${seed.giftbacks?.length ?? 0} giftbacks da Zoppy?`)) return;
    await dados.importarSeed(seed, (txt) => { situacao.textContent = txt; });
    config = await dados.obterConfig();
    situacao.textContent = 'Importação concluída.';
    avisar('Dados da Zoppy importados.');
    await atualizarContador();
  });
  const apagar = () => tentar(async () => {
    const resposta = prompt('Isto apaga TODOS os clientes, compras, giftbacks e mensagens do Giftback Acker (as configurações ficam).\nUse só para recomeçar com os dados finais da Zoppy.\n\nPara confirmar, digite: APAGAR TUDO');
    if (resposta !== 'APAGAR TUDO') { if (resposta != null) avisar('Nada foi apagado.'); return; }
    await dados.apagarTudo();
    estado.clienteId = null; estado.resultadoCompra = null;
    avisar('Todos os dados foram apagados.');
    await atualizarContador();
  });
  return h('div', { class: 'cartao', style: 'margin-top:22px' },
    h('h3', {}, 'Dados da Zoppy'),
    h('p', { class: 'suave', style: 'margin:6px 0 12px' }, 'Para trazer os clientes, compras e giftbacks da Zoppy: escolha o arquivo ', h('b', {}, 'seed.json'), ' da pasta GIFTBACK ACKER > dados_migrados e clique em Importar. Só funciona com o banco vazio.'),
    h('div', { class: 'linha-flex' }, arquivo, h('button', { class: 'botao principal', onclick: importar }, 'Importar')),
    situacao,
    h('p', { class: 'suave pequeno', style: 'margin-top:16px' }, 'No dia da troca definitiva, apague os dados de teste e importe o arquivo novo:'),
    h('button', { class: 'botao perigo', style: 'margin-top:6px', onclick: apagar }, 'Apagar todos os dados'));
}

// ───────────────────────── login ─────────────────────────

function telaLogin(mensagem = '') {
  const fEmail = h('input', { type: 'email', autocomplete: 'username', placeholder: 'seu e-mail' });
  const fSenha = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'senha' });
  const info = h('div', {});
  if (mensagem) info.append(h('div', { class: 'caixa-info ambar', style: 'margin-bottom:12px' }, mensagem));
  const entrar = () => tentar(async () => {
    await dados.entrar(fEmail.value, fSenha.value);
    await depoisDoLogin();
  });
  const primeiroAcesso = () => tentar(async () => {
    if (!fEmail.value.trim() || fSenha.value.length < 8) throw new Error('Digite o e-mail e uma senha nova com pelo menos 8 caracteres.');
    await dados.criarAcesso(fEmail.value, fSenha.value, ENDERECO_APP);
    trocar(info, h('div', { class: 'caixa-info verde', style: 'margin-bottom:12px' }, 'Pronto! Enviamos um e-mail de confirmação. Abra o e-mail, clique no link e depois entre aqui com a senha que você criou.'));
  });
  const esqueci = () => tentar(async () => {
    if (!fEmail.value.trim()) throw new Error('Digite o seu e-mail primeiro.');
    await dados.recuperarSenha(fEmail.value, ENDERECO_APP);
    trocar(info, h('div', { class: 'caixa-info verde', style: 'margin-bottom:12px' }, 'Enviamos um e-mail com o link para criar uma senha nova.'));
  });
  document.getElementById('abas').hidden = true;
  trocar(tela, h('form', { class: 'cartao', style: 'max-width:420px;margin:40px auto', onsubmit: (e) => { e.preventDefault(); entrar(); } },
    h('h1', { class: 'titulo-tela' }, 'Entrar no Giftback Acker'),
    info,
    h('label', { class: 'campo' }, h('span', {}, 'E-mail'), fEmail),
    h('label', { class: 'campo', style: 'margin-top:10px' }, h('span', {}, 'Senha'), fSenha),
    h('button', { class: 'botao principal grande', type: 'submit', style: 'margin-top:16px;width:100%;justify-content:center' }, 'Entrar'),
    h('div', { class: 'linha-flex pequeno', style: 'margin-top:14px;justify-content:space-between' },
      h('button', { class: 'link', type: 'button', onclick: primeiroAcesso }, 'Primeiro acesso: criar minha senha'),
      h('button', { class: 'link', type: 'button', onclick: esqueci }, 'Esqueci a senha'))));
  fEmail.focus();
}

function telaNovaSenha() {
  const fSenha = h('input', { type: 'password', autocomplete: 'new-password' });
  document.getElementById('abas').hidden = true;
  trocar(tela, h('form', { class: 'cartao', style: 'max-width:420px;margin:40px auto', onsubmit: (e) => { e.preventDefault(); tentar(async () => {
    if (fSenha.value.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
    await dados.trocarSenha(fSenha.value);
    avisar('Senha alterada.');
    await depoisDoLogin();
  }); } },
    h('h1', { class: 'titulo-tela' }, 'Criar senha nova'),
    h('label', { class: 'campo' }, h('span', {}, 'Senha nova (mínimo 8 caracteres)'), fSenha),
    h('button', { class: 'botao principal grande', type: 'submit', style: 'margin-top:16px' }, 'Salvar senha')));
  fSenha.focus();
}

async function depoisDoLogin() {
  if (!(await dados.ehEquipe())) {
    const s = await dados.sessao();
    await dados.sair();
    telaLogin(`O e-mail ${s?.user?.email || ''} ainda não tem permissão para usar o Giftback Acker. Peça para o Jacson liberar.`);
    return;
  }
  const s = await dados.sessao();
  const usuario = document.getElementById('usuario');
  trocar(usuario, h('span', { class: 'pequeno' }, s?.user?.email || ''), ' ',
    h('button', { class: 'link pequeno', style: 'color:#fff', onclick: () => tentar(async () => { await dados.sair(); location.reload(); }) }, 'Sair'));
  usuario.hidden = false;
  document.getElementById('abas').hidden = false;
  await abrirSistema();
}

// ───────────────────────── navegação ─────────────────────────

const extras = criarTelasExtras({
  h, trocar, tentar, avisar, tela, estado, nomeCompleto, dia, hoje, abrirWhatsApp, valorGift,
  dados: () => dados, config: () => config,
});
const TELAS = {
  caixa: telaCaixa, mensagens: telaMensagens, uniplus: telaUniplus, clientes: telaClientes,
  relatorios: extras.telaRelatorios, campanhas: extras.telaCampanhas,
  config: telaConfig,
};

function navegar() {
  const aba = (location.hash || '#caixa').slice(1);
  const desenhar = TELAS[aba] || telaCaixa;
  document.querySelectorAll('#abas a').forEach((a) => a.classList.toggle('ativa', a.dataset.aba === (TELAS[aba] ? aba : 'caixa')));
  trocar(tela);
  window.scrollTo(0, 0);
  tentar(() => desenhar());
  if (dados) atualizarContador().catch(() => {});
}

let sistemaAberto = false;

async function abrirSistema() {
  await dados.iniciar();
  config = await dados.obterConfig();
  document.getElementById('modo').hidden = dados.modo !== 'teste';
  document.getElementById('aba-uniplus').hidden = !dados.puxarVendasUniplus;
  if (sistemaAberto) { navegar(); atualizarContador(); return; }
  sistemaAberto = true;

  // Atalhos vindos de fora (ex.: tecla de atalho do PDV):
  //   ?busca=nome ou telefone      abre o caixa já buscando
  //   ?novo=1&telefone=..&nome=..  abre o cadastro de cliente novo preenchido
  const p = new URLSearchParams(location.search);
  if (p.get('busca')) { estado.busca = p.get('busca'); estado.abrirUnico = true; location.hash = '#caixa'; }
  if (p.get('novo')) { estado.novoPrefill = { telefone: M.normalizarTelefone(p.get('telefone')), nome: p.get('nome') || '' }; location.hash = '#caixa'; }
  for (const k of ['busca', 'novo', 'telefone', 'nome']) p.delete(k);
  history.replaceState(null, '', location.pathname + (p.toString() ? '?' + p : '') + location.hash);

  window.addEventListener('hashchange', navegar);
  navegar();
  atualizarContador();
}

// Instalar como aplicativo (janela própria, sem barra de endereço): o Chrome avisa quando é possível.
let pedidoInstalacao = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pedidoInstalacao = e;
  const b = document.getElementById('instalar');
  b.hidden = false;
  b.onclick = async () => { b.hidden = true; await pedidoInstalacao.prompt(); pedidoInstalacao = null; };
});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

async function iniciar() {
  if (MODO_TESTE) {
    const lerArquivo = async (caminho) => {
      try {
        const r = await fetch(caminho, { cache: 'no-store' });
        return r.ok ? await r.json() : null;
      } catch { return null; }
    };
    dados = criarDadosLocal({
      carregarSeed: () => lerArquivo('../dados_migrados/seed.json'),
      carregarExemploUniplus: () => lerArquivo('../dados_migrados/uniplus_exemplo.json'),
    });
    return abrirSistema();
  }
  const { createClient } = await import(SUPABASE_JS);
  const supabase = createClient(SUPABASE_URL, SUPABASE_CHAVE_PUBLICA, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  dados = criarDadosSupabase({ supabase });
  let recuperando = /type=recovery/.test(location.hash);
  dados.aoMudarSessao((evento) => {
    if (evento === 'PASSWORD_RECOVERY') { recuperando = true; telaNovaSenha(); }
  });
  const sessao = await dados.sessao();
  if (recuperando) { telaNovaSenha(); return; }
  if (/^#(access_token|error)/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search + '#caixa');
  if (!sessao) { telaLogin(); return; }
  await depoisDoLogin();
}

iniciar().catch((e) => {
  console.error(e);
  trocar(tela, h('div', { class: 'cartao caixa-info vermelha' }, 'Não foi possível abrir o Giftback Acker: ' + (e.message || e)));
});
