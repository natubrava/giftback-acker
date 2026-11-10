// rfm.js — Matriz RFM e público de campanhas. Funções puras, com testes.
// Mesmo método da Zoppy (conferido em 2026-11-10: bate em 90% dos clientes; o resto é porque a Zoppy
// só recalcula uma vez por dia e usa a base dela):
//   R = nota de 1 a 5 da recência (dias desde a última compra), RELATIVA à base: os 20% que compraram
//       mais recentemente ganham 5, os 20% seguintes 4... (quintis).
//   F = nota de 1 a 5 do número de compras e M = nota de 1 a 5 do total gasto, também por quintis.
//   FM = média de F e M arredondada para baixo.
//   A categoria sai da posição (R, FM) na grade 5x5 padrão de RFM.
// As faixas fixas abaixo ficam só como referência/explicação.
import { diaSP, diasEntre } from './motor.js';

export const FAIXAS_RECENCIA = Object.freeze([30, 60, 90, 180]); // dias
export const FAIXAS_FREQUENCIA = Object.freeze([2, 3, 5, 10]); // compras

export const SEGMENTOS_RFM = Object.freeze({
  campeao: { nome: 'Campeão', cor: '#7b4fd6', descricao: 'Comprou há pouco e compra sempre. São os melhores clientes.', sugestao: 'Agradeça, mostre novidades primeiro e peça indicação.' },
  fiel: { nome: 'Fidelizado', cor: '#12a594', descricao: 'Compra com frequência e esteve na loja nos últimos 3 meses.', sugestao: 'Mantenha por perto: avise de reposições e ofertas do Club.' },
  possivel_fiel: { nome: 'Possível leal', cor: '#2b8fd6', descricao: 'Comprou há pouco e já voltou algumas vezes.', sugestao: 'Incentive a próxima compra para virar fidelizado (lembrete do giftback).' },
  novo: { nome: 'Novo', cor: '#3aa655', descricao: 'Primeira compra nos últimos 30 dias.', sugestao: 'Dê boas-vindas ao Club e lembre do giftback.' },
  promissor: { nome: 'Promissor', cor: '#1f79b8', descricao: 'Uma compra só, entre 1 e 2 meses atrás.', sugestao: 'Convide para voltar antes que esfrie.' },
  atencao: { nome: 'Precisa de atenção', cor: '#a25ad1', descricao: 'Cliente médio que não aparece há 2 a 3 meses.', sugestao: 'Mande uma oferta por tempo limitado.' },
  quase_hibernando: { nome: 'Quase hibernando', cor: '#6c78c9', descricao: 'Comprou pouco e não aparece há 2 a 3 meses.', sugestao: 'Lembre da loja com um produto que ele já comprou.' },
  nao_pode_perder: { nome: 'Não pode perder', cor: '#e06a80', descricao: 'Comprava muito (10+ compras) e sumiu há mais de 3 meses.', sugestao: 'Fale pessoalmente: vale um desconto maior para trazer de volta.' },
  em_risco: { nome: 'Em risco', cor: '#c77ae0', descricao: 'Comprava com frequência e sumiu há mais de 3 meses.', sugestao: 'Campanha de resgate com desconto e prazo.' },
  hibernando: { nome: 'Hibernando', cor: '#8a909c', descricao: 'Comprou 1 ou 2 vezes e não aparece há mais de 3 meses.', sugestao: 'Campanha de resgate em massa, sem gastar muito tempo.' },
});

export function notaRecencia(dias) {
  const [a, b, c, d] = FAIXAS_RECENCIA;
  return dias <= a ? 5 : dias <= b ? 4 : dias <= c ? 3 : dias <= d ? 2 : 1;
}

export function notaFrequencia(compras) {
  const [a, b, c, d] = FAIXAS_FREQUENCIA;
  return compras >= d ? 5 : compras >= c ? 4 : compras >= b ? 3 : compras >= a ? 2 : 1;
}

/** Categoria a partir das notas de recência (r) e frequência (f). */
export function segmentoRFM(r, f) {
  if (r <= 2) return f >= 5 ? 'nao_pode_perder' : f >= 3 ? 'em_risco' : 'hibernando';
  if (r === 3) return f >= 4 ? 'fiel' : f === 3 ? 'atencao' : 'quase_hibernando';
  if (r === 4) return f >= 4 ? 'fiel' : f >= 2 ? 'possivel_fiel' : 'promissor';
  return f >= 4 ? 'campeao' : f >= 2 ? 'possivel_fiel' : 'novo';
}

/**
 * Nota de 1 a 5 por quintis: posição do valor na base (empates ficam no meio). `inverter` = menor é melhor.
 * Devolve uma função valor -> nota.
 */
export function notaPorQuintil(valores, inverter = false) {
  const ord = [...valores].sort((a, b) => a - b);
  const n = ord.length;
  const posicao = (x) => {
    let lo = 0, hi = n; // primeiros >= x
    while (lo < hi) { const m = (lo + hi) >> 1; if (ord[m] < x) lo = m + 1; else hi = m; }
    let fim = lo; // primeiro > x
    let a = lo, b = n;
    while (a < b) { const m = (a + b) >> 1; if (ord[m] <= x) a = m + 1; else b = m; }
    fim = a;
    return (lo + (fim - lo) / 2) / n;
  };
  return (x) => {
    if (!n) return 3;
    const nota = Math.min(5, Math.floor(posicao(x) * 5) + 1);
    return inverter ? 6 - nota : nota;
  };
}

