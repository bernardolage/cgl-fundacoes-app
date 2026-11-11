/* ====================================================================
   js/dash_explica.js — "o que é este número" da Sala de Comando (fase 164).
   Carregado antes de js/dashboard.js. Só dados e funções puras: nada aqui lê o banco, guarda estado ou liga evento.

   DASH_EXPLICA: chave → { regra, fazer, origem }, em linguagem de quem usa a tela.
     - "Para regularizar": a chave é o filtro que a linha traz.
     - "Exige ação hoje" e "Minha fila": fonte:ordem, com :nível quando a mesma ordem dá dois títulos.
   Quem mudar o prazo ou a regra de uma pendência da Sala muda o texto aqui na mesma entrega, e a linha do anexo
   docs/specs/fase-164-textos.md, que guarda a origem técnica de cada texto (este arquivo não cita objeto do banco).
   Pendência sem texto conferido fica fora do dicionário: a linha sai sem o "?" e a tela mostra o contador como antes.
   ==================================================================== */
const DASH_EXPLICA = {
  /* ---------- Exige ação hoje ---------- */
  "acoes:10:critico": { regra: "Obras em andamento com 7 dias corridos ou mais desde o último RDO. Sem nenhum RDO, a conta parte da data de início da obra (ou do dia do cadastro, se não houver data de início).",
    fazer: "Lançar os diários; se a obra parou, mudar o status dela.", origem: "Dos RDOs e do cadastro das obras em andamento." },
  "acoes:10:atencao": { regra: "A mesma conta do alerta de 7 dias, para obras em andamento com 3 a 6 dias corridos sem RDO.",
    fazer: "Lançar os diários dos dias que faltam.", origem: "Dos RDOs e do cadastro das obras em andamento." },
  "acoes:12": { regra: "Obras em andamento sem nenhuma estaca no cadastro (Refurada não conta) e sem meta de estacas.",
    fazer: "Importar o projeto na aba Estacas ou informar a meta de estacas na aba Parâmetros da obra.", origem: "Do cadastro de estacas e da meta das obras em andamento." },
  "acoes:13": { regra: "Obras em andamento em que as estacas executadas já alcançaram as previstas: as do cadastro, sem contar Refurada, ou a meta quando não há cadastro.",
    fazer: "Concluir a obra, ou cadastrar as estacas que ainda faltam no projeto.", origem: "Do cadastro de estacas das obras em andamento." },
  "acoes:14": { regra: "Medições com valor de NF informado que difere do valor produzido por mais que o maior entre 50 reais e 1 % da NF (medição rejeitada não entra). Fica crítico quando a medição foi criada há mais de 15 dias.",
    fazer: "Lançar no RDO a produção que a NF já cobrou, ou corrigir a medição.", origem: "Das medições: o valor da NF comparado com o valor final medido." },
  "acoes:15": { regra: "Execuções de RDO, em obras em andamento, que não apontam para uma estaca do cadastro (refuro não entra). O número conta execuções, não obras.",
    fazer: "Abrir a aba Estacas da obra e vincular ou cadastrar a estaca.", origem: "Das execuções lançadas nos RDOs." },
  "acoes:20": { regra: "Perfuratrizes e bate-estacas ativos com mobilização em obra, chegada há 3 dias ou mais, e sem produção lançada há 3 dias ou mais (ou nunca).",
    fazer: "Lançar o RDO da máquina, ou atualizar a mobilização se ela já saiu da obra.", origem: "Das mobilizações e da produção lançada nos RDOs." },
  "acoes:21:critico": { regra: "Ordens de serviço de manutenção agendadas ou em andamento com a data prevista já passada.",
    fazer: "Concluir a OS ou remarcar a data prevista.", origem: "Das ordens de serviço de manutenção." },
  "acoes:21:observar": { regra: "Ordens de serviço de manutenção agendadas ou em andamento, sem data prevista, abertas há mais de 30 dias.",
    fazer: "Informar a data prevista ou encerrar a OS.", origem: "Das ordens de serviço de manutenção." },
  "acoes:30": { regra: "Medições com status Enviada sem nenhuma alteração há mais de 15 dias. Fica crítico depois de 30 dias.",
    fazer: "Cobrar o cliente e registrar a aprovação.", origem: "Das medições." },
  "acoes:31": { regra: "Medições aprovadas, sem número de NF, sem alteração há mais de 5 dias.",
    fazer: "Emitir a NFS-e da medição.", origem: "Das medições." },
  "acoes:32": { regra: "Títulos a pagar ainda não exportados para o financeiro: os já vencidos ficam em crítico e os que vencem em até 3 dias, em atenção.",
    fazer: "Exportar o lote de títulos em Contratos.", origem: "Dos títulos a pagar." },
  "acoes:33": { regra: "Medições em rascunho sem alteração há mais de 5 dias.",
    fazer: "Terminar e enviar a medição, ou excluir o rascunho.", origem: "Das medições." },
  "acoes:40": { regra: "Pedidos de compra aguardando aprovação criados há mais de 2 dias.",
    fazer: "Aprovar ou devolver o pedido.", origem: "Dos pedidos de compra." },
  "acoes:41": { regra: "Requisições de material pendentes criadas há mais de 3 dias.",
    fazer: "Atender, transformar em pedido ou recusar.", origem: "Das requisições de material." },
  "acoes:42": { regra: "Pedidos em cotação sem movimento, no pedido ou nas cotações dele, há mais do que o prazo configurado.",
    fazer: "Fechar a cotação ou cobrar o fornecedor.", origem: "Dos pedidos de compra em cotação." },
  "acoes:43": { regra: "Recebimentos confirmados de pedidos que exigem conferência de quem pediu, ainda sem conferência depois do prazo configurado, em dias úteis.",
    fazer: "O solicitante confere o que chegou e registra a conferência.", origem: "Dos recebimentos de compras." },
  "acoes:44": { regra: "Saídas de estoque que saíram a custo zero e não foram estornadas. O número conta saídas.",
    fazer: "Em Produtos, na visão Saídas sem custo, definir o custo do produto ou revalorar as saídas.", origem: "Das movimentações de estoque." },
  "acoes:50": { regra: "Pendências de mobilização não concluídas com o prazo já passado.",
    fazer: "Concluir a pendência ou ajustar o prazo.", origem: "Das pendências das mobilizações." },
  "acoes:60": { regra: "Chamados de prioridade 1 abertos ou em análise.",
    fazer: "Tratar antes de qualquer outro chamado.", origem: "Dos chamados." },
  "acoes:61": { regra: "Chamados ainda com status Aberto criados há mais de 7 dias.",
    fazer: "Triar: classificar e responder.", origem: "Dos chamados." },
  "acoes:70": { regra: "Contratos com a pendência indicada no título: sem assinatura, aditivo pendente de assinatura, aditivo assinado com valor a conferir, valor provisório, quadro de orçamento lido em parte, valor diferente da soma dos orçamentos, saldo negativo (medido acima do contratado) ou produção pendente em medição. O nível vem da gravidade da pendência.",
    fazer: "Abrir a aba Contrato da obra e resolver a pendência.", origem: "Dos contratos, aditivos, orçamentos e medições." },
  "acoes:71": { regra: "Orçamentos enviados ou em negociação cuja validade termina nos próximos 7 dias.",
    fazer: "Falar com o cliente ou renovar a validade.", origem: "Dos orçamentos." },
  "acoes:72": { regra: "Contratos de fornecedor vigentes com o fim previsto já passado (crítico) ou dentro do aviso de vencimento do contrato, que é de 30 dias quando o contrato não informa (atenção).",
    fazer: "Renovar, aditar ou encerrar o contrato.", origem: "Dos contratos de fornecedor." },
  "assinar": { regra: "Pedido de compra aguardando aprovação em que a assinatura de dono do custo cabe a você e ainda não foi dada: como responsável da obra, gestor da máquina, responsável do centro de custo ou dos acessórios.",
    fazer: "Abrir o pedido e assinar ou recusar.", origem: "Das aprovações pendentes dos pedidos de compra." },
  "sep:45": { regra: "Separações de material abertas, em separação ou separadas com o prazo já passado.",
    fazer: "Separar e entregar, ou ajustar o prazo.", origem: "Das separações de material." },
  "sep:46": { regra: "Separações de material abertas ou em separação sem responsável indicado.",
    fazer: "Indicar quem separa.", origem: "Das separações de material." },
  "fab:50": { regra: "Ordens de fabricação em produção iniciadas há mais de 30 dias. Sem data de início, vale a data de abertura.",
    fazer: "Concluir ou revisar a ordem.", origem: "Das ordens de fabricação." },
  "fin:34": { regra: "Cauções abertas ou parciais com a previsão de devolução já passada. O número conta cauções; o valor no título é a soma do saldo delas.",
    fazer: "Cobrar a devolução do cliente ou corrigir a previsão.", origem: "Das cauções das medições." },
  "fin:35": { regra: "Cauções abertas ou parciais com devolução prevista de hoje até 30 dias. O número conta cauções; o valor no título é a soma do saldo delas.",
    fazer: "Preparar a cobrança.", origem: "Das cauções das medições." },
  "fin:36": { regra: "Medições aprovadas ou faturadas, com NF, vencimento já passado e saldo a receber. O número conta medições; o valor no título é a soma do líquido a receber menos o já recebido.",
    fazer: "Cobrar o cliente e registrar o recebimento.", origem: "Das medições com NF." },
  "fin:37": { regra: "Parcelas de venda de bens vencidas e não recebidas (venda cancelada não entra). O número conta parcelas; o valor no título é a soma do saldo delas.",
    fazer: "Cobrar o comprador.", origem: "Das parcelas das vendas de bens." },
  "fin:38": { regra: "Parcelas de venda de bens em aberto que vencem de hoje até 7 dias. O número conta parcelas; o valor no título é a soma do saldo delas.",
    fazer: "Avisar o comprador.", origem: "Das parcelas das vendas de bens." },
  "fin:39": { regra: "Permutas em que o crédito já lançado passou do valor do imóvel. O número conta permutas; o valor no título é a soma do que passou.",
    fazer: "Rever a permuta com a diretoria e negociar o acerto do excedente.", origem: "Das permutas e dos créditos lançados nelas." },
  "fin:40": { regra: "Permutas com o prazo para executar já passado e ainda com saldo a executar. O número conta permutas; o valor no título é a soma desse saldo.",
    fazer: "Renegociar o prazo ou executar o saldo.", origem: "Das permutas e dos créditos lançados nelas." },
  "fin:41": { regra: "Permutas com saldo a executar cujo prazo vence em até 90 dias. O número conta permutas; o valor no título é a soma desse saldo.",
    fazer: "Programar a execução.", origem: "Das permutas e dos créditos lançados nelas." },
  "man:22": { regra: "Máquinas ativas com item do plano de manutenção preventiva já vencido: passou das horas, dos quilômetros ou da data. O número conta máquinas; no detalhe, entre parênteses, quantos itens em cada uma.",
    fazer: "Abrir a OS da preventiva.", origem: "Dos planos de manutenção preventiva e das leituras de horímetro e quilometragem." },
  "man:23": { regra: "Máquinas ativas com item do plano de manutenção preventiva dentro da margem de aviso: a margem configurada em horas ou quilômetros, ou 7 dias para item por data. O número conta máquinas.",
    fazer: "Programar a preventiva.", origem: "Dos planos de manutenção preventiva e das leituras de horímetro e quilometragem." },
  "man:52": { regra: "Mobilizações com máquina, previstas ou em preparação com saída prevista até daqui a 7 dias (ou já passada), ou em trânsito, sem checklist aprovado ligado a elas.",
    fazer: "Fazer e aprovar o checklist da mobilização.", origem: "Das mobilizações e dos checklists." },

  /* ---------- Minha fila ---------- */
  "fila:10": { regra: "Comentário de obra em que você foi indicado como responsável e que ainda não foi resolvido.",
    fazer: "Abrir a aba Timeline da obra e resolver o comentário.", origem: "Dos comentários das obras." },
  "fila:20": { regra: "Pendência de mobilização sob a sua responsabilidade, ainda não concluída. Fica crítico quando o prazo passou.",
    fazer: "Concluir a pendência.", origem: "Das pendências das mobilizações." },
  "fila:30": { regra: "Requisição pendente em que você é o aprovador.",
    fazer: "Aprovar ou recusar a requisição.", origem: "Das requisições de material." },
  "fila:40": { regra: "Chamado que você abriu, ainda não encerrado, com resposta de outra pessoa depois da sua última mensagem.",
    fazer: "Ler a resposta.", origem: "Dos chamados e das respostas deles." },
  "fila:41": { regra: "Chamado em validação com uma pergunta dirigida a você: como autor, como pessoa indicada ou, na pergunta feita à diretoria, se você é da diretoria. Fica crítico com o prazo vencido.",
    fazer: "Responder; se houver resposta sugerida, basta aprovar.", origem: "Dos chamados em validação." },
  "fila:42": { regra: "Chamado seu resolvido há menos de 7 dias e ainda sem a sua confirmação.",
    fazer: "Confirmar que funcionou ou reabrir.", origem: "Dos chamados resolvidos." },
  "fila:50": { regra: "Medição de obra sob a sua responsabilidade com valor de NF informado que difere do valor produzido por mais que o maior entre 50 reais e 1 % da NF. Fica crítico quando a medição foi criada há mais de 15 dias.",
    fazer: "Lançar no RDO a produção que falta, ou corrigir a medição.", origem: "Das medições: o valor da NF comparado com o valor final medido." },
  "fila_sep:25": { regra: "Separação de material atribuída a você, aberta, em separação ou já separada. Fica crítico com o prazo vencido.",
    fazer: "Separar os itens e entregar.", origem: "Das separações de material." },
  "fila_sep:26": { regra: "Separação de material que você pediu e que já está separada.",
    fazer: "Retirar no almoxarifado.", origem: "Das separações de material." },
  "fila_sep:27": { regra: "Peças de estoque lançadas como consumo numa OS, ainda sem baixa no estoque e fora de separação em andamento. Aparece para quem dá baixa de peças no almoxarifado. O número conta peças da OS; fica em atenção quando a OS já foi concluída.",
    fazer: "Dar a baixa na aba Materiais da OS.", origem: "Dos materiais das ordens de serviço e das separações." },
  "fila_custo:27": { regra: "Produto sem custo cadastrado que teve saída de estoque a custo zero a partir da data configurada (EPI e uniforme não entram). Uma linha por produto; fica crítico quando a primeira dessas saídas tem mais de 3 dias.",
    fazer: "Definir o custo do produto.", origem: "Das movimentações de estoque e do cadastro de produtos." },

  /* ---------- Para regularizar ---------- */
  "sem_responsavel": { regra: "Obras em andamento, ou planejadas que já têm item de pedido de compra, sem engenheiro responsável.",
    fazer: "O gestor do serviço indica o responsável na ficha da obra.", origem: "Do cadastro das obras." },
  "responsavel_inativo": { regra: "Obras não canceladas cujo engenheiro responsável foi desativado e que estão em andamento ou têm estaca a regularizar (projeto a confirmar, ou executada sem profundidade).",
    fazer: "Indicar outro responsável na ficha da obra.", origem: "Do cadastro das obras e dos usuários." },
  "sem_jornada": { regra: "Obras em andamento sem horário de entrada da jornada informado.",
    fazer: "Preencher a jornada na aba Parâmetros da obra.", origem: "Do cadastro das obras." },
  "sem_estacas": { regra: "Obras em andamento sem estaca no cadastro (Refurada não conta) e sem meta de estacas.",
    fazer: "Importar o projeto na aba Estacas ou informar a meta.", origem: "Do cadastro de estacas e da meta das obras." },
  "obra_sem_ibge": { regra: "Obras em andamento sem o código IBGE do município da prestação, que a NFS-e exige.",
    fazer: "Informar o CEP na aba Endereço da obra: ele preenche o município.", origem: "Do cadastro das obras." },
  "sem_profundidade": { regra: "Estacas marcadas como executadas com a profundidade executada zerada, em obra não cancelada. Uma linha por obra.",
    fazer: "Lançar a profundidade executada. Em estaca raiz, veja o filtro 'Só injeção: falta a perfuração'.", origem: "Do cadastro de estacas." },
  "injecao_sem_perfuracao": { regra: "Estacas marcadas como executadas, sem profundidade executada, com a injeção lançada em diário e nenhum diário com a metragem (refuro não conta), em obra não cancelada. Uma linha por obra.",
    fazer: "Lançar a perfuração no diário da máquina e do turno que perfurou.", origem: "Dos RDOs." },
  "projeto_pendente": { regra: "Estacas marcadas com projeto a confirmar, em obra não cancelada. Uma linha por obra.",
    fazer: "Confirmar o projeto na aba Estacas.", origem: "Do cadastro de estacas." },
  "rdo_sem_dados": { regra: "RDOs de obra em andamento, em dia que não é domingo nem feriado, sem execução, sem equipe, sem atividades e sem observação. Uma linha por obra.",
    fazer: "Preencher ou excluir o diário.", origem: "Dos RDOs." },
  "rdo_sem_equipe": { regra: "RDOs de 01/11/2026 em diante com estaca lançada e ninguém na equipe, passados 2 dias úteis da data do diário. Uma linha por obra.",
    fazer: "Lançar a equipe do diário.", origem: "Dos RDOs." },
  "rdo_sem_equipamento": { regra: "RDOs sem máquina: todos os de obra em andamento e, nas demais obras não canceladas, os dos últimos 60 dias. Uma linha por obra.",
    fazer: "Atribuir a máquina ao diário.", origem: "Dos RDOs." },
  "estaca_por_observacao": { regra: "Execuções lançadas nos últimos 14 dias em que a etapa final registrada não é a metragem (injeção, concretagem, argamassado ou outra). Uma linha por obra.",
    fazer: "Abrir o RDO e conferir se a estaca foi mesmo executada.", origem: "Das execuções lançadas nos RDOs." },
  "sem_diametro": { regra: "Estacas sem diâmetro em obra em andamento (Refurada não conta). Uma linha por obra.",
    fazer: "Informar o diâmetro da estaca.", origem: "Do cadastro de estacas." },
  "sem_preco": { regra: "Modelos de acessório ativos sem preço de referência. Uma linha por família.",
    fazer: "Informar o preço de cada modelo.", origem: "Do cadastro de modelos de acessório." },
  "acessorio_sem_ncm": { regra: "Acessórios que estão no kit de uma mobilização em preparação, em trânsito ou em obra e não têm NCM.",
    fazer: "Preencher o NCM do acessório.", origem: "Das mobilizações e do cadastro de acessórios." },
  "sem_codigo_externo": { regra: "Perfuratrizes e bate-estacas ativos sem o código externo usado na importação do Geodigitus e do Maya.",
    fazer: "Preencher o código na ficha da máquina.", origem: "Do cadastro de máquinas." },
  "maquina_sem_ncm": { regra: "Máquinas principais ou de apoio de mobilização em preparação, em trânsito ou em obra, sem NCM.",
    fazer: "Preencher o NCM da máquina.", origem: "Das mobilizações e do cadastro de máquinas." },
  "pergunta_vencida": { regra: "Chamados em validação cuja pergunta passou do prazo de resposta. Só a diretoria vê; uma linha por quem deve a resposta.",
    fazer: "Cobrar a resposta de quem deve.", origem: "Dos chamados em validação." },
  "cliente_sem_fiscal": { regra: "Clientes com obra em andamento sem CNPJ ou CPF válido, sem inscrição estadual definida, sem CEP ou sem código IBGE. O detalhe diz o que falta em cada um.",
    fazer: "Completar os dados fiscais do cliente.", origem: "Do cadastro de clientes." },
  "caucao_vencida": { regra: "Cauções abertas ou parciais com a previsão de devolução já passada.",
    fazer: "Cobrar a devolução ou corrigir a previsão.", origem: "Das cauções das medições." },
  "venda_incompleta": { regra: "Vendas de bens não canceladas sem comprador, sem valor, sem data ou sem parcelas. O detalhe diz o que falta.",
    fazer: "Completar o cadastro da venda.", origem: "Das vendas de bens." },
  "venda_sem_contrato": { regra: "Vendas de bens em andamento ou atrasadas sem contrato anexado.",
    fazer: "Anexar o contrato da venda.", origem: "Das vendas de bens." },
  "veiculo_sem_transferencia": { regra: "Vendas não canceladas de veículo ou caminhão em que a transferência ainda não foi concluída.",
    fazer: "Registrar a comunicação de venda e a entrega do CRV, e concluir a transferência.", origem: "Das vendas de bens." },
  "bem_vendido_sem_valor_aquisicao": { regra: "Vendas não canceladas de bem sem valor de aquisição no cadastro; sem ele o resultado da venda não é calculado.",
    fazer: "Informar o valor de aquisição do bem.", origem: "Das vendas de bens e do cadastro do bem." },
  "permuta_termo": { regra: "Permutas não quitadas cujo instrumento ou contrato ainda não foi assinado.",
    fazer: "Colher a assinatura e registrar na permuta.", origem: "Das permutas." },
  "permuta_imovel": { regra: "Permutas não quitadas sem imóvel identificado ou sem valor do imóvel.",
    fazer: "Definir a unidade e o valor do imóvel.", origem: "Das permutas." },
  "permuta_nf": { regra: "Lançamentos de crédito de permuta sem NF emitida. O número conta lançamentos; o valor no título é a soma dos créditos.",
    fazer: "Emitir a NF.", origem: "Dos créditos lançados nas permutas." },
  "os_atrasada": { regra: "Ordens de serviço de manutenção agendadas ou em andamento com a data prevista já passada.",
    fazer: "Concluir a OS ou remarcar a data.", origem: "Das ordens de serviço de manutenção." },
  "leitura_parada": { regra: "Máquinas ativas em uso ou em obra (perfuratriz, bate-estaca, bomba, compressor, gerador, escavadeira, retroescavadeira e guindaste) sem leitura de horímetro há mais de 15 dias, ou sem nenhuma leitura.",
    fazer: "Lançar a leitura da máquina.", origem: "Das leituras de horímetro das máquinas." },
  "promocao_vencida": { regra: "Funcionários ativos cuja data prevista de mudança de função, pelo plano de cargos, já passou. A data sai do início da função atual mais os meses do plano.",
    fazer: "Efetivar a mudança ou reprogramar.", origem: "Do plano de cargos e do histórico de funções." },
  "promocao_60": { regra: "Funcionários ativos com mudança de função prevista, pelo plano de cargos, para os próximos 60 dias.",
    fazer: "Preparar a mudança.", origem: "Do plano de cargos e do histórico de funções." },
  "pj_vigencia_30": { regra: "Contratos PJ de pessoas ativas que vencem entre 16 e 30 dias.",
    fazer: "Tratar a renovação.", origem: "Do cadastro de funcionários." },
  "pj_vigencia_15": { regra: "Contratos PJ de pessoas ativas já vencidos ou que vencem em até 15 dias. Fica na lista até renovar ou encerrar.",
    fazer: "Renovar ou encerrar o contrato.", origem: "Do cadastro de funcionários." },
  "a_liberar": { regra: "Lançamentos de hora extra ou noturna do RDO e de horas de viagem, de 15 dias atrás ou mais, ainda não liberados. O número conta lançamentos; o detalhe traz as horas por obra.",
    fazer: "Liberar as horas.", origem: "Da equipe dos RDOs e das horas de viagem." },
  "revisar_informacao": { regra: "Linhas de equipe do RDO com a situação Revisar informação e ainda não liberadas; essa situação bloqueia a liberação.",
    fazer: "Corrigir a informação no RDO.", origem: "Da equipe dos RDOs." },
  "epi_vencida": { regra: "Entregas de EPI a colaborador ativo, não devolvidas nem substituídas, com a validade do EPI já passada. O número conta entregas.",
    fazer: "Trocar o EPI e registrar a entrega.", origem: "Das entregas de EPI." },
  "epi_sem_pessoa": { regra: "Saídas de EPI do estoque sem o colaborador que recebeu, a partir da data em que o controle de EPI começou.",
    fazer: "Informar o colaborador na saída.", origem: "Das saídas de EPI do estoque." },
  "programa_vencendo": { regra: "Programas legais ativos de obra em andamento com a vigência já passada ou que termina em até 30 dias.",
    fazer: "Renovar o programa.", origem: "Dos programas legais das obras." },
  "obra_sem_pgr": { regra: "Obras em andamento sem PGR de obra ativo e dentro da vigência.",
    fazer: "Cadastrar o PGR da obra.", origem: "Dos programas legais das obras." },
  "funcao_sem_ghe": { regra: "Funções de funcionários ativos sem grupo homogêneo de exposição (GHE). Só aparece depois que algum GHE foi ligado a uma função. O número conta funções.",
    fazer: "Vincular a função a um GHE.", origem: "Do cadastro de funcionários e dos GHE." },
  "sem_classificacao": { regra: "Ocorrências de SST registradas há mais de 2 dias e ainda sem categoria.",
    fazer: "Classificar a ocorrência.", origem: "Das ocorrências de SST." },
  "acao_vencida": { regra: "Ações de ocorrência de SST a fazer ou em andamento com o prazo já passado. Em Meus aparecem as ações em que você é o responsável.",
    fazer: "Concluir a ação ou rever o prazo.", origem: "Das ações das ocorrências de SST." },
  "sem_eficacia": { regra: "Ocorrências de SST com as ações concluídas há mais de 30 dias e ainda sem a eficácia verificada.",
    fazer: "Verificar a eficácia e registrar.", origem: "Das ocorrências de SST e das ações delas." },
  "cpu_calibracao_vencida": { regra: "Computadores de bordo ativos com calibração vencida, que vence em até 30 dias, ou sem certificado.",
    fazer: "Calibrar e registrar o certificado.", origem: "Do cadastro de computadores de bordo e das calibrações." },
  "cpu_sem_vinculo": { regra: "Computadores de bordo ativos sem máquina vinculada hoje.",
    fazer: "Vincular o computador de bordo à máquina.", origem: "Do cadastro de computadores de bordo." },
  "cpu_imei_desconhecido": { regra: "Aparelhos que mandam arquivo do Geodigitus e não têm cadastro de computador de bordo (os marcados para ignorar não entram).",
    fazer: "Cadastrar o computador de bordo.", origem: "Dos arquivos recebidos do Geodigitus." },
  "geodigitus_estaca_sem_maquina": { regra: "Estacas que chegaram do Geodigitus de um computador de bordo sem máquina vinculada na data.",
    fazer: "Corrigir o vínculo do computador de bordo.", origem: "Das chegadas do Geodigitus." },
  "geodigitus_estaca_sem_obra": { regra: "Estacas que chegaram do Geodigitus e ficaram em conferência porque a obra não foi determinada.",
    fazer: "Definir a obra em Chegadas.", origem: "Das chegadas do Geodigitus." },
  "geodigitus_estaca_sem_cadastro": { regra: "Estacas que chegaram do Geodigitus e não foram ligadas a uma única estaca do cadastro da obra.",
    fazer: "Vincular à estaca certa em Chegadas.", origem: "Das chegadas do Geodigitus." },
  "geodigitus_rdo_finalizado": { regra: "Estacas que chegaram do Geodigitus para um diário que já estava finalizado.",
    fazer: "Reabrir o diário ou tratar em Chegadas.", origem: "Das chegadas do Geodigitus." },
  "geodigitus_sync_parado": { regra: "Com a sincronização ligada: computador de bordo ativo e vinculado sem arquivo sincronizado dentro do prazo configurado, ou nenhuma rodada automática nas últimas 2 horas, de segunda a sábado, das 7h às 20h.",
    fazer: "Ver o estado da sincronização.", origem: "Das rodadas de sincronização do Geodigitus." },
  "geodigitus_estaca_a_confirmar": { regra: "Chegadas do Geodigitus ainda sem confirmação e com algum sinal de dúvida: arquivo incompleto, refuro, profundidade menor que 1 m ou número repetido no mesmo dia e no mesmo computador de bordo.",
    fazer: "Confirmar em Chegadas o que foi.", origem: "Das chegadas do Geodigitus." },
  "acessorio_vida_alerta": { regra: "Peças de desgaste em uso cujos metros perfurados já passaram do percentual de aviso configurado sobre a mediana de vida do modelo (da mesma marca, quando há histórico suficiente).",
    fazer: "Planejar a troca da peça.", origem: "Do histórico de instalação e retirada das peças e dos metros dos RDOs." },
  "baixada_vencida": { regra: "Pessoas ativas, fora de baixada, com a data da próxima baixada já passada.",
    fazer: "Programar a baixada.", origem: "Das baixadas e dos acordos de baixada." },
  "baixada_a_vencer": { regra: "Pessoas ativas com a próxima baixada de hoje até o número de dias de aviso configurado, que aparece no título.",
    fazer: "Programar a baixada.", origem: "Das baixadas e dos acordos de baixada." },
  "lotacao_diferente": { regra: "Pessoas alocadas em uma obra que aparecem, no diário mais recente dos últimos 7 dias, em outra obra (falta, folga, DSR e atestado não contam).",
    fazer: "Conferir e corrigir a alocação.", origem: "Das alocações e da equipe dos RDOs." },
  "lotacao_ausente": { regra: "Pessoas que aparecem em diário dos últimos 7 dias e não têm obra de alocação (falta, folga, DSR e atestado não contam).",
    fazer: "Alocar a pessoa.", origem: "Das alocações e da equipe dos RDOs." },
  "rdo_devolvido": { regra: "Diários em rascunho devolvidos ao campo há mais de 1 dia e ainda não reenviados.",
    fazer: "Cobrar o reenvio.", origem: "Dos diários do aplicativo do campo." },
  "rdo_enviado_sem_conferencia": { regra: "Diários enviados pelo campo, ainda em rascunho, com mais de 1 dia útil desde o envio.",
    fazer: "Conferir e finalizar, ou devolver.", origem: "Dos diários do aplicativo do campo." },
  "estaca_nao_chegou": { regra: "Aviso do operador, ainda não resolvido, de estacas executadas que não chegaram do computador de bordo.",
    fazer: "Conferir o computador de bordo e lançar a estaca.", origem: "Das pendências abertas no aplicativo do campo." },
  "contestacao_campo": { regra: "Estaca do diário contestada pelo operador (não é dele, número errado ou outro motivo), ainda sem resolução.",
    fazer: "Analisar e responder.", origem: "Das pendências abertas no aplicativo do campo." },
  "relogio_divergente": { regra: "Ao abrir o dia, o relógio do celular do operador diferia do servidor em mais minutos do que o limite configurado. Pendência ainda não resolvida.",
    fazer: "Conferir os horários do diário.", origem: "Das pendências abertas no aplicativo do campo." },
  "obra_divergente": { regra: "Ao abrir o dia, o operador não confirmou a obra indicada, ou já havia outro diário da mesma máquina e dia em outra obra. Pendência ainda não resolvida.",
    fazer: "Confirmar a obra do diário.", origem: "Das pendências abertas no aplicativo do campo." },
  "rdo_tipo_nao_confirmado": { regra: "O operador tentou abrir o dia de uma máquina sem tipo de serviço definido, e a abertura foi recusada. Pendência ainda não resolvida.",
    fazer: "Informar o tipo de serviço da máquina.", origem: "Das pendências abertas no aplicativo do campo." },
  "aprovacao_os": { regra: "Apontamentos de horas de OS aguardando aprovação, lançados por outra pessoa.",
    fazer: "Aprovar ou recusar em Apontamentos.", origem: "Dos apontamentos de horas." },
  "aprovacao_rp_of": { regra: "Apontamentos de horas de reparo e de fabricação aguardando aprovação, lançados por outra pessoa.",
    fazer: "Aprovar ou recusar em Apontamentos.", origem: "Dos apontamentos de horas." }
};

