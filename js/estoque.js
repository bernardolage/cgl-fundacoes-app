/* ====================================================================
   Módulo: Entrada de Estoque
   Layout: simplificado no padrão Serviços + Odoo.
   ==================================================================== */

let _ultimasEntradas = [];

/* ---------- Fornecedores (select da entrada) ---------- */
async function carregarFornecedores(){
  const { data } = await sb.from("fornecedores").select("id,razao_social").eq("ativo",true).order("razao_social");
  $("ent-fornecedor").innerHTML = '<option value="">— não informado —</option>' +
    (data||[]).map(f=>`<option value="${esc(f.id)}">${esc(f.razao_social)}</option>`).join("");
}

/* ---------- Últimas entradas ---------- */
async function carregarUltimasEntradas(){
  const { data, error } = await sb.from("movimentacoes_estoque")
    .select("id,produto_id,tipo,quantidade,custo_unitario,custo_total,fornecedor_id,documento,data_movimentacao")
    .eq("tipo","entrada")
    .order("data_movimentacao", { ascending: false })
    .limit(50);
  _ultimasEntradas = error ? [] : (data || []);
  renderUltimasEntradas();
}

function renderUltimasEntradas(){
  const cont = $("ent-historico");
  if(!cont) return;
  const termo = ($("ent-busca")?.value || "").trim().toLowerCase();
  // Mapeia produtos pra nomes (precisa _produtos do produtos.js)
  const mapaProd = {};
  (typeof _produtos !== "undefined" ? _produtos : []).forEach(p => mapaProd[p.id] = `${p.codigo} — ${p.nome}`);
  const filtradas = _ultimasEntradas.filter(m => {
    if(!termo) return true;
    const prod = (mapaProd[m.produto_id] || "").toLowerCase();
    const forn = (mapaFornecedores[m.fornecedor_id] || "").toLowerCase();
    return prod.includes(termo) || forn.includes(termo) || (m.documento||"").toLowerCase().includes(termo);
  });
  if(!filtradas.length){
    cont.innerHTML = `<p class="vazio">Nenhuma entrada registrada.</p>`;
    return;
  }
  const linhas = filtradas.map(m => {
    const d = new Date(m.data_movimentacao);
    return `<tr>
      <td>${d.toLocaleDateString("pt-BR")}</td>
      <td>${esc(mapaProd[m.produto_id] || "—")}</td>
      <td class="num">${num(m.quantidade)}</td>
      <td class="num">${brl(m.custo_unitario)}</td>
      <td class="num">${brl(m.custo_total)}</td>
      <td>${esc(mapaFornecedores[m.fornecedor_id] || "—")}</td>
      <td>${esc(m.documento || "—")}</td>
    </tr>`;
  }).join("");
  cont.innerHTML = `<div class="tabela-rola"><table>
    <thead><tr>
      <th>Data</th><th>Produto</th><th class="num">Qtd</th>
      <th class="num">Custo unit.</th><th class="num">Total</th><th>Fornecedor</th><th>Documento</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

/* ---------- Submit ---------- */
async function registrarEntrada(){
  if(!$("ent-produto").value){ aviso("app-aviso","Selecione um produto.","erro"); return; }
  const reg = {
    produto_id: $("ent-produto").value,
    tipo: "entrada",
    quantidade: Number($("ent-qtd").value),
    custo_unitario: Number($("ent-custo").value),
    fornecedor_id: $("ent-fornecedor").value || null,
    documento: $("ent-doc").value.trim() || null
  };
  if(!reg.quantidade || reg.quantidade <= 0){ aviso("app-aviso","Informe a quantidade.","erro"); return; }
  if(!(reg.custo_unitario >= 0)){ aviso("app-aviso","Informe o custo unitário.","erro"); return; }

  const { error } = await sb.from("movimentacoes_estoque").insert(reg);
  if(error){ aviso("app-aviso","Não foi possível registrar a entrada: "+error.message,"erro"); return; }
  aviso("app-aviso","Entrada registrada — estoque e custo atualizados.","ok");
  $("ent-qtd").value = "";
  $("ent-custo").value = "";
  $("ent-doc").value = "";
  if(typeof carregarProdutos === "function") await carregarProdutos();
  if(typeof carregarDashboard === "function") await carregarDashboard();
  await carregarUltimasEntradas();
}

async function criarNovoFornecedorRapido(){
  const nome = prompt("Razão social do novo fornecedor:");
  if(!nome) return;
  const { error } = await sb.from("fornecedores").insert({ razao_social: nome.trim() });
  if(error){ aviso("app-aviso","Erro ao criar fornecedor: "+error.message,"erro"); return; }
  await carregarFornecedores();
  aviso("app-aviso","Fornecedor criado.","ok");
}

/* ---------- Listeners ---------- */
function ligarEstoque(){
  $("btn-registrar-entrada")?.addEventListener("click", () => comBotaoTravado("btn-registrar-entrada", registrarEntrada));
  $("btn-novo-forn")?.addEventListener("click", criarNovoFornecedorRapido);
  $("ent-busca")?.addEventListener("input", renderUltimasEntradas);

  const navEst = document.querySelector('nav button[data-secao="estoque"]');
  if(navEst) navEst.addEventListener("click", carregarUltimasEntradas);
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", ligarEstoque);
} else {
  ligarEstoque();
}
