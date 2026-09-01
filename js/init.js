/* ====================================================================
   init.js — executado por último, depois que core.js e todos os
   módulos já registraram suas funções. Faz o arranque da aplicação.
   ==================================================================== */

/* preenche os selects fixos (UFs, unidades, status) */
montarSelects();

/* preenche datas padrão dos formulários com a data de hoje */
["orc-data","med-data"].forEach(id=>{ const el = $(id); if(el) el.value = hojeISO(); });

/* Arranque: primeiro consome um token que tenha vindo no hash (magic link /
   convite / recuperação), depois verifica a sessão e entra no app. */
(async () => {
  await consumirTokenDoHash();
  const { data:{ session } } = await sb.auth.getSession();
  if(session) iniciarApp();
})();