/* Os cinco indicadores da faixa do período: o texto que antes ficava só no title (não abria em tela de toque) */
const DASH_EXPLICA_FAIXA = {
  producao: "Soma de profundidade executada e número de estacas (sem refuros) dos RDOs com data no período. Variação contra o período anterior de mesmo tamanho.",
  obras:    "Obras em andamento com pelo menos um RDO no período ÷ obras em andamento.",
  medido:   "Valor final das medições aprovadas ou faturadas com data de medição no período.",
  receber:  "Medições com NF emitida e ainda não recebidas (líquido a receber − já recebido) + saldo das vendas de bens em andamento ou atrasadas. Entre parênteses, o que já venceu.",
  custo:    "Soma dos custos registrados no período: compras, ordens de serviço, diesel do RDO, contratos e avulsos."
};

/* Famílias de acessório: em "Para regularizar", a linha de modelo sem preço traz a família no lugar do filtro */
const DASH_EXPLICA_FAMILIAS = ["helice", "raiz", "secante", "trado", "comum"];
const DASH_EXPLICA_FONTES = ["acoes", "sep", "fab", "fin", "man", "assinar", "fila", "fila_sep", "fila_custo"];
const dashExplicaTem = (k) => typeof k === "string" && Object.prototype.hasOwnProperty.call(DASH_EXPLICA, k);

