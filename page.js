// Preview page. Independent of the toolbar and the engine.
(() => {
  const status = document.querySelector(".page-status");

  // Shows messages from any widget that dispatches "toolbar:status" (see toolbar.js).
  document.addEventListener("toolbar:status", (event) => {
    status.textContent = event.detail;
  });

  // Demo-only subscribe form: no request is sent.
  document.querySelector("main form").addEventListener("submit", (event) => {
    event.preventDefault();
    event.target.reset();
    status.textContent = "Thanks! You're on the list.";
  });
})();
