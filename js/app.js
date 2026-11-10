// app.js — Telas do Giftback Acker (Caixa, Mensagens, Clientes, Configurações) e login.
// As regras ficam em motor.js; os dados, em dados-supabase.js (online) ou dados-local.js (modo teste).
import * as M from './motor.js';
import { criarDadosLocal } from './dados-local.js';
import { criarDadosSupabase } from './dados-supabase.js';
import { SUPABASE_URL, SUPABASE_CHAVE_PUBLICA } from './config-online.js';

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

  function abrirCliente(id) {
    estado.clienteId = id; estado.resultadoCompra = null;
    trocar(resultados);
    painelCliente(painel, () => { campo.value = ''; estado.busca = ''; estado.clienteId = null; trocar(painel); campo.focus(); });
  }

  function abrirNovo(prefill = {}) {
    estado.clienteId = null;
    trocar(resultados);
    painelNovoCliente(painel, prefill, (c) => abrirCliente(c.id), () => { trocar(painel); campo.focus(); });
  }

  trocar(tela,
    h('div', { class: 'busca' }, campo, h('button', { class: 'botao', onclick: () => abrirNovo() }, '+ Cliente novo')),
    resultados, painel);

  if (estado.clienteId) painelCliente(painel, () => { campo.value = ''; estado.busca = ''; estado.clienteId = null; trocar(painel); campo.focus(); });
  else if (estado.busca) buscar().then(() => { if (estado.abrirUnico && lista.length === 1) abrirCliente(lista[0].id); estado.abrirUnico = false; });
  if (estado.novoPrefill) { const p = estado.novoPrefill; estado.novoPrefill = null; abrirNovo(p); }
  else if (!estado.clienteId) campo.focus();
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

  // Cabeçalho
  const cabecalho = h('div', { class: 'cliente-topo' },
    h('div', {},
      h('h2', { class: 'cliente-nome' }, nomeCompleto(c)),
      h('div', { class: 'cliente-dados' }, M.formatarTelefone(c.telefone),
        c.compras ? ` · ${c.compras} compra${c.compras > 1 ? 's' : ''} · ${M.formatarReais(c.totalCentavos)} no total · última em ${dia(c.ultimaCompra)}` : ' · primeira compra')),
    h('span', { class: 'espaco' }),
    h('button', { class: 'botao', onclick: () => editarCliente(painel, c, redesenhar) }, 'Editar'),
    h('button', { class: 'botao', onclick: aoFechar }, 'Fechar'));

  // Giftback
  let cartaoGift;
  if (g) {
    const faltam = M.diasEntre(hoje(), M.diaSP(g.expiraEm));
    cartaoGift = h('div', { class: 'gift' + (faltam <= 3 ? ' alerta' : '') },
      h('div', { class: 'gift-rotulo' }, g.tipo === 'resgate' ? 'Cupom de resgate ativo' : 'Giftback ativo'),
      h('div', { class: 'gift-valor' }, valorGift(g)),
      h('div', { class: 'gift-detalhes' },
        h('span', {}, 'Código ', h('span', { class: 'codigo' }, g.codigo)),
        h('span', {}, 'Vale até ', h('b', {}, dia(g.expiraEm)), ` (${textoPrazo(g)})`),
        g.minimoCentavos ? h('span', {}, 'Compra mínima ', h('b', {}, M.formatarReais(g.minimoCentavos))) : null));
  } else {
    cartaoGift = h('div', { class: 'gift sem' }, 'Sem giftback ativo no momento.');
  }

  // Resultado da compra recém-lançada ou formulário
  const area = h('div', { class: 'lancar' });
  if (estado.resultadoCompra) desenharSucesso(area, estado.resultadoCompra, c, aoFechar, redesenhar);
  else desenharFormulario(area, c, g, redesenhar);

  // Histórico
  const ultimaOk = c.historicoCompras.find((p) => p.status === 'ok');
  const historico = c.historicoCompras.length ? h('div', { class: 'cartao' },
    h('h3', { style: 'margin-bottom:8px' }, 'Últimas compras'),
    h('div', { class: 'rolagem' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Data'), h('th', { class: 'num' }, 'Valor'), h('th', { class: 'num' }, 'Giftback usado'), h('th', { class: 'num' }, 'Pagou'), h('th', {}, ''))),
      h('tbody', {}, c.historicoCompras.slice(0, 8).map((p) => h('tr', { class: p.status === 'ok' ? '' : 'cancelada' },
        h('td', {}, dia(p.data)),
        h('td', { class: 'num' }, M.formatarReais(p.valorCentavos)),
        h('td', { class: 'num' }, p.descontoCentavos ? '− ' + M.formatarReais(p.descontoCentavos) : '—'),
        h('td', { class: 'num' }, M.formatarReais(p.valorFinalCentavos)),
        h('td', {}, p.status !== 'ok' ? 'cancelada'
          : (p.id === ultimaOk?.id && p.origem === 'acker'
            ? h('button', { class: 'link', onclick: () => desfazerCompra(p, redesenhar) }, 'desfazer') : ''))))))))
    : null;

  trocar(painel, h('div', { class: 'cartao' }, cabecalho, cartaoGift, area), historico);
}

