// motor.js — Regras de negócio do Giftback Acker.
// Funções puras: não acessam banco, tela nem relógio (a data "agora" é sempre passada).
// Todos os valores em CENTAVOS inteiros, para nunca errar centavo.
// Fonte das regras: docs/01-contexto-e-decisoes.md

export const CONFIG_PADRAO = Object.freeze({
  percentual: 5, // % do valor final da compra que vira giftback (padrão 5%, decisão do Jacson em 2026-11-10; pode mudar por venda no caixa)
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
    // Os 3 abaixo eram usados na Zoppy; ainda não são automáticos aqui (fase 2), mas o texto já fica guardado.
    aniversario:
      'Oi {primeiro_nome}, aqui é o Jacson da {loja}! 🎉\n' +
      'Hoje é um dia especial e não poderíamos deixar passar em branco.\n\n' +
      'Preparamos um presente pra você: *{valor}* de desconto para usar na loja.\n' +
      'Informe o código *{codigo}* no caixa até {validade}\n' +
      '(compra mínima de {minimo}).\n\n' +
      'Feliz aniversário e esperamos você! 🌿🎂',
    recompra90:
      'Ei, {primeiro_nome}! 👋 Sentimos sua falta na {loja} e temos uma surpresa exclusiva esperando por você! 🎉\n' +
      'Para você ficar por dentro de todas as novidades, liberamos um presente especial: *{valor}* de desconto com o código *{codigo}*.\n' +
      'Use até {validade}, diretamente no caixa (compra mínima de {minimo}).\n\n' +
      'Esperamos você! 🌱',
    recompra180:
      'Oi, {primeiro_nome}! 👋 Você se esqueceu da gente?😢\n' +
      'Faz um tempinho que você não aparece, e sentimos sua falta!\n' +
      'Por isso, temos uma surpresa especial só pra você: {valor} de desconto na sua próxima compra com o cupom {codigo}! 🎁 Válido até {validade}\n' +
      'Aproveite para voltar e escolher seus produtos favoritos! Estamos esperando por você. 😊\n' +
      'Um abraço!',
  }),
  // Mensagens automáticas de retorno (como os fluxos da Zoppy): cria um cupom de % e põe a mensagem na fila.
  // Zoppy: Recompra 90 dias = 10%, Recompra 180 dias = 15%, sem compra mínima, validade 30 dias.
  // janelaDias: só entra quem completou os dias há no máximo esta quantidade de dias (não acorda quem sumiu há meses).
  automaticas: Object.freeze({
    janelaDias: 7,
    recompra90: Object.freeze({ ativo: true, dias: 90, percentual: 10, validadeDias: 30, minimoCentavos: 0 }),
    recompra180: Object.freeze({ ativo: true, dias: 180, percentual: 15, validadeDias: 30, minimoCentavos: 0 }),
    aniversario: Object.freeze({ ativo: true, percentual: 10, validadeDias: 15, minimoCentavos: 0 }),
  }),
  // Perfis especiais de cliente (parcerias e família). Cada um pode ter % de giftback e compra mínima
  // próprios; em branco (null) usa a regra geral. compraMinimaCentavos = 0 significa "sem mínimo".
  perfis: Object.freeze([
    Object.freeze({ id: 'nutricionista', nome: 'Nutricionista', cor: '#0f8a7a', percentual: null, compraMinimaCentavos: null }),
    Object.freeze({ id: 'medico', nome: 'Médico', cor: '#2563a8', percentual: null, compraMinimaCentavos: null }),
    Object.freeze({ id: 'influenciador', nome: 'Influenciador', cor: '#b0358f', percentual: null, compraMinimaCentavos: null }),
    Object.freeze({ id: 'familiar', nome: 'Familiar', cor: '#b3641a', percentual: null, compraMinimaCentavos: null }),
  ]),
  // Assinatura colocada no fim de toda mensagem (como era na Zoppy). Deixe vazio para não usar.
  rodape: '💬 Dúvidas? É só responder por aqui — você está falando com a *{loja}*.',
  // Modelos de campanha (envio manual para um grupo de clientes). Vieram das campanhas feitas na Zoppy.
  campanhas: Object.freeze([
    Object.freeze({
      id: 'resgate-90d',
      nome: 'Resgate 90 dias sem comprar (10% de desconto)',
      texto:
        'Olá, {primeiro_nome}!\n' +
        'Sentimos sua falta na {loja}.\n\n' +
        'Você ganhou *10% de desconto* em itens não promocionais para usar na loja física.\n\n' +
        '📍 Estamos na Av. Osvaldo Reis, 3547 Praia Brava, Itajaí-SC (ao lado do Supermercado De Angelina)\n\n' +
        'Válido por 15 dias.\n' +
        'Não cumulativo com outras promoções ou cupons.',
    }),
    Object.freeze({
      id: 'club-60d',
      nome: 'Club NatuBrava: acima de 60 dias sem comprar (10%)',
      texto:
        'Olá, {primeiro_nome}! 👋\n' +
        'Aqui é da *{loja}* e temos uma surpresa exclusiva para quem é *Club NatuBrava* esperando por você! 🎉\n\n' +
        '*Você tem 10% de desconto* em itens não promocionais.\n\n' +
        'Como usar:\n' +
        '- Apresente esta mensagem no caixa.\n' +
        '- *Validade: até {data_limite}*\n' +
        '- Uso único em seu nome (não cumulativo com outras promoções)\n\n' +
        'Esperamos você! 🌱',
    }),
  ]),
});

