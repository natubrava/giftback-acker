// app.js — Telas do Giftback Acker (Caixa, Mensagens, Clientes, Configurações) e login.
// As regras ficam em motor.js; os dados, em dados-supabase.js (online) ou dados-local.js (modo teste).
import * as M from './motor.js?v=20261111162131';
import { criarDadosLocal } from './dados-local.js?v=20261111162131';
import { criarDadosSupabase } from './dados-supabase.js?v=20261111162131';
import { SUPABASE_URL, SUPABASE_CHAVE_PUBLICA } from './config-online.js?v=20261111162131';
import { criarTelasExtras } from './telas-extra.js?v=20261111162131';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
const MODO_TESTE = new URLSearchParams(location.search).get('modo') === 'teste' || !SUPABASE_URL;
const ENDERECO_APP = location.origin + location.pathname;

let dados = null;

const tela = document.getElementById('tela');
let config = M.CONFIG_PADRAO;
const estado = { clienteId: null, busca: '', resultadoCompra: null };
let usuarioEmail = ''; // quem está usando (para o histórico das regras)

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

const ICONES = {
  presente: '<path d="M3 8h18v4H3z"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
  calendario: '<rect x="3" y="4.5" width="18" height="17" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
};
/** Ícone desenhado em linha (presente, calendário). */
function icone(nome, classe = '') {
  const el = document.createElement('span');
  el.className = 'icone ' + classe;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<svg viewBox="0 0 24 24">${ICONES[nome]}</svg>`;
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

const nomeCompleto = (c) => `${c.nome ?? ''} ${c.sobrenome ?? ''}`.trim() || '(sem nome)';
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
  const elBaixo = document.getElementById('contador-baixo');
  elBaixo.textContent = n;
  elBaixo.hidden = n === 0;
  elBaixo.classList.toggle('atrasado', atrasadas > 0);
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
function campoPercentual(aoMudar, base = config) {
  const campo = h('input', { type: 'number', class: 'pct', min: 0.5, max: 100, step: 0.5, value: base.percentual, 'aria-label': '% de giftback desta venda' });
  const aviso = h('span', { class: 'suave pequeno' });
  const valor = () => {
    const n = Number(String(campo.value).replace(',', '.'));
    return n > 0 && n <= 100 ? n : base.percentual;
  };
  const marcar = () => {
    const mudou = valor() !== base.percentual;
    campo.classList.toggle('alterado', mudou);
    aviso.textContent = mudou ? `só nesta venda (padrão ${base.percentual}%)` : '';
  };
  campo.addEventListener('input', () => { marcar(); aoMudar(); });
  // Normal: só o texto "Giftback desta venda: 5%", discreto. Clicou: aparecem as setas para mudar o %.
  const mudar = (d) => { campo.value = Math.min(100, Math.max(0.5, valor() + d)); marcar(); aoMudar(); };
  const editor = h('span', { class: 'pct-editor', hidden: true },
    'Giftback desta venda:',
    h('button', { type: 'button', class: 'pct-seta', 'aria-label': 'Diminuir o %', onclick: () => mudar(-1) }, '−'),
    campo,
    h('button', { type: 'button', class: 'pct-seta', 'aria-label': 'Aumentar o %', onclick: () => mudar(1) }, '+'),
    '%', aviso);
  const resumo = h('button', { type: 'button', class: 'pct-resumo', title: 'Clique para mudar o % só desta venda' },
    'Giftback desta venda: ', h('b', {}, `${base.percentual}%`), h('span', { class: 'pct-lapis', 'aria-hidden': 'true' }, '✎'));
  resumo.onclick = () => { resumo.hidden = true; editor.hidden = false; campo.focus(); campo.select(); };
  const el = h('div', { class: 'linha-pct' }, resumo, editor);
  return { el, valor, configDaVenda: () => ({ ...base, percentual: valor() }), mudou: () => valor() !== base.percentual };
}

/** Etiqueta colorida do perfil especial do cliente (ou nada, se for cliente comum). */
function etiquetaPerfil(cliente) {
  const p = M.perfilDoCliente(cliente, config);
  return p ? h('span', { class: 'etiqueta perfil', style: `background:${p.cor}` }, p.nome) : null;
}

/** Linha de cliente nas listas do caixa (resultado da busca e clientes recentes). */
function linhaCliente(c, aoClicar, destaque = false) {
  const p = M.perfilDoCliente(c, config);
  return h('button', { class: 'resultado' + (destaque ? ' destaque' : ''), style: p ? `border-left:5px solid ${p.cor}` : '', onclick: aoClicar },
    h('span', { class: 'resultado-id' }, h('span', { class: 'nome' }, nomeCompleto(c)), ' ', etiquetaPerfil(c), h('br'),
      h('span', { class: 'suave pequeno' }, M.formatarTelefone(c.telefone), c.ultimaCompra ? h('span', { class: 'so-medio' }, ` · última compra ${dia(c.ultimaCompra)}`) : null)),
    h('span', { class: 'espaco' }),
    c.giftback
      ? h('span', { class: 'resultado-gift' },
        h('span', { class: 'etiqueta verde' }, valorGift(c.giftback), ' até ', dia(c.giftback.expiraEm).slice(0, 5)),
        c.giftback.minimoCentavos ? h('span', { class: 'gift-min' }, 'compra mín. ', M.formatarReais(c.giftback.minimoCentavos)) : null)
      : h('span', { class: 'etiqueta cinza' }, 'sem giftback'));
}

/** Liga a vírgula automática num campo de valor: digitar 20000 vira 200,00. */
function comVirgulaAutomatica(campo) {
  campo.inputMode = 'numeric';
  if (campo.value) campo.value = M.mascararReais(campo.value);
  campo.addEventListener('input', () => {
    campo.value = M.mascararReais(campo.value);
    campo.setSelectionRange?.(campo.value.length, campo.value.length);
  });
  return campo;
}

/** Lista para escolher o perfil do cliente nos formulários. */
function seletorPerfil(atual = '') {
  const sel = h('select', {}, h('option', { value: '' }, 'Cliente comum'), (config.perfis || []).map((p) => h('option', { value: p.id }, p.nome)));
  sel.value = atual || '';
  return sel;
}

// ───────────────────────── CAIXA ─────────────────────────

function telaCaixa() {
  const campo = h('input', {
    type: 'search', id: 'busca', placeholder: 'Nome, celular ou código do giftback', autocomplete: 'off',
    value: estado.busca, 'aria-label': 'Buscar cliente',
  });
  const resultados = h('div', { class: 'resultados' });
  const painel = h('div', { id: 'painel' });
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
    lista.forEach((c, i) => resultados.append(linhaCliente(c, () => abrirCliente(c.id), i === 0)));
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
    h('h1', { class: 'titulo-tela titulo-caixa' }, 'Caixa'),
    h('div', { class: 'busca' }, campo, h('button', { class: 'botao', onclick: () => abrirNovo() }, h('span', { class: 'longo' }, '+ Cliente novo'), h('span', { class: 'curto' }, '+ Novo'))),
    resultados, painel);
  if (!estado.clienteId && !estado.busca && !estado.novoPrefill) desenharResumoDoDia(painel);
  window.__gbAbrirCliente = abrirCliente;

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
  const recentes = dados.clientesRecentes ? await dados.clientesRecentes(8).catch(() => []) : [];
  if (estado.clienteId || painel.childElementCount) return;
  trocar(painel,
    recentes.length ? h('div', { class: 'recentes' },
      h('div', { class: 'rotulo-lista' }, 'Clientes recentes'),
      h('div', { class: 'resultados' }, recentes.map((c) => linhaCliente(c, () => window.__gbAbrirCliente?.(c.id))))) : null,
    h('div', { class: 'numeros so-largo', style: 'margin-top:16px' },
      h('div', { class: 'numero' }, h('b', {}, r.compras), h('span', {}, 'compras lançadas hoje')),
      h('div', { class: 'numero' }, h('b', {}, M.formatarReais(r.totalCentavos)), h('span', {}, 'valor lançado hoje')),
      h('div', { class: 'numero' }, h('b', {}, r.giftbacksGerados), h('span', {}, 'giftbacks gerados hoje')),
      h('a', { class: 'numero' + (fila ? ' alerta' : ''), href: '#mensagens', style: 'text-decoration:none;color:inherit' }, h('b', {}, fila), h('span', {}, 'mensagens para enviar'))),
    r.ultimas.length ? h('div', { class: 'cartao so-largo' },
      h('h3', { style: 'margin-bottom:8px' }, 'Últimas compras de hoje'),
      h('table', {}, h('tbody', {}, r.ultimas.map((c) => h('tr', { class: 'clicavel', onclick: () => { estado.clienteId = c.clienteId; estado.resultadoCompra = null; telaCaixa(); } },
        h('td', {}, String(c.data).slice(11, 16) ? new Date(c.data).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''),
        h('td', {}, c.cliente ? `${c.cliente.nome ?? ''} ${c.cliente.sobrenome ?? ''}`.trim() : ''),
        h('td', { class: 'num' }, M.formatarReais(c.valorFinalCentavos)),
        h('td', {}, c.giftbackUsadoId ? h('span', { class: 'etiqueta azul' }, 'usou giftback') : ''))))))
      : (recentes.length ? null : h('p', { class: 'suave', style: 'text-align:center;margin-top:18px' }, 'Busque o cliente pelo nome, celular ou código do giftback para lançar a compra.')));
}

function painelNovoCliente(painel, prefill, aoSalvar, aoCancelar) {
  const fTel = h('input', { type: 'tel', value: prefill.telefone ? M.formatarTelefone(prefill.telefone) : '', placeholder: '(47) 99999-9999', autocomplete: 'off' });
  const fNome = h('input', { type: 'text', value: prefill.nome ? prefill.nome.split(/\s+/)[0] : '', autocomplete: 'off' });
  const fSobrenome = h('input', { type: 'text', value: prefill.nome ? prefill.nome.split(/\s+/).slice(1).join(' ') : (prefill.sobrenome || ''), autocomplete: 'off' });
  const fSexo = h('select', {}, h('option', { value: '' }, 'Não informar'), h('option', { value: 'F' }, 'Feminino'), h('option', { value: 'M' }, 'Masculino'));
  const fEmail = h('input', { type: 'email', placeholder: 'opcional', autocomplete: 'off' });
  const jaExiste = h('div', {});
  const fPerfilNovo = seletorPerfil('');
  const botaoCadastrar = h('button', { class: 'botao principal', type: 'submit' }, 'Cadastrar e lançar compra');
  let repetido = null;      // cliente que já usa este WhatsApp (não deixa cadastrar de novo)
  let conferido = '';       // último telefone conferido

  // Confere o WhatsApp assim que o número fica completo: um telefone = um cadastro só.
  async function conferirTelefone() {
    const tel = M.normalizarTelefone(fTel.value) || '';
    if (tel === conferido) return repetido;
    conferido = tel;
    repetido = tel ? await dados.clientePorTelefone(tel) : null;
    if (conferido !== tel) return repetido; // digitou mais enquanto conferia
    trocar(jaExiste);
    botaoCadastrar.disabled = !!repetido;
    if (!repetido) return null;
    const c = repetido;
    jaExiste.append(c.excluidoEm
      ? h('div', { class: 'alerta-repetido', role: 'alert' },
        h('div', { class: 'alerta-titulo' }, 'Este WhatsApp é de um cliente excluído'),
        h('div', { class: 'alerta-nome' }, nomeCompleto(c)),
        h('div', {}, `Excluído em ${dia(c.excluidoEm)}. Não dá para cadastrar de novo com o mesmo número: restaure o cadastro, que volta com todo o histórico.`),
        h('button', { class: 'botao principal grande', type: 'button', onclick: () => tentar(async () => { await dados.restaurarCliente(c.id); avisar('Cliente restaurado.'); aoSalvar(c); }) }, 'Restaurar este cliente'))
      : h('div', { class: 'alerta-repetido', role: 'alert' },
        h('div', { class: 'alerta-titulo' }, 'Este WhatsApp já tem cadastro'),
        h('div', { class: 'alerta-nome' }, nomeCompleto(c)),
        h('div', {}, 'Não é possível cadastrar o mesmo número duas vezes. Abra o cadastro que já existe para lançar a compra.'),
        h('button', { class: 'botao principal grande', type: 'button', onclick: () => aoSalvar(c) }, `Abrir o cadastro de ${c.nome || 'cliente'}`)));
    jaExiste.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return repetido;
  }
  fTel.addEventListener('input', () => { conferirTelefone().catch(() => {}); });
  fTel.addEventListener('blur', () => { conferirTelefone().catch(() => {}); });

  const salvar = () => tentar(async () => {
    conferido = ''; // confere de novo na hora de salvar
    if (await conferirTelefone()) throw new Error('Este WhatsApp já tem cadastro. Abra o cadastro que já existe.');
    const c = await dados.criarCliente({ nome: fNome.value, sobrenome: fSobrenome.value, telefone: fTel.value, sexo: fSexo.value || null, email: fEmail.value.trim() || null, perfil: fPerfilNovo.value || null });
    avisar('Cliente cadastrado no Club NatuBrava.');
    aoSalvar(c);
  });

  trocar(painel, h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); salvar(); } },
    h('h2', { class: 'titulo-tela' }, 'Cliente novo'),
    jaExiste,
    h('div', { class: 'grade' },
      h('label', { class: 'campo' }, h('span', {}, 'WhatsApp (obrigatório)'), fTel),
      h('label', { class: 'campo' }, h('span', {}, 'Nome'), fNome),
      h('label', { class: 'campo' }, h('span', {}, 'Sobrenome'), fSobrenome),
      h('label', { class: 'campo' }, h('span', {}, 'Sexo'), fSexo),
      h('label', { class: 'campo' }, h('span', {}, 'E-mail'), fEmail),
      h('label', { class: 'campo' }, h('span', {}, 'Perfil'), fPerfilNovo)),
    h('div', { class: 'linha-flex', style: 'margin-top:14px' },
      botaoCadastrar,
      h('button', { class: 'botao', type: 'button', onclick: aoCancelar }, 'Cancelar'))));
  (prefill.telefone ? fNome : fTel).focus();
  if (prefill.telefone) conferirTelefone().catch(() => {});
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
  // Última compra, nº de compras e total: recolhido; o "i" ao lado do telefone abre e fecha
  const linhaUltima = h('div', { class: 'cliente-ultima', hidden: true }, ultima);
  const botaoInfo = h('button', { type: 'button', class: 'info-btn', title: 'Última compra e total do cliente', 'aria-expanded': 'false' }, 'i');
  botaoInfo.onclick = () => {
    linhaUltima.hidden = !linhaUltima.hidden;
    botaoInfo.classList.toggle('aberto', !linhaUltima.hidden);
    botaoInfo.setAttribute('aria-expanded', String(!linhaUltima.hidden));
  };
  const cabecalho = h('div', {},
    h('div', { class: 'cliente-topo' },
      h('div', { class: 'cliente-id' },
        h('h2', { class: 'cliente-nome', title: nomeCompleto(c) }, nomeCompleto(c), ' ', etiquetaPerfil(c)),
        h('div', { class: 'cliente-dados' }, M.formatarTelefone(c.telefone), c.ultimaCompra || c.compras ? botaoInfo : null)),
      h('div', { class: 'cliente-acoes' },
        h('button', { class: 'botao mini', onclick: () => historico.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 'Histórico'),
        h('button', { class: 'botao mini', onclick: () => editarCliente(painel, c, redesenhar) }, 'Editar'),
        h('button', { class: 'botao mini', onclick: aoFechar, title: 'Fechar (Esc)', 'aria-label': 'Fechar' }, '✕'))),
    linhaUltima);

  // Giftback: valor à esquerda; validade e compra mínima (em destaque) à direita. O código fica só no Histórico.
  let cartaoGift;
  if (g) {
    const faltam = M.diasEntre(hoje(), M.diaSP(g.expiraEm));
    // "faltam X dias" fica recolhido (o "i" mostra); perto de vencer (3 dias ou menos) aparece sempre, em vermelho
    const urgente = faltam <= 3;
    const prazo = h('span', { class: urgente ? 'urgente' : 'prazo-extra', hidden: !urgente }, ' · ', textoPrazo(g));
    const botaoPrazo = urgente ? null : h('button', { type: 'button', class: 'info-btn', title: 'Quantos dias faltam', onclick: () => { prazo.hidden = !prazo.hidden; botaoPrazo.classList.toggle('aberto', !prazo.hidden); } }, 'i');
    cartaoGift = h('div', { class: 'gift' + (urgente ? ' alerta' : ''), title: `Código ${g.codigo}` },
      h('div', { class: 'gift-linha' },
        icone('presente', 'gift-icone'),
        h('div', { class: 'gift-esq' },
          h('div', { class: 'gift-rotulo' }, g.tipo === 'resgate' ? 'Cupom de resgate ativo' : 'Tem giftback'),
          h('div', { class: 'gift-valor' }, valorGift(g))),
        h('div', { class: 'gift-divisa' }),
        h('div', { class: 'gift-lado' },
          h('div', { class: 'gift-vale' }, icone('calendario'), 'Vale até ', h('b', {}, dia(g.expiraEm)), prazo, botaoPrazo),
          g.minimoCentavos ? h('div', { class: 'gift-minimo' }, 'Compra mínima ', h('b', {}, M.formatarReais(g.minimoCentavos))) : null)));
  } else {
    const ultimoGift = linhasGiftbacks(c)[0];
    const motivo = !ultimoGift ? 'Ainda não ganhou giftback.'
      : ultimoGift.status === 'usado' ? h('span', {}, `Último giftback (${valorGift(ultimoGift)}) foi `, h('b', { class: 'txt-azul' }, `usado em ${dia(ultimoGift.usadoEm)}`), '.')
        : ultimoGift.status === 'expirado' ? h('span', {}, `Último giftback (${valorGift(ultimoGift)}) `, h('b', { class: 'txt-vermelho' }, `venceu em ${dia(ultimoGift.expiraEm)}`), ' sem ser usado.')
          : '';
    cartaoGift = h('div', { class: 'gift sem' }, h('b', {}, 'Sem giftback no momento.'), motivo ? h('div', { class: 'pequeno' }, motivo) : null);
  }

  // Resultado da compra recém-lançada ou formulário
  const area = h('div', { class: 'lancar' });
  if (estado.resultadoCompra) desenharSucesso(area, estado.resultadoCompra, c, aoFechar, redesenhar);
  else desenharFormulario(area, c, g, redesenhar);

  desenharHistorico(historico, c, redesenhar);
  const perfil = M.perfilDoCliente(c, config);
  const regras = M.configParaCliente(config, c);
  const avisoPerfil = perfil && (regras.percentual !== config.percentual || regras.compraMinimaCentavos !== config.compraMinimaCentavos)
    ? h('div', { class: 'caixa-info pequeno', style: `margin-top:10px;background:${perfil.cor}1a;color:${perfil.cor}` },
      h('b', {}, `Regras de ${perfil.nome}: `), `giftback de ${regras.percentual}%`,
      regras.compraMinimaCentavos ? `, em compras a partir de ${M.formatarReais(regras.compraMinimaCentavos)}.` : ', sem compra mínima.') : null;
  trocar(painel, h('div', { class: 'cartao', style: perfil ? `border-top:5px solid ${perfil.cor}` : '' }, cabecalho, avisoPerfil, cartaoGift, area), historico);
}

const STATUS_GIFT = { ativo: ['verde', 'ativo'], usado: ['azul', 'usado'], expirado: ['vermelha', 'venceu'], substituido: ['cinza', 'trocado por um maior'], cancelado: ['cinza', 'cancelado'] };

/**
 * Linhas da aba Giftbacks do histórico, da mais nova para a mais antiga.
 * Junta os giftbacks registrados aqui com os que foram usados na época da Zoppy
 * (a Zoppy só entregou os cupons ativos; os usados aparecem nas compras, pelo desconto e pelo código).
 */
function linhasGiftbacks(c) {
  const agora = new Date();
  const registrados = (c.historicoGiftbacks || []).map((g) => ({ ...g, status: g.status === 'ativo' && new Date(g.expiraEm) < agora ? 'expirado' : g.status }));
  const ids = new Set(registrados.map((g) => g.id));
  const antigos = (c.historicoCompras || [])
    .filter((p) => p.status === 'ok' && p.descontoCentavos > 0 && !(p.giftbackUsadoId && ids.has(p.giftbackUsadoId)))
    .map((p) => ({ id: `compra-${p.id}`, antigo: true, criadoEm: null, expiraEm: null, valorCentavos: p.descontoCentavos, status: 'usado', usadoEm: p.data, compraUsoId: p.id, codigo: p.codigoUsado || '' }));
  const quando = (g) => String(g.criadoEm || g.usadoEm || '');
  return [...registrados, ...antigos].sort((a, b) => quando(b).localeCompare(quando(a)));
}

/** Situação do giftback em palavras, sempre com a data: "usado em", "venceu em", "trocado em". */
function situacaoGiftback(g, c) {
  const compraDe = (id) => (c.historicoCompras || []).find((p) => p.id === id);
  if (g.status === 'ativo') return [h('span', { class: 'etiqueta verde' }, 'ativo'), ` vence em ${dia(g.expiraEm)}`];
  if (g.status === 'usado') {
    const p = compraDe(g.compraUsoId);
    return [h('span', { class: 'etiqueta azul' }, `usado em ${dia(g.usadoEm || p?.data)}`), p ? ` na compra de ${M.formatarReais(p.valorCentavos)}` : ''];
  }
  if (g.status === 'expirado') return [h('span', { class: 'etiqueta vermelha' }, `venceu em ${dia(g.expiraEm)}`), ' sem ser usado'];
  if (g.status === 'substituido') {
    const p = (c.historicoCompras || []).find((x) => x.giftbackSubstituidoId === g.id);
    return [h('span', { class: 'etiqueta cinza' }, p ? `trocado em ${dia(p.data)}` : 'trocado'), ' por um giftback maior'];
  }
  if (g.status === 'cancelado') return [h('span', { class: 'etiqueta cinza' }, 'cancelado'), ' (compra desfeita)'];
  return [h('span', { class: 'etiqueta cinza' }, g.status)];
}
const STATUS_MSG = { enviada: ['verde', 'enviada'], pendente: ['ambar', 'na fila'], pulada: ['cinza', 'pulada'], cancelada: ['cinza', 'não precisou'] };

/** Histórico do cliente em 3 abas: compras, giftbacks e mensagens (para tirar dúvida do cliente no balcão). */
function desenharHistorico(caixa, c, redesenhar) {
  const listaGifts = linhasGiftbacks(c);
  const abas = [['compras', `Compras (${c.historicoCompras.length})`], ['giftbacks', `Giftbacks (${listaGifts.length})`], ['mensagens', `Mensagens (${(c.historicoMensagens || []).length})`]];
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
      trocar(corpo, listaGifts.length ? h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Ganhou em'), h('th', { class: 'num' }, 'Valor'), h('th', {}, 'Validade'), h('th', {}, 'O que aconteceu'), h('th', {}, 'Código'))),
        h('tbody', {}, listaGifts.map((g) => h('tr', {},
          h('td', {}, g.criadoEm ? dia(g.criadoEm) : h('span', { class: 'suave', title: 'Ganho na época da Zoppy' }, 'na Zoppy')),
          h('td', { class: 'num' }, valorGift(g)),
          h('td', {}, g.expiraEm ? dia(g.expiraEm) : '—'),
          h('td', {}, situacaoGiftback(g, c)),
          h('td', {}, g.codigo ? h('span', { class: 'codigo pequeno' }, g.codigo) : ''))))) : h('p', { class: 'suave' }, 'Nenhum giftback ainda.'));
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
    h('p', { class: 'suave pequeno', style: 'margin-top:8px' }, 'Da época da Zoppy vieram o giftback ativo e os giftbacks que foram usados (pelas compras com desconto). Os que venceram sem uso naquela época não vieram. Daqui para frente fica tudo registrado: ganho, uso, vencimento e troca, com a data. Mensagens enviadas pela Zoppy aparecem como "enviada (pela Zoppy)", sem a data exata.'));
  mostrar();
}

function desenharFormulario(area, cliente, g, redesenhar) {
  const fValor = h('input', { type: 'text', inputMode: 'numeric', placeholder: '0,00', title: 'Valor dos produtos que NÃO estão em promoção', autocomplete: 'off', 'aria-label': 'Valor da compra (itens não promocionais)' });
  const previa = h('div', { class: 'previa' });
  const confirmar = h('button', { class: 'botao principal grande registrar', disabled: true }, 'Registrar compra');
  let usar = null; // null = ainda não decidiu (segue o padrão: usar sempre que puder)
  const regrasCliente = M.configParaCliente(config, cliente);
  const pct = campoPercentual(() => atualizar(), regrasCliente);

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
      previa.append(h('label', { class: 'usar' }, marca, g.tipo === 'resgate' ? `Usar o cupom de ${valorGift(g)} nesta compra` : h('span', {}, 'Usar Giftback de ', h('b', {}, valorGift(g)), ' nesta compra')));
    } else if (g && uso.motivo === 'abaixo_minimo') {
      previa.append(h('div', { class: 'caixa-info ambar curta' }, icone('presente'), h('span', {}, 'Giftback: faltam ', h('b', {}, M.formatarReais(uso.faltamCentavos)), ' para a compra mínima de ', M.formatarReais(g.minimoCentavos))));
    }

    previa.append(h('div', { class: 'resumo-venda' },
      vaiUsar ? h('div', { class: 'conta' },
        h('span', {}, 'Desconto no PDV (giftback)'), h('span', { class: 'direita desconto' }, '− ' + M.formatarReais(r.descontoCentavos))) : null,
      h('div', { class: 'paga' }, h('span', {}, 'Cliente paga'), h('b', {}, M.formatarReais(r.valorFinalCentavos)))));
    if (r.novoGiftback) {
      previa.append(h('div', { class: 'caixa-info verde curta' }, icone('presente'), h('span', {}, 'Vai ganhar ', h('b', {}, M.formatarReais(r.novoGiftback.valorCentavos)),
        ` (${pct.valor()}%), válido até ${dia(r.novoGiftback.expiraEm)}`)));
    } else if (r.novoDescartado) {
      previa.append(h('div', { class: 'caixa-info verde curta', title: 'Giftback não acumula: fica sempre o de maior valor.' }, icone('presente'), h('span', {}, 'Continua com o giftback de ', h('b', {}, valorGift(g)), ` (maior que o desta, ${M.formatarReais(r.novoDescartado.valorCentavos)})`)));
    } else {
      previa.append(h('div', { class: 'caixa-info cinza curta' }, icone('presente'), h('span', {}, `Não gera giftback (abaixo de ${M.formatarReais(regrasCliente.compraMinimaCentavos)})`)));
    }
    if (r.giftbackAnterior === 'substituido') {
      previa.append(h('div', { class: 'caixa-info ambar curta', title: 'Giftback não acumula: fica sempre o de maior valor.' }, icone('presente'), h('span', {}, `O giftback de ${valorGift(g)} não será usado: troca pelo novo de `, h('b', {}, M.formatarReais(r.novoGiftback.valorCentavos)))));
    }
    confirmar.disabled = false;
    confirmar.onclick = () => tentar(async () => {
      confirmar.disabled = true;
      estado.resultadoCompra = await dados.lancarCompra({ clienteId: cliente.id, valorCentavos: valor, usarGiftback: vaiUsar, percentual: pct.mudou() ? pct.valor() : null });
      await atualizarContador();
      redesenhar();
    });
  }

  comVirgulaAutomatica(fValor);
  fValor.addEventListener('input', atualizar);
  fValor.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !confirmar.disabled) { e.preventDefault(); confirmar.focus(); } });

  fValor.id = 'valor-compra';
  trocar(area,
    h('div', { class: 'caixa-valor' },
      h('label', { class: 'caixa-valor-rotulo', for: 'valor-compra' }, 'Valor da compra', h('span', { class: 'obs' }, ' – produtos NÃO promocionais')),
      h('div', { class: 'valor-linha' }, h('span', { class: 'prefixo' }, 'R$'), fValor),
      pct.el),
    previa,
    confirmar);
  fValor.focus();
}

function desenharSucesso(area, r, cliente, aoFechar, redesenhar) {
  const passos = [];
  let n = 1;
  if (r.giftbackUsado) {
    passos.push(h('div', { class: 'passo' }, h('span', { class: 'num' }, n++), h('div', {},
      'No PDV, dê o desconto do giftback: ', h('span', { class: 'destaque-valor' }, M.formatarReais(r.compra.descontoCentavos)),
      h('div', { class: 'paga', style: 'margin-top:6px' }, h('span', {}, 'Cliente paga'), h('b', {}, M.formatarReais(r.compra.valorFinalCentavos))),
      h('div', { class: 'suave pequeno', style: 'margin-top:4px' }, 'O giftback usado já foi baixado.'))));
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
  const fPerfil = seletorPerfil(c.perfil);
  trocar(painel, h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); tentar(async () => {
    await dados.atualizarCliente(c.id, { nome: fNome.value, sobrenome: fSobrenome.value, telefone: fTel.value, sexo: fSexo.value || null, email: fEmail.value, nascimento: fNasc.value || null, perfil: fPerfil.value || null });
    avisar('Cadastro atualizado.'); depois();
  }); } },
    h('h2', { class: 'titulo-tela' }, 'Editar cliente'),
    h('div', { class: 'grade' },
      h('label', { class: 'campo' }, h('span', {}, 'Nome'), fNome),
      h('label', { class: 'campo' }, h('span', {}, 'Sobrenome'), fSobrenome),
      h('label', { class: 'campo' }, h('span', {}, 'WhatsApp'), fTel),
      h('label', { class: 'campo' }, h('span', {}, 'Sexo'), fSexo),
      h('label', { class: 'campo' }, h('span', {}, 'E-mail (opcional)'), fEmail),
      h('label', { class: 'campo' }, h('span', {}, 'Nascimento (opcional)'), fNasc),
      h('label', { class: 'campo' }, h('span', {}, 'Perfil (parceria ou família)'), fPerfil)),
    h('div', { class: 'linha-flex', style: 'margin-top:14px' },
      h('button', { class: 'botao principal', type: 'submit' }, 'Salvar'),
      h('button', { class: 'botao', type: 'button', onclick: depois }, 'Cancelar'),
      h('span', { class: 'espaco' }),
      h('button', { class: 'link pequeno perigo-link', type: 'button', onclick: () => tentar(async () => {
        const nome = nomeCompleto(c);
        const motivo = prompt(`Excluir ${nome}?\n\nO cliente sai das listas, da matriz e das campanhas, mas fica guardado em Clientes > Excluídos (com data, quem excluiu e motivo) e pode ser restaurado.\n\nQual o motivo da exclusão?`);
        if (motivo == null) return;
        if (!motivo.trim()) { avisar('Informe o motivo. Nada foi excluído.', true); return; }
        const conf = prompt(`Para confirmar a exclusão de ${nome}, digite: EXCLUIR`);
        if (conf == null || conf.trim().toUpperCase() !== 'EXCLUIR') { avisar('Nada foi excluído.'); return; }
        await dados.excluirCliente(c.id, motivo.trim());
        estado.clienteId = null; estado.resultadoCompra = null; estado.busca = '';
        avisar(`${nome} foi excluído. Dá para restaurar em Clientes > Excluídos.`);
        await atualizarContador();
        telaCaixa();
      }) }, 'Excluir cliente…'))));
}

// ───────────────────────── MENSAGENS ─────────────────────────

const ABAS_MENSAGENS = [['fila', 'Para enviar'], ['proximas', 'Próximas'], ['historico', 'Enviadas e puladas']];

function abasMensagens() {
  const atual = estado.abaMensagens || 'fila';
  return h('div', { class: 'subabas' }, ABAS_MENSAGENS.map(([id, nome]) =>
    h('button', { class: 'subaba' + (id === atual ? ' ativa' : ''), type: 'button', onclick: () => { estado.abaMensagens = id; telaMensagens(); } }, nome)));
}

/** Conferência das mensagens: as que ainda vão entrar na fila e as que já foram enviadas ou puladas. */
async function telaMensagensConferencia(aba) {
  const todas = await dados.historicoMensagens(45);
  const hj = hoje();
  const lista = aba === 'proximas'
    ? todas.filter((m) => m.status === 'pendente' && m.devidaEm > hj && m.giftback.status === 'ativo').sort((a, b) => a.devidaEm.localeCompare(b.devidaEm))
    : todas.filter((m) => m.status !== 'pendente');
  const filtro = h('input', { type: 'search', class: 'entrada', placeholder: 'Buscar cliente', style: 'max-width:280px' });
  const soPuladas = h('input', { type: 'checkbox' });
  const corpo = h('tbody');
  const rodape = h('p', { class: 'suave pequeno', style: 'margin-top:8px' });
  const texto = (m) => M.mensagemCompleta(m.tipo, { cliente: m.cliente, giftback: m.giftback, config, hoje: hoje() });
  function linhas() {
    const v = lista.filter((m) => M.clienteCombina(m.cliente, filtro.value) && (!soPuladas.checked || m.status === 'pulada'));
    trocar(corpo, v.slice(0, 300).map((m) => {
      const vigente = m.giftback.status === 'ativo';
      const situacao = m.status === 'enviada'
        ? [h('span', { class: 'etiqueta verde' }, 'enviada'), m.enviadaEm ? ` ${new Date(m.enviadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : (m.origem === 'zoppy' ? ' pela Zoppy' : '')]
        : m.status === 'pulada' ? h('span', { class: 'etiqueta ambar' }, 'pulada') : h('span', { class: 'etiqueta azul' }, 'agendada');
      const acao = m.status === 'pulada' && vigente
        ? h('button', { class: 'botao', onclick: () => tentar(async () => { await dados.marcarMensagem(m.id, 'pendente'); avisar('Voltou para a fila.'); await atualizarContador(); telaMensagens(); }) }, 'Voltar para a fila')
        : m.status === 'enviada' && vigente
          ? h('button', { class: 'link pequeno', onclick: () => abrirWhatsApp(m.cliente, texto(m)) }, 'reenviar')
          : '';
      return h('tr', {},
        h('td', {}, M.formatarDia(m.devidaEm)),
        h('td', {}, h('b', {}, nomeCompleto(m.cliente)), h('br'), h('span', { class: 'suave pequeno' }, M.formatarTelefone(m.cliente.telefone))),
        h('td', {}, M.TIPOS_MENSAGEM[m.tipo] || m.tipo),
        h('td', {}, `${valorGift(m.giftback)} até ${dia(m.giftback.expiraEm)}`, vigente ? '' : h('span', { class: 'suave pequeno' }, ` (${m.giftback.status})`)),
        h('td', {}, situacao),
        h('td', {}, acao));
    }));
    rodape.textContent = v.length > 300 ? `Mostrando 300 de ${v.length}.` : `${v.length} mensage${v.length === 1 ? 'm' : 'ns'}.`;
  }
  filtro.addEventListener('input', linhas);
  soPuladas.addEventListener('change', linhas);
  trocar(tela,
    h('h1', { class: 'titulo-tela' }, 'Mensagens'),
    abasMensagens(),
    h('p', { class: 'suave', style: 'margin-bottom:12px' }, aba === 'proximas'
      ? 'Mensagens já agendadas que ainda vão entrar na fila, no dia marcado. Se o cliente usar o giftback antes, a mensagem é cancelada sozinha.'
      : 'Mensagens dos últimos 45 dias que já saíram da fila. Uma mensagem pulada por engano pode voltar para a fila aqui.'),
    h('div', { class: 'cartao' },
      h('div', { class: 'linha-flex', style: 'margin-bottom:10px' }, filtro,
        aba === 'historico' ? h('label', { class: 'linha-flex pequeno' }, soPuladas, 'Só as puladas') : null),
      h('div', { class: 'rolagem' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, aba === 'proximas' ? 'Entra na fila em' : 'Era para'), h('th', {}, 'Cliente'), h('th', {}, 'Mensagem'), h('th', {}, 'Giftback'), h('th', {}, 'Situação'), h('th', {}, ''))),
        corpo)),
      rodape));
  linhas();
}

