// dados-supabase.js — Camada de dados ONLINE (Supabase). Mesma interface de dados-local.js.
// O cálculo continua em motor.js; o banco grava tudo de uma vez (funções gb_registrar_compra
// e gb_cancelar_compra) e garante as regras críticas (1 giftback ativo, só a equipe acessa).
import {
  CONFIG_PADRAO, calcularCompra, planejarMensagens, clienteCombina, normalizarTelefone, diaSP, organizarFila, configParaCliente, historicoRegras,
} from './motor.js?v=20261111160442';

const PAGINA = 1000;

// ───────────── conversão banco (snake_case) <-> tela (camelCase) ─────────────
const cliente = (r) => r && ({
  id: r.id, nome: r.nome, sobrenome: r.sobrenome || '', telefone: r.telefone, email: r.email, sexo: r.sexo,
  nascimento: r.nascimento, cpf: r.cpf, uniplusCodigo: r.uniplus_codigo, criadoEm: r.criado_em, origem: r.origem,
  perfil: r.perfil || null,
  excluidoEm: r.excluido_em || null, excluidoPor: r.excluido_por || null, motivoExclusao: r.motivo_exclusao || null,
});
const giftback = (r) => r && ({
  id: r.id, clienteId: r.cliente_id, codigo: r.codigo, tipo: r.tipo, percentual: r.percentual == null ? null : Number(r.percentual),
  valorCentavos: r.valor_centavos, minimoCentavos: r.minimo_centavos, criadoEm: r.criado_em, expiraEm: r.expira_em,
  status: r.status, compraOrigemId: r.compra_origem_id, compraUsoId: r.compra_uso_id, usadoEm: r.usado_em, origem: r.origem,
});
const compra = (r) => r && ({
  id: r.id, clienteId: r.cliente_id, data: r.data, valorCentavos: r.valor_centavos, descontoCentavos: r.desconto_centavos,
  valorFinalCentavos: r.valor_final_centavos, codigoUsado: r.codigo_usado, giftbackUsadoId: r.giftback_usado_id,
  giftbackGeradoId: r.giftback_gerado_id, giftbackSubstituidoId: r.giftback_substituido_id, status: r.status, origem: r.origem,
});
const campanha = (r) => r && ({
  id: r.id, nome: r.nome, texto: r.texto, publico: r.publico, dataLimite: r.data_limite, criadaEm: r.criada_em,
});
const mensagem = (r) => r && ({
  id: r.id, clienteId: r.cliente_id, giftbackId: r.giftback_id, tipo: r.tipo, devidaEm: r.devida_em,
  status: r.status, enviadaEm: r.enviada_em, origem: r.origem,
});

function erro(e) {
  if (!e) return null;
  const msg = e.message || String(e);
  if (/duplicate key.*telefone/i.test(msg)) return new Error('Já existe um cliente com este telefone.');
  if (/gb_giftbacks_um_ativo_por_cliente/.test(msg)) return new Error('Este cliente já tem um giftback ativo. Abra o cliente de novo.');
  if (/JWT|session|not authenticated/i.test(msg)) return new Error('Sua sessão expirou. Entre de novo.');
  return new Error(msg);
}
const ok = ({ data, error }) => { if (error) throw erro(error); return data; };

