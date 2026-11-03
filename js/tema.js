/* Fase 138: tema claro/escuro — aplicado ANTES da primeira pintura.
   Carregado no <head> do index.html logo depois do css/estilo.css, sem depender de core.js nem de nada:
   lê a preferência do navegador (localStorage "cgl-tema", gravada por aplicarTema em core.js) e carimba
   data-theme="escuro" no <html> quando a escolha é escuro. No claro não carimba nada: o claro é o padrão do CSS.
   Em try/catch porque navegador com storage bloqueado (modo privado, política) cai no claro sem erro no console. */
(function(){
  try{
    if(localStorage.getItem("cgl-tema") === "escuro") document.documentElement.dataset.theme = "escuro";
  }catch(_){ /* sem storage: tema claro */ }
})();
