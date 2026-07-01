// Editor glue: mount CodeMirror, debounce edits, POST to /render, show the PDF
// in the preview iframe or the error message in the alert box.
(function () {
  "use strict";

  var initial = document.getElementById("default-letter").value;
  var errorEl = document.getElementById("error");
  var statusEl = document.getElementById("status");
  var preview = document.getElementById("preview");
  var download = document.getElementById("download");
  var lastURL = null;
  var timer = null;

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  async function render(source) {
    statusEl.textContent = "Erzeuge PDF…";
    try {
      var res = await fetch("/render", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "source=" + encodeURIComponent(source),
      });
      if (!res.ok) {
        showError(await res.text());
        statusEl.textContent = "";
        return;
      }
      clearError();
      var blob = await res.blob();
      if (lastURL) URL.revokeObjectURL(lastURL);
      lastURL = URL.createObjectURL(blob);
      preview.src = lastURL;
      download.disabled = false;
      statusEl.textContent = "";
    } catch (e) {
      showError("Netzwerkfehler: " + e.message);
      statusEl.textContent = "";
    }
  }

  function schedule(source) {
    clearTimeout(timer);
    timer = setTimeout(function () {
      render(source);
    }, 500);
  }

  MDO.createEditor(document.getElementById("editor"), initial, schedule);

  download.addEventListener("click", function () {
    if (!lastURL) return;
    var a = document.createElement("a");
    a.href = lastURL;
    a.download = "brief.pdf";
    a.click();
  });

  render(initial);
})();
