/* Centro de Control · capa de datos para Google Apps Script.
   Imita lo que las páginas usaban dentro de Claude (window.claude.use("db" | "mcp" | "assets"))
   pero guardando todo en la hoja de Google «Centro de Control – datos» a través de google.script.run. */
(function () {
  var CDC = window.__CDC || {};
  /* Llamadas a Google con reintentos.
     Si Google tarda o falla (pasa a veces, sobre todo con varias cuentas abiertas o justo al abrir),
     se reintenta sola dos veces antes de avisar, en vez de dejar la sección en «Cargando…». */
  var ESPERA = 30000, REINTENTOS = [1500, 4000];
  var NO_REPETIR = { asset_upload: 1 };   // subir una foto dos veces la duplicaría
  function run1(action, payload) {
    return new Promise(function (res, rej) {
      if (!window.google || !google.script || !google.script.run) { rej(new Error("sin_apps_script")); return; }
      var hecho = false;
      var t = setTimeout(function () { if (hecho) return; hecho = true; rej(new Error("sin_respuesta")); }, ESPERA);
      google.script.run
        .withSuccessHandler(function (r) { if (hecho) return; hecho = true; clearTimeout(t); try { res(typeof r === "string" ? JSON.parse(r) : r); } catch (e) { res(r); } })
        .withFailureHandler(function (e) { if (hecho) return; hecho = true; clearTimeout(t); rej(e); })
        .api(action, JSON.stringify(payload || {}));
    });
  }
  function run(action, payload) {
    var intento = 0;
    function uno() {
      return run1(action, payload).then(function (r) { quitarAviso(); return r; }, function (e) {
        var msg = String(e && e.message || e);
        var definitivo = msg === "sin_apps_script" || /Acción desconocida|no válida|Falta el id/.test(msg) || NO_REPETIR[action] || (action === "mcp" && payload && payload.tool === "create_event");   // un evento repetido saldría dos veces en el calendario
        if (!definitivo && intento < REINTENTOS.length) {
          var d = REINTENTOS[intento++];
          return new Promise(function (ok) { setTimeout(ok, d); }).then(uno);
        }
        if (!/Acción desconocida/.test(msg)) avisar(e);
        throw e;
      });
    }
    return uno();
  }

  /* Lecturas agrupadas: lo que se pide a la vez (en 40 ms) va a Google en UNA sola llamada («lote»).
     Si la misma pestaña ya se está pidiendo, se reutiliza esa petición. */
  var cola = {}, enCurso = {}, sinLote = false, temporizador = null, colaMcp = [];
  /* Lecturas de calendario y hojas (Dinero): van en el mismo lote que las pestañas */
  function leerMcp(server, tool, args) {
    return new Promise(function (res, rej) {
      colaMcp.push({ id: "m" + colaMcp.length + "_" + Date.now().toString(36), server: server, tool: tool, args: args || {}, res: res, rej: rej });
      if (!temporizador) temporizador = setTimeout(vaciar, 40);
    });
  }
  function listar(tab, nueva) {
    if (cola[tab]) return cola[tab].p;              // aún no ha salido: vale también para «nueva»
    if (enCurso[tab] && !nueva) return enCurso[tab];
    var h = {}, p = new Promise(function (res, rej) { h.res = res; h.rej = rej; });
    h.p = p; cola[tab] = h;
    enCurso[tab] = p;
    var fin = function () { if (enCurso[tab] === p) delete enCurso[tab]; };
    p.then(fin, fin);
    if (!temporizador) temporizador = setTimeout(vaciar, 40);
    return p;
  }
  function vaciar() {
    temporizador = null;
    var pend = cola; cola = {};
    var ms = colaMcp; colaMcp = [];
    var tabs = Object.keys(pend);
    if (!tabs.length && !ms.length) return;
    var uno = function (t) { run("list", { col: t }).then(function (r) { guardarLocal(t, r); pend[t].res(r); }, pend[t].rej); };
    var unoMcp = function (m) { run("mcp", { server: m.server, tool: m.tool, args: m.args }).then(m.res, m.rej); };
    if (sinLote || (tabs.length + ms.length === 1)) { tabs.forEach(uno); ms.forEach(unoMcp); return; }
    run("lote", { cols: tabs, mcp: ms.map(function (m) { return { id: m.id, server: m.server, tool: m.tool, args: m.args }; }) }).then(function (out) {
      tabs.forEach(function (t) {
        var r = out && out[t];
        if (r && r.__error) pend[t].rej(new Error(r.__error));
        else { guardarLocal(t, r || []); pend[t].res(r || []); }
      });
      var om = out && out.__mcp;
      ms.forEach(function (m) {
        if (!om) return unoMcp(m);                       // servidor sin lecturas en lote: una a una
        var r = om[m.id];
        if (r && r.__error) m.rej(new Error(r.__error)); else m.res(r);
      });
    }, function (e) {
      if (/Acción desconocida/.test(String(e && e.message || e))) { sinLote = true; tabs.forEach(uno); ms.forEach(unoMcp); }   // servidor antiguo
      else { tabs.forEach(function (t) { pend[t].rej(e); }); ms.forEach(function (m) { m.rej(e); }); }
    });
  }

  /* Copia en el móvil de lo último que llegó de cada pestaña: al abrir se enseña al momento
     y luego se actualiza con lo de Google. Así nunca se queda en blanco aunque Google tarde. */
  var PREFIJO = "cdc:v1:";
  function leerLocal(tab) { try { var x = localStorage.getItem(PREFIJO + tab); return x ? JSON.parse(x) : null; } catch (e) { return null; } }
  function guardarLocal(tab, rows) {
    try { var t = JSON.stringify(rows || []); if (t.length < 400000) localStorage.setItem(PREFIJO + tab, t); else localStorage.removeItem(PREFIJO + tab); } catch (e) {}
  }
  function avisar(e) {
    if (document.getElementById("cdc-aviso") || !document.body) return;
    var d = document.createElement("div"); d.id = "cdc-aviso";
    d.setAttribute("role", "alert");
    d.style.cssText = "position:fixed;left:12px;right:12px;top:12px;z-index:9999;background:#25291F;color:#fff;border-radius:12px;padding:14px 16px;font:15px/1.45 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)";
    d.innerHTML = "<b>Google no contesta ahora mismo.</b><br>Lo he intentado varias veces. Donde había datos guardados, ves los de la última vez. " +
      "Si pasa a menudo, mira que en este navegador solo esté abierta <b>tu cuenta de Google</b>." +
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
  var ultimaVez = 0;
  function refresh(col, nueva) {
    ultimaVez = Date.now();
    return listar(tabla(col), nueva).then(function (rows) {
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
      set: function (data) { return run("set", { col: tabla(col), id: id, data: data }).then(function () { refresh(col, true).catch(function () {}); }); },
      update: function (data) { return run("update", { col: tabla(col), id: id, data: data }).then(function () { refresh(col, true).catch(function () {}); }); },
      delete: function () { return run("delete", { col: tabla(col), id: id }).then(function () { refresh(col, true).catch(function () {}); }); }
    };
  }
  function collection(col) {
    return {
      doc: function (id) { return doc(col, id); },
      get: function () { return listar(tabla(col)).then(snapOf); },
      onSnapshot: function (f, err) {
        (subs[col] = subs[col] || []).push(f);
        var local = leerLocal(tabla(col));
        if (local) setTimeout(function () { try { f(snapOf(local)); } catch (e) { console.error(e); } }, 0);
        refresh(col).catch(function (e) { if (err && !local) err(e); });
        return function () { subs[col] = (subs[col] || []).filter(function (x) { return x !== f; }); };
      }
    };
  }
  /* Actualizar: al volver a la página (si hace más de 30 s) y cada 5 minutos mientras está abierta.
     Antes se pedía todo cada minuto, y eso saturaba a Google. */
  function refrescarTodo() { Object.keys(subs).forEach(function (c) { if (subs[c].length) refresh(c).catch(function () {}); }); }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && Date.now() - ultimaVez > 30000) refrescarTodo();
  });
  setInterval(function () { if (document.visibilityState === "visible") refrescarTodo(); }, 300000);
  var db = Object.freeze({
    collection: collection,
    doc: function (path) { var p = String(path).split("/"); return doc(p[0], p[1]); }
  });
  var mcp = Object.freeze({
    callTool: function (server, tool, args) {
      var lectura = /^(list_events|get_values|read_file_content)$/.test(tool);
      if (!lectura) return run("mcp", { server: server, tool: tool, args: args || {} }).then(function (r) { return { payload: r }; });
      var p = leerMcp(server, tool, args);
      /* Lecturas (calendario, hojas): si Google tarda más de 6 s y hay una copia de la última vez, se usa esa
         y la nueva se guarda para la próxima. La copia solo vale si se pidió lo mismo (mismas fechas). */
      var clave = "mcp:" + server + ":" + tool + ":" + JSON.stringify(args || {});
      p.then(function (r) { guardarLocal(clave, r); }, function () {});
      var local = leerLocal(clave);
      if (!local) return p.then(function (r) { return { payload: r }; });
      return new Promise(function (res, rej) {
        var hecho = false;
        var t = setTimeout(function () { if (!hecho) { hecho = true; res({ payload: local }); } }, 6000);
        p.then(function (r) { if (!hecho) { hecho = true; clearTimeout(t); res({ payload: r }); } },
               function (e) { if (!hecho) { hecho = true; clearTimeout(t); res({ payload: local }); } });
      });
    },
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
