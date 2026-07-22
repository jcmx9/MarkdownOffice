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
  var archiveDialog = document.getElementById("archive-dialog");
  var archiveTitle = document.getElementById("archive-title");
  var lettersList = document.getElementById("letters");
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
      "  - ",
      "  - ",
      "  - ",
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

  // Accent colour picker <-> hex field. The hex field stays the source of truth
  // (empty = template default); the picker mirrors it and offers a preview.
  var accentPicker = document.getElementById("accent-picker");
  var accentHex = document.getElementById("accent-hex");
  var sigState = document.getElementById("sig-state");
  var sigRemove = document.getElementById("sig-remove");

  function syncPickerFromHex() {
    if (/^#[0-9a-fA-F]{6}$/.test(accentHex.value.trim())) {
      accentPicker.value = accentHex.value.trim();
    }
  }
  accentPicker.addEventListener("input", function () { accentHex.value = accentPicker.value; });
  accentHex.addEventListener("input", syncPickerFromHex);

  function setSignatureState(present) {
    sigState.textContent = present ? "Signatur hinterlegt" : "keine hinterlegt";
    sigRemove.hidden = !present;
  }

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
    form.signature_width.value = p.signature_width || "";
    document.getElementById("signature-file").value = "";
    syncPickerFromHex();
    setSignatureState(!!p.signature);
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
      signature_width: parseFloat(form.signature_width.value) || 0,
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

  // --- Archive (saved letters) ----------------------------------------------

  function letterProfile(source) {
    var m = source.match(/^\s*profile:\s*(.+?)\s*$/m);
    return m ? m[1].trim() : (profileSel.value || "default");
  }

  async function saveLetter() {
    var source = view.state.doc.toString();
    var profile = letterProfile(source);
    statusEl.textContent = "Speichere…";
    try {
      var res = await fetch("/letters/" + encodeURIComponent(profile), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "source=" + encodeURIComponent(source),
      });
      if (!res.ok) {
        statusEl.textContent = "";
        showError(await res.text());
        return;
      }
      var data = await res.json();
      statusEl.textContent = "Gespeichert: " + data.id;
    } catch (e) {
      statusEl.textContent = "";
      showError("Netzwerkfehler: " + e.message);
    }
  }

  function letterItem(profile, m) {
    var li = document.createElement("li");
    var open = document.createElement("button");
    open.type = "button";
    open.className = "letter-open";
    open.textContent = m.subject || "(ohne Betreff)";
    if (m.recipient) open.textContent += " — " + m.recipient;
    var id = document.createElement("small");
    id.textContent = m.id;
    open.appendChild(document.createElement("br"));
    open.appendChild(id);
    open.addEventListener("click", async function () {
      try {
        var r = await fetch("/letters/" + encodeURIComponent(profile) + "/" + encodeURIComponent(m.id));
        if (r.ok) {
          setDoc(await r.text());
          archiveDialog.close();
        }
      } catch (e) { /* ignore */ }
    });
    var del = document.createElement("button");
    del.type = "button";
    del.className = "danger letter-del";
    del.textContent = "×";
    del.title = "Brief löschen";
    del.addEventListener("click", async function () {
      await fetch("/letters/" + encodeURIComponent(profile) + "/" + encodeURIComponent(m.id), { method: "DELETE" });
      openArchive();
    });
    li.appendChild(open);
    li.appendChild(del);
    return li;
  }

  async function openArchive() {
    var profile = profileSel.value || "default";
    archiveTitle.textContent = "Briefe – Profil „" + profile + "“";
    lettersList.innerHTML = "";
    try {
      var res = await fetch("/letters/" + encodeURIComponent(profile));
      var metas = res.ok ? await res.json() : [];
      if (!metas.length) {
        var empty = document.createElement("li");
        empty.className = "empty";
        empty.textContent = "Noch keine gespeicherten Briefe.";
        lettersList.appendChild(empty);
      } else {
        metas.forEach(function (m) { lettersList.appendChild(letterItem(profile, m)); });
      }
    } catch (e) { /* non-fatal */ }
    if (!archiveDialog.open) archiveDialog.showModal();
  }

  document.getElementById("save").addEventListener("click", saveLetter);
  document.getElementById("archive").addEventListener("click", openArchive);
  document.getElementById("archive-close").addEventListener("click", function () { archiveDialog.close(); });

  document.getElementById("manage").addEventListener("click", openDialog);
  document.getElementById("profile-new").addEventListener("click", function () {
    dialogClearError();
    fillForm("", null);
    form.slug.focus();
  });
  document.getElementById("profile-delete").addEventListener("click", deleteProfile);
  document.getElementById("profile-close").addEventListener("click", function () { dialog.close(); });
  sigRemove.addEventListener("click", async function () {
    var slug = form.slug.value.trim();
    if (!slug) { setSignatureState(false); return; }
    try {
      var res = await fetch("/profiles/" + encodeURIComponent(slug) + "/signature", { method: "DELETE" });
      if (res.ok) {
        setSignatureState(false);
        document.getElementById("signature-file").value = "";
      } else {
        dialogShowError(await res.text());
      }
    } catch (e) {
      dialogShowError("Netzwerkfehler: " + e.message);
    }
  });
  form.addEventListener("submit", function (e) { e.preventDefault(); saveProfile(); });

  loadProfiles();
  render(initial);
})();
