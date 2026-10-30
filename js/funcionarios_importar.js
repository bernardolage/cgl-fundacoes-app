/* ====================================================================
   Hotfix 224 (30/10/2026, chamado #224 do RH): funcionários novos pela planilha
   "Empregados em Excel" do sistema da folha (33 colunas). Spec:
   docs/specs/hotfix-224-importar-funcionarios-planilha.md.

   A planilha é lida AQUI no navegador (SheetJS de vendor/): CPF, salário, PIS, RG, CTPS e
   endereço nunca saem deste computador a não ser para as tabelas do próprio app, pelas
   mesmas policies do assistente de admissão (funcionarios_sensiveis e admissoes só rh e
   diretor, com a sessão confirmada por MFA). Nada de console.log com linha da planilha.

   Fluxo: botão "📥 Importar planilha" (só diretor e rh) → prévia com a situação de cada
   linha (Novo, Já cadastrado, Nome igual, Incompleto) → "Abrir na admissão" preenche o
   assistente de uma pessoa, ou "Cadastrar selecionados" grava em lote: funcionarios →
   funcionarios_sensiveis → admissoes (rascunho, origem planilha). Se os sensíveis falham,
   o cadastro recém-criado é apagado, para não sobrar funcionário sem CPF.
   ==================================================================== */
let _funcImp = { linhas: [], gravando: false };

/* cabeçalho da planilha (sem acento, caixa nem pontuação) → chave interna */
const FUNC_IMP_COLUNAS = {
  matricula: ["cod epr", "cod empregado", "codigo", "matricula"],
  nome: ["nome", "nome empregado", "nome do empregado"],
  admissao: ["admissao", "data admissao", "data de admissao"],
  salario: ["salario", "salario base"],
  cargo: ["descricao cargo", "descricao do cargo", "cargo", "funcao"],
  cbo: ["cbo"],
  cpf: ["cpf"],
  pis: ["pis", "pis pasep", "nis"],
  rg: ["rg"],
  rg_uf: ["uf rg"],
  rg_orgao: ["orgao rg", "orgao emissor", "orgao emissor rg"],
  nascimento: ["data nascimento", "data de nascimento", "nascimento"],
  nasc_cidade: ["cidade nascimento", "cidade de nascimento", "naturalidade"],
  nasc_uf: ["uf nasc", "uf nascimento"],
  logradouro: ["endereco", "logradouro"],
  numero: ["numero", "nro"],
  complemento: ["complemento"],
  bairro: ["bairro"],
  cep: ["cep"],
  cidade: ["cidade"],
  uf: ["uf end", "uf endereco", "uf"],
  celular: ["celular", "telefone"],
  titulo: ["titulo", "titulo eleitor", "titulo de eleitor"],
  zona: ["zona", "zona eleitoral"],
  secao: ["secao", "secao eleitoral"],
  ctps: ["ctps"],
  ctps_serie: ["serie ctps", "ctps serie"],
  ctps_uf: ["uf ctps"],
  mae: ["nome mae", "nome da mae"],
  pai: ["nome pai", "nome do pai"],
  sexo: ["sexo"],
  estado_civil: ["estado civil"],
  raca: ["raca cor", "raca", "cor raca"],
  instrucao: ["grau instrucao", "grau de instrucao", "escolaridade"]
};
const FUNC_IMP_UFS = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"];
const FUNC_IMP_MAX = 500;