/* Chave do texto de uma linha, ou null quando não há texto conferido para ela.
   bloco: "regularizar" usa o filtro; "acoes" e "fila" usam a fonte marcada na leitura (a._fonte), a ordem e o nível.
   Nunca usa o título, que em várias linhas leva valor, número ou nome. */
function dashExplicaChave(a, bloco){
  if(!a) return null;
  if(bloco === "regularizar"){
    const f = a.filtro == null ? "" : String(a.filtro);
    if(dashExplicaTem(f)) return f;
    if(a.setor === "acessorios" && a.secao === "acessorios" && DASH_EXPLICA_FAMILIAS.includes(f)) return "sem_preco";
    return null;
  }
  const fonte = a._fonte;
  if(!DASH_EXPLICA_FONTES.includes(fonte)) return null;
  if(fonte === "assinar") return dashExplicaTem("assinar") ? "assinar" : null;   // uma linha por pedido: a ordem é só a posição
  const ordem = Number(a.ordem);
  if(!Number.isFinite(ordem)) return null;
  const comNivel = `${fonte}:${ordem}:${a.nivel}`, semNivel = `${fonte}:${ordem}`;
  return dashExplicaTem(comNivel) ? comNivel : dashExplicaTem(semNivel) ? semNivel : null;
}

/* Painel "o que é este número": três linhas rotuladas. Chave sem texto devolve "" (a linha fica sem o "?"). */
function dashExplicaHTML(chave){
  if(!dashExplicaTem(chave)) return "";
  const t = DASH_EXPLICA[chave];
  const linha = (rotulo, texto) => `<div class="dash-explica-linha"><span class="rotulo-caps">${esc(rotulo)}</span><span>${esc(texto)}</span></div>`;
  return linha("O que é", t.regra) + linha("O que fazer", t.fazer) + linha("De onde vem", t.origem);
}
/* Painel dos indicadores da faixa: só "O que é" */
function dashExplicaFaixaHTML(chave){
  if(typeof chave !== "string" || !Object.prototype.hasOwnProperty.call(DASH_EXPLICA_FAIXA, chave)) return "";
  return `<div class="dash-explica-linha"><span class="rotulo-caps">O que é</span><span>${esc(DASH_EXPLICA_FAIXA[chave])}</span></div>`;
}