function desenharFormulario(area, cliente, g, redesenhar) {
  const fValor = h('input', { type: 'text', inputMode: 'decimal', placeholder: '0,00', autocomplete: 'off', 'aria-label': 'Valor da compra' });
  const previa = h('div', { class: 'previa' });
  const confirmar = h('button', { class: 'botao principal grande', disabled: true }, 'Confirmar compra');
  let usar = null; // null = ainda não decidiu (segue o padrão: usar sempre que puder)

  function atualizar() {
    const valor = M.lerReais(fValor.value);
    trocar(previa);
    confirmar.disabled = true;
    if (!valor || valor <= 0) return;
    const uso = M.podeUsarGiftback(g, valor, new Date());
    const vaiUsar = uso.ok && (usar ?? true);
    const r = M.calcularCompra({ valorCentavos: valor, giftbackAtivo: g, usarGiftback: vaiUsar, config, agora: new Date() });

    if (g && uso.ok) {
      const marca = h('input', { type: 'checkbox', checked: vaiUsar, onchange: (e) => { usar = e.target.checked; atualizar(); } });
      previa.append(h('label', { class: 'usar' }, marca, `Usar o ${g.tipo === 'resgate' ? 'cupom' : 'giftback'} de ${valorGift(g)} nesta compra`));
    } else if (g && uso.motivo === 'abaixo_minimo') {
      previa.append(h('div', { class: 'caixa-info ambar' }, `Ainda não dá para usar o giftback: faltam ${M.formatarReais(uso.faltamCentavos)} para a compra mínima de ${M.formatarReais(g.minimoCentavos)}.`));
    }

    if (vaiUsar) {
      previa.append(h('div', { class: 'conta' },
        h('span', {}, 'Compra'), h('span', { class: 'direita' }, M.formatarReais(valor)),
        h('span', {}, 'Desconto no PDV'), h('span', { class: 'direita' }, '− ' + M.formatarReais(r.descontoCentavos)),
        h('span', { class: 'total' }, 'Cliente paga'), h('span', { class: 'total direita' }, M.formatarReais(r.valorFinalCentavos))));
    }
    if (r.novoGiftback) {
      previa.append(h('div', { class: 'caixa-info verde' }, 'Vai ganhar ', h('b', {}, M.formatarReais(r.novoGiftback.valorCentavos)),
        ` de giftback, válido até ${dia(r.novoGiftback.expiraEm)}.`));
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
      estado.resultadoCompra = await dados.lancarCompra({ clienteId: cliente.id, valorCentavos: valor, usarGiftback: vaiUsar });
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
    const texto = M.montarMensagem(config.modelos.envio, { cliente, giftback: r.novoGiftback, config });
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
      h('button', { class: 'botao', type: 'button', onclick: depois }, 'Cancelar'))));
}

// ───────────────────────── MENSAGENS ─────────────────────────

