/* Centro de Control · capa de datos para Google Apps Script.
   Imita lo que las páginas usaban dentro de Claude (window.claude.use("db" | "mcp" | "assets"))
   pero guardando todo en la hoja de Google «Centro de Control – datos» a través de google.script.run. */
(function () {
  var CDC = window.__CDC || {};
  /* Si Google no contesta (pasa sobre todo con varias cuentas de Google abiertas en el mismo navegador),
     la llamada se da por fallida a los 20 s y la página avisa, en vez de quedarse cargando para siempre. */
  var fallos = 0;
  function run(action, payload) {
    return new Promise(function (res, rej) {
      if (!window.google || !google.script || !google.script.run) { rej(new Error("sin_apps_script")); return; }
      var hecho = false;
      var t = setTimeout(function () { if (hecho) return; hecho = true; fallos++; avisar(); rej(new Error("sin_respuesta")); }, 20000);
      google.script.run
        .withSuccessHandler(function (r) { if (hecho) return; hecho = true; clearTimeout(t); fallos = 0; quitarAviso(); try { res(typeof r === "string" ? JSON.parse(r) : r); } catch (e) { res(r); } })
        .withFailureHandler(function (e) { if (hecho) return; hecho = true; clearTimeout(t); fallos++; avisar(e); rej(e); })
        .api(action, JSON.stringify(payload || {}));
    });
  }
  function avisar(e) {
    if (document.getElementById("cdc-aviso") || !document.body) return;
    var d = document.createElement("div"); d.id = "cdc-aviso";
    d.setAttribute("role", "alert");
    d.style.cssText = "position:fixed;left:12px;right:12px;top:12px;z-index:9999;background:#25291F;color:#fff;border-radius:12px;padding:14px 16px;font:15px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)";
    d.innerHTML = "<b>Google no deja leer tus datos.</b><br>Casi siempre es porque en este navegador hay <b>más de una cuenta de Google</b> abierta. " +
      "Abre el enlace en una <b>ventana privada</b> (o en un navegador donde solo tengas tu cuenta) e inicia sesión solo con la tuya." +
      "<div style='margin-top:10px;display:flex;gap:8px;flex-wrap:wrap'><button id='cdc-re' style='border:0;border-radius:8px;padding:8px 14px;font-weight:700'>Volver a intentarlo</button>" +
      "<button id='cdc-x' style='border:1px solid #fff;background:none;color:#fff;border-radius:8px;padding:8px 14px'>Cerrar</button></div>";
    document.body.appendChild(d);
    document.getElementById("cdc-re").onclick = function () { window.top.location.href = (CDC.url || location.href) + (CDC.app ? "?app=" + CDC.app : ""); };
    document.getElementById("cdc-x").onclick = quitarAviso;
  }
  function quitarAviso() { var d = document.getElementById("cdc-aviso"); if (d) d.remove(); }
  /* Cada página guarda sus colecciones en pestañas propias: panel_tasks, labores_patrones, tests_progreso…
     Para usar la de otra página se escribe «app:colección» (p. ej. "panel:tasks" desde Mis labores). */
  function tabla(col) { return col.indexOf(":") > 0 ? col.replace(":", "_") : (CDC.app || "panel") + "_" + col; }
  var subs = {};
  function snapOf(rows) { return { docs: (rows || []).map(function (r) { return { id: r.id, exists: true, data: function () { return r.data; } }; }) }; }
  function refresh(col) {
    return run("list", { col: tabla(col) }).then(function (rows) {
      (subs[col] || []).forEach(function (f) { try { f(snapOf(rows)); } catch (e) { console.error(e); } });
      return rows;
    });
  }
  function nuevoId() { return "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function doc(col, id) {
    id = id || nuevoId();
    return {
      id: id,
      get: function () { return run("get", { col: tabla(col), id: id }).then(function (d) { return { id: id, exists: !!d, data: function () { return d; } }; }); },
      set: function (data) { return run("set", { col: tabla(col), id: id, data: data }).then(function () { refresh(col).catch(function () {}); }); },
      update: function (data) { return run("update", { col: tabla(col), id: id, data: data }).then(function () { refresh(col).catch(function () {}); }); },
      delete: function () { return run("delete", { col: tabla(col), id: id }).then(function () { refresh(col).catch(function () {}); }); }
    };
  }
  function collection(col) {
    return {
      doc: function (id) { return doc(col, id); },
      get: function () { return run("list", { col: tabla(col) }).then(snapOf); },
      onSnapshot: function (f, err) {
        (subs[col] = subs[col] || []).push(f);
        refresh(col).catch(function (e) { if (err) err(e); });
        return function () { subs[col] = (subs[col] || []).filter(function (x) { return x !== f; }); };
      }
    };
  }
  setInterval(function () {
    if (document.visibilityState === "visible") Object.keys(subs).forEach(function (c) { if (subs[c].length) refresh(c).catch(function () {}); });
  }, 60000);
  var db = Object.freeze({
    collection: collection,
    doc: function (path) { var p = String(path).split("/"); return doc(p[0], p[1]); }
  });
  var mcp = Object.freeze({
    callTool: function (server, tool, args) { return run("mcp", { server: server, tool: tool, args: args || {} }).then(function (r) { return { payload: r }; }); },
    invalidate: function () { return Promise.resolve(); }
  });
  function aBase64(blob) {
    return new Promise(function (res, rej) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(",")[1]); }; fr.onerror = rej; fr.readAsDataURL(blob); });
  }
  function reducir(file) {
    if (!/^image\//.test(file.type) || /svg/.test(file.type)) return Promise.resolve(file);
    return new Promise(function (res) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600, w = img.width, h = img.height, k = Math.min(1, max / Math.max(w, h));
        var c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { res(b || file); }, "image/jpeg", 0.85);
      };
      img.onerror = function () { res(file); };
      img.src = url;
    });
  }
  var assets = Object.freeze({
    upload: function (file) {
      return reducir(file).then(function (b) { return aBase64(b).then(function (b64) {
        return run("asset_upload", { b64: b64, mime: b.type || "image/jpeg", name: (file.name || "foto") });
      }); });
    },
    delete: function (id) { return run("asset_delete", { id: id }); },
    list: function () { return Promise.resolve({ assets: [], usage: {} }); }
  });
  var spaces = { db: db, mcp: mcp, assets: assets };
  window.claude = Object.freeze({ use: function (n) { return Promise.resolve(spaces[n] || null); } });

  /* Enlaces entre las páginas: los antiguos de Claude pasan a las nuevas de Google */
  var MAPA = [
    [/claude\.ai\/(code\/)?artifact\/(790360f7-59fe-49e3-837c-8eceaec48e51|Fwi1eA13XFoXBxPWNoe1da)/, "tests"],
    [/claude\.ai\/(code\/)?artifact\/(W5j3MvqeFmroz35Y9Vw6sS|eb81e79b-ff2e-440b-ae05-09167d174411)/, "labores"],
    [/claude\.ai\/(code\/)?artifact\/(MMUSxcTFKKApM74mBt1g1x|a4d29052-c8de-4125-9ca6-52dc009fd7a3)/, "panel"]
  ];
  function convertir(a) {
    var h = a.getAttribute("href"); if (!h || !CDC.url) return;
    for (var i = 0; i < MAPA.length; i++) {
      if (MAPA[i][0].test(h)) {
        var hash = h.indexOf("#") >= 0 ? h.slice(h.indexOf("#") + 1) : "";
        a.setAttribute("href", CDC.url + "?app=" + MAPA[i][1] + (hash ? "&h=" + encodeURIComponent(hash) : ""));
        a.setAttribute("target", "_top");
        return;
      }
    }
    if (/^https?:/.test(h) && !a.getAttribute("target")) a.setAttribute("target", "_blank");
  }
  function repasar(root) { (root.querySelectorAll ? root.querySelectorAll("a[href]") : []).forEach(convertir); }
  document.addEventListener("click", function (ev) { var a = ev.target.closest && ev.target.closest("a[href]"); if (a) convertir(a); }, true);
  document.addEventListener("DOMContentLoaded", function () {
    repasar(document);
    new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) { if (n.matches && n.matches("a[href]")) convertir(n); repasar(n); } }); }); })
      .observe(document.body, { childList: true, subtree: true });
  });
  /* Botón para volver al panel desde Tests y Mis labores */
  function botonVolver() {
    if (!CDC.url || !CDC.app || CDC.app === "panel" || document.getElementById("cdc-volver")) return;
    var a = document.createElement("a");
    a.id = "cdc-volver"; a.href = CDC.url; a.target = "_top"; a.textContent = "← Panel";
    a.setAttribute("aria-label", "Volver al panel");
    a.style.cssText = "display:inline-block;margin:calc(10px + env(safe-area-inset-top,0px)) 0 0 max(16px,env(safe-area-inset-left,0px));" +
      "padding:8px 14px;border-radius:999px;border:1.5px solid rgba(0,0,0,.15);background:rgba(255,255,255,.9);color:#25291F;" +
      "font:700 15px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none;position:relative;z-index:50";
    document.body.insertBefore(a, document.body.firstChild);
  }
  if (document.readyState !== "loading") botonVolver(); else document.addEventListener("DOMContentLoaded", botonVolver);
  window.__abrirApp = function (app, hash) { window.top.location.href = CDC.url + "?app=" + app + (hash ? "&h=" + encodeURIComponent(hash) : ""); };
  if (CDC.hash) { try { location.hash = CDC.hash; } catch (e) {} }
})();
