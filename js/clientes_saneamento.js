










let _clsReceita = {};
let _clsLote = null;
const CLS_PAUSA_MS = 1300;

const CLS_ROTULO_FK = {
  "obras.cliente_id": "Obras (cliente)", "obras.obra_para_id": "Obras (\"Obra para\")", "orcamentos.cliente_id": "Orçamentos",
  "contratos.cliente_id": "Contratos", "caucoes.cliente_id": "Cauções", "vendas_bens.cliente_id": "Vendas de bens",
  "permutas.cliente_id": "Permutas", "permuta_lancamentos.cliente_id": "Lançamentos de permuta",
  "servico_precos_cliente.cliente_id": "Preços por cliente", "funcionario_documentos.cliente_id": "Documentos de funcionário",
  "sst_matriz.cliente_id": "Matriz de SST", "sst_programas.cliente_id": "Programas de SST",
  "sst_ocorrencias.cliente_id": "Ocorrências de SST", "sst_turmas.cliente_id": "Turmas de SST"
};
const CLS_CAMPOS = [
  ["nome_fantasia", "nome_fantasia", "Fantasia"], ["cep", "cep", "CEP"], ["logradouro", "logradouro", "Logradouro"],
  ["numero", "numero", "Número"], ["complemento", "complemento", "Complemento"], ["bairro", "bairro", "Bairro"],
  ["cidade", "cidade", "Cidade"], ["uf", "uf", "UF"], ["codigo_ibge", "ibge", "IBGE"], ["telefone", "telefone", "Telefone"],
  ["email", "email", "E-mail"]
];
const CLS_PALAVRAS_FORA = new Set(["ltda", "sa", "s", "a", "me", "epp", "eireli", "spe", "cia", "e", "de", "da", "do", "das", "dos",
  "construtora", "construcoes", "construcao", "engenharia", "empreendimentos", "empreendimento", "incorporadora", "incorporacao",
  "imobiliaria", "imobiliario", "grupo", "servicos", "comercio", "industria", "participacoes", "obras"]);

