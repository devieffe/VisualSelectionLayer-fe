// Preview page. Independent of the toolbar and the engine.
(() => {
  const status = document.querySelector(".page-status");
  const main = document.querySelector("main");

  // Pressing on a picture or on already-selected content starts a new selection instead of a
  // native drag (which would drag a ghost of the content and leave the selection unchanged).
  main.querySelectorAll("img").forEach((img) => { img.draggable = false; });
  main.addEventListener("mousedown", (event) => {
    if (event.button !== 0 || event.shiftKey || event.target.closest("input, textarea, select, button, a")) return;
    const selection = getSelection();
    if (!selection.isCollapsed) selection.removeAllRanges();
    if (event.target.localName === "img") selectFromImage(event);
  }, true);

  // Chrome and Safari start no selection on a picture, so drive it by hand: the anchor sits
  // after the picture when dragging up and before it when dragging down, so the picture is included.
  function selectFromImage(event) {
    event.preventDefault();
    const img = event.target;
    const index = [...img.parentNode.childNodes].indexOf(img);
    const caretAt = (x, y) => {
      const p = document.caretPositionFromPoint?.(x, y);
      if (p) return [p.offsetNode, p.offset];
      const r = document.caretRangeFromPoint?.(x, y);
      return r ? [r.startContainer, r.startOffset] : null;
    };
    const move = (e) => {
      const focus = caretAt(e.clientX, e.clientY);
      if (!focus || !main.contains(focus[0])) return;
      const up = e.clientY < event.clientY;
      getSelection().setBaseAndExtent(img.parentNode, index + (up ? 1 : 0), ...focus);
    };
    const stop = () => {
      removeEventListener("mousemove", move);
      removeEventListener("mouseup", stop);
    };
    addEventListener("mousemove", move);
    addEventListener("mouseup", stop);
  }

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