export function criarDadosSupabase({ supabase, relogio = () => new Date() }) {
  let resumos = []; // gb_clientes_resumo em memória (600 linhas: rápido de buscar), sem os excluídos
  let excluidos = []; // clientes excluídos (guardados com data, quem e motivo)
  let ativos = new Map(); // clienteId -> giftback ativo
  let configSalva = null;

  async function todos(consulta) {
    const linhas = [];
    for (let de = 0; ; de += PAGINA) {
      const parte = ok(await consulta().range(de, de + PAGINA - 1));
      linhas.push(...parte);
      if (parte.length < PAGINA) return linhas;
    }
  }

  async function recarregar() {
    await supabase.rpc('gb_expirar_vencidos');
    const [r, g] = await Promise.all([
      todos(() => supabase.from('gb_clientes_resumo').select('*').order('id')),
      todos(() => supabase.from('gb_giftbacks').select('*').eq('status', 'ativo').order('id')),
    ]);
    resumos = r.filter((x) => !x.excluido_em);
    excluidos = r.filter((x) => x.excluido_em);
    ativos = new Map(g.map((x) => [x.cliente_id, giftback(x)]));
  }

  const resumo = (r) => ({
    ...cliente(r), giftback: ativos.get(r.id) || null, compras: r.compras, totalCentavos: Number(r.total_centavos),
    ultimaCompra: r.ultima_compra, primeiraCompra: r.primeira_compra || null,
  });

  function configAtual() {
    const c = configSalva || {};
    return { ...CONFIG_PADRAO, ...c, modelos: { ...CONFIG_PADRAO.modelos, ...(c.modelos || {}) } };
  }

  async function giftbackAtivoAgora(clienteId) {
    await supabase.rpc('gb_expirar_vencidos');
    const linhas = ok(await supabase.from('gb_giftbacks').select('*').eq('cliente_id', clienteId).eq('status', 'ativo'));
    return giftback(linhas[0]) || null;
  }

  return {
    modo: 'online',

    // ───────────── login ─────────────
    async sessao() {
      const { data } = await supabase.auth.getSession();
      return data.session || null;
    },
    async entrar(email, senha) {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
      if (error) throw new Error(/confirm/i.test(error.message) ? 'Confirme o e-mail primeiro (veja a caixa de entrada).' : 'E-mail ou senha incorretos.');
    },
    async criarAcesso(email, senha, voltarPara) {
      const { error } = await supabase.auth.signUp({ email: email.trim(), password: senha, options: { emailRedirectTo: voltarPara } });
      if (error) throw erro(error);
    },
    async recuperarSenha(email, voltarPara) {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: voltarPara });
      if (error) throw erro(error);
    },
    async trocarSenha(senha) {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw erro(error);
    },
    async sair() { await supabase.auth.signOut(); },
    async ehEquipe() {
      const { data, error } = await supabase.rpc('gb_e_equipe');
      return !error && data === true;
    },
    aoMudarSessao(fn) { return supabase.auth.onAuthStateChange((evento, sessao) => fn(evento, sessao)); },

    // ───────────── dados ─────────────
    async iniciar() {
      const linhas = ok(await supabase.from('gb_config').select('valor').eq('chave', 'geral'));
      configSalva = linhas[0]?.valor || null;
      await recarregar();
    },

    async obterConfig() { return configAtual(); },

    async salvarConfig(nova) {
      const valor = { ...(configSalva || {}), ...nova, modelos: { ...(configSalva?.modelos || {}), ...(nova.modelos || {}) } };
      ok(await supabase.from('gb_config').upsert({ chave: 'geral', valor, atualizado_em: new Date().toISOString() }));
      configSalva = valor;
      return configAtual();
    },

    async buscarClientes(busca, limite = 30) {
      const q = String(busca || '').trim().toLowerCase();
      if (!q) return [];
      const codigo = q.replace(/\s/g, '');
      const porCodigo = [...ativos.values()].find((g) => g.codigo.toLowerCase() === codigo);
      const achados = [];
      if (porCodigo) { const r = resumos.find((x) => x.id === porCodigo.clienteId); if (r) achados.push(r); }
      for (const r of resumos) {
        if (achados.length >= limite) break;
        if (r.id !== porCodigo?.clienteId && clienteCombina(r, q)) achados.push(r);
      }
      return achados.map(resumo).sort((a, b) => (b.ultimaCompra || '').localeCompare(a.ultimaCompra || ''));
    },

    async listarClientes() {
      await recarregar();
      return resumos.map(resumo);
    },

    async obterCliente(id) {
      const [linha, compras, gifts, msgs] = await Promise.all([
        supabase.from('gb_clientes_resumo').select('*').eq('id', id).maybeSingle().then(ok),
        supabase.from('gb_compras').select('*').eq('cliente_id', id).order('data', { ascending: false }).order('seq', { ascending: false }).then(ok),
        supabase.from('gb_giftbacks').select('*').eq('cliente_id', id).order('criado_em', { ascending: false }).then(ok),
        supabase.from('gb_mensagens').select('*').eq('cliente_id', id).order('devida_em', { ascending: false }).then(ok),
      ]);
      if (!linha) return null;
      const g = gifts.map(giftback);
      const ativo = g.find((x) => x.status === 'ativo' && new Date(x.expiraEm) >= relogio()) || null;
      if (ativo) ativos.set(id, ativo); else ativos.delete(id);
      const i = resumos.findIndex((x) => x.id === id);
      if (i >= 0) resumos[i] = linha; else resumos.push(linha);
      return { ...resumo(linha), giftback: ativo, historicoCompras: compras.map(compra), historicoGiftbacks: g, historicoMensagens: (Array.isArray(msgs) ? msgs : []).map(mensagem) };
    },

    async clientePorTelefone(telefone) {
      const tel = normalizarTelefone(telefone);
      if (!tel) return null;
      const r = ok(await supabase.from('gb_clientes_resumo').select('*').eq('telefone', tel).maybeSingle());
      return r ? resumo(r) : null; // pode vir um excluído (excluidoEm preenchido): a tela oferece restaurar
    },

    async criarCliente({ nome, sobrenome = '', telefone, sexo = null, email = null, cpf = null, uniplusCodigo = null, perfil = null }) {
      const tel = normalizarTelefone(telefone);
      if (!tel) throw new Error('Telefone inválido. Informe DDD + número.');
      if (!String(nome || '').trim()) throw new Error('Informe o nome do cliente.');
      const r = ok(await supabase.from('gb_clientes').insert({
        nome: nome.trim(), sobrenome: String(sobrenome || '').trim(), telefone: tel, sexo: sexo || null,
        email: email || null, cpf: cpf || null, uniplus_codigo: uniplusCodigo, perfil: perfil || null,
      }).select().single());
      const linha = { ...r, compras: 0, total_centavos: 0, ultima_compra: null };
      resumos.push(linha);
      return resumo(linha);
    },

    /** Exclui o cliente com segurança: fica guardado (data, quem, motivo), sai das listas e pode ser restaurado. */
    async excluirCliente(id, motivo) {
      if (!String(motivo || '').trim()) throw new Error('Informe o motivo da exclusão.');
      ok(await supabase.rpc('gb_excluir_cliente', { p_cliente: id, p_motivo: motivo }));
      await recarregar();
    },

    async listarExcluidos() {
      await recarregar();
      return excluidos.map(resumo).sort((a, b) => String(b.excluidoEm).localeCompare(String(a.excluidoEm)));
    },

    async restaurarCliente(id) {
      ok(await supabase.rpc('gb_restaurar_cliente', { p_cliente: id }));
      await recarregar();
    },

    /** Apaga de vez (só cliente que já está excluído). Use só para clientes de teste. */
    async apagarClienteDeVez(id) {
      ok(await supabase.rpc('gb_apagar_cliente_de_vez', { p_cliente: id }));
      await recarregar();
    },

    async atualizarCliente(id, dados) {
      const mudar = {};
      if (dados.telefone != null) {
        const tel = normalizarTelefone(dados.telefone);
        if (!tel) throw new Error('Telefone inválido. Informe DDD + número.');
        mudar.telefone = tel;
      }
      for (const campo of ['nome', 'sobrenome', 'sexo', 'email', 'nascimento', 'cpf', 'perfil']) {
        if (campo in dados) mudar[campo] = typeof dados[campo] === 'string' ? dados[campo].trim() || null : dados[campo];
      }
      if ('nome' in mudar && !mudar.nome) throw new Error('Informe o nome do cliente.');
      if ('sobrenome' in mudar && mudar.sobrenome == null) mudar.sobrenome = '';
      ok(await supabase.from('gb_clientes').update(mudar).eq('id', id));
      return this.obterCliente(id);
    },

    async lancarCompra({ clienteId, valorCentavos, usarGiftback = false, data = null, uniplusOperacaoId = null, itensExcluidos = null, percentual = null }) {
      let linhaCliente = resumos.find((r) => r.id === clienteId);
      if (!linhaCliente) linhaCliente = ok(await supabase.from('gb_clientes').select('perfil').eq('id', clienteId).maybeSingle());
      const doCliente = configParaCliente(configAtual(), linhaCliente); // perfil especial pode ter % e mínimo próprios
      const config = percentual ? { ...doCliente, percentual: Number(percentual) } : doCliente; // % só desta venda
      const agora = data ? new Date(data) : relogio(); // venda do Uniplus: vale a data/hora da venda
      const atual = await giftbackAtivoAgora(clienteId); // sempre do banco, nunca da tela
      const r = calcularCompra({ valorCentavos, giftbackAtivo: atual, usarGiftback, config, agora });
      const mensagens = r.novoGiftback
        ? planejarMensagens({ criadoEm: agora.toISOString(), expiraEm: r.novoGiftback.expiraEm }, config).map((m) => ({ tipo: m.tipo, devida_em: m.devidaEm }))
        : [];
      const res = ok(await supabase.rpc('gb_registrar_compra', {
        p: {
          cliente_id: clienteId, giftback_atual_id: atual?.id || null, acao_anterior: r.giftbackAnterior,
          valor_centavos: valorCentavos, desconto_centavos: r.descontoCentavos, valor_final_centavos: r.valorFinalCentavos,
          novo: r.novoGiftback ? { valor_centavos: r.novoGiftback.valorCentavos, minimo_centavos: r.novoGiftback.minimoCentavos, expira_em: r.novoGiftback.expiraEm, prefixo: config.prefixoCodigo } : null,
          mensagens,
          data: data ? agora.toISOString() : null,
          uniplus_operacao_id: uniplusOperacaoId,
          itens_excluidos: itensExcluidos,
        },
      }));
      const [c, novo, envio] = await Promise.all([
        supabase.from('gb_compras').select('*').eq('id', res.compra_id).single().then(ok),
        res.giftback_id ? supabase.from('gb_giftbacks').select('*').eq('id', res.giftback_id).single().then(ok) : null,
        res.giftback_id ? supabase.from('gb_mensagens').select('*').eq('giftback_id', res.giftback_id).eq('tipo', 'envio').maybeSingle().then(ok) : null,
      ]);
      const cli = await this.obterCliente(clienteId);
      return {
        compra: compra(c), cliente: cli,
        giftbackUsado: r.giftbackAnterior === 'usado' ? atual : null,
        giftbackSubstituido: r.giftbackAnterior === 'substituido' ? atual : null,
        giftbackMantidoMaior: r.novoDescartado ? atual : null, novoDescartado: r.novoDescartado,
        novoGiftback: giftback(novo), mensagemEnvio: mensagem(envio),
      };
    },

    async cancelarCompra(compraId) {
      ok(await supabase.rpc('gb_cancelar_compra', { p_compra: compraId }));
      await recarregar();
    },

    async filaMensagens() {
      await supabase.rpc('gb_expirar_vencidos');
      const hoje = diaSP(relogio());
      const linhas = await todos(() => supabase.from('gb_mensagens')
        .select('*, giftback:gb_giftbacks(*), cliente:gb_clientes(*)')
        .eq('status', 'pendente').lte('devida_em', hoje).order('id'));
      const fila = linhas
        .filter((m) => m.giftback?.status === 'ativo' && m.cliente)
        .map((m) => ({ ...mensagem(m), giftback: giftback(m.giftback), cliente: cliente(m.cliente) }));
      return organizarFila(fila, hoje);
    },

    async proximasMensagens(dias = 7) {
      const hoje = diaSP(relogio());
      const limite = new Date(new Date(hoje + 'T12:00:00Z').getTime() + dias * 86400000).toISOString().slice(0, 10);
      const { count, error } = await supabase.from('gb_mensagens').select('id', { count: 'exact', head: true })
        .eq('status', 'pendente').gt('devida_em', hoje).lte('devida_em', limite);
      if (error) throw erro(error);
      return count || 0;
    },

    /** Marca a mensagem. `substituidas`: mensagens antigas do mesmo giftback que deixam de ser necessárias. */
    async marcarMensagem(id, status, substituidas = []) {
      if (!['pendente', 'enviada', 'pulada'].includes(status)) throw new Error('Status inválido.');
      const { data } = await supabase.auth.getUser();
      ok(await supabase.from('gb_mensagens').update({
        status, enviada_em: status === 'enviada' ? new Date().toISOString() : null,
        enviada_por: status === 'enviada' ? data.user?.email || null : null,
      }).eq('id', id));
      if (substituidas.length) {
        if (status === 'pendente') {
          ok(await supabase.from('gb_mensagens').update({ status: 'pendente', motivo: null })
            .in('id', substituidas).eq('status', 'pulada').eq('motivo', 'substituída'));
        } else {
          ok(await supabase.from('gb_mensagens').update({ status: 'pulada', motivo: 'substituída' })
            .in('id', substituidas).eq('status', 'pendente'));
        }
      }
    },

    // ───────────── campanhas ─────────────
    async listarCampanhas() {
      const [camps, msgs] = await Promise.all([
        supabase.from('gb_campanhas').select('*').order('criada_em', { ascending: false }).then(ok),
        todos(() => supabase.from('gb_mensagens').select('campanha_id, status').not('campanha_id', 'is', null).order('id')),
      ]);
      return camps.map((c) => {
        const ms = msgs.filter((m) => m.campanha_id === c.id);
        return { ...campanha(c), total: ms.length, enviadas: ms.filter((m) => m.status === 'enviada').length,
          puladas: ms.filter((m) => m.status === 'pulada').length, pendentes: ms.filter((m) => m.status === 'pendente').length };
      });
    },

    async criarCampanha({ nome, texto, publico = '', dataLimite = null, clienteIds }) {
      if (!String(nome || '').trim() || !String(texto || '').trim()) throw new Error('Informe o nome e a mensagem da campanha.');
      if (!clienteIds?.length) throw new Error('Nenhum cliente no grupo escolhido.');
      const c = ok(await supabase.from('gb_campanhas').insert({ nome: nome.trim(), texto, publico, data_limite: dataLimite }).select().single());
      const hoje = diaSP(relogio());
      const linhas = clienteIds.map((cliente_id) => ({ cliente_id, campanha_id: c.id, tipo: 'campanha', devida_em: hoje, status: 'pendente' }));
      for (let i = 0; i < linhas.length; i += 500) ok(await supabase.from('gb_mensagens').insert(linhas.slice(i, i + 500)));
      return campanha(c);
    },

    async obterCampanha(id) {
      const c = ok(await supabase.from('gb_campanhas').select('*').eq('id', id).maybeSingle());
      if (!c) return null;
      const ms = await todos(() => supabase.from('gb_mensagens').select('*, cliente:gb_clientes(*)').eq('campanha_id', id).order('id'));
      return {
        campanha: campanha(c),
        destinatarios: ms.filter((m) => m.cliente).map((m) => ({ id: m.id, status: m.status, enviadaEm: m.enviada_em, cliente: cliente(m.cliente) }))
          .sort((a, b) => `${a.cliente.nome} ${a.cliente.sobrenome}`.localeCompare(`${b.cliente.nome} ${b.cliente.sobrenome}`, 'pt-BR')),
      };
    },

    async excluirCampanha(id) {
      ok(await supabase.from('gb_campanhas').delete().eq('id', id));
    },

    /** Clientes que compraram mais recentemente (lista da tela inicial do caixa). Usa a lista já carregada. */
    async clientesRecentes(n = 8) {
      return resumos.filter((r) => r.ultima_compra).sort((a, b) => String(b.ultima_compra).localeCompare(String(a.ultima_compra))).slice(0, n).map(resumo);
    },

    /** Compras lançadas hoje (para o resumo da tela do caixa). */
    async resumoDoDia() {
      const hoje = diaSP(relogio());
      const desde = `${hoje}T00:00:00-03:00`;
      const [compras, gerados] = await Promise.all([
        supabase.from('gb_compras').select('*, cliente:gb_clientes(nome, sobrenome)').eq('status', 'ok').gte('data', desde).order('data', { ascending: false }).then(ok),
        supabase.from('gb_giftbacks').select('id', { count: 'exact', head: true }).neq('status', 'cancelado').gte('criado_em', desde)
          .then(({ count, error }) => { if (error) throw erro(error); return count || 0; }),
      ]);
      return {
        compras: compras.length,
        totalCentavos: compras.reduce((s, c) => s + c.valor_final_centavos, 0),
        giftbacksGerados: gerados,
        giftbacksUsados: compras.filter((c) => c.giftback_usado_id).length,
        ultimas: compras.slice(0, 5).map((c) => ({ ...compra(c), cliente: c.cliente })),
      };
    },

    /** Mensagens de giftback dos últimos dias e as futuras (enviadas, puladas e na fila), para conferência. */
    async historicoMensagens(diasAtras = 45) {
      const desde = new Date(relogio().getTime() - diasAtras * 86400000).toISOString().slice(0, 10);
      const linhas = await todos(() => supabase.from('gb_mensagens')
        .select('*, giftback:gb_giftbacks(*), cliente:gb_clientes(*)')
        .in('status', ['pendente', 'enviada', 'pulada']).not('giftback_id', 'is', null).gte('devida_em', desde).order('id'));
      return linhas
        .filter((m) => m.cliente && !m.cliente.excluido_em && m.giftback)
        .map((m) => ({ ...mensagem(m), enviadaPor: m.enviada_por || null, giftback: giftback(m.giftback), cliente: cliente(m.cliente) }))
        .sort((a, b) => b.devidaEm.localeCompare(a.devidaEm));
    },

    /** Cópia de segurança: todas as tabelas do Giftback Acker num arquivo só. */
    async exportarTudo() {
      const tabelas = { gb_clientes: 'id', gb_compras: 'id', gb_giftbacks: 'id', gb_mensagens: 'id', gb_campanhas: 'id', gb_config: 'chave', gb_uniplus_ignoradas: 'operacao_id' };
      const copia = { geradoEm: new Date().toISOString(), origem: 'supabase giftback-acker' };
      for (const [tabela, chave] of Object.entries(tabelas)) copia[tabela] = await todos(() => supabase.from(tabela).select('*').order(chave));
      copia.historicoRegras = historicoRegras(configAtual()); // inclui o padrão da Zoppy, mesmo que as regras nunca tenham sido alteradas
      return copia;
    },

    /** Cópia automática do dia (feita no banco, 1 por dia, guardada 14 dias). Devolve true se criou agora. */
    async copiaDiaria() {
      return ok(await supabase.rpc('gb_copia_diaria')) === true;
    },

    /** Lista das cópias automáticas guardadas (sem o conteúdo, que é grande). */
    async listarCopias() {
      return ok(await supabase.from('gb_copias').select('dia, criada_em, criada_por, resumo').order('dia', { ascending: false }))
        .map((r) => ({ dia: r.dia, criadaEm: r.criada_em, criadaPor: r.criada_por, resumo: r.resumo || {} }));
    },

    /** Conteúdo de uma cópia automática, para baixar. */
    async baixarCopia(dia) {
      const r = ok(await supabase.from('gb_copias').select('dados').eq('dia', dia).maybeSingle());
      if (!r) throw new Error('Cópia não encontrada.');
      return { ...r.dados, historicoRegras: historicoRegras(configAtual()) };
    },

    /** Quantas mensagens já foram enviadas hoje (para o painel). */
    async enviadasHoje() {
      const hoje = diaSP(relogio());
      const { count, error } = await supabase.from('gb_mensagens').select('id', { count: 'exact', head: true })
        .eq('status', 'enviada').gte('enviada_em', `${hoje}T00:00:00-03:00`);
      if (error) throw erro(error);
      return count || 0;
    },

    async resumoGeral() {
      const lista = [...ativos.values()];
      return {
        clientes: resumos.length,
        giftbacksAtivos: lista.filter((g) => g.tipo === 'giftback').length,
        saldoCentavos: lista.reduce((s, g) => s + g.valorCentavos, 0),
        cuponsResgate: lista.filter((g) => g.tipo === 'resgate').length,
      };
    },

    // ───────────── vendas do Uniplus (Edge Function gb-uniplus) ─────────────
    /**
     * Busca as vendas recentes no Uniplus e devolve só as que ainda não foram lançadas nem ignoradas,
     * já com o cliente do Giftback Acker correspondente (pelo celular ou CPF), se existir.
     */
    async puxarVendasUniplus(dias = 3) {
      const cfg = ok(await supabase.from('gb_config').select('valor').eq('chave', 'uniplus'))[0]?.valor || {};
      const { data, error } = await supabase.functions.invoke('gb-uniplus', { body: { dias, chute_id: cfg.ultimo_id || 49000 } });
      if (error) {
        let msg = error.message;
        try { msg = (await error.context.json()).erro || msg; } catch { /* sem corpo */ }
        if (/401|Unauthorized|JWT/i.test(msg)) msg = 'O Supabase recusou o login na função gb-uniplus. Veja docs/06-uniplus-vendas.md (configuração "Verify JWT").';
        throw new Error(msg);
      }
      if (data?.erro) throw new Error(data.erro);
      ok(await supabase.from('gb_config').upsert({ chave: 'uniplus', valor: { ...cfg, ultimo_id: data.ultimo_id, ultima_busca: new Date().toISOString() } }));
      const ids = data.vendas.map((v) => v.operacao_id);
      const [lancadas, ignoradas] = ids.length ? await Promise.all([
        supabase.from('gb_compras').select('uniplus_operacao_id').in('uniplus_operacao_id', ids).then(ok),
        supabase.from('gb_uniplus_ignoradas').select('operacao_id').in('operacao_id', ids).then(ok),
      ]) : [[], []];
      const fora = new Set([...lancadas.map((x) => Number(x.uniplus_operacao_id)), ...ignoradas.map((x) => Number(x.operacao_id))]);
      await recarregar();
      const porTelefone = new Map(resumos.map((r) => [r.telefone, r]));
      const porCpf = new Map(resumos.filter((r) => r.cpf).map((r) => [String(r.cpf).replace(/\D/g, ''), r]));
      return data.vendas
        .filter((v) => !fora.has(Number(v.operacao_id)))
        .map((v) => {
          const tel = normalizarTelefone(v.cliente.celular);
          const r = (v.cliente.cpf && porCpf.get(v.cliente.cpf)) || (tel && porTelefone.get(tel)) || null;
          return { ...v, telefone: tel, clienteAcker: r ? resumo(r) : null };
        })
        .sort((a, b) => String(b.hora).localeCompare(String(a.hora)));
    },

    async ignorarVendaUniplus(operacaoId, motivo = null) {
      ok(await supabase.from('gb_uniplus_ignoradas').upsert({ operacao_id: operacaoId, motivo }));
    },

    // ───────────── importação da Zoppy (arquivo dados_migrados/seed.json) ─────────────
    async contarClientes() {
      const { count, error } = await supabase.from('gb_clientes').select('id', { count: 'exact', head: true });
      if (error) throw erro(error);
      return count || 0;
    },

    async importarSeed(seed, progresso = () => {}) {
      if (!seed || !Array.isArray(seed.clientes)) throw new Error('Arquivo inválido. Use o seed.json da pasta dados_migrados.');
      if ((await this.contarClientes()) > 0) throw new Error('O banco já tem clientes. Para importar de novo, apague tudo antes.');
      const lotes = async (tabela, linhas, nome) => {
        for (let i = 0; i < linhas.length; i += 500) {
          ok(await supabase.from(tabela).insert(linhas.slice(i, i + 500)));
          progresso(`${nome}: ${Math.min(i + 500, linhas.length)} de ${linhas.length}`);
        }
      };
      await lotes('gb_clientes', seed.clientes.map((c) => ({
        id: c.id, nome: c.nome || '(sem nome)', sobrenome: c.sobrenome || '', telefone: c.telefone, email: c.email,
        sexo: c.sexo, nascimento: c.nascimento, cpf: c.cpf, uniplus_codigo: c.uniplusCodigo, criado_em: c.criadoEm, origem: 'zoppy',
      })), 'Clientes');
      await lotes('gb_giftbacks', seed.giftbacks.map((g) => ({
        id: g.id, cliente_id: g.clienteId, codigo: g.codigo, tipo: g.tipo, percentual: g.percentual,
        valor_centavos: g.valorCentavos, minimo_centavos: g.minimoCentavos, criado_em: g.criadoEm, expira_em: g.expiraEm,
        status: g.status, origem: 'zoppy',
      })), 'Giftbacks');
      await lotes('gb_compras', seed.compras.map((c) => ({
        id: c.id, cliente_id: c.clienteId, data: c.data, valor_centavos: c.valorCentavos, desconto_centavos: c.descontoCentavos,
        valor_final_centavos: c.valorFinalCentavos, codigo_usado: c.codigoUsado, status: c.status, origem: 'zoppy', operador: null,
      })), 'Compras');
      await lotes('gb_mensagens', seed.mensagens.map((m) => ({
        id: m.id, cliente_id: m.clienteId, giftback_id: m.giftbackId, tipo: m.tipo, devida_em: m.devidaEm,
        status: m.status, origem: m.origem,
      })), 'Mensagens');
      if (seed.config) await this.salvarConfig(seed.config);
      await recarregar();
    },

    async apagarTudo() {
      ok(await supabase.rpc('gb_apagar_tudo', { confirmacao: 'APAGAR TUDO' }));
      await recarregar();
    },
  };
}