function clsPodeJuntar(){ return !!usuarioAtual && usuarioAtual.cargo === "diretor"; }
function clsDigitos(v){ return String(v || "").replace(/\D/g, ""); }
function clsVazio(v){ return !String(v == null ? "" : v).trim(); }
function clsNorm(txt){
  return String(txt || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
function clsPalavraChave(c){
  const p = clsNorm(String(c.nome || "").split(",")[0]).split(" ").filter(w => w.length > 1 && !CLS_PALAVRAS_FORA.has(w));
  return p[0] || "";
}


function clsProblemas(){
  const ativos = _clientes.filter(c => c.ativo !== false);
  const out = [];
  const add = (c, motivo, extra) => out.push(Object.assign({ c, motivo }, extra || {}));
  ativos.forEach(c => {
    const doc = clsDigitos(c.cpf_cnpj);
    if(!doc) add(c, c.tipo_pessoa === "fisica" ? "Sem CPF (preencher à mão na ficha)" : "Sem CNPJ");
    if(String(c.nome || "").includes(",")) add(c, "Nome com vírgula: contato colado ao nome?");
    if(/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(String(c.nome || "").trim())) add(c, "Nome parece e-mail");
    const r = _clsReceita[c.id];
    if(r && !r.ativa) add(c, `Receita: situação ${r.situacao}`);
    if(r && r.razao && clsNorm(r.razao) !== clsNorm(String(c.nome || "").split(",")[0])) add(c, `Receita: razão social "${r.razao}"`);
  });

  const porRaiz = {};
  ativos.forEach(c => { const r = cliRaiz(c.cpf_cnpj); if(r) (porRaiz[r] = porRaiz[r] || []).push(c); });
  Object.values(porRaiz).filter(l => l.length > 1).forEach(l => {
    const grupos = new Set(l.map(c => c.grupo_id || ""));
    if(grupos.size > 1 || grupos.has("")) l.forEach(c => add(c, `Mesma raiz de CNPJ de ${l.filter(x => x !== c).map(x => x.nome).join(", ")}, sem o mesmo grupo`));
  });

  const porChave = {};
  ativos.forEach(c => { const k = clsPalavraChave(c); if(k) (porChave[k] = porChave[k] || []).push(c); });
  Object.values(porChave).forEach(l => {
    const com = l.filter(c => clsDigitos(c.cpf_cnpj)), sem = l.filter(c => !clsDigitos(c.cpf_cnpj));
    sem.forEach(s => {
      const par = com[0] || l.find(x => x !== s);
      if(par) add(s, `Nome parecido com ${par.nome}${clsDigitos(par.cpf_cnpj) ? " (que tem CNPJ)" : ""}`, { par });
    });
  });
  return out;
}

function clsRender(){
  const cont = $("cli-conteudo");
  if(!cont) return;
  const termo = ($("cli-busca")?.value || "").trim().toLowerCase();
  const probs = clsProblemas().filter(p => !termo || `${p.c.nome} ${p.c.cpf_cnpj || ""} ${p.motivo}`.toLowerCase().includes(termo));
  const nCli = new Set(probs.map(p => p.c.id)).size;
  const contador = $("cli-contador");
  if(contador) contador.textContent = `${probs.length} problemas em ${nCli} cadastros`;
  const barra = `<div class="form-acoes compacta">
      ${cliPodeEditar() ? `<button type="button" class="btn-sec btn-sm" id="cls-btn-lote" title="Consulta a Receita (BrasilAPI) para os clientes com CNPJ e endereço, fantasia ou IBGE vazios; mostra a prévia antes de gravar">Completar pelo CNPJ</button>` : ""}
      ${clsPodeJuntar() ? `<button type="button" class="btn-sec btn-sm" id="cls-btn-juntar" title="Escolher o cadastro que fica e o que sai; mostra o que muda antes de confirmar">Juntar cadastros</button>` : ""}
      <span class="meta">Lista conferida em docs/cargas/clientes-saneamento-2026-11-16.md. Nenhuma junção é feita sem a confirmação da diretoria.</span>
    </div><div id="cls-lote"></div>`;
  if(!probs.length){ cont.innerHTML = barra + uiVazio("Nenhum problema encontrado nos cadastros ativos."); clsRenderLote(); return; }
  const linhas = probs.map(p => `<tr class="linha-clicavel" data-id="${esc(p.c.id)}">
      <td>${esc(p.c.nome)}${p.c.nome_fantasia ? `<div class="meta">${esc(p.c.nome_fantasia)}</div>` : ""}</td>
      <td>${p.c.cpf_cnpj ? uiCodigo(p.c.cpf_cnpj) : "—"}</td>
      <td>${esc(p.motivo)}</td>
      <td>${p.par && clsPodeJuntar() ? `<button type="button" class="btn-sec btn-sm" data-cls-juntar="${esc(p.c.id)}" data-cls-par="${esc(p.par.id)}" title="Abre a junção com este cadastro saindo e o parecido ficando">Juntar…</button>` : ""}</td>
    </tr>`).join("");
  cont.innerHTML = barra + `<div class="tabela-rola"><table>
      <thead><tr><th>Cliente</th><th>CPF / CNPJ</th><th>Motivo</th><th></th></tr></thead>
      <tbody>${linhas}</tbody></table></div>`;
  clsRenderLote();
}


function clsCandidatosLote(){
  return _clientes.filter(c => c.ativo !== false && clsDigitos(c.cpf_cnpj).length === 14
    && (clsVazio(c.logradouro) || clsVazio(c.nome_fantasia) || clsVazio(c.codigo_ibge) || clsVazio(c.cep) || clsVazio(c.cidade)));
}

async function clsConsultarLote(){
  const cands = clsCandidatosLote();
  if(!cands.length){ aviso("app-aviso", "Nenhum cliente com CNPJ e endereço, fantasia ou IBGE vazios.", "info"); return; }
  if(!await uiConfirmar({ titulo: "Consultar na Receita", texto: `Consultar ${cands.length} CNPJ(s) na Receita, um a um (cerca de ${Math.ceil(cands.length * CLS_PAUSA_MS / 60000)} min)? Nada é gravado antes da prévia.`, confirmar: "Consultar" })) return;
  _clsLote = { itens: [], parar: false, feitos: 0, total: cands.length, erros: [] };
  clsRenderLote();
  for(const c of cands){
    if(_clsLote.parar) break;
    const r = await fiscalBuscarCnpj(c.cpf_cnpj);
    _clsLote.feitos++;
    if(r.erro){
      _clsLote.erros.push(`${c.nome}: ${r.erro}`);
      if(/limitou/i.test(r.erro)) { _clsLote.parar = true; break; }
    } else {
      _clsReceita[c.id] = { razao: r.razao_social, situacao: r.situacao, ativa: r.ativa };
      const campos = CLS_CAMPOS.filter(([col, chave]) => clsVazio(c[col]) && !clsVazio(r[chave])).map(([col, chave, rot]) => ({ col, rot, valor: r[chave] }));
      if(campos.length || !r.ativa) _clsLote.itens.push({ cli: c, dados: r, campos, marcado: campos.length > 0 });
    }
    clsRenderLote();
    await new Promise(ok => setTimeout(ok, CLS_PAUSA_MS));
  }
  _clsLote.fim = true;
  clsRender();
}

function clsRenderLote(){
  const box = $("cls-lote");
  if(!box || !_clsLote) { if(box) box.innerHTML = ""; return; }
  const L = _clsLote;
  const topo = `<p class="meta">Receita: ${esc(L.feitos)} de ${esc(L.total)} consultados${L.fim ? "" : " (consultando…)"}${L.erros.length ? `; ${esc(L.erros.length)} sem resposta` : ""}.
    ${L.fim ? "" : `<button type="button" class="btn-sec btn-sm" id="cls-lote-parar">Parar</button>`}</p>`;
  const linhas = L.itens.map((it, i) => `<tr>
      <td><input type="checkbox" data-cls-marca="${i}" ${it.marcado ? "checked" : ""} ${it.campos.length ? "" : "disabled"} aria-label="Gravar este cliente" /></td>
      <td>${esc(it.cli.nome)}${it.dados.ativa ? "" : `<div class="txt-perigo">Situação na Receita: ${esc(it.dados.situacao)}</div>`}</td>
      <td>${it.campos.length ? it.campos.map(f => `<div><span class="rotulo-caps">${esc(f.rot)}</span> ${esc(f.valor)}</div>`).join("") : "—"}</td>
    </tr>`).join("");
  const erros = L.erros.length ? `<details><summary class="meta">Sem resposta (${esc(L.erros.length)})</summary>${L.erros.map(e => `<div class="meta">${esc(e)}</div>`).join("")}</details>` : "";
  box.innerHTML = `<div class="card">${topo}${L.itens.length ? `<div class="tabela-rola"><table>
      <thead><tr><th></th><th>Cliente</th><th>Vai preencher (só campos vazios)</th></tr></thead><tbody>${linhas}</tbody></table></div>` : ""}
      ${erros}
      ${L.fim && L.itens.some(it => it.campos.length) ? `<div class="form-acoes compacta"><button type="button" class="btn" id="cls-lote-gravar">Gravar os marcados</button>
        <button type="button" class="btn-sec" id="cls-lote-descartar">Descartar</button></div>` : ""}</div>`;
}

async function clsGravarLote(){
  const itens = (_clsLote?.itens || []).filter(it => it.marcado && it.campos.length);
  if(!itens.length){ aviso("app-aviso", "Nenhum cliente marcado.", "aviso"); return; }
  let ok = 0; const falhas = [];
  for(const it of itens){
    const dados = {};
    it.campos.forEach(f => { dados[f.col] = f.valor; });
    const { error } = await sb.rpc("clientes_completar_receita", { p_id: it.cli.id, p_dados: dados });
    if(error) falhas.push(`${it.cli.nome}: ${error.message}`); else ok++;
  }
  _clsLote = null;
  await carregarClientes();
  aviso("app-aviso", `${ok} cliente(s) completados pela Receita${falhas.length ? `; ${falhas.length} com erro: ${falhas.join("; ")}` : ""}.`, falhas.length ? "aviso" : "sucesso");
}


function clsAbrirJuntar(saiId, ficaId){
  if(!clsPodeJuntar()) return;
  const ops = _clientes.filter(c => c.ativo !== false).sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"))
    .map(c => ({ id: c.id, rotulo: `${c.nome}${c.cpf_cnpj ? " · " + c.cpf_cnpj : ""}` }));
  ["cls-fica", "cls-sai"].forEach(id => preencherSelect($(id), ops, "id", "rotulo", "Escolha o cadastro"));
  $("cls-fica").value = ficaId || "";
  $("cls-sai").value = saiId || "";
  $("cls-previa").innerHTML = "";
  $("cls-btn-confirmar").disabled = true;
  $("cls-modal").style.display = "flex";
  if(ficaId && saiId) clsPrevia();
}
function clsFecharJuntar(){ $("cls-modal").style.display = "none"; }

async function clsPrevia(){
  const fica = $("cls-fica").value, sai = $("cls-sai").value;
  const box = $("cls-previa");
  $("cls-btn-confirmar").disabled = true;
  if(!fica || !sai){ box.innerHTML = ""; return; }
  if(fica === sai){ box.innerHTML = `<p class="txt-perigo">Escolha dois cadastros diferentes.</p>`; return; }
  box.innerHTML = `<p class="meta">Contando…</p>`;
  const { data, error } = await sb.rpc("clientes_juntar_previa", { p_manter: fica, p_apagar: sai });
  if(error){ box.innerHTML = `<p class="txt-perigo">${esc(error.message)}</p>`; return; }
  const chaves = Object.keys(data.sai || {}).filter(k => (data.sai[k] || 0) > 0 || (data.fica[k] || 0) > 0);
  const f = cliPorId(fica), s = cliPorId(sai);
  const linhas = chaves.map(k => `<tr><td>${esc(CLS_ROTULO_FK[k] || k)}</td><td class="num">${esc(data.fica[k] || 0)}</td><td class="num">${esc(data.sai[k] || 0)}</td><td class="num">${esc((data.fica[k] || 0) + (data.sai[k] || 0))}</td></tr>`).join("");
  const contato = s && s.nome.includes(",") && clsVazio(f?.contato_nome) ? `<p class="meta">Contato depois da vírgula ("${esc(s.nome.split(",").slice(1).join(",").trim())}") vai para a pessoa de contato do que fica.</p>` : "";
  box.innerHTML = `${chaves.length ? `<div class="tabela-rola"><table>
      <thead><tr><th>Ligado ao cliente</th><th class="num">Fica hoje</th><th class="num">Vem do que sai</th><th class="num">Fica depois</th></tr></thead>
      <tbody>${linhas}</tbody></table></div>` : `<p class="meta">O cadastro que sai não tem nada ligado.</p>`}
    <p class="meta">"${esc(s?.nome || "")}" fica inativo (não é apagado) e o nome vai para o histórico. Campos vazios de "${esc(f?.nome || "")}" são completados com os do outro.</p>${contato}`;
  $("cls-btn-confirmar").disabled = false;
}

async function clsConfirmarJuntar(){
  const fica = $("cls-fica").value, sai = $("cls-sai").value;
  const f = cliPorId(fica), s = cliPorId(sai);
  if(!f || !s || fica === sai) return;
  if(!await uiConfirmar({ titulo: "Juntar clientes", texto: `Juntar "${s.nome}" em "${f.nome}"? Tudo o que está ligado ao primeiro passa para o segundo e o primeiro fica inativo.`, confirmar: "Juntar", perigo: true })) return;
  const { data, error } = await sb.rpc("clientes_juntar", { p_manter: fica, p_apagar: sai });
  if(error){ aviso("app-aviso", "Junção não feita: " + error.message, "erro"); return; }
  clsFecharJuntar();
  const mov = Object.entries(data.movidos || {}).filter(([, n]) => n > 0).map(([k, n]) => `${CLS_ROTULO_FK[k] || k} ${n}`).join(", ");
  await carregarClientes();
  aviso("app-aviso", `"${s.nome}" juntado em "${f.nome}". Movido: ${mov || "nada ligado"}.`, "sucesso");
}


function ligarClientesSaneamento(){
  $("cli-conteudo")?.addEventListener("click", (e) => {
    if(_cliView !== "corrigir") return;
    const j = e.target.closest("[data-cls-juntar]");
    if(j){ e.stopPropagation(); clsAbrirJuntar(j.dataset.clsJuntar, j.dataset.clsPar); return; }
    if(e.target.closest("#cls-btn-juntar")){ e.stopPropagation(); clsAbrirJuntar(); return; }
    if(e.target.closest("#cls-btn-lote")){ e.stopPropagation(); comBotaoTravado("cls-btn-lote", clsConsultarLote); return; }
    if(e.target.closest("#cls-lote-parar")){ e.stopPropagation(); if(_clsLote) _clsLote.parar = true; return; }
    if(e.target.closest("#cls-lote-gravar")){ e.stopPropagation(); comBotaoTravado("cls-lote-gravar", clsGravarLote); return; }
    if(e.target.closest("#cls-lote-descartar")){ e.stopPropagation(); _clsLote = null; clsRenderLote(); return; }
    if(e.target.closest("#cls-lote")) e.stopPropagation();
  }, true);
  $("cli-conteudo")?.addEventListener("change", (e) => {
    const m = e.target.closest("[data-cls-marca]");
    if(m && _clsLote) _clsLote.itens[+m.dataset.clsMarca].marcado = m.checked;
  });
  $("cls-fica")?.addEventListener("change", clsPrevia);
  $("cls-sai")?.addEventListener("change", clsPrevia);
  $("cls-btn-fechar")?.addEventListener("click", clsFecharJuntar);
  $("cls-btn-confirmar")?.addEventListener("click", () => comBotaoTravado("cls-btn-confirmar", clsConfirmarJuntar));
}

if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarClientesSaneamento);
else ligarClientesSaneamento();