async function telaMensagens() {
  if ((estado.abaMensagens || 'fila') !== 'fila') return telaMensagensConferencia(estado.abaMensagens);
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
    h('h1', { class: 'titulo-tela' }, 'Mensagens'),
    abasMensagens(),
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
    const regrasCliente = M.configParaCliente(config, v.clienteAcker);
    const pct = campoPercentual(() => recalcular(), regrasCliente);

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
            : h('div', { class: 'caixa-info cinza' }, `Valor final abaixo de ${M.formatarReais(regrasCliente.compraMinimaCentavos)}: não gera giftback.`));
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

/** Clientes excluídos: aparecem riscados, com data, quem excluiu e motivo. Restaurar ou apagar de vez (testes). */
function cartaoExcluidos() {
  const caixa = h('details', { class: 'cartao excluidos', style: 'margin-top:14px' });
  const corpo = h('div', {});
  caixa.addEventListener('toggle', () => { if (caixa.open) desenhar(); });
  async function desenhar() {
    const lista = await dados.listarExcluidos();
    trocar(corpo, lista.length ? h('div', { class: 'rolagem' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Cliente'), h('th', {}, 'Celular'), h('th', {}, 'Excluído em'), h('th', {}, 'Por'), h('th', {}, 'Motivo'), h('th', {}, ''))),
      h('tbody', {}, lista.map((c) => h('tr', { class: 'excluido' },
        h('td', {}, h('s', {}, nomeCompleto(c))),
        h('td', {}, h('s', {}, M.formatarTelefone(c.telefone))),
        h('td', {}, new Date(c.excluidoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })),
        h('td', { class: 'pequeno' }, c.excluidoPor || ''),
        h('td', {}, c.motivoExclusao || ''),
        h('td', { style: 'white-space:nowrap' },
          h('button', { class: 'botao', onclick: () => tentar(async () => { await dados.restaurarCliente(c.id); avisar(`${nomeCompleto(c)} foi restaurado.`); await atualizarContador(); telaClientes(); }) }, 'Restaurar'), ' ',
          h('button', { class: 'link pequeno perigo-link', onclick: () => tentar(async () => {
            const conf = prompt(`Apagar ${nomeCompleto(c)} DE VEZ, com compras, giftbacks e mensagens?\nIsso não tem volta. Use só para clientes de teste.\n\nPara confirmar, digite: APAGAR`);
            if (conf == null || conf.trim().toUpperCase() !== 'APAGAR') { if (conf != null) avisar('Nada foi apagado.'); return; }
            await dados.apagarClienteDeVez(c.id); avisar('Apagado de vez.'); desenhar();
          }) }, 'apagar de vez'))))))) : h('p', { class: 'suave' }, 'Nenhum cliente excluído.'));
  }
  caixa.append(h('summary', { style: 'cursor:pointer;font-weight:700' }, 'Clientes excluídos'), h('p', { class: 'suave pequeno', style: 'margin:6px 0 10px' }, 'Quem foi excluído fica guardado aqui, riscado, com data, quem excluiu e o motivo. "Restaurar" traz o cliente de volta com todo o histórico.'), corpo);
  return caixa;
}

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
      rodape),
    cartaoExcluidos());
  desenhar();
}