async function telaMensagens() {
  const [fila, proximas, enviadas] = await Promise.all([dados.filaMensagens(), dados.proximasMensagens(7), dados.enviadasHoje()]);
  const etiquetas = { envio: 'verde', lembrete: 'azul', vencendo: 'ambar' };
  const atrasadas = fila.filter((m) => m.atrasada).length;
  const textoAgora = (m) => M.montarMensagem(config.modelos[m.tipo], { cliente: m.cliente, giftback: m.giftback, config, hoje: hoje() });

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
  const num = (valor, extra = {}) => h('input', { type: 'number', value: valor, min: 0, step: 'any', ...extra });
  const f = {
    percentual: num(config.percentual, { max: 100 }),
    minimo: h('input', { type: 'text', inputMode: 'decimal', value: (config.compraMinimaCentavos / 100).toFixed(2).replace('.', ',') }),
    validade: num(config.validadeDias, { step: 1, min: 1 }),
    multiplo: num(config.multiploUsoMinimo, { min: 1 }),
    lembrete: num(config.diasLembrete, { step: 1 }),
    avisoFinal: num(config.diasAntesAvisoFinal, { step: 1 }),
    loja: h('input', { type: 'text', value: config.nomeLoja }),
    envio: h('textarea', { value: config.modelos.envio }),
    lembreteTxt: h('textarea', { value: config.modelos.lembrete }),
    vencendo: h('textarea', { value: config.modelos.vencendo }),
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
      modelos: { envio: f.envio.value, lembrete: f.lembreteTxt.value, vencendo: f.vencendo.value },
    });
    avisar('Configurações salvas. Valem para as próximas compras.');
  });

  const variaveis = () => h('div', { class: 'variaveis' }, ['{primeiro_nome}', '{valor}', '{validade}', '{codigo}', '{minimo}', '{loja}'].map((v) => h('code', {}, v)));

  trocar(tela,
    h('h1', { class: 'titulo-tela' }, 'Configurações'),
    h('form', { onsubmit: (e) => { e.preventDefault(); salvar(); } },
      h('div', { class: 'cartao' },
        h('h3', { style: 'margin-bottom:12px' }, 'Regras do giftback'),
        h('div', { class: 'grade' },
          h('label', { class: 'campo' }, h('span', {}, 'Giftback (% da compra)'), f.percentual),
          h('label', { class: 'campo' }, h('span', {}, 'Compra mínima para ganhar (R$)'), f.minimo),
          h('label', { class: 'campo' }, h('span', {}, 'Validade (dias)'), f.validade),
          h('label', { class: 'campo' }, h('span', {}, 'Para usar: compra de quantas vezes o giftback'), f.multiplo),
          h('label', { class: 'campo' }, h('span', {}, 'Lembrete após quantos dias'), f.lembrete),
          h('label', { class: 'campo' }, h('span', {}, 'Aviso final: quantos dias antes de vencer'), f.avisoFinal),
          h('label', { class: 'campo' }, h('span', {}, 'Nome da loja nas mensagens'), f.loja)),
        exemplo,
        h('p', { class: 'suave pequeno', style: 'margin-top:8px' }, 'Mudanças valem para os giftbacks novos. Os que já foram gerados continuam com o valor e a validade combinados com o cliente.')),
      h('div', { class: 'cartao' },
        h('h3', {}, 'Textos das mensagens de WhatsApp'),
        h('p', { class: 'suave pequeno', style: 'margin-top:4px' }, 'As palavras entre chaves são trocadas sozinhas pelos dados do cliente. Asteriscos deixam o texto em *negrito* no WhatsApp.'),
        variaveis(),
        h('div', { class: 'grade', style: 'grid-template-columns:repeat(auto-fit,minmax(260px,1fr))' },
          h('label', { class: 'campo' }, h('span', {}, '1. Giftback novo (na hora da compra)'), f.envio),
          h('label', { class: 'campo' }, h('span', {}, '2. Lembrete'), f.lembreteTxt),
          h('label', { class: 'campo' }, h('span', {}, '3. Vence em breve'), f.vencendo))),
      h('div', { class: 'linha-flex', style: 'margin-top:14px' }, h('button', { class: 'botao principal grande', type: 'submit' }, 'Salvar configurações'))),
    dados.modo === 'online' ? cartaoDadosOnline() : null,
    dados.modo === 'teste' ? h('div', { class: 'cartao', style: 'margin-top:22px' },
      h('h3', {}, 'Modo teste'),
      h('p', { class: 'suave', style: 'margin:6px 0 12px' }, 'Você está usando uma cópia dos dados da Zoppy guardada só neste navegador. Pode lançar compras e cadastrar clientes à vontade: nada vai para a Zoppy nem para os clientes (a mensagem só sai se você apertar Enter no WhatsApp).'),
      h('button', { class: 'botao perigo', onclick: () => { if (confirm('Apagar tudo que foi feito no teste e voltar aos dados da Zoppy?')) tentar(async () => { await dados.restaurarDadosZoppy(); config = await dados.obterConfig(); estado.clienteId = null; estado.resultadoCompra = null; avisar('Dados restaurados.'); await atualizarContador(); telaConfig(); }); } }, 'Apagar testes e recarregar dados da Zoppy')) : null);
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

const TELAS = { caixa: telaCaixa, mensagens: telaMensagens, clientes: telaClientes, config: telaConfig };

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

async function iniciar() {
  if (MODO_TESTE) {
    dados = criarDadosLocal({
      carregarSeed: async () => {
        try {
          const r = await fetch('../dados_migrados/seed.json', { cache: 'no-store' });
          return r.ok ? await r.json() : null;
        } catch { return null; }
      },
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