/**
 * Classifica os clientes. Entrada: [{compras, totalCentavos, ultimaCompra, ...}].
 * Saída: os mesmos clientes com rfm = {r, f, m, fm, segmento, diasSemComprar}. Quem não tem compra fica com rfm = null.
 */
export function classificarRFM(clientes, hoje) {
  const comCompra = clientes.filter((c) => c.compras && c.ultimaCompra);
  const dias = (c) => Math.max(0, diasEntre(diaSP(c.ultimaCompra), hoje));
  const nR = notaPorQuintil(comCompra.map(dias), true);
  const nF = notaPorQuintil(comCompra.map((c) => c.compras));
  const nM = notaPorQuintil(comCompra.map((c) => c.totalCentavos || 0));
  return clientes.map((c) => {
    if (!c.compras || !c.ultimaCompra) return { ...c, rfm: null };
    const diasSemComprar = dias(c);
    const r = nR(diasSemComprar), f = nF(c.compras), m = nM(c.totalCentavos || 0);
    const fm = Math.floor((f + m) / 2);
    return { ...c, rfm: { r, f, m, fm, segmento: segmentoRFM(r, fm), diasSemComprar } };
  });
}

/** Números de um grupo de clientes (para o painel ao lado da matriz). */
export function resumoGrupo(lista) {
  const compras = lista.reduce((s, c) => s + (c.compras || 0), 0);
  const total = lista.reduce((s, c) => s + (c.totalCentavos || 0), 0);
  const datas = lista.map((c) => c.ultimaCompra).filter(Boolean).sort();
  // tempo médio entre uma compra e outra (só de quem comprou 2+ vezes e tem a data da primeira compra)
  const intervalos = lista.filter((c) => c.compras > 1 && c.primeiraCompra && c.ultimaCompra)
    .map((c) => diasEntre(diaSP(c.primeiraCompra), diaSP(c.ultimaCompra)) / (c.compras - 1));
  const qtd = lista.map((c) => c.compras || 0);
  return {
    // a Zoppy chama de "tempo médio de recompra" a média de dias desde a última compra do grupo
    mediaDiasSemComprar: lista.some((c) => c.rfm) ? Math.round(lista.reduce((s, c) => s + (c.rfm?.diasSemComprar || 0), 0) / lista.length) : null,
    tempoMedioRecompraDias: intervalos.length ? Math.round(intervalos.reduce((s, x) => s + x, 0) / intervalos.length) : null,
    frequenciaMin: qtd.length ? Math.min(...qtd) : 0,
    frequenciaMax: qtd.length ? Math.max(...qtd) : 0,
    clientes: lista.length,
    compras,
    totalCentavos: total,
    ticketMedioCentavos: compras ? Math.round(total / compras) : 0,
    maisAntiga: datas[0] || null,
    maisRecente: datas[datas.length - 1] || null,
    comGiftback: lista.filter((c) => c.giftback).length,
  };
}

/**
 * Público de uma campanha. filtro = {segmentos: [..] (vazio = todos), diasMin, diasMax, gastoMinCentavos,
 * comprasMin, sexo ('F'|'M'|''), semGiftback (true = tira quem já tem giftback ativo)}.
 */
export function filtrarPublico(clientesRFM, filtro = {}) {
  const segs = new Set(filtro.segmentos || []);
  return clientesRFM.filter((c) => {
    if (!c.rfm) return false;
    if (segs.size && !segs.has(c.rfm.segmento)) return false;
    if (filtro.diasMin != null && filtro.diasMin !== '' && c.rfm.diasSemComprar < Number(filtro.diasMin)) return false;
    if (filtro.diasMax != null && filtro.diasMax !== '' && c.rfm.diasSemComprar > Number(filtro.diasMax)) return false;
    if (filtro.gastoMinCentavos && c.totalCentavos < filtro.gastoMinCentavos) return false;
    if (filtro.comprasMin && c.compras < Number(filtro.comprasMin)) return false;
    if (filtro.sexo && c.sexo !== filtro.sexo) return false;
    if (filtro.semGiftback && c.giftback) return false;
    return true;
  });
}

/** Texto curto que descreve o público (fica guardado na campanha). */
export function descreverPublico(filtro = {}) {
  const partes = [];
  const segs = filtro.segmentos || [];
  partes.push(segs.length ? segs.map((s) => SEGMENTOS_RFM[s]?.nome || s).join(', ') : 'Todos os clientes');
  if (filtro.diasMin) partes.push(`${filtro.diasMin}+ dias sem comprar`);
  if (filtro.diasMax) partes.push(`até ${filtro.diasMax} dias sem comprar`);
  if (filtro.gastoMinCentavos) partes.push(`gastou R$ ${(filtro.gastoMinCentavos / 100).toFixed(0)}+`);
  if (filtro.comprasMin) partes.push(`${filtro.comprasMin}+ compras`);
  if (filtro.sexo) partes.push(filtro.sexo === 'F' ? 'mulheres' : 'homens');
  if (filtro.semGiftback) partes.push('sem giftback ativo');
  return partes.join(' · ');
}