// ───────────────────────── CONFIGURAÇÕES ─────────────────────────

async function telaConfig() {
  config = await dados.obterConfig();
  const secoes = [['regras', 'Regras do giftback'], ['perfis', 'Perfis especiais'], ['modelos', 'Modelos de mensagem'], ['dados', dados.modo === 'online' ? 'Dados' : 'Modo teste']];
  const atual = secoes.some(([id]) => id === estado.secaoConfig) ? estado.secaoConfig : 'regras';
  const abas = h('div', { class: 'subabas' }, secoes.map(([id, nome]) =>
    h('button', { class: 'subaba' + (id === atual ? ' ativa' : ''), type: 'button', onclick: () => { estado.secaoConfig = id; telaConfig(); } }, nome)));
  const conteudo = atual === 'regras' ? configRegras() : atual === 'perfis' ? configPerfis() : atual === 'modelos' ? configModelos()
    : (dados.modo === 'online' ? cartaoDadosOnline() : cartaoModoTeste());
  trocar(tela, h('h1', { class: 'titulo-tela' }, 'Configurações'), abas, conteudo);
}

/** Perfis especiais (parcerias e família): nome, cor, % de giftback e compra mínima próprios. */
function configPerfis() {
  const perfis = (config.perfis || []).map((p) => ({ ...p }));
  const lista = h('div', {});
  function desenhar() {
    trocar(lista, perfis.map((p, i) => {
      const exemplo = h('span', { class: 'etiqueta perfil', style: `background:${p.cor}` }, p.nome || 'Perfil');
      const nome = h('input', { type: 'text', value: p.nome, oninput: (e) => { p.nome = e.target.value; exemplo.textContent = p.nome || 'Perfil'; } });
      const cor = h('input', { type: 'color', value: p.cor || '#2f6b3c', style: 'padding:2px;height:42px', oninput: (e) => { p.cor = e.target.value; exemplo.style.background = p.cor; } });
      const pctCampo = h('input', { type: 'number', min: 0, max: 100, step: 0.5, placeholder: `padrão (${config.percentual}%)`, value: p.percentual ?? '', oninput: (e) => { p.percentual = e.target.value === '' ? null : Number(e.target.value); } });
      const minimo = h('input', { type: 'text', inputMode: 'decimal', placeholder: `padrão (${M.formatarReais(config.compraMinimaCentavos)})`, value: p.compraMinimaCentavos == null ? '' : (p.compraMinimaCentavos / 100).toFixed(2).replace('.', ','),
        oninput: (e) => { p.compraMinimaCentavos = e.target.value.trim() === '' ? null : (M.lerReais(e.target.value) ?? null); } });
      comVirgulaAutomatica(minimo);
      return h('div', { class: 'cartao' },
        h('div', { class: 'linha-flex', style: 'margin-bottom:10px' }, exemplo, h('span', { class: 'espaco' }),
          h('button', { class: 'link pequeno perigo-link', type: 'button', onclick: () => { if (confirm(`Remover o perfil "${p.nome}"? Os clientes com ele voltam a ser clientes comuns.`)) { perfis.splice(i, 1); desenhar(); } } }, 'remover')),
        h('div', { class: 'grade' },
          h('label', { class: 'campo' }, h('span', {}, 'Nome do perfil'), nome),
          h('label', { class: 'campo' }, h('span', {}, 'Cor'), cor),
          h('label', { class: 'campo' }, h('span', {}, 'Giftback (%)'), pctCampo),
          h('label', { class: 'campo' }, h('span', {}, 'Compra mínima para ganhar (R$)'), minimo)));
    }));
  }
  desenhar();
  const salvar = () => tentar(async () => {
    const limpos = perfis.filter((p) => String(p.nome || '').trim()).map((p, i) => ({
      id: p.id || `perfil-${Date.now()}-${i}`, nome: p.nome.trim(), cor: p.cor || '#2f6b3c',
      percentual: p.percentual == null || p.percentual === '' ? null : Number(p.percentual),
      compraMinimaCentavos: p.compraMinimaCentavos == null ? null : Number(p.compraMinimaCentavos),
    }));
    if (limpos.some((p) => p.percentual != null && !(p.percentual > 0 && p.percentual <= 100))) throw new Error('O % de cada perfil deve ficar entre 0 e 100 (ou em branco para usar o padrão).');
    config = await dados.salvarConfig({ perfis: limpos });
    avisar('Perfis salvos.');
    telaConfig();
  });
  return h('form', { onsubmit: (e) => { e.preventDefault(); salvar(); } },
    h('div', { class: 'cartao' },
      h('p', { class: 'suave' }, 'Para parcerias (nutricionistas, médicos, influenciadores) e família. O cliente continua na mesma lista, só ganha uma etiqueta colorida e pode ter regras próprias. Você escolhe o perfil no cadastro do cliente (Editar > Perfil).'),
      h('p', { class: 'suave pequeno', style: 'margin-top:6px' }, 'Deixe o % ou a compra mínima em branco para usar a regra geral. Compra mínima 0 = ganha giftback em qualquer valor. Os clientes comuns não mudam em nada.')),
    lista,
    h('button', { class: 'botao', type: 'button', style: 'margin-top:12px', onclick: () => { perfis.push({ id: '', nome: 'Novo perfil', cor: '#5b6b7a', percentual: null, compraMinimaCentavos: null }); desenhar(); } }, '+ Novo perfil'),
    h('div', { class: 'barra-salvar' }, h('button', { class: 'botao principal grande', type: 'submit' }, 'Salvar perfis')));
}

