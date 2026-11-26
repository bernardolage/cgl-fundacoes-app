





montarSelects();


["orc-data","med-data"].forEach(id=>{ const el = $(id); if(el) el.value = hojeISO(); });



(async () => {

  if(_primeiroAcessoToken !== null){ abrirPrimeiroAcesso(); return; }
  await consumirTokenDoHash();
  const { data:{ session } } = await sb.auth.getSession();
  if(session) iniciarApp();
})();
