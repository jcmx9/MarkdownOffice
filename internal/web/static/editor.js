// Editor glue: mount CodeMirror, debounce edits, POST to /render, and manage
// sender profiles (list, new-letter-from-profile, create/edit/delete, signature
// upload) via the /profiles endpoints.
(function () {
  "use strict";

  var initial = document.getElementById("default-letter").value;
  var errorEl = document.getElementById("error");
  var statusEl = document.getElementById("status");
  var preview = document.getElementById("preview");
  var download = document.getElementById("download");
  var profileSel = document.getElementById("profile");
  var dialog = document.getElementById("profile-dialog");
  var form = document.getElementById("profile-form");
  var dialogError = document.getElementById("dialog-error");
  var lastURL = null;
  var timer = null;
  var view = null;

  function showError(msg) { errorEl.textContent = msg; errorEl.hidden = false; }
  function clearError() { errorEl.hidden = true; errorEl.textContent = ""; }

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
    timer = setTimeout(function () { render(source); }, 500);
  }

  function setDoc(text) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }

  view = MDO.createEditor(document.getElementById("editor"), initial, schedule);

  download.addEventListener("click", function () {
    if (!lastURL) return;
    var a = document.createElement("a");
    a.href = lastURL;
    a.download = "brief.pdf";
    a.click();
  });

  // --- Profiles --------------------------------------------------------------

  async function loadProfiles(selectName) {
    try {
      var res = await fetch("/profiles");
      var names = res.ok ? await res.json() : [];
      profileSel.innerHTML = "";
      names.forEach(function (n) {
        var opt = document.createElement("option");
        opt.value = n;
        opt.textContent = n;
        profileSel.appendChild(opt);
      });
      if (selectName && names.indexOf(selectName) >= 0) profileSel.value = selectName;
    } catch (e) {
      /* listing profiles is non-fatal */
    }
  }

  function newLetterSkeleton(profile) {
    return [
      "---",
      "profile: " + profile,
      "recipient:",
      "  name: ",
      "  street: ",
      "  zip: ",
      "  city: ",
      "subject: ",
      "date: null",
      "closing: Mit freundlichen Grüßen",
      "sign: false",
      "---",
      "",
      "Sehr geehrte Damen und Herren,",
      "",
      "",
    ].join("\n");
  }

  document.getElementById("new-letter").addEventListener("click", function () {
    setDoc(newLetterSkeleton(profileSel.value || "default"));
  });

  // --- Profile dialog --------------------------------------------------------

  function dialogShowError(msg) { dialogError.textContent = msg; dialogError.hidden = false; }
  function dialogClearError() { dialogError.hidden = true; dialogError.textContent = ""; }

  function fillForm(slug, p) {
    p = p || {};
    var bank = p.bank || {};
    form.slug.value = slug || "";
    form.name.value = p.name || "";
    form.street.value = p.street || "";
    form.zip.value = p.zip || "";
    form.city.value = p.city || "";
    form.phone.value = p.phone || "";
    form.email.value = p.email || "";
    form.accent.value = p.accent || "";
    form.holder.value = bank.holder || "";
    form.iban.value = bank.iban || "";
    form.bic.value = bank.bic || "";
    form.bank_name.value = bank.bank_name || "";
    form.print_qr.checked = slug ? !!p.print_qr : true;
    document.getElementById("signature-file").value = "";
  }

  async function openDialog() {
    dialogClearError();
    var slug = profileSel.value;
    if (slug) {
      try {
        var res = await fetch("/profiles/" + encodeURIComponent(slug));
        fillForm(slug, res.ok ? await res.json() : null);
      } catch (e) {
        fillForm(slug, null);
      }
    } else {
      fillForm("", null);
    }
    dialog.showModal();
  }

  function formToProfile() {
    var p = {
      name: form.name.value,
      street: form.street.value,
      zip: form.zip.value,
      city: form.city.value,
      phone: form.phone.value,
      email: form.email.value,
      accent: form.accent.value,
      print_qr: form.print_qr.checked,
      signature_height: 15,
    };
    if (form.iban.value || form.bic.value || form.bank_name.value || form.holder.value) {
      p.bank = {
        holder: form.holder.value,
        iban: form.iban.value,
        bic: form.bic.value,
        bank_name: form.bank_name.value,
      };
    }
    return p;
  }

  async function saveProfile() {
    dialogClearError();
    var slug = form.slug.value.trim();
    if (!/^[a-z0-9_-]+$/.test(slug)) {
      dialogShowError("Kurzname: nur a–z, 0–9, - und _.");
      return;
    }
    if (!form.name.value || !form.street.value || !form.zip.value || !form.city.value) {
      dialogShowError("Name, Straße, PLZ und Ort sind Pflichtfelder.");
      return;
    }
    try {
      var res = await fetch("/profiles/" + encodeURIComponent(slug), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formToProfile()),
      });
      if (!res.ok) {
        dialogShowError(await res.text());
        return;
      }
      var fileInput = document.getElementById("signature-file");
      if (fileInput.files.length) {
        var fd = new FormData();
        fd.append("file", fileInput.files[0]);
        var sres = await fetch("/profiles/" + encodeURIComponent(slug) + "/signature", { method: "POST", body: fd });
        if (!sres.ok) {
          dialogShowError(await sres.text());
          return;
        }
      }
      await loadProfiles(slug);
      dialog.close();
    } catch (e) {
      dialogShowError("Netzwerkfehler: " + e.message);
    }
  }

  async function deleteProfile() {
    var slug = form.slug.value.trim();
    if (!slug) { dialog.close(); return; }
    try {
      var res = await fetch("/profiles/" + encodeURIComponent(slug), { method: "DELETE" });
      if (!res.ok) {
        dialogShowError(await res.text());
        return;
      }
      await loadProfiles();
      dialog.close();
    } catch (e) {
      dialogShowError("Netzwerkfehler: " + e.message);
    }
  }

  document.getElementById("manage").addEventListener("click", openDialog);
  document.getElementById("profile-new").addEventListener("click", function () {
    dialogClearError();
    fillForm("", null);
    form.slug.focus();
  });
  document.getElementById("profile-delete").addEventListener("click", deleteProfile);
  document.getElementById("profile-close").addEventListener("click", function () { dialog.close(); });
  form.addEventListener("submit", function (e) { e.preventDefault(); saveProfile(); });

  loadProfiles();
  render(initial);
})();
