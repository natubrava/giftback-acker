// dados-local.js — Camada de dados do MODO TESTE.
// Guarda tudo no navegador deste computador (localStorage), começando pelos dados
// migrados da Zoppy (dados_migrados/seed.json). Serve para testar e moldar as telas.
// A versão online usa a mesma interface, trocando este arquivo pelo do Supabase.
//
// Toda regra de negócio vem de motor.js; aqui só se lê e grava.
import {
  CONFIG_PADRAO, calcularCompra, giftbackVigente, gerarCodigo, planejarMensagens,
  clienteCombina, normalizarTelefone, diaSP, organizarFila,
} from './motor.js';

const CHAVE = 'giftback-acker-teste-v1';

export function criarDadosLocal({ armazenamento = globalThis.localStorage, carregarSeed, carregarExemploUniplus = null, relogio = () => new Date() } = {}) {
  let estado = null;

  const novoId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
  const agoraISO = () => relogio().toISOString();

  function salvar() {
    armazenamento?.setItem(CHAVE, JSON.stringify(estado));
  }

  function configAtual() {
    const c = estado.config || {};
    return { ...CONFIG_PADRAO, ...c, modelos: { ...CONFIG_PADRAO.modelos, ...(c.modelos || {}) } };
  }

  /** Giftbacks que passaram da validade deixam de ser "ativos". */
  function expirarVencidos() {
    const agora = relogio();
    let mudou = false;
    for (const g of estado.giftbacks) {
      if (g.status === 'ativo' && !giftbackVigente(g, agora)) {
        g.status = 'expirado';
        cancelarMensagens(g.id, 'giftback expirou');
        mudou = true;
      }
    }
    if (mudou) salvar();
  }

  function cancelarMensagens(giftbackId, motivo) {
    for (const m of estado.mensagens) {
      if (m.giftbackId === giftbackId && m.status === 'pendente') { m.status = 'cancelada'; m.motivo = motivo; }
    }
  }

  function reativarMensagens(giftbackId) {
    for (const m of estado.mensagens) {
      if (m.giftbackId === giftbackId && m.status === 'cancelada') { m.status = 'pendente'; delete m.motivo; }
    }
  }

  const giftbackAtivoDe = (clienteId) => estado.giftbacks.find((g) => g.clienteId === clienteId && g.status === 'ativo') || null;
  const clientePorId = (id) => estado.clientes.find((c) => c.id === id) || null;

  function resumoCliente(c) {
    let compras = 0, totalCentavos = 0, ultima = null, primeira = null;
    for (const p of estado.compras) {
      if (p.clienteId !== c.id || p.status !== 'ok') continue;
      compras++; totalCentavos += p.valorFinalCentavos;
      if (!ultima || p.data > ultima) ultima = p.data;
      if (!primeira || p.data < primeira) primeira = p.data;
    }
    return { ...c, giftback: giftbackAtivoDe(c.id), compras, totalCentavos, ultimaCompra: ultima, primeiraCompra: primeira };
  }

  return {
    modo: 'teste',

    async iniciar() {
      const salvo = armazenamento?.getItem(CHAVE);
      if (salvo) estado = JSON.parse(salvo);
      else await this.restaurarDadosZoppy();
      expirarVencidos();
    },

    /** Apaga tudo que foi feito no teste e volta aos dados migrados da Zoppy. */
    async restaurarDadosZoppy() {
      const seed = carregarSeed ? await carregarSeed() : null;
      estado = {
        config: seed?.config || null,
        clientes: seed?.clientes || [],
        compras: seed?.compras || [],
        giftbacks: seed?.giftbacks || [],
        mensagens: seed?.mensagens || [],
        virada: seed?.virada || null,
      };
      salvar();
      expirarVencidos();
    },

    async obterConfig() { return configAtual(); },

    async salvarConfig(nova) {
      estado.config = { ...(estado.config || {}), ...nova, modelos: { ...(estado.config?.modelos || {}), ...(nova.modelos || {}) } };
      salvar();
      return configAtual();
    },

    /** Busca por nome, telefone, CPF ou código do giftback. */
    async buscarClientes(busca, limite = 30) {
      expirarVencidos();
      const q = String(busca || '').trim().toLowerCase();
      if (!q) return [];
      const achados = [];
      const porCodigo = estado.giftbacks.find((g) => g.status === 'ativo' && g.codigo.toLowerCase() === q.replace(/\s/g, ''));
      if (porCodigo) { const c = clientePorId(porCodigo.clienteId); if (c) achados.push(c); }
      for (const c of estado.clientes) {
        if (achados.length >= limite) break;
        if (c.id !== porCodigo?.clienteId && clienteCombina(c, q)) achados.push(c);
      }
      return achados.map(resumoCliente).sort((a, b) => (b.ultimaCompra || '').localeCompare(a.ultimaCompra || ''));
    },

    async listarClientes() {
      expirarVencidos();
      return estado.clientes.map(resumoCliente);
    },

    async obterCliente(id) {
      expirarVencidos();
      const c = clientePorId(id);
      if (!c) return null;
      const compras = estado.compras.filter((p) => p.clienteId === id).sort((a, b) => b.data.localeCompare(a.data));
      const giftbacks = estado.giftbacks.filter((g) => g.clienteId === id).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
      const mensagens = estado.mensagens.filter((m) => m.clienteId === id).sort((a, b) => b.devidaEm.localeCompare(a.devidaEm));
      return { ...resumoCliente(c), historicoCompras: compras, historicoGiftbacks: giftbacks, historicoMensagens: mensagens };
    },

    async clientePorTelefone(telefone) {
      const tel = normalizarTelefone(telefone);
      const c = tel && estado.clientes.find((x) => x.telefone === tel);
      return c ? resumoCliente(c) : null;
    },

    async criarCliente({ nome, sobrenome = '', telefone, sexo = null, email = null, cpf = null, uniplusCodigo = null }) {
      const tel = normalizarTelefone(telefone);
      if (!tel) throw new Error('Telefone inválido. Informe DDD + número.');
      if (!String(nome || '').trim()) throw new Error('Informe o nome do cliente.');
      if (estado.clientes.some((c) => c.telefone === tel)) throw new Error('Já existe um cliente com este telefone.');
      const c = {
        id: novoId(), nome: nome.trim(), sobrenome: String(sobrenome || '').trim(), telefone: tel,
        sexo: sexo || null, email: email || null, nascimento: null, cpf: cpf || null, uniplusCodigo,
        criadoEm: agoraISO(), origem: 'acker',
      };
      estado.clientes.push(c);
      salvar();
      return resumoCliente(c);
    },

    async atualizarCliente(id, dados) {
      const c = clientePorId(id);
      if (!c) throw new Error('Cliente não encontrado.');
      if (dados.telefone != null) {
        const tel = normalizarTelefone(dados.telefone);
        if (!tel) throw new Error('Telefone inválido. Informe DDD + número.');
        if (estado.clientes.some((x) => x.id !== id && x.telefone === tel)) throw new Error('Já existe outro cliente com este telefone.');
        c.telefone = tel;
      }
      for (const campo of ['nome', 'sobrenome', 'sexo', 'email', 'nascimento', 'cpf']) {
        if (campo in dados) c[campo] = typeof dados[campo] === 'string' ? dados[campo].trim() || null : dados[campo];
      }
      if (!c.nome) throw new Error('Informe o nome do cliente.');
      salvar();
      return resumoCliente(c);
    },

    /**
     * Registra a compra: dá baixa no giftback usado, cria o novo (se a compra der direito)
     * e agenda as mensagens. Devolve tudo que a tela precisa mostrar.
     */
    async lancarCompra({ clienteId, valorCentavos, usarGiftback = false, data = null, uniplusOperacaoId = null, itensExcluidos = null, percentual = null }) {
      expirarVencidos();
      const cliente = clientePorId(clienteId);
      if (!cliente) throw new Error('Cliente não encontrado.');
      if (uniplusOperacaoId != null && estado.compras.some((c) => c.uniplusOperacaoId === uniplusOperacaoId && c.status === 'ok')) {
        throw new Error('Esta venda do Uniplus já foi lançada.');
      }
      const config = percentual ? { ...configAtual(), percentual: Number(percentual) } : configAtual(); // % desta venda
      const agora = data ? new Date(data) : relogio();
      const atual = giftbackAtivoDe(clienteId);
      const r = calcularCompra({ valorCentavos, giftbackAtivo: atual, usarGiftback, config, agora });

      const compra = {
        id: novoId(), clienteId, data: agora.toISOString(), valorCentavos,
        descontoCentavos: r.descontoCentavos, valorFinalCentavos: r.valorFinalCentavos,
        codigoUsado: usarGiftback ? atual.codigo : null,
        giftbackUsadoId: null, giftbackGeradoId: null, giftbackSubstituidoId: null,
        status: 'ok', origem: uniplusOperacaoId != null ? 'uniplus' : 'acker',
        uniplusOperacaoId, itensExcluidos,
      };

      if (atual && r.giftbackAnterior === 'usado') {
        atual.status = 'usado'; atual.usadoEm = compra.data; atual.compraUsoId = compra.id;
        compra.giftbackUsadoId = atual.id;
        cancelarMensagens(atual.id, 'giftback usado');
      } else if (atual && r.giftbackAnterior === 'substituido') {
        atual.status = 'substituido';
        compra.giftbackSubstituidoId = atual.id;
        cancelarMensagens(atual.id, 'substituído por giftback novo');
      }

      let novo = null;
      const mensagensNovas = [];
      if (r.novoGiftback) {
        novo = {
          id: novoId(), clienteId, tipo: 'giftback', percentual: null,
          codigo: gerarCodigo(config.prefixoCodigo, (cod) => estado.giftbacks.some((g) => g.codigo === cod)),
          valorCentavos: r.novoGiftback.valorCentavos, minimoCentavos: r.novoGiftback.minimoCentavos,
          criadoEm: compra.data, expiraEm: r.novoGiftback.expiraEm, status: 'ativo',
          compraOrigemId: compra.id, compraUsoId: null, usadoEm: null, origem: 'acker',
        };
        estado.giftbacks.push(novo);
        compra.giftbackGeradoId = novo.id;
        for (const m of planejarMensagens(novo, config)) {
          const msg = { id: novoId(), clienteId, giftbackId: novo.id, tipo: m.tipo, devidaEm: m.devidaEm, status: 'pendente', enviadaEm: null, origem: 'acker' };
          estado.mensagens.push(msg);
          mensagensNovas.push(msg);
        }
      }
      estado.compras.push(compra);
      salvar();
      return {
        compra, cliente: resumoCliente(cliente), giftbackUsado: r.giftbackAnterior === 'usado' ? atual : null,
        giftbackSubstituido: r.giftbackAnterior === 'substituido' ? atual : null, novoGiftback: novo,
        giftbackMantidoMaior: r.novoDescartado ? atual : null, novoDescartado: r.novoDescartado,
        mensagemEnvio: mensagensNovas.find((m) => m.tipo === 'envio') || null,
      };
    },

    /** Desfaz uma compra lançada errada (só a mais recente do cliente). */
    async cancelarCompra(compraId) {
      const compra = estado.compras.find((c) => c.id === compraId);
      if (!compra || compra.status !== 'ok') throw new Error('Compra não encontrada.');
      // mais recente = maior data; no empate, a que foi gravada por último
      let maisRecente = null;
      for (const c of estado.compras) {
        if (c.clienteId === compra.clienteId && c.status === 'ok' && (!maisRecente || c.data >= maisRecente.data)) maisRecente = c;
      }
      if (maisRecente.id !== compra.id) throw new Error('Só é possível desfazer a compra mais recente do cliente.');
      const porId = (id) => estado.giftbacks.find((g) => g.id === id);
      if (compra.giftbackGeradoId) {
        const g = porId(compra.giftbackGeradoId);
        if (g.status === 'usado') throw new Error('O giftback desta compra já foi usado.');
        g.status = 'cancelado';
        cancelarMensagens(g.id, 'compra cancelada');
        for (const m of estado.mensagens) if (m.giftbackId === g.id && m.status === 'cancelada') m.motivo = 'compra cancelada (definitivo)';
      }
      const voltar = compra.giftbackUsadoId || compra.giftbackSubstituidoId;
      if (voltar) {
        const g = porId(voltar);
        g.status = 'ativo'; g.usadoEm = null; g.compraUsoId = null;
        for (const m of estado.mensagens) {
          if (m.giftbackId === g.id && m.status === 'cancelada' && !String(m.motivo).includes('definitivo')) { m.status = 'pendente'; delete m.motivo; }
        }
      }
      compra.status = 'cancelada';
      compra.canceladaEm = agoraISO();
      salvar();
      expirarVencidos();
    },

    /** Mensagens que já deveriam ter sido enviadas (até hoje) e ainda não foram. */
    async filaMensagens() {
      expirarVencidos();
      const hoje = diaSP(relogio());
      const fila = [];
      for (const m of estado.mensagens) {
        if (m.status !== 'pendente' || m.devidaEm > hoje) continue;
        const giftback = estado.giftbacks.find((g) => g.id === m.giftbackId);
        const cliente = clientePorId(m.clienteId);
        if (!giftback || !cliente || giftback.status !== 'ativo') continue;
        fila.push({ ...m, giftback, cliente });
      }
      return organizarFila(fila, hoje);
    },

    async proximasMensagens(dias = 7) {
      const hoje = diaSP(relogio());
      const limite = new Date(new Date(hoje + 'T12:00:00Z').getTime() + dias * 86400000).toISOString().slice(0, 10);
      return estado.mensagens.filter((m) => m.status === 'pendente' && m.devidaEm > hoje && m.devidaEm <= limite).length;
    },

    /** Marca a mensagem. `substituidas`: mensagens antigas do mesmo giftback que deixam de ser necessárias. */
    async marcarMensagem(id, status, substituidas = []) {
      const m = estado.mensagens.find((x) => x.id === id);
      if (!m) throw new Error('Mensagem não encontrada.');
      if (!['pendente', 'enviada', 'pulada'].includes(status)) throw new Error('Status inválido.');
      m.status = status;
      m.enviadaEm = status === 'enviada' ? agoraISO() : null;
      for (const sid of substituidas) {
        const s = estado.mensagens.find((x) => x.id === sid);
        if (!s) continue;
        if (status === 'pendente') { if (s.status === 'pulada' && s.motivo === 'substituída') { s.status = 'pendente'; delete s.motivo; } }
        else if (s.status === 'pendente') { s.status = 'pulada'; s.motivo = 'substituída'; }
      }
      salvar();
    },

    // Modo teste: "vendas do PDV" vêm de um arquivo de exemplo (dados_migrados/uniplus_exemplo.json).
    async puxarVendasUniplus() {
      const exemplo = carregarExemploUniplus ? await carregarExemploUniplus() : null;
      if (!exemplo) throw new Error('Sem arquivo de exemplo (dados_migrados/uniplus_exemplo.json) no modo teste.');
      const fora = new Set([
        ...estado.compras.filter((c) => c.status === 'ok' && c.uniplusOperacaoId != null).map((c) => c.uniplusOperacaoId),
        ...(estado.ignoradas || []),
      ]);
      return exemplo.vendas
        .filter((v) => !fora.has(v.operacao_id))
        .map((v) => {
          const tel = normalizarTelefone(v.cliente.celular);
          const c = (tel && estado.clientes.find((x) => x.telefone === tel)) || (v.cliente.cpf && estado.clientes.find((x) => x.cpf === v.cliente.cpf)) || null;
          return { ...v, telefone: tel, clienteAcker: c ? resumoCliente(c) : null };
        });
    },

    async ignorarVendaUniplus(operacaoId) {
      estado.ignoradas = [...(estado.ignoradas || []), operacaoId];
      salvar();
    },

    // ───────────── campanhas ─────────────
    async listarCampanhas() {
      return (estado.campanhas || []).slice().reverse().map((c) => {
        const ms = estado.mensagens.filter((m) => m.campanhaId === c.id);
        return { ...c, total: ms.length, enviadas: ms.filter((m) => m.status === 'enviada').length,
          puladas: ms.filter((m) => m.status === 'pulada').length, pendentes: ms.filter((m) => m.status === 'pendente').length };
      });
    },

    async criarCampanha({ nome, texto, publico = '', dataLimite = null, clienteIds }) {
      if (!String(nome || '').trim() || !String(texto || '').trim()) throw new Error('Informe o nome e a mensagem da campanha.');
      if (!clienteIds?.length) throw new Error('Nenhum cliente no grupo escolhido.');
      const c = { id: novoId(), nome: nome.trim(), texto, publico, dataLimite, criadaEm: agoraISO() };
      estado.campanhas = [...(estado.campanhas || []), c];
      const hoje = diaSP(relogio());
      for (const clienteId of clienteIds) {
        estado.mensagens.push({ id: novoId(), clienteId, giftbackId: null, campanhaId: c.id, tipo: 'campanha', devidaEm: hoje, status: 'pendente', enviadaEm: null, origem: 'acker' });
      }
      salvar();
      return c;
    },

    async obterCampanha(id) {
      const campanha = (estado.campanhas || []).find((c) => c.id === id);
      if (!campanha) return null;
      const destinatarios = estado.mensagens.filter((m) => m.campanhaId === id)
        .map((m) => ({ id: m.id, status: m.status, enviadaEm: m.enviadaEm, cliente: clientePorId(m.clienteId) })).filter((d) => d.cliente);
      return { campanha, destinatarios };
    },

    async excluirCampanha(id) {
      estado.campanhas = (estado.campanhas || []).filter((c) => c.id !== id);
      estado.mensagens = estado.mensagens.filter((m) => m.campanhaId !== id);
      salvar();
    },

    /** Compras lançadas hoje (para o resumo da tela do caixa). */
    async resumoDoDia() {
      const hoje = diaSP(relogio());
      const doDia = estado.compras.filter((c) => c.status === 'ok' && c.origem !== 'zoppy' && diaSP(c.data) === hoje);
      const gerados = estado.giftbacks.filter((g) => g.origem !== 'zoppy' && g.status !== 'cancelado' && diaSP(g.criadoEm) === hoje);
      return {
        compras: doDia.length,
        totalCentavos: doDia.reduce((s, c) => s + c.valorFinalCentavos, 0),
        giftbacksGerados: gerados.length,
        giftbacksUsados: doDia.filter((c) => c.giftbackUsadoId).length,
        ultimas: doDia.slice(-5).reverse().map((c) => ({ ...c, cliente: clientePorId(c.clienteId) })),
      };
    },

    /** Quantas mensagens já foram enviadas hoje (para o painel). */
    async enviadasHoje() {
      const hoje = diaSP(relogio());
      return estado.mensagens.filter((m) => m.status === 'enviada' && m.enviadaEm && diaSP(m.enviadaEm) === hoje).length;
    },

    async resumoGeral() {
      expirarVencidos();
      const ativos = estado.giftbacks.filter((g) => g.status === 'ativo');
      return {
        clientes: estado.clientes.length,
        giftbacksAtivos: ativos.filter((g) => g.tipo === 'giftback').length,
        saldoCentavos: ativos.reduce((s, g) => s + g.valorCentavos, 0),
        cuponsResgate: ativos.filter((g) => g.tipo === 'resgate').length,
      };
    },
  };
}
