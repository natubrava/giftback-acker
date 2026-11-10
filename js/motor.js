// motor.js — Regras de negócio do Giftback Acker.
// Funções puras: não acessam banco, tela nem relógio (a data "agora" é sempre passada).
// Todos os valores em CENTAVOS inteiros, para nunca errar centavo.
// Fonte das regras: docs/01-contexto-e-decisoes.md

export const CONFIG_PADRAO = Object.freeze({
  percentual: 7, // % do valor final da compra que vira giftback
  compraMinimaCentavos: 5000, // valor final mínimo para GANHAR giftback (R$ 50,00)
  validadeDias: 45, // dias de validade do giftback
  multiploUsoMinimo: 5, // para USAR, a compra precisa ser >= 5x o giftback
  diasLembrete: 31, // dias após ganhar para o lembrete
  diasAntesAvisoFinal: 3, // aviso "vence em 3 dias"
  prefixoCodigo: 'natubrava',
  nomeLoja: 'NatuBrava Produtos Naturais',
  whatsappLoja: '4733483186',
  modelos: Object.freeze({
    envio:
      'Obrigado pela sua compra, {primeiro_nome}! 🙌\n\n' +
      'Você ganhou *{valor}* de cashback para usar na próxima visita.\n' +
      'Válido até {validade}, informando o código *{codigo}* diretamente no caixa (compra mínima de {minimo}).\n\n' +
      'Até breve! 🌿',
    lembrete:
      'Oi {primeiro_nome}! 👋\n\n' +
      'Passando pra lembrar que você tem *{valor}* de cashback esperando aqui na {loja}.\n\n' +
      'Use até {validade}, informando o código *{codigo}* diretamente no caixa.\n' +
      '(Válido para compras acima de {minimo}).\n\n' +
      'Te esperamos! 🌱',
    vencendo:
      'Ei {primeiro_nome}, tudo bem?\n\n' +
      'Você ainda tem *{valor}* de cashback aqui na {loja}, mas ele vence *{prazo}* ({validade})! 😱\n\n' +
      'Para resgatar, basta informar o código *{codigo}* no caixa na sua próxima compra (compra mínima de {minimo}).\n\n' +
      'Corre aproveitar! 🌿💚',
  }),
});

export const TIPOS_MENSAGEM = Object.freeze({
  envio: 'Giftback novo',
  lembrete: 'Lembrete',
  vencendo: 'Vence em breve',
});

// ───────────────────────── Datas (fuso de Brasília, UTC-3 fixo) ─────────────────────────

const FUSO_MS = 3 * 60 * 60 * 1000;

/** Dia do calendário em Brasília ('AAAA-MM-DD') de um instante. */
export function diaSP(instante) {
  const d = new Date(instante);
  if (Number.isNaN(d.getTime())) throw new Error('Data inválida: ' + instante);
  return new Date(d.getTime() - FUSO_MS).toISOString().slice(0, 10);
}

