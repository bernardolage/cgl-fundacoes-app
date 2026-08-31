/* ====================================================================
   init.js — executado por último, depois que core.js e todos os
   módulos já registraram suas funções. Faz o arranque da aplicação.
   ==================================================================== */

/* preenche os selects fixos (UFs, unidades, status) */
montarSelects();

/* preenche datas padrão dos formulários com a data de hoje */
["orc-data","med-data"].forEach(id=>{ const el = $(id); if(el) el.value = hojeISO(); });

/* se já houver uma sessão ativa, entra direto no app */
sb.auth.getSession().then(({ data:{ session } })=>{
  if(session) iniciarApp();
});