function funcImpNorm(s){
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function funcImpTxt(v){
  if(v === null || v === undefined) return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  return t || null;
}
/* só dígitos; número do Excel perde o zero à esquerda, então repõe até o tamanho (CPF 11, PIS 11, CEP 8) */
function funcImpDigitos(v, tam){
  if(v === null || v === undefined || v === "") return null;
  let d = typeof v === "number" ? String(Math.round(v)) : String(v).replace(/\D/g, "");
  if(!d) return null;
  if(tam && d.length < tam) d = d.padStart(tam, "0");
  return d;
}
function funcImpData(v){
  if(v === null || v === undefined || v === "") return null;
  const pad = (n) => String(n).padStart(2, "0");
  if(typeof v === "number" && v > 0 && typeof XLSX !== "undefined" && XLSX.SSF){
    const p = XLSX.SSF.parse_date_code(v);
    return p && p.y > 1900 ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : null;
  }
  if(v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if(m){
    let a = Number(m[3]); if(a < 100) a += a > 40 ? 1900 : 2000;
    const d = Number(m[1]), me = Number(m[2]);
    if(me >= 1 && me <= 12 && d >= 1 && d <= 31) return `${a}-${pad(me)}-${pad(d)}`;
    return null;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function funcImpNum(v){
  if(v === null || v === undefined || v === "") return null;
  if(typeof v === "number") return isFinite(v) ? v : null;
  let s = String(v).replace(/[R$\s]/g, "");
  if(s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return isFinite(n) ? n : null;
}
function funcImpUf(v){
  const u = funcImpNorm(v).toUpperCase().replace(/\s/g, "");
  return FUNC_IMP_UFS.includes(u) ? u : null;
}
function funcImpCpfValido(c){
  if(!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  const dv = (n) => { let s = 0; for(let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}
function funcImpCpfMascara(c){ return c && c.length === 11 ? `***.***.*${c.slice(7, 9)}-${c.slice(9)}` : "—"; }
function funcImpCpfFormatado(c){ return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`; }
/* opção das listas do assistente: casa pelas 4 primeiras letras (Solteiro → Solteiro(a), PARDA → Parda) */
function funcImpOpcao(v, opcoes){
  const n = funcImpNorm(v);
  if(!n) return null;
  const o = opcoes.find(op => funcImpNorm(op).slice(0, 4) === n.slice(0, 4));
  return o || funcImpTxt(v);
}
function funcImpInstrucao(v){
  const n = funcImpNorm(v);
  if(!n) return null;
  const inc = /incomplet/.test(n) || /\b[1-8] ?[oa]? ?(ano|serie)\b/.test(n);
  if(/analfab/.test(n)) return "Analfabeto";
  if(/\bpos\b|mestr|doutor|especializ/.test(n)) return "Pós-graduação";
  if(/superior|graduac/.test(n)) return inc ? "Superior incompleto" : "Superior";
  if(/tecnic/.test(n)) return "Técnico";
  if(/medio|2 ?o? grau|segundo grau/.test(n)) return inc ? "Ensino Médio incompleto" : "Ensino Médio";
  if(/fundamental|1 ?o? grau|primeiro grau|\bano\b|serie/.test(n)) return inc ? "Ensino Fundamental incompleto" : "Ensino Fundamental";
  return funcImpTxt(v);
}
function funcImpSexo(v){
  const n = funcImpNorm(v);
  return n.startsWith("m") ? "M" : n.startsWith("f") ? "F" : null;
}
function funcImpJunta(a, b){
  const x = funcImpTxt(a), y = funcImpTxt(b);
  if(!x) return null;
  if(!y || funcImpNorm(x).includes(funcImpNorm(y))) return x;
  return `${x}/${y}`;
}

/* ---------- leitura ---------- */
function funcImpLerPlanilha(wb){
  const aba = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(aba, { header: 1, raw: true, defval: "" });
  let hi = -1, idx = {};
  for(let i = 0; i < Math.min(rows.length, 20); i++){
    const cab = (rows[i] || []).map(funcImpNorm);
    if(cab.includes("nome") && cab.includes("cpf")){
      hi = i;
      Object.entries(FUNC_IMP_COLUNAS).forEach(([k, nomes]) => {
        for(const n of nomes){ const j = cab.indexOf(n); if(j >= 0){ idx[k] = j; break; } }
      });
      break;
    }
  }
  if(hi < 0) throw new Error("Não achei a linha de cabeçalho com as colunas Nome e CPF nas 20 primeiras linhas. Use a exportação \"Empregados em Excel\" da folha.");
  const dados = rows.slice(hi + 1).filter(r => r && r.some(c => String(c ?? "").trim() !== ""));
  if(dados.length > FUNC_IMP_MAX) throw new Error(`A planilha tem ${dados.length} linhas; o limite por importação é ${FUNC_IMP_MAX}. Filtre só os admitidos novos.`);
  const g = (r, k) => idx[k] === undefined ? null : r[idx[k]];
  return dados.map((r, i) => {
    const cpf = funcImpDigitos(g(r, "cpf"), 11);
    const funcao = typeof funcPadronizarFuncao === "function" ? funcPadronizarFuncao(funcImpTxt(g(r, "cargo")) || "") : (funcImpTxt(g(r, "cargo")) || "");
    const l = {
      i, item: hi + 2 + i,
      matricula: (() => { const m = funcImpDigitos(g(r, "matricula")); return m ? String(Number(m)) : null; })(),
      nome: funcImpTxt(g(r, "nome")), admissao: funcImpData(g(r, "admissao")), salario: funcImpNum(g(r, "salario")),
      funcao: funcao || null, cbo: funcImpTxt(g(r, "cbo")), cpf,
      pis: funcImpDigitos(g(r, "pis"), 11), rg: funcImpTxt(g(r, "rg")),
      rg_orgao: funcImpJunta(g(r, "rg_orgao"), funcImpUf(g(r, "rg_uf"))),
      nascimento: funcImpData(g(r, "nascimento")),
      naturalidade: funcImpJunta(g(r, "nasc_cidade"), funcImpUf(g(r, "nasc_uf"))),
      logradouro: funcImpTxt(g(r, "logradouro")), numero: funcImpTxt(g(r, "numero")), complemento: funcImpTxt(g(r, "complemento")),
      bairro: funcImpTxt(g(r, "bairro")), cep: funcImpDigitos(g(r, "cep"), 8), cidade: funcImpTxt(g(r, "cidade")), uf: funcImpUf(g(r, "uf")),
      telefone: funcImpTxt(g(r, "celular")),
      titulo: funcImpDigitos(g(r, "titulo")), zona: funcImpTxt(g(r, "zona")), secao: funcImpTxt(g(r, "secao")),
      ctps: funcImpTxt(g(r, "ctps")), ctps_serie: funcImpJunta(g(r, "ctps_serie"), funcImpUf(g(r, "ctps_uf"))),
      mae: funcImpTxt(g(r, "mae")), pai: funcImpTxt(g(r, "pai")), sexo: funcImpSexo(g(r, "sexo")),
      estado_civil: funcImpOpcao(g(r, "estado_civil"), ["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Separado(a)", "Viúvo(a)"]),
      raca: funcImpOpcao(g(r, "raca"), ["Amarela", "Branca", "Indígena", "Parda", "Preta"]),
      instrucao: funcImpInstrucao(g(r, "instrucao")),
      situacao: "novo", motivo: "", existenteId: null, marcado: false, resultado: null, novoId: null
    };
    const falta = [];
    if(!l.nome) falta.push("nome");
    if(!l.cpf || !funcImpCpfValido(l.cpf)) falta.push("CPF válido");
    if(!l.admissao) falta.push("data de admissão");
    if(!l.funcao) falta.push("cargo");
    if(falta.length){ l.situacao = "incompleto"; l.motivo = "Falta " + falta.join(", ") + "."; }
    return l;
  });
}

/* ---------- situação de cada linha ---------- */
async function funcImpClassificar(linhas){
  // CPF: lê de funcionarios_sensiveis só o id dos CPFs que estão na planilha (com e sem pontuação)
  const cpfs = [...new Set(linhas.filter(l => l.cpf && l.situacao !== "incompleto").map(l => l.cpf))];
  const porCpf = {};
  for(let k = 0; k < cpfs.length; k += 100){
    const lote = cpfs.slice(k, k + 100);
    const { data, error } = await sb.from("funcionarios_sensiveis").select("funcionario_id,cpf").in("cpf", lote.concat(lote.map(funcImpCpfFormatado)));
    if(error) throw new Error("Não consegui conferir os CPFs já cadastrados: " + error.message);
    (data || []).forEach(x => { porCpf[String(x.cpf || "").replace(/\D/g, "")] = x.funcionario_id; });
  }
  const vistos = new Set();
  for(const l of linhas){
    if(l.situacao === "incompleto") continue;
    if(vistos.has(l.cpf)){ l.situacao = "incompleto"; l.motivo = "CPF repetido na planilha (linha anterior)."; continue; }
    vistos.add(l.cpf);
    const pelaMat = l.matricula ? _funcs.find(f => String(f.matricula || "").replace(/^0+/, "") === l.matricula) : null;
    if(porCpf[l.cpf]){ l.situacao = "existe"; l.existenteId = porCpf[l.cpf]; l.motivo = "CPF já cadastrado."; continue; }
    if(pelaMat){ l.situacao = "existe"; l.existenteId = pelaMat.id; l.motivo = `Matrícula ${l.matricula} já é de ${pelaMat.nome}.`; continue; }
    const iguais = _funcs.filter(f => funcNormalizarNome(f.nome) === funcNormalizarNome(l.nome));
    if(iguais.length){
      // homônimo: mesma regra da ficha; o existente precisa ter CPF (leitura auditada, só dos homônimos)
      let semCpf = null;
      for(const f of iguais){
        const s = await funcCarregarSensivel(f.id);
        if(!String(s?.cpf || "").replace(/\D/g, "")){ semCpf = f; break; }
      }
      if(semCpf){ l.situacao = "bloqueado"; l.existenteId = semCpf.id; l.motivo = `Já existe ${semCpf.nome} sem CPF no cadastro. Preencha o CPF dele primeiro (pode ser a mesma pessoa).`; continue; }
      l.situacao = "homonimo"; l.existenteId = iguais[0].id; l.motivo = `Nome igual a ${iguais[0].nome}, com CPF diferente. Confira antes de marcar.`;
      continue;
    }
    l.marcado = true;
  }
}

/* ---------- abrir, render, fechar ---------- */
async function funcImpAbrirArquivo(file){
  if(!funcVeSensivel() || (typeof ehSomenteLeitura === "function" && ehSomenteLeitura())){
    aviso("app-aviso", "Importar planilha: só RH e diretoria.", "erro"); return;
  }
  try {
    const { data: nivel } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if(nivel?.currentLevel !== "aal2"){
      aviso("app-aviso", "Os dados sensíveis exigem a sessão confirmada com o autenticador (MFA). Saia e entre de novo confirmando o código.", "erro");
      return;
    }
  } catch(_){ /* sem MFA disponível: o banco recusa e a prévia mostra o erro */ }
  _funcImp = { linhas: [], gravando: false };
  $("func-imp-linhas").innerHTML = "";
  $("func-imp-info").textContent = `Lendo ${file.name}… A planilha é lida aqui no navegador e não sai deste computador.`;
  aviso("func-imp-aviso", "", "");
  $("func-imp-modal").style.display = "flex";
  try {
    if(typeof XLSX === "undefined") throw new Error("Leitor de planilha não carregou. Recarregue a página.");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
    const linhas = funcImpLerPlanilha(wb);
    if(!linhas.length) throw new Error("A planilha não tem linhas de funcionário abaixo do cabeçalho.");
    if(!_funcs.length && typeof carregarFuncionarios === "function") await carregarFuncionarios();
    await funcImpClassificar(linhas);
    _funcImp.linhas = linhas;
    $("func-imp-info").textContent = `${file.name}: ${linhas.length} funcionário(s). A planilha é lida aqui no navegador e não sai deste computador. Confira cada linha antes de cadastrar.`;
  } catch(e){
    $("func-imp-info").textContent = "A planilha não foi lida.";
    aviso("func-imp-aviso", e.message || String(e), "erro");
  }
  funcImpRender();
}

const FUNC_IMP_TAG = {
  novo: ["verde", "Novo"], existe: ["cinza", "Já cadastrado"], homonimo: ["ambar", "Nome igual"],
  bloqueado: ["vermelho", "Travado"], incompleto: ["vermelho", "Incompleto"],
  feito: ["ok", "Cadastrado"], erro: ["vermelho", "Erro"]
};
function funcImpRender(){
  const tb = $("func-imp-linhas");
  if(!tb) return;
  tb.innerHTML = _funcImp.linhas.map(l => {
    const sit = l.resultado ? (l.resultado.ok ? "feito" : "erro") : l.situacao;
    const [cor, rot] = FUNC_IMP_TAG[sit] || ["cinza", sit];
    const pode = !l.resultado && (l.situacao === "novo" || l.situacao === "homonimo");
    const msg = l.resultado ? l.resultado.msg : l.motivo;
    const idFicha = l.novoId || l.existenteId;
    const acoes = [
      pode && !_funcImp.gravando ? `<button type="button" class="btn-sec" data-acao="admissao" data-i="${esc(l.i)}" title="Abre o assistente de admissão preenchido com esta linha (gera os PDFs ao concluir)">Abrir na admissão</button>` : "",
      idFicha ? `<button type="button" class="btn-sec" data-acao="ficha" data-id="${esc(idFicha)}">Abrir ficha</button>` : ""
    ].join(" ");
    return `<tr>
      <td><input type="checkbox" data-i="${esc(l.i)}" ${l.marcado ? "checked" : ""} ${pode && !_funcImp.gravando ? "" : "disabled"} /></td>
      <td>${esc(l.nome || "—")}<br><span class="meta">linha ${esc(l.item)}${l.matricula ? " · matr. " + esc(l.matricula) : ""}</span></td>
      <td>${esc(l.funcao || "—")}</td>
      <td>${esc(dataBR(l.admissao) || "—")}</td>
      <td>${esc(funcImpCpfMascara(l.cpf))}</td>
      <td><span class="tag ${esc(cor)}">${esc(rot)}</span>${msg ? `<br><span class="meta">${esc(msg)}</span>` : ""}</td>
      <td>${/* html */ acoes}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="7" class="meta">Nenhuma linha.</td></tr>`;
  funcImpContar();
}
function funcImpContar(){
  const n = _funcImp.linhas.filter(l => l.marcado && !l.resultado).length;
  const novos = _funcImp.linhas.filter(l => l.situacao === "novo").length;
  const feitos = _funcImp.linhas.filter(l => l.resultado?.ok).length;
  $("func-imp-contagem").textContent = `${novos} novo(s) na planilha · ${n} marcado(s)${feitos ? ` · ${feitos} cadastrado(s)` : ""}`;
  const b = $("btn-func-imp-gravar");
  b.disabled = !n || _funcImp.gravando;
  b.textContent = n ? `Cadastrar selecionados (${n})` : "Cadastrar selecionados";
  const todos = $("func-imp-todos");
  if(todos){
    const marcaveis = _funcImp.linhas.filter(l => !l.resultado && l.situacao === "novo");
    todos.checked = !!marcaveis.length && marcaveis.every(l => l.marcado);
    todos.disabled = !marcaveis.length || _funcImp.gravando;
  }
}
function funcImpFechar(){
  if(_funcImp.gravando) return;
  $("func-imp-modal").style.display = "none";
  $("func-imp-linhas").innerHTML = "";
  _funcImp = { linhas: [], gravando: false };   // solta os dados da planilha da memória da tela
}

/* ---------- abrir uma linha no assistente de admissão ---------- */
function funcImpParaAdmissao(l){
  funcImpFechar();
  funcAdmAbrir();
  const set = (id, v) => {
    const el = $(id);
    if(!el || v === null || v === undefined || v === "") return;
    if(el.tagName === "SELECT" && ![...el.options].some(o => o.value === String(v))){
      const o = document.createElement("option"); o.value = String(v); o.textContent = String(v); el.appendChild(o);
    }
    el.value = String(v);
  };
  set("adm-nome", l.nome); set("adm-cpf", l.cpf); set("adm-rg", l.rg); set("adm-rg-orgao", l.rg_orgao);
  set("adm-nascimento", l.nascimento); set("adm-sexo", l.sexo); set("adm-estado-civil", l.estado_civil);
  set("adm-naturalidade", l.naturalidade); set("adm-raca-cor", l.raca); set("adm-grau-instrucao", l.instrucao);
  set("adm-nome-mae", l.mae); set("adm-nome-pai", l.pai); set("adm-telefone", l.telefone);
  set("adm-ctps", l.ctps); set("adm-ctps-serie", l.ctps_serie); set("adm-pis", l.pis);
  set("adm-titulo-eleitor", l.titulo); set("adm-zona", l.zona); set("adm-secao", l.secao);
  set("adm-cep", l.cep); set("adm-logradouro", l.logradouro); set("adm-numero", l.numero); set("adm-complemento", l.complemento);
  set("adm-bairro", l.bairro); set("adm-cidade", l.cidade); set("adm-uf", l.uf);
  set("adm-matricula", l.matricula); set("adm-funcao", l.funcao); set("adm-cbo", l.cbo); set("adm-data", l.admissao);
  if(l.salario !== null){ set("adm-salario", l.salario); $("adm-salario")?.dispatchEvent(new Event("input")); }
  funcAdmCalcVencimentos(true);
  funcAdmSugerirModelo();
  aviso("adm-aviso", "Dados preenchidos pela planilha. Confira cada etapa e complete o que a folha não traz (banco, contato de emergência, benefícios).", "aviso");
}

/* ---------- cadastrar em lote ---------- */
async function funcImpGravarLinha(l){
  const padrao = typeof ADM_PADROES === "object" ? ADM_PADROES : {};
  const funcionario = {
    nome: l.nome, matricula: l.matricula, funcao: l.funcao, status: "ativo", ativo: true,
    data_admissao: l.admissao, telefone: l.telefone, tipo_contrato: "clt"
  };
  const r1 = await sb.from("funcionarios").insert(funcionario).select("id").single();
  if(r1.error) return { ok: false, msg: /matricula/i.test(r1.error.message) ? "Matrícula já em uso." : "Erro ao cadastrar: " + r1.error.message };
  const id = r1.data.id;
  const sens = {
    funcionario_id: id, cpf: l.cpf, rg: l.rg, rg_orgao_emissor: l.rg_orgao, data_nascimento: l.nascimento, sexo: l.sexo,
    estado_civil: l.estado_civil, naturalidade: l.naturalidade, nacionalidade: padrao["adm-nacionalidade"] || "Brasileira",
    raca_cor: l.raca, grau_instrucao: l.instrucao, nome_mae: l.mae, nome_pai: l.pai,
    ctps: l.ctps, ctps_serie: l.ctps_serie, pis: l.pis, titulo_eleitor: l.titulo, zona_eleitoral: l.zona, secao_eleitoral: l.secao,
    cep: l.cep, logradouro: l.logradouro, numero: l.numero, complemento: l.complemento, bairro: l.bairro, cidade: l.cidade, uf: l.uf,
    salario_contabil: l.salario, horario_trabalho: padrao["adm-horario"] || null, intervalo: padrao["adm-intervalo"] || null,
    horas_semanais: padrao["adm-horas-semanais"] ? Number(padrao["adm-horas-semanais"]) : null, forma_pagamento: padrao["adm-forma-pagamento"] || null
  };
  const r2 = await sb.from("funcionarios_sensiveis").upsert(sens, { onConflict: "funcionario_id" });
  if(r2.error){
    const desfez = await sb.from("funcionarios").delete().eq("id", id);
    const base = /cpf/i.test(r2.error.message) ? "CPF já cadastrado em outro funcionário." : "Dados sensíveis recusados: " + r2.error.message;
    return { ok: false, msg: base + (desfez.error ? " O cadastro ficou criado sem os dados sensíveis; confira a ficha." : " Nada foi gravado.") , id: desfez.error ? id : null };
  }
  const soma = (iso, dias) => dataLocalISO(new Date(new Date(iso + "T00:00:00").getTime() + dias * 864e5));
  const v1 = soma(l.admissao, 44), v2 = soma(v1, 45);   // 45 + 45, o dia da admissão conta (mesma conta do assistente)
  const adm = {
    funcionario_id: id, data_admissao: l.admissao, funcao: l.funcao, cbo: l.cbo, salario: l.salario,
    prazo_experiencia_dias: 45, prorrogacao_dias: 45, vencimento_1: v1, vencimento_2: v2,
    tipo_documento: /AJUDANTE|SOLDADOR/.test(funcNormalizarNome(l.funcao)) ? "ajudante_soldador" : "padrao",
    status: "rascunho", origem: "planilha", item_planilha: l.item,
    observacoes: `Importada da planilha da folha em ${dataBR(hojeISO())} (hotfix 224)`
  };
  const r3 = await sb.from("admissoes").insert(adm);
  if(r3.error) return { ok: true, id, msg: "Cadastrado, mas a admissão não foi registrada: " + r3.error.message };
  return { ok: true, id, msg: "Cadastrado com a admissão em rascunho. PDFs pela aba Documentos." };
}
async function funcImpGravar(){
  const alvo = _funcImp.linhas.filter(l => l.marcado && !l.resultado && (l.situacao === "novo" || l.situacao === "homonimo"));
  if(!alvo.length) return;
  if(!confirm(`Cadastrar ${alvo.length} funcionário(s) com os dados da planilha?`)) return;
  _funcImp.gravando = true; funcImpRender();
  let ok = 0;
  for(const l of alvo){
    aviso("func-imp-aviso", `Cadastrando ${ok + 1} de ${alvo.length}…`, "aviso");
    try { l.resultado = await funcImpGravarLinha(l); }
    catch(e){ l.resultado = { ok: false, msg: e.message || String(e) }; }
    if(l.resultado.id) l.novoId = l.resultado.id;
    if(l.resultado.ok) ok++;
    l.marcado = false;
  }
  _funcImp.gravando = false;
  if(typeof _funcLog !== "undefined") _funcLog = null;
  if(typeof carregarFuncionarios === "function") await carregarFuncionarios();
  funcImpRender();
  const falhas = alvo.length - ok;
  aviso("func-imp-aviso", `${ok} cadastrado(s)${falhas ? `, ${falhas} com erro (motivo na linha)` : ""}.`, falhas ? "erro" : "ok");
}

/* ---------- listeners ---------- */
function ligarFuncImportar(){
  $("btn-func-importar")?.addEventListener("click", () => $("func-imp-arquivo")?.click());
  $("func-imp-arquivo")?.addEventListener("change", (ev) => {
    const f = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if(f) funcImpAbrirArquivo(f);
  });
  $("btn-func-imp-fechar")?.addEventListener("click", funcImpFechar);
  $("btn-func-imp-gravar")?.addEventListener("click", () => comBotaoTravado("btn-func-imp-gravar", funcImpGravar));
  $("func-imp-todos")?.addEventListener("change", (ev) => {
    _funcImp.linhas.forEach(l => { if(!l.resultado && l.situacao === "novo") l.marcado = ev.target.checked; });
    funcImpRender();
  });
  $("func-imp-linhas")?.addEventListener("change", (ev) => {
    const cb = ev.target.closest("input[type=checkbox][data-i]");
    if(!cb) return;
    const l = _funcImp.linhas[Number(cb.dataset.i)];
    if(l) l.marcado = cb.checked;
    funcImpContar();
  });
  $("func-imp-linhas")?.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-acao]");
    if(!b || _funcImp.gravando) return;
    if(b.dataset.acao === "admissao"){ const l = _funcImp.linhas[Number(b.dataset.i)]; if(l) funcImpParaAdmissao(l); }
    if(b.dataset.acao === "ficha"){ const id = b.dataset.id; funcImpFechar(); if(id) abrirFuncionario(id); }
  });
}
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", ligarFuncImportar);
else ligarFuncImportar();