/** Soma dias a um dia 'AAAA-MM-DD'. */
export function somarDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Diferença em dias entre dois dias 'AAAA-MM-DD' (b - a). */
export function diasEntre(a, b) {
  const t = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Último instante do dia em Brasília. */
export function fimDoDiaSP(dia) {
  return `${dia}T23:59:59-03:00`;
}

/** 'AAAA-MM-DD' -> 'DD/MM/AAAA'. */
export function formatarDia(dia) {
  const [a, m, d] = dia.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

// ───────────────────────── Dinheiro ─────────────────────────

/** 445 -> 'R$ 4,45' */
export function formatarReais(centavos) {
  const neg = centavos < 0;
  const v = Math.abs(Math.round(centavos));
  const inteiro = String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}R$ ${inteiro},${String(v % 100).padStart(2, '0')}`;
}

/** Texto digitado ('63,54', '1.234,5', '63.54', 'R$ 50') -> centavos. null se inválido. */
export function lerReais(texto) {
  if (typeof texto === 'number') return Number.isFinite(texto) ? Math.round(texto * 100) : null;
  let s = String(texto ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100 + 1e-7);
}

function porcentagem(centavos, pct) {
  return Math.round((centavos * pct) / 100 + 1e-9);
}

// ───────────────────────── Telefone e texto ─────────────────────────

/** Deixa só DDD+número (10 ou 11 dígitos). null se não for um telefone brasileiro válido. */
export function normalizarTelefone(texto) {
  let d = String(texto ?? '').replace(/\D/g, '');
  d = d.replace(/^0+/, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  d = d.replace(/^0+/, '');
  return d.length === 10 || d.length === 11 ? d : null;
}

/** '47999998888' -> '(47) 99999-8888' */
export function formatarTelefone(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(tel ?? '');
}

/** Minúsculas e sem acento, para busca. */
export function semAcento(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** 'maria DA silva' -> 'Maria' */
export function primeiroNome(nome) {
  const p = String(nome ?? '').trim().split(/\s+/)[0] || '';
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '';
}

/**
 * O cliente bate com a busca? Aceita nome (qualquer ordem, sem acento),
 * telefone (trecho de 3+ dígitos) ou CPF.
 */
export function clienteCombina(cliente, busca) {
  const q = semAcento(busca);
  if (!q) return true;
  const digitos = q.replace(/\D/g, '');
  const soNumero = /^[\d\s().+-]+$/.test(q);
  if (soNumero) {
    if (digitos.length < 3) return false;
    const alvo = digitos.length >= 12 && digitos.startsWith('55') ? digitos.slice(2) : digitos;
    return String(cliente.telefone ?? '').includes(alvo) || String(cliente.cpf ?? '').replace(/\D/g, '').includes(alvo);
  }
  const nome = semAcento(`${cliente.nome ?? ''} ${cliente.sobrenome ?? ''}`);
  return q.split(/\s+/).every((parte) => nome.includes(parte));
}

// ───────────────────────── Giftback ─────────────────────────

/**
 * O giftback pode ser usado nesta compra?
 * motivo: 'sem_giftback' | 'inativo' | 'expirado' | 'abaixo_minimo' | null
 */
export function podeUsarGiftback(giftback, valorCentavos, agora) {
  if (!giftback) return { ok: false, motivo: 'sem_giftback' };
  if (giftback.status !== 'ativo') return { ok: false, motivo: 'inativo' };
  if (new Date(agora).getTime() > new Date(giftback.expiraEm).getTime()) return { ok: false, motivo: 'expirado' };
  if (valorCentavos < giftback.minimoCentavos) {
    return { ok: false, motivo: 'abaixo_minimo', faltamCentavos: giftback.minimoCentavos - valorCentavos };
  }
  return { ok: true, motivo: null };
}

/** O giftback ainda vale hoje? (ativo e dentro do prazo) */
export function giftbackVigente(giftback, agora) {
  return !!giftback && giftback.status === 'ativo' && new Date(agora).getTime() <= new Date(giftback.expiraEm).getTime();
}

/**
 * Calcula o resultado de uma compra. NÃO grava nada.
 *
 * @param valorCentavos  valor dos produtos NÃO promocionais, antes do desconto do giftback
 * @param giftbackAtivo  giftback atual do cliente (ou null)
 * @param usarGiftback   o caixa marcou para usar o giftback?
 * @returns {
 *   descontoCentavos, valorFinalCentavos,
 *   novoGiftback: {valorCentavos, minimoCentavos, expiraEm} | null,
 *   giftbackAnterior: null | 'usado' | 'substituido' | 'mantido',
 *   novoDescartado: giftback que a compra geraria, mas não gerou porque o atual é maior | null,
 *   uso: resultado de podeUsarGiftback
 * }
 */
export function calcularCompra({ valorCentavos, giftbackAtivo = null, usarGiftback = false, config = CONFIG_PADRAO, agora }) {
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new Error('Valor da compra inválido.');
  if (agora == null) throw new Error('Informe a data/hora da compra.');
  const vigente = giftbackVigente(giftbackAtivo, agora) ? giftbackAtivo : null;
  const uso = podeUsarGiftback(vigente, valorCentavos, agora);
  if (usarGiftback && !uso.ok) throw new Error('Este giftback não pode ser usado nesta compra (' + uso.motivo + ').');

  // Giftback é valor fixo. Cupom de resgate (recompra 90/180 dias) é percentual sobre a compra.
  const descontoCentavos = !usarGiftback ? 0
    : vigente.percentual ? porcentagem(valorCentavos, vigente.percentual)
    : Math.min(vigente.valorCentavos, valorCentavos);
  const valorFinalCentavos = valorCentavos - descontoCentavos;

  let novoGiftback = null;
  if (valorFinalCentavos >= config.compraMinimaCentavos) {
    const valor = porcentagem(valorFinalCentavos, config.percentual);
    if (valor > 0) {
      novoGiftback = {
        valorCentavos: valor,
        minimoCentavos: valor * config.multiploUsoMinimo,
        expiraEm: fimDoDiaSP(somarDias(diaSP(agora), config.validadeDias)),
      };
    }
  }

  // Giftback não acumula. Se o cliente tem um giftback que NÃO foi usado nesta compra,
  // fica o de MAIOR valor (decisão do Jacson, 2026-11-10): nem o cliente perde um giftback
  // maior, nem a loja passa a dever a soma dos dois. Empate: fica o novo (validade renovada).
  // Cupom de resgate (%) não usado é sempre trocado pelo giftback novo.
  let giftbackAnterior = null;
  let novoDescartado = null;
  if (vigente) {
    if (usarGiftback) giftbackAnterior = 'usado';
    else if (!novoGiftback) giftbackAnterior = 'mantido';
    else if (!vigente.percentual && novoGiftback.valorCentavos < vigente.valorCentavos) {
      giftbackAnterior = 'mantido';
      novoDescartado = novoGiftback;
      novoGiftback = null;
    } else giftbackAnterior = 'substituido';
  }
  return { descontoCentavos, valorFinalCentavos, novoGiftback, giftbackAnterior, novoDescartado, uso };
}

const ALFABETO_CODIGO = 'abcdefghjkmnpqrstuvwxyz23456789'; // sem 0,o,1,l,i (confundem ao ditar)

/** Gera um código novo, ex.: 'natubrava7k2pm'. `existe(codigo)` evita repetição. */
export function gerarCodigo(prefixo = CONFIG_PADRAO.prefixoCodigo, existe = () => false, aleatorio = Math.random) {
  for (let tentativa = 0; tentativa < 1000; tentativa++) {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALFABETO_CODIGO[Math.floor(aleatorio() * ALFABETO_CODIGO.length)];
    const codigo = prefixo + s;
    if (!existe(codigo)) return codigo;
  }
  throw new Error('Não foi possível gerar um código único.');
}

// ───────────────────────── Mensagens ─────────────────────────

/**
 * Datas das mensagens de um giftback: envio (no dia), lembrete e aviso final.
 * @returns [{tipo, devidaEm: 'AAAA-MM-DD'}]
 */
export function planejarMensagens(giftback, config = CONFIG_PADRAO) {
  const criado = diaSP(giftback.criadoEm);
  const expira = diaSP(giftback.expiraEm);
  const plano = [{ tipo: 'envio', devidaEm: criado }];
  const avisoFinal = somarDias(expira, -config.diasAntesAvisoFinal);
  const lembrete = somarDias(criado, config.diasLembrete);
  const temAvisoFinal = config.diasAntesAvisoFinal > 0 && avisoFinal > criado;
  if (config.diasLembrete > 0 && lembrete < (temAvisoFinal ? avisoFinal : expira)) plano.push({ tipo: 'lembrete', devidaEm: lembrete });
  if (temAvisoFinal) plano.push({ tipo: 'vencendo', devidaEm: avisoFinal });
  return plano;
}

/**
 * Prazo do giftback em palavras, calculado no DIA DO ENVIO (nunca no dia em que a mensagem foi agendada):
 * 'hoje' | 'amanhã' | 'em 2 dias'. Se já venceu: 'já venceu'.
 */
export function prazoEmPalavras(expiraEm, hoje) {
  const faltam = diasEntre(hoje, diaSP(expiraEm));
  if (faltam < 0) return 'já venceu';
  if (faltam === 0) return 'hoje';
  if (faltam === 1) return 'amanhã';
  return `em ${faltam} dias`;
}

/** Monta o texto final trocando as {variáveis}. `hoje` = dia do envio ('AAAA-MM-DD'). */
export function montarMensagem(modelo, { cliente, giftback, config = CONFIG_PADRAO, hoje = diaSP(new Date()) }) {
  const faltam = giftback ? diasEntre(hoje, diaSP(giftback.expiraEm)) : null;
  const valores = {
    prazo: giftback ? prazoEmPalavras(giftback.expiraEm, hoje) : '',
    dias_restantes: faltam == null ? '' : String(Math.max(0, faltam)),
    primeiro_nome: primeiroNome(cliente?.nome),
    nome: `${cliente?.nome ?? ''} ${cliente?.sobrenome ?? ''}`.trim(),
    valor: giftback ? (giftback.percentual ? `${giftback.percentual}%` : formatarReais(giftback.valorCentavos)) : '',
    minimo: giftback ? formatarReais(giftback.minimoCentavos) : '',
    validade: giftback ? formatarDia(diaSP(giftback.expiraEm)) : '',
    codigo: giftback?.codigo ?? '',
    loja: config.nomeLoja,
  };
  return String(modelo).replace(/\{(\w+)\}/g, (tudo, chave) => (chave in valores ? valores[chave] : tudo));
}

/**
 * Organiza a fila do dia. Recebe as mensagens pendentes já vencidas (devidaEm <= hoje), cada uma com
 * {id, tipo, devidaEm, giftback, cliente}, e devolve UMA por giftback: a mais recente.
 * As mais antigas do mesmo giftback (ex.: lembrete atrasado quando já é dia do aviso final) vão em
 * `substituidas`, para serem marcadas como puladas quando a principal for enviada: o cliente
 * recebe uma mensagem só, sempre com a informação certa.
 * Ordem: atrasadas primeiro (mais antigas antes), depois aviso final, lembrete e giftback novo.
 */
export function organizarFila(pendentes, hoje) {
  const porGiftback = new Map();
  for (const m of pendentes) {
    const chave = m.giftback?.id ?? m.giftbackId ?? m.id;
    if (!porGiftback.has(chave)) porGiftback.set(chave, []);
    porGiftback.get(chave).push(m);
  }
  const ordemTipo = { vencendo: 0, lembrete: 1, envio: 2 };
  const fila = [];
  for (const grupo of porGiftback.values()) {
    grupo.sort((a, b) => b.devidaEm.localeCompare(a.devidaEm) || (ordemTipo[a.tipo] ?? 9) - (ordemTipo[b.tipo] ?? 9));
    const [principal, ...antigas] = grupo;
    const diasAtraso = diasEntre(principal.devidaEm, hoje);
    fila.push({ ...principal, atrasada: diasAtraso > 0, diasAtraso, substituidas: antigas.map((x) => x.id) });
  }
  return fila.sort((a, b) =>
    (b.diasAtraso - a.diasAtraso) || (ordemTipo[a.tipo] ?? 9) - (ordemTipo[b.tipo] ?? 9)
    || String(a.giftback?.expiraEm).localeCompare(String(b.giftback?.expiraEm)));
}

/**
 * Link que abre a conversa já com o texto pronto.
 * modo 'web' = WhatsApp Web direto (computador); 'app' = wa.me (celular).
 */
export function linkWhatsApp(telefone, texto, modo = 'web') {
  const tel = normalizarTelefone(telefone);
  if (!tel) return null;
  const t = encodeURIComponent(texto);
  return modo === 'app' ? `https://wa.me/55${tel}?text=${t}` : `https://web.whatsapp.com/send?phone=55${tel}&text=${t}`;
}