/* ---------- "Para regularizar": as três visões sobre o papel que cada linha já traz ---------- */
const DASH_REG_VISOES = [["meus", "Meus"], ["empresa", "Da empresa"], ["acompanho", "Acompanho"]];
/* responsavel = é meu; acompanha = outro responde e eu acompanho; o resto (diretoria) é o total da empresa.
   Papel desconhecido cai em "empresa" para nenhuma linha sumir da tela. */
function dashRegVisaoDoPapel(papel){ return papel === "responsavel" ? "meus" : papel === "acompanha" ? "acompanho" : "empresa"; }
function dashRegFiltrar(lista, visao){ return (lista || []).filter(a => dashRegVisaoDoPapel(a && a.papel) === visao); }
function dashRegContar(lista){
  const n = { meus: 0, empresa: 0, acompanho: 0 };
  (lista || []).forEach(a => { n[dashRegVisaoDoPapel(a && a.papel)]++; });
  return n;
}
/* A escolha guardada vale enquanto tiver linha; senão "Meus" quando houver, depois "Da empresa", depois "Acompanho".
   Sem linha nenhuma devolve null. */
function dashRegVisaoInicial(contagem, guardada){
  const n = contagem || {};
  if(guardada && n[guardada] > 0) return guardada;
  const v = DASH_REG_VISOES.find(([k]) => n[k] > 0);
  return v ? v[0] : null;
}

// teste em Node (scripts/testar-fase164.mjs): dados e funções puras também saem por module.exports
if(typeof module === "object" && module && module.exports){
  module.exports = { DASH_EXPLICA, DASH_EXPLICA_FAIXA, DASH_EXPLICA_FAMILIAS, DASH_REG_VISOES, dashExplicaChave, dashExplicaHTML, dashExplicaFaixaHTML,
    dashRegVisaoDoPapel, dashRegFiltrar, dashRegContar, dashRegVisaoInicial };
}