export const TIPOS_MENSAGEM = Object.freeze({
  envio: 'Giftback novo',
  lembrete: 'Lembrete',
  vencendo: 'Vence em breve',
  aniversario: 'Aniversário',
  recompra90: 'Recompra 90 dias',
  recompra180: 'Recompra 180 dias',
  campanha: 'Campanha',
});

/** Variáveis que podem ser usadas nos textos, com o que significam (para a tela de modelos). */
export const VARIAVEIS_MENSAGEM = Object.freeze([
  ['{primeiro_nome}', 'primeiro nome do cliente'],
  ['{nome}', 'nome completo'],
  ['{valor}', 'valor do giftback'],
  ['{codigo}', 'código do giftback'],
  ['{validade}', 'data em que vence'],
  ['{prazo}', '"hoje", "amanhã", "em 2 dias" (calculado no dia do envio)'],
  ['{dias_restantes}', 'quantos dias faltam'],
  ['{minimo}', 'compra mínima para usar'],
  ['{loja}', 'nome da loja'],
  ['{data_limite}', 'data limite de uma campanha'],
]);

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

/**
 * Vírgula automática (como em maquininha e app de banco): só os números contam e os dois últimos
 * são os centavos. '2' -> '0,02', '200' -> '2,00', '20000' -> '200,00'. Vazio continua vazio.
 */