function configRegras() {
  const num = (valor, extra = {}) => h('input', { type: 'number', value: valor, min: 0, step: 'any', ...extra });
  const f = {
    percentual: num(config.percentual, { max: 100 }),
    minimo: comVirgulaAutomatica(h('input', { type: 'text', value: (config.compraMinimaCentavos / 100).toFixed(2).replace('.', ',') })),
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
    const novas = {
      percentual: pct, compraMinimaCentavos: minimo, validadeDias: Math.round(Number(f.validade.value)),
      multiploUsoMinimo: Number(f.multiplo.value) || 1, diasLembrete: Math.round(Number(f.lembrete.value) || 0),
      diasAntesAvisoFinal: Math.round(Number(f.avisoFinal.value) || 0), nomeLoja: f.loja.value.trim() || M.CONFIG_PADRAO.nomeLoja,
    };
    // Toda mudança das regras entra no histórico (quando, quem e como ficou)
    const hist = M.registrarMudancaRegras(config, novas, { em: new Date().toISOString(), por: usuarioEmail || (dados.modo === 'teste' ? 'modo teste' : null) });
    config = await dados.salvarConfig(hist ? { ...novas, historicoRegras: hist } : novas);
    avisar(hist ? 'Regras salvas e mudança registrada no histórico. Valem para as próximas compras.' : 'Regras salvas (nada mudou nas regras).');
    telaConfig();
  });

  // Histórico das regras: da mais nova para a mais antiga; a de cima é a que vale hoje
  const hist = M.historicoRegras(config);
  const emVigor = M.regrasDe(config);
  const ultimaIgual = M.CAMPOS_REGRAS.every((k) => Number(hist[hist.length - 1].regras[k]) === Number(emVigor[k]));
  const linhasHist = (ultimaIgual ? hist : [...hist, { em: null, titulo: 'Em vigor hoje (alterada antes de o histórico existir)', por: null, regras: emVigor }]).slice().reverse();
  const celula = (r, ant, k, texto) => h('td', { class: 'num' }, ant && Number(ant[k]) !== Number(r[k]) ? h('b', { class: 'txt-azul', title: 'Mudou nesta alteração' }, texto) : texto);
  const tabelaHist = h('div', { class: 'cartao' },
    h('h3', { style: 'margin-bottom:4px' }, 'Histórico das regras'),
    h('p', { class: 'suave pequeno', style: 'margin-bottom:8px' }, 'Cada vez que as regras são salvas com alguma mudança, fica registrado aqui. Começa pelo padrão que era usado na Zoppy. Em azul, o que mudou. Este histórico vai junto na cópia de segurança.'),
    h('div', { class: 'rolagem' }, h('table', { class: 'hist-regras' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Quando'), h('th', { class: 'num' }, 'Giftback'), h('th', { class: 'num' }, 'Mín. para ganhar'), h('th', { class: 'num' }, 'Validade'), h('th', { class: 'num' }, 'Para usar'), h('th', { class: 'num' }, 'Lembrete'), h('th', { class: 'num' }, 'Aviso final'), h('th', {}, 'Quem'))),
      h('tbody', {}, linhasHist.map((x, i) => {
        const r = x.regras, ant = linhasHist[i + 1]?.regras;
        const quando = x.titulo || (x.em ? `${dia(x.em)} às ${new Date(x.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '');
        return h('tr', { class: i === 0 ? 'atual' : '' },
          h('td', {}, quando, i === 0 ? h('span', { class: 'etiqueta verde', style: 'margin-left:6px' }, 'vale hoje') : null),
          celula(r, ant, 'percentual', `${r.percentual}%`),
          celula(r, ant, 'compraMinimaCentavos', M.formatarReais(r.compraMinimaCentavos)),
          celula(r, ant, 'validadeDias', `${r.validadeDias} dias`),
          celula(r, ant, 'multiploUsoMinimo', `${r.multiploUsoMinimo}× o giftback`),
          celula(r, ant, 'diasLembrete', `dia ${r.diasLembrete}`),
          celula(r, ant, 'diasAntesAvisoFinal', `${r.diasAntesAvisoFinal} dias antes`),
          h('td', { class: 'suave pequeno' }, x.por || ''));
      })))));

  return h('div', {}, h('form', { class: 'cartao', onsubmit: (e) => { e.preventDefault(); salvar(); } },
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
    h('div', { class: 'linha-flex', style: 'margin-top:14px' }, h('button', { class: 'botao principal grande', type: 'submit' }, 'Salvar regras'))),
  tabelaHist);
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

function baixarArquivo(conteudo, nome) {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(conteudo)], { type: 'application/json' })), download: nome });
  document.body.append(a); a.click(); a.remove();
}

function cartaoDadosOnline() {
  // Há quantos dias a última cópia foi baixada neste computador
  let baixadaEm = null;
  try { baixadaEm = localStorage.getItem('gb_ultima_copia_baixada'); } catch { /* sem armazenamento local */ }
  const diasSemBaixar = baixadaEm ? M.diasEntre(baixadaEm, hoje()) : null;
  const ultimaBaixada = h('p', { class: 'pequeno ' + (diasSemBaixar == null || diasSemBaixar > 7 ? 'txt-vermelho' : 'suave'), style: 'margin-top:8px' },
    diasSemBaixar == null ? 'Neste computador ainda não foi baixada nenhuma cópia.'
      : diasSemBaixar === 0 ? 'Última cópia baixada neste computador: hoje.'
        : `Última cópia baixada neste computador: ${M.formatarDia(baixadaEm)} (há ${diasSemBaixar} dia${diasSemBaixar > 1 ? 's' : ''}).${diasSemBaixar > 7 ? ' Já passou de uma semana: baixe uma nova e guarde no Google Drive.' : ''}`);

  // Cópias automáticas guardadas no banco
  const copias = h('div', {}, h('p', { class: 'suave pequeno' }, 'Carregando…'));
  (async () => {
    try {
      await dados.copiaDiaria().catch(() => {});
      const lista = await dados.listarCopias();
      trocar(copias, lista.length ? h('div', { class: 'rolagem' }, h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Dia'), h('th', { class: 'num' }, 'Clientes'), h('th', { class: 'num' }, 'Compras'), h('th', { class: 'num' }, 'Giftbacks'), h('th', { class: 'num' }, 'Mensagens'), h('th', {}, ''))),
        h('tbody', {}, lista.map((c) => h('tr', {},
          h('td', {}, M.formatarDia(c.dia)),
          h('td', { class: 'num' }, c.resumo.clientes ?? ''), h('td', { class: 'num' }, c.resumo.compras ?? ''),
          h('td', { class: 'num' }, c.resumo.giftbacks ?? ''), h('td', { class: 'num' }, c.resumo.mensagens ?? ''),
          h('td', {}, h('button', { class: 'link', type: 'button', onclick: () => tentar(async () => { baixarArquivo(await dados.baixarCopia(c.dia), `giftback-acker-copia-${c.dia}.json`); avisar('Cópia baixada.'); }) }, 'baixar')))))))
        : h('p', { class: 'suave pequeno' }, 'Nenhuma cópia automática ainda. A primeira é feita hoje.'));
    } catch {
      trocar(copias, h('p', { class: 'suave pequeno' }, 'As cópias automáticas ainda não foram ativadas no banco.'));
    }
  })();

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
  return h('div', { class: 'cartao' },
    h('h3', {}, 'Cópia de segurança'),
    h('p', { class: 'suave', style: 'margin:6px 0 12px' }, 'O botão abaixo baixa um arquivo com todos os clientes, compras, giftbacks, mensagens, campanhas, configurações e o histórico das regras. Guarde no Google Drive de vez em quando (sugestão: toda semana). É a cópia que fica fora do banco, para recuperar tudo mesmo se o banco inteiro tiver problema.'),
    h('button', { class: 'botao', onclick: () => tentar(async () => {
      baixarArquivo(await dados.exportarTudo(), `giftback-acker-copia-${hoje()}.json`);
      try { localStorage.setItem('gb_ultima_copia_baixada', hoje()); } catch { /* sem armazenamento local */ }
      avisar('Cópia de segurança baixada.');
      telaConfig();
    }) }, 'Baixar cópia de segurança agora'),
    ultimaBaixada,
    h('h3', { style: 'margin-top:18px' }, 'Cópias automáticas'),
    h('p', { class: 'suave', style: 'margin:6px 0 10px' }, 'O sistema guarda sozinho uma cópia por dia (na primeira vez que alguém abre o Giftback Acker no dia) e mantém as dos últimos 14 dias. Servem para voltar atrás se algo for apagado ou alterado por engano.'),
    copias,
    h('hr', { style: 'border:0;border-top:1px solid var(--linha);margin:18px 0' }),
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
  mostrarMenus(false);
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
  mostrarMenus(false);
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
  usuarioEmail = s?.user?.email || '';
  const usuario = document.getElementById('usuario');
  trocar(usuario, h('span', { class: 'pequeno' }, s?.user?.email || ''), ' ',
    h('button', { class: 'link pequeno', style: 'color:#fff', onclick: () => tentar(async () => { await dados.sair(); location.reload(); }) }, 'Sair'));
  usuario.hidden = false;
  document.getElementById('mais-usuario').textContent = s?.user?.email || '';
  const sair = document.getElementById('mais-sair');
  sair.hidden = false;
  sair.onclick = () => tentar(async () => { await dados.sair(); location.reload(); });
  mostrarMenus(true);
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
  const atual = TELAS[aba] ? aba : 'caixa';
  document.querySelectorAll('#abas a').forEach((a) => a.classList.toggle('ativa', a.dataset.aba === atual));
  document.querySelectorAll('#barra-baixo [data-aba]').forEach((a) => a.classList.toggle('ativa', a.dataset.aba === atual));
  const mais = document.getElementById('baixo-mais');
  mais.classList.toggle('ativa', mais.dataset.grupo.split(' ').includes(atual));
  document.getElementById('folha-mais').hidden = true;
  trocar(tela);
  window.scrollTo(0, 0);
  tentar(() => desenhar());
  if (dados) atualizarContador().catch(() => {});
}

// Barra de ícones (janela estreita e celular)
function mostrarMenus(sim) {
  document.getElementById('abas').hidden = !sim;
  document.getElementById('barra-baixo').classList.toggle('escondida', !sim);
}
document.getElementById('baixo-buscar').addEventListener('click', (e) => {
  estado.clienteId = null; estado.busca = ''; estado.resultadoCompra = null;
  if ((location.hash || '#caixa') === '#caixa') { e.preventDefault(); navegar(); }
});
document.getElementById('baixo-novo').addEventListener('click', (e) => {
  estado.clienteId = null; estado.busca = ''; estado.novoPrefill = {};
  if ((location.hash || '#caixa') === '#caixa') { e.preventDefault(); navegar(); }
});
document.getElementById('baixo-mais').addEventListener('click', () => { const f = document.getElementById('folha-mais'); f.hidden = !f.hidden; });
document.getElementById('folha-mais').addEventListener('click', (e) => { if (e.target.id === 'folha-mais' || e.target.closest('a')) document.getElementById('folha-mais').hidden = true; });

let sistemaAberto = false;

async function abrirSistema() {
  await dados.iniciar();
  config = await dados.obterConfig();
  document.getElementById('modo').hidden = dados.modo !== 'teste';
  if (dados.modo === 'teste') document.getElementById('mais-usuario').textContent = 'MODO TESTE (dados só neste navegador)';
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
  // Cópia de segurança automática do dia (o banco faz 1 por dia; se falhar, não atrapalha o uso)
  dados.copiaDiaria?.().catch(() => {});
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