export function mascararReais(texto) {
  const digitos = String(texto ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (!digitos) return '';
  const centavos = Number(digitos.slice(0, 11));
  const inteiro = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${inteiro},${String(centavos % 100).padStart(2, '0')}`;
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
  // Celular sem o 9 da frente (padrão antigo, 8 dígitos começando por 6, 7, 8 ou 9): acrescenta o 9.
  // Fixo (começa por 2, 3, 4 ou 5) continua com 10 dígitos.
  if (d.length === 10 && /[6-9]/.test(d[2])) d = `${d.slice(0, 2)}9${d.slice(2)}`;
  return d.length === 10 || d.length === 11 ? d : null;
}

/** '47999998888' -> '(47) 99999-8888' */
export function formatarTelefone(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 3)}.${d.slice(3, 7)}-${d.slice(7)}`;
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

// ───────────────────────── Perfis especiais ─────────────────────────

/** Perfil especial do cliente (ou null se for cliente comum ou se o perfil não existe mais). */
export function perfilDoCliente(cliente, config = CONFIG_PADRAO) {
  if (!cliente?.perfil) return null;
  return (config.perfis || []).find((p) => p.id === cliente.perfil) || null;
}

/** Regras que valem para este cliente: as gerais, trocando % e compra mínima se o perfil dele tiver os seus. */
export function configParaCliente(config, cliente) {
  const p = perfilDoCliente(cliente, config);
  if (!p) return config;
  return {
    ...config,
    percentual: p.percentual != null && p.percentual !== '' ? Number(p.percentual) : config.percentual,
    compraMinimaCentavos: p.compraMinimaCentavos != null && p.compraMinimaCentavos !== '' ? Number(p.compraMinimaCentavos) : config.compraMinimaCentavos,
  };
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
    minimo: giftback ? (giftback.minimoCentavos ? formatarReais(giftback.minimoCentavos) : 'qualquer valor') : '',
    validade: giftback ? formatarDia(diaSP(giftback.expiraEm)) : '',
    codigo: giftback?.codigo ?? '',
    loja: config.nomeLoja,
  };
  return String(modelo).replace(/\{(\w+)\}/g, (tudo, chave) => (chave in valores ? valores[chave] : tudo));
}

/**
 * Venda vinda do Uniplus: soma dos itens marcados para contar no giftback (valor de cada item
 * ANTES do desconto dado no subtotal, que normalmente é o próprio giftback).
 * @param itens [{totalCentavos, promocional}]   @param marcados Set de índices que contam (padrão: os não promocionais)
 */
export function baseDosItens(itens, marcados = null) {
  let base = 0;
  itens.forEach((i, k) => { if (marcados ? marcados.has(k) : !i.promocional) base += i.totalCentavos; });
  return base;
}

/** O desconto dado no PDV parece ser o giftback do cliente? (diferença de até R$ 0,10) */
export function descontoPareceGiftback(descontoCentavos, giftback, baseCentavos) {
  if (!giftback || !descontoCentavos) return false;
  const esperado = giftback.percentual ? Math.round(baseCentavos * giftback.percentual / 100) : giftback.valorCentavos;
  return Math.abs(descontoCentavos - esperado) <= 5; // até 5 centavos (arredondamento do PDV); é só sugestão, a caixa confere
}

/** Hora do Uniplus ('2026-11-09T15:28:52.193', sem fuso) -> ISO com fuso de Brasília. */
export function horaUniplus(hora, dia) {
  const base = hora ? String(hora).slice(0, 19) : `${dia}T12:00:00`;
  return new Date(`${base}-03:00`).toISOString();
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

/** Texto pronto para enviar: o modelo do tipo + a assinatura (rodapé). */
export function mensagemCompleta(tipoOuTexto, { cliente, giftback = null, config = CONFIG_PADRAO, hoje = diaSP(new Date()), extras = {} }) {
  const modelo = config.modelos?.[tipoOuTexto] ?? tipoOuTexto;
  let texto = montarMensagem(modelo, { cliente, giftback, config, hoje });
  for (const [k, v] of Object.entries(extras)) texto = texto.split(`{${k}}`).join(v);
  const rodape = String(config.rodape ?? '').trim();
  if (rodape) texto = `${texto.trimEnd()}\n\n${montarMensagem(rodape, { cliente, giftback, config, hoje })}`;
  return texto;
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

// ───────────── Histórico das regras do giftback ─────────────
// Guarda cada mudança das regras (quando, quem e como ficou), começando pelo padrão que era usado na Zoppy.
// Fica dentro das configurações (historicoRegras), então vai junto na cópia de segurança.

export const CAMPOS_REGRAS = Object.freeze(['percentual', 'compraMinimaCentavos', 'validadeDias', 'multiploUsoMinimo', 'diasLembrete', 'diasAntesAvisoFinal']);

/** Como era na Zoppy até a troca (levantado no painel da Zoppy em 2026-11-09, ver docs/02). */
export const REGRAS_ZOPPY = Object.freeze({ percentual: 7, compraMinimaCentavos: 5000, validadeDias: 45, multiploUsoMinimo: 5, diasLembrete: 31, diasAntesAvisoFinal: 3 });

/** Só os campos de regra de uma configuração. */
export function regrasDe(config = {}) {
  return Object.fromEntries(CAMPOS_REGRAS.filter((k) => config[k] != null).map((k) => [k, Number(config[k])]));
}

const mesmasRegras = (a, b) => CAMPOS_REGRAS.every((k) => Number(a?.[k]) === Number(b?.[k]));

/** Histórico guardado ou, se ainda não houver, as duas linhas de partida (Zoppy e início do Giftback Acker). */
export function historicoRegras(config = {}) {
  if (Array.isArray(config.historicoRegras) && config.historicoRegras.length) return config.historicoRegras.map((x) => ({ ...x }));
  return [
    { em: null, titulo: 'Padrão da Zoppy (até 10/11/2026)', por: null, regras: { ...REGRAS_ZOPPY } },
    { em: '2026-11-10', titulo: 'Início do Giftback Acker', por: null, regras: regrasDe(CONFIG_PADRAO) },
  ];
}

/**
 * Devolve o histórico com a mudança acrescentada, ou null se as regras não mudaram.
 * Se as regras atuais já eram diferentes da última linha (mudança feita antes de o histórico existir),
 * registra isso também, sem inventar data.
 */
export function registrarMudancaRegras(configAnterior, novas, { em, por = null } = {}) {
  const antes = { ...regrasDe(CONFIG_PADRAO), ...regrasDe(configAnterior) };
  const depois = { ...antes, ...regrasDe(novas) };
  if (mesmasRegras(antes, depois)) return null;
  const hist = historicoRegras(configAnterior);
  if (!mesmasRegras(hist[hist.length - 1].regras, antes)) {
    hist.push({ em: null, titulo: 'Alteração anterior ao histórico (sem data registrada)', por: null, regras: antes });
  }
  hist.push({ em, por, regras: depois });
  return hist;
}

/**
 * Máscara do WhatsApp enquanto digita: 47999328511 vira (47) 9.9932-8511; fixo: (47) 3348-3186.
 * Aceita colar com +55 na frente.
 */
export function mascararTelefone(texto) {
  let d = String(texto ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (!d) return '';
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const r = d.slice(2);
  let resto;
  if (r[0] === '9') { // celular
    resto = r[0];
    if (r.length > 1) resto += '.' + r.slice(1, 5);
    if (r.length > 5) resto += '-' + r.slice(5, 9);
  } else {
    resto = r.slice(0, 4);
    if (r.length > 4) resto += '-' + r.slice(4, 8);
  }
  return `(${ddd}) ${resto}`;
}

/**
 * Mensagens automáticas de retorno que devem nascer hoje (Recompra 90/180 dias e Aniversário).
 * Mesma regra da função do banco gb_gerar_automaticas (migração 0011).
 * @param clientes [{id, ultimaCompra, nascimento, semMensagens, excluidoEm, giftback (ativo ou null)}]
 * @param mensagens [{clienteId, tipo, devidaEm}] já existentes (para não repetir)
 * @returns [{clienteId, tipo, percentual, validadeDias, minimoCentavos}]
 */
export function automaticasDoDia({ clientes, hoje, config = CONFIG_PADRAO, mensagens = [] }) {
  const a = { ...CONFIG_PADRAO.automaticas, ...(config.automaticas || {}) };
  const janela = Number(a.janelaDias) || 7;
  const dentro = (dia) => dia <= hoje && diasEntre(dia, hoje) <= janela;
  const novas = [];
  for (const c of clientes) {
    if (c.excluidoEm || c.semMensagens || c.giftback || !c.ultimaCompra) continue; // 1 cupom ativo por cliente
    const doCliente = mensagens.filter((m) => m.clienteId === c.id);
    const ultima = diaSP(c.ultimaCompra);
    let criou = false;
    for (const tipo of ['recompra90', 'recompra180']) {
      const f = a[tipo];
      if (!f?.ativo) continue;
      if (!dentro(somarDias(ultima, Number(f.dias)))) continue;
      if (doCliente.some((m) => m.tipo === tipo && m.devidaEm > ultima)) continue;
      novas.push({ clienteId: c.id, tipo, percentual: Number(f.percentual), validadeDias: Number(f.validadeDias) || 30, minimoCentavos: Number(f.minimoCentavos) || 0 });
      criou = true;
      break;
    }
    const f = a.aniversario;
    if (criou || !f?.ativo || !c.nascimento) continue;
    const ano = hoje.slice(0, 4);
    let aniv = `${ano}${String(c.nascimento).slice(4, 10)}`;
    if (aniv.endsWith('-02-29') && new Date(Date.UTC(Number(ano), 1, 29)).getUTCMonth() !== 1) aniv = `${ano}-03-01`;
    if (!dentro(aniv)) continue;
    if (doCliente.some((m) => m.tipo === 'aniversario' && m.devidaEm >= aniv)) continue;
    novas.push({ clienteId: c.id, tipo: 'aniversario', percentual: Number(f.percentual), validadeDias: Number(f.validadeDias) || 15, minimoCentavos: Number(f.minimoCentavos) || 0 });
  }
  return novas;
}

/** Tipos de mensagem de retorno (cupom de %, sem ligação com compra): aparecem com outra cor na fila. */
export const TIPOS_RETORNO = Object.freeze(['recompra90', 'recompra180', 'aniversario']);
