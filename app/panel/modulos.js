/* Panel de Haizea · secciones Coche, Práctico y Canal, vacaciones (en Calendario),
   gastos del coche (en Dinero) y la tarjeta «Avisos» de Hoy.
   Va aparte del script principal: solo necesita el HTML del panel y window.claude.use("db"). */
(function () {
  "use strict";

  /* ---------- Utilidades ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = n => String(n).padStart(2, "0");
  const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const aFecha = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const HOY = iso(new Date());
  const dias = s => s ? Math.round((aFecha(s) - aFecha(HOY)) / 86400000) : null;
  const fCorta = s => s ? aFecha(s).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "numeric" }) : "";
  const cuando = d => d < 0 ? `hace ${-d} día${d === -1 ? "" : "s"}` : d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`;
  const sumarMeses = (s, n) => { const d = aFecha(s); d.setMonth(d.getMonth() + n); return iso(d); };
  const eur = n => (Math.round(n * 100) / 100).toLocaleString("es-ES", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " €";
  const esLaborable = s => { const w = aFecha(s).getDay(); return w >= 1 && w <= 5; };
  const lunesDe = s => { const d = aFecha(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
  const mesDe = s => s.slice(0, 7);
  const id = t => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) + "-" + Date.now().toString(36).slice(-4);

  /* ---------- Contenido fijo ---------- */
  const SEMILLAS_RECORDATORIOS = [
    { id: "coche-itv", grupo: "coche", titulo: "ITV", cadaMeses: 12, nota: "Tu coche es de 2006: pasa la ITV cada año." },
    { id: "coche-seguro", grupo: "coche", titulo: "Renovar el seguro", cadaMeses: 12, nota: "Mira la fecha de vencimiento en la póliza." },
    { id: "coche-impuesto", grupo: "coche", titulo: "Impuesto de circulación", cadaMeses: 12, nota: "Lo cobra el ayuntamiento una vez al año." },
    { id: "coche-revision", grupo: "coche", titulo: "Revisión y cambio de aceite", cadaMeses: 12, nota: "" },
    { id: "coche-v16", grupo: "coche", titulo: "Baliza V16: fin de la conexión", cadaMeses: 0, nota: "La fecha viene en la caja o en las instrucciones." }
  ];
  const VACACIONES_INICIALES = ["2026-11-13", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-08", "2026-12-24", "2026-12-25", "2026-12-31", "2027-01-01"];
  const EN_EL_COCHE = [
    ["Obligatorio", [["perm", "Permiso de circulación (en la cartera sándwich)"], ["itv", "Tarjeta de la ITV"], ["v16", "Baliza V16"], ["chaleco", "Chaleco reflectante (al alcance, no en el maletero)"], ["rueda", "Rueda de repuesto con gato y llave, o kit antipinchazos"], ["carnet", "Tu carnet, cuando lo tengas"]]],
    ["Recomendado", [["seguro", "Justificante del seguro (no es obligatorio llevarlo)"], ["linterna", "Linterna"], ["cables", "Cables de batería o arrancador"]]]
  ];
  const MANIOBRAS = [
    ["previas", "Comprobaciones antes de arrancar"], ["incorporarse", "Incorporarse a la circulación"], ["carril", "Mantener el carril y cambiar de carril"],
    ["rotondas", "Rotondas"], ["cruces", "Cruces y prioridad"], ["senales", "Señales y semáforos"], ["peatones", "Peatones y ciclistas"],
    ["velocidad", "Velocidad adecuada"], ["distancia", "Distancia de seguridad"], ["adelantar", "Adelantamientos"], ["autovia", "Entrar y salir de la autovía"],
    ["sentido", "Cambio de sentido"], ["linea", "Aparcar en línea"], ["bateria", "Aparcar en batería"], ["atras", "Marcha atrás"],
    ["pendiente", "Arrancar en cuesta"], ["luces", "Luces"], ["eficiente", "Conducción eficiente"]
  ];
  const NIVELES = ["Sin practicar", "Me cuesta", "Regular", "Lo domino"];
  const TIPOS_GASTO = ["Gasolina", "Taller", "ITV", "Seguro", "Impuestos", "Aparcamiento", "Otros"];
  const TIPOS_CANAL = ["Cuento", "Música para dormir"];
  const ESTADOS_CANAL = [["idea", "Idea"], ["guion", "Guion"], ["hecho", "Hecho"], ["publicado", "Publicado"]];
  const SECCIONES = [
    { id: "coche", nombre: "Coche" }, { id: "practico", nombre: "Práctico" },
    { id: "canal", nombre: "Canal" }
  ];

  /* ---------- Estado ---------- */
  const st = { rec: [], gastos: [], clases: [], canal: [], ajustes: {}, exams: [], cargado: new Set() };
  let db = null;
  const ajuste = k => st.ajustes[k] || {};
  const guardarAjuste = (k, datos) => { st.ajustes[k] = Object.assign({}, ajuste(k), datos); pintar(); return db && db.collection("ajustes").doc(k).set(st.ajustes[k]).catch(fallo); };
  const fallo = () => aviso("No se ha podido guardar. Vuelve a intentarlo.");
  function aviso(txt) { const n = $("#note"); if (n) { n.textContent = txt; n.hidden = !txt; } }

  /* ---------- Montaje en la página ---------- */
  function montar() {
    const nav = $(".tabs"), antes = nav.querySelector('[data-go="accesos"]');
    const secAccesos = $('[data-tab="accesos"]');
    SECCIONES.forEach(s => {
      const b = document.createElement("button");
      Object.assign(b, { type: "button", textContent: s.nombre });
      b.setAttribute("role", "tab"); b.dataset.go = s.id; b.setAttribute("aria-selected", "false");
      nav.insertBefore(b, antes);
      const sec = document.createElement("section");
      sec.dataset.tab = s.id; sec.hidden = true; sec.className = "mod";
      sec.innerHTML = `<h2>${s.nombre}</h2><div id="mod-${s.id}" class="mod-cuerpo"></div>`;
      secAccesos.parentNode.insertBefore(sec, secAccesos);
    });
    const tarjeta = document.createElement("div");
    tarjeta.className = "card avisos"; tarjeta.innerHTML = `<h3>Avisos</h3><div id="hoy-avisos" class="vacio">Mirando plazos…</div>`;
    $("#hoy").prepend(tarjeta);
    const vac = document.createElement("div");
    vac.className = "panel"; vac.id = "mod-vacaciones";
    $(".cal").appendChild(vac);
    const din = document.createElement("div");
    din.id = "mod-din-coche"; din.className = "mod-cuerpo";
    $('[data-tab="dinero"]').appendChild(din);
    let guardada = location.hash.slice(1);
    if (!guardada) { try { guardada = localStorage.getItem("panel-tab") || ""; } catch (e) {} }
    if (SECCIONES.some(s => s.id === guardada) && window.irA) window.irA(guardada, false);
  }

  /* ---------- Piezas comunes ---------- */
  function listaRecordatorios(grupo) {
    const rs = st.rec.filter(r => r.grupo === grupo).sort((a, b) => (a.proxima || "9999").localeCompare(b.proxima || "9999"));
    return `<ul class="recs">${rs.map(r => {
      const d = dias(r.proxima), cls = d === null ? "" : d < 0 ? "late" : d <= 30 ? "soon" : "";
      return `<li class="rec ${cls}" data-rec="${esc(r.id)}">
        <div class="rec-t"><strong>${esc(r.titulo)}</strong>${r.nota ? `<small>${esc(r.nota)}</small>` : ""}</div>
        <label class="rec-f"><span>${r.proxima ? cuando(d) : "Pon la fecha"}</span><input type="date" value="${esc(r.proxima || "")}" data-rec-fecha aria-label="Fecha de ${esc(r.titulo)}"></label>
        <div class="rec-a">${r.cadaMeses ? `<button type="button" class="mini" data-rec-hecho ${r.proxima ? "" : "disabled"}>Hecho → ${r.cadaMeses === 1 ? "el mes que viene" : "dentro de " + r.cadaMeses + " meses"}</button>` : ""}<button type="button" class="mini" data-rec-borrar aria-label="Quitar ${esc(r.titulo)}">Quitar</button></div>
      </li>`;
    }).join("")}</ul>
    <form class="mod-form" data-rec-nuevo="${grupo}"><input type="text" name="t" placeholder="Añadir otro recordatorio" maxlength="80" required><select name="m" aria-label="Cada cuánto"><option value="0">Una vez</option><option value="1">Cada mes</option><option value="3">Cada 3 meses</option><option value="6">Cada 6 meses</option><option value="12" selected>Cada año</option></select><button class="btn">Añadir</button></form>`;
  }
  function checklist(grupos) {
    const hecho = ajuste("maletero").hecho || {};
    return grupos.map(([titulo, items]) => `<div class="card"><h3>${esc(titulo)}</h3><ul class="checks">${items.map(([k, t]) =>
      `<li><label><input type="checkbox" data-maletero="${k}" ${hecho[k] ? "checked" : ""}> ${esc(t)}</label></li>`).join("")}</ul></div>`).join("");
  }

  /* ---------- Coche ---------- */
  function pintarCoche() {
    const mes = mesDe(HOY), delMes = st.gastos.filter(g => mesDe(g.fecha || "") === mes).sort((a, b) => b.fecha.localeCompare(a.fecha));
    const total = delMes.reduce((s, g) => s + (+g.importe || 0), 0);
    $("#mod-coche").innerHTML = `
      <div class="card"><h3>Fechas del coche</h3>${listaRecordatorios("coche")}</div>
      <div class="cols">${checklist(EN_EL_COCHE)}</div>
      <div class="card"><h3>Gastos de este mes · ${eur(total)}</h3>
        <form class="mod-form" id="gasto-nuevo"><input type="date" name="f" value="${HOY}" aria-label="Fecha" required><select name="t" aria-label="Tipo">${TIPOS_GASTO.map(t => `<option>${t}</option>`).join("")}</select><input type="number" name="i" step="0.01" min="0" placeholder="€" aria-label="Importe" required><button class="btn">Apuntar</button></form>
        ${delMes.length ? `<ul class="filas">${delMes.map(g => `<li><span>${fCorta(g.fecha)}</span><span>${esc(g.tipo)}</span><b>${eur(+g.importe || 0)}</b><button type="button" class="mini" data-gasto-borrar="${esc(g.id)}" aria-label="Borrar gasto">✕</button></li>`).join("")}</ul>` : `<p class="note">Nada apuntado este mes.</p>`}
      </div>`;
  }

  /* ---------- Práctico ---------- */
  function pintarPractico() {
    const p = ajuste("practico"), niveles = ajuste("maniobras").nivel || {};
    const clases = st.clases.slice().sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
    const minutos = clases.reduce((s, c) => s + (+c.minutos || 0), 0);
    const gasto = clases.length * (+p.precio || 0);
    const dEx = dias(p.examen);
    const flojas = MANIOBRAS.filter(([k]) => niveles[k] === 1).concat(MANIOBRAS.filter(([k]) => !niveles[k]));
    $("#mod-practico").innerHTML = `
      <div class="hoy">
        <div class="card"><h3>Examen práctico</h3>
          ${p.examen ? `<div class="big${dEx <= 14 ? " soon" : ""}">${dEx < 0 ? "Hecho" : dEx === 0 ? "Hoy" : dEx === 1 ? "Mañana" : dEx + " días"}</div><div class="note">${esc(aFecha(p.examen).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }))}${p.hora ? " · " + esc(p.hora) : ""}</div>` : `<p class="note">Sin fecha todavía. Ponla cuando te la den.</p>`}
          <div class="campos2"><label>Fecha<input type="date" data-pr="examen" value="${esc(p.examen || "")}"></label><label>Hora<input type="time" data-pr="hora" value="${esc(p.hora || "")}"></label></div>
        </div>
        <div class="card"><h3>Mis clases</h3>
          <div class="cifras"><div><b>${clases.length}</b><span>clases</span></div><div><b>${(minutos / 60).toLocaleString("es-ES", { maximumFractionDigits: 1 })}</b><span>horas</span></div><div><b>${p.precio ? eur(gasto) : "—"}</b><span>gastado</span></div></div>
          <div class="campos2"><label>Autoescuela<input type="text" data-pr="autoescuela" value="${esc(p.autoescuela || "")}" placeholder="Nombre"></label><label>€ por clase<input type="number" step="0.5" min="0" data-pr="precio" value="${esc(p.precio || "")}"></label></div>
        </div>
      </div>
      <div class="card"><h3>Apuntar una clase</h3>
        <form id="clase-nueva" class="clase-form">
          <div class="campos2"><label>Día<input type="date" name="f" value="${HOY}" required></label><label>Duración<select name="m"><option value="45">45 min</option><option value="60" selected>1 hora</option><option value="90">1 h 30</option><option value="120">2 horas</option></select></label></div>
          <fieldset><legend>Qué has practicado</legend><div class="chips">${MANIOBRAS.map(([k, t]) => `<label class="chip-c"><input type="checkbox" name="man" value="${k}"><span>${esc(t)}</span></label>`).join("")}</div></fieldset>
          <label>Qué me ha dicho el profe / qué he fallado<textarea name="fallos" rows="2" maxlength="600" placeholder="p. ej. Miro poco el retrovisor antes de cambiar de carril"></textarea></label>
          <fieldset><legend>Cómo ha ido</legend><div class="chips">${["Bien", "Regular", "Mal"].map((t, i) => `<label class="chip-c"><input type="radio" name="ido" value="${t}" ${i === 0 ? "checked" : ""}><span>${t}</span></label>`).join("")}</div></fieldset>
          <button class="btn">Guardar la clase</button>
        </form>
      </div>
      <div class="card"><h3>Cómo voy en cada maniobra</h3><p class="note">Toca para cambiar: ${NIVELES.slice(1).join(" → ")}.</p>
        <div class="niveles">${MANIOBRAS.map(([k, t]) => { const n = niveles[k] || 0; return `<button type="button" class="nivel n${n}" data-man="${k}"><span>${esc(t)}</span><small>${NIVELES[n]}</small></button>`; }).join("")}</div>
        ${flojas.length && clases.length ? `<p class="note">Para la próxima clase, pide practicar: ${flojas.slice(0, 3).map(([, t]) => esc(t.toLowerCase())).join(", ")}.</p>` : ""}
      </div>
      <div class="card"><h3>Últimas clases</h3>${clases.length ? `<ul class="clases">${clases.slice(0, 8).map(c => `<li><div><strong>${fCorta(c.fecha)}</strong> · ${c.minutos} min · ${esc(c.ido || "")}</div>${(c.maniobras || []).length ? `<small>${c.maniobras.map(k => esc((MANIOBRAS.find(m => m[0] === k) || [k, k])[1])).join(", ")}</small>` : ""}${c.fallos ? `<p>${esc(c.fallos)}</p>` : ""}<button type="button" class="mini" data-clase-borrar="${esc(c.id)}">Borrar</button></li>`).join("")}</ul>` : `<p class="note">Todavía no has apuntado ninguna clase.</p>`}</div>
      <details class="card"><summary><h3 style="display:inline">Cómo se aprueba el práctico</h3></summary>
        <ul class="info"><li><b>Suspendes</b> con 1 falta eliminatoria, 2 deficientes o 10 leves.</li>
        <li><b>Eliminatorias típicas:</b> saltarte un stop o un semáforo en rojo, no ceder el paso, invadir el sentido contrario, subirte a la acera o que el examinador tenga que frenar.</li>
        <li><b>Deficientes típicas:</b> no mirar los retrovisores o no señalizar antes de un cambio de carril o de dirección, ir demasiado despacio sin motivo, no respetar la distancia de seguridad.</li>
        <li><b>Leves típicas:</b> calarse, titubear en una maniobra, colocarse mal en el carril, no quitar el intermitente.</li>
        <li>El teórico lo tienes aprobado; si quieres repasar señales y prioridades, tienes la tarea de volver a Almagro.</li></ul></details>`;
  }

  /* ---------- Canal ---------- */
  function pintarCanal() {
    const lunes = lunesDe(HOY), domingo = iso(new Date(aFecha(lunes).getTime() + 6 * 86400000));
    const estaSemana = st.canal.filter(c => c.fecha && c.fecha >= lunes && c.fecha <= domingo);
    const orden = (a, b) => (a.fecha || "9999").localeCompare(b.fecha || "9999");
    $("#mod-canal").innerHTML = `
      <div class="card"><h3>Esta semana (${fCorta(lunes)} – ${fCorta(domingo)})</h3>${estaSemana.length ? `<ul class="filas">${estaSemana.sort(orden).map(c => `<li><span>${fCorta(c.fecha)}</span><span>${esc(c.titulo)}</span><b>${esc((ESTADOS_CANAL.find(e => e[0] === c.estado) || ["", ""])[1])}</b></li>`).join("")}</ul>` : `<p class="note">No tienes nada con fecha esta semana. Pon fecha a una idea para no saltarte la publicación semanal.</p>`}</div>
      <div class="card"><h3>Nueva idea</h3><form class="mod-form" id="canal-nuevo"><input type="text" name="t" placeholder="Título del cuento o del vídeo" maxlength="120" required><select name="tipo" aria-label="Tipo">${TIPOS_CANAL.map(t => `<option>${t}</option>`).join("")}</select><button class="btn">Añadir</button></form></div>
      <div class="cols">${ESTADOS_CANAL.map(([k, nombre]) => { const xs = st.canal.filter(c => (c.estado || "idea") === k).sort(orden); return `<div class="card"><h3>${nombre} · ${xs.length}</h3>${xs.length ? `<ul class="canal">${xs.map(c => `<li data-canal="${esc(c.id)}"><strong>${esc(c.titulo)}</strong><small>${esc(c.tipo || "")}</small><div class="campos2"><input type="date" value="${esc(c.fecha || "")}" data-canal-fecha aria-label="Fecha de publicación"><select data-canal-estado aria-label="Estado">${ESTADOS_CANAL.map(([v, t]) => `<option value="${v}" ${v === (c.estado || "idea") ? "selected" : ""}>${t}</option>`).join("")}</select></div><button type="button" class="mini" data-canal-borrar>Quitar</button></li>`).join("")}</ul>` : `<p class="note">Nada.</p>`}</div>`; }).join("")}</div>`;
  }

  /* ---------- Vacaciones (en Calendario) ---------- */
  const diasVacaciones = () => (ajuste("vacaciones").dias || []).slice().sort();
  const examenesSinVacaciones = () => st.exams.filter(e => e.examen && dias(e.examen) >= 0 && !/^\s*(cerrad|no me presento)/i.test(e.estado || "") && esLaborable(e.examen) && !diasVacaciones().includes(e.examen)).sort((a, b) => a.examen.localeCompare(b.examen));
  function pintarVacaciones() {
    const ds = diasVacaciones(), anio = HOY.slice(0, 4), libres = examenesSinVacaciones();
    $("#mod-vacaciones").innerHTML = `<div class="day-title">Vacaciones ${anio}</div>
      <p class="note">${ds.filter(d => d.startsWith(anio)).length} días apuntados este año. Toca un día para quitarlo.</p>
      <div class="chips">${ds.map(d => `<button type="button" class="chip-v${d < HOY ? " pasado" : ""}" data-vac="${d}">${fCorta(d)}</button>`).join("")}</div>
      <form class="mod-form" id="vac-nuevo"><input type="date" name="f" required aria-label="Día de vacaciones"><button class="btn">Añadir día</button></form>
      ${libres.length ? `<div class="plazo-hoy">Exámenes en día de trabajo: ${libres.map(e => `${esc(e.organismo)} (${fCorta(e.examen)})`).join(", ")}. Pide el día o el permiso.</div>` : ""}`;
  }

  /* ---------- Dinero ---------- */
  function pintarDinero() {
    const mes = mesDe(HOY), p = ajuste("practico");
    const coche = st.gastos.filter(g => mesDe(g.fecha || "") === mes).reduce((s, g) => s + (+g.importe || 0), 0);
    const clases = st.clases.filter(c => mesDe(c.fecha || "") === mes).length * (+p.precio || 0);
    $("#mod-din-coche").innerHTML = `<div class="card"><h3>Coche este mes</h3><div class="cifras"><div><b>${eur(coche)}</b><span>gastos del coche</span></div><div><b>${p.precio ? eur(clases) : "—"}</b><span>clases del práctico</span></div></div><button type="button" class="mini" data-go="coche">Ver Coche</button></div>`;
  }

  /* ---------- Avisos de Hoy ---------- */
  function pintarAvisos() {
    const el = $("#hoy-avisos"), out = [];
    st.exams.forEach(e => { const f = e.ficha || {}, d = dias(f.impugnar_hasta); if (d !== null && d >= 0) out.push({ d, txt: `${f.impugnar_txt || "Reclamar"} · ${e.organismo}: hasta el ${fCorta(f.impugnar_hasta)} (${cuando(d)})` }); });
    st.rec.filter(r => r.grupo === "coche").forEach(r => { const d = dias(r.proxima); if (d !== null && d <= 30) out.push({ d, txt: `${r.titulo}: ${cuando(d)}`, ir: "coche" }); });
    examenesSinVacaciones().filter(e => dias(e.examen) <= 45).forEach(e => out.push({ d: dias(e.examen), txt: `${e.organismo} es el ${fCorta(e.examen)}, día de trabajo: pide el día`, ir: "cal" }));
    const p = ajuste("practico"), dEx = dias(p.examen);
    if (dEx !== null && dEx >= 0 && dEx <= 30) out.push({ d: dEx, txt: `Examen práctico del carnet ${cuando(dEx)}`, ir: "practico" });
    const lunes = lunesDe(HOY), domingo = iso(new Date(aFecha(lunes).getTime() + 6 * 86400000));
    if (st.cargado.has("canal") && !st.canal.some(c => c.fecha && c.fecha >= lunes && c.fecha <= domingo)) out.push({ d: 7, txt: "Canal: nada con fecha esta semana", ir: "canal" });
    out.sort((a, b) => a.d - b.d);
    el.className = out.length ? "" : "vacio";
    el.innerHTML = out.length ? `<ul>${out.map(a => `<li><span class="w ${a.d < 0 ? "late" : a.d <= 2 ? "late" : a.d <= 7 ? "soon" : ""}">${a.d < 0 ? "Pasado" : a.d === 0 ? "Hoy" : a.d === 1 ? "Mañana" : a.d + " d"}</span><span>${esc(a.txt)}${a.ir ? ` <button type="button" class="mini" data-go="${a.ir}">Ver</button>` : ""}</span></li>`).join("")}</ul>` : "Nada urgente.";
  }

  function pintar() {
    pintarCoche(); pintarPractico(); pintarCanal(); pintarVacaciones(); pintarDinero(); pintarAvisos();
  }

  /* ---------- Acciones ---------- */
  const col = n => db.collection(n);
  function enlazar() {
    document.addEventListener("change", ev => {
      const t = ev.target;
      if (t.matches("[data-rec-fecha]")) { const r = st.rec.find(x => x.id === t.closest("[data-rec]").dataset.rec); if (r) { r.proxima = t.value; col("recordatorios").doc(r.id).update({ proxima: t.value }).catch(fallo); pintar(); } }
      else if (t.matches("[data-maletero]")) { const h = Object.assign({}, ajuste("maletero").hecho); h[t.dataset.maletero] = t.checked; guardarAjuste("maletero", { hecho: h }); }
      else if (t.matches("[data-pr]")) guardarAjuste("practico", { [t.dataset.pr]: t.value.trim() });
      else if (t.matches("[data-canal-fecha],[data-canal-estado]")) { const c = st.canal.find(x => x.id === t.closest("[data-canal]").dataset.canal); if (!c) return; const k = t.matches("[data-canal-fecha]") ? "fecha" : "estado"; c[k] = t.value; col("canal").doc(c.id).update({ [k]: t.value }).catch(fallo); pintar(); }
    });
    document.addEventListener("click", ev => {
      const t = ev.target.closest("button"); if (!t) return;
      const recEl = t.closest("[data-rec]");
      if (t.matches("[data-rec-hecho]") && recEl) { const r = st.rec.find(x => x.id === recEl.dataset.rec); if (r && r.proxima) { r.proxima = sumarMeses(r.proxima < HOY ? HOY : r.proxima, r.cadaMeses); col("recordatorios").doc(r.id).update({ proxima: r.proxima }).catch(fallo); pintar(); } }
      else if (t.matches("[data-rec-borrar]") && recEl) confirmarYBorrar(t, "recordatorios", recEl.dataset.rec, "rec");
      else if (t.dataset.gastoBorrar) confirmarYBorrar(t, "coche_gastos", t.dataset.gastoBorrar, "gastos");
      else if (t.dataset.claseBorrar) confirmarYBorrar(t, "practico_clases", t.dataset.claseBorrar, "clases");
      else if (t.matches("[data-canal-borrar]")) confirmarYBorrar(t, "canal", t.closest("[data-canal]").dataset.canal, "canal");
      else if (t.dataset.man) { const n = Object.assign({}, ajuste("maniobras").nivel); n[t.dataset.man] = (n[t.dataset.man] || 0) % (NIVELES.length - 1) + 1; guardarAjuste("maniobras", { nivel: n }); }
      else if (t.dataset.vac) guardarAjuste("vacaciones", { dias: diasVacaciones().filter(d => d !== t.dataset.vac) });
    });
    document.addEventListener("submit", ev => {
      const f = ev.target, v = n => (f.elements[n] ? f.elements[n].value.trim() : "");
      if (f.dataset.recNuevo) { ev.preventDefault(); añadir("recordatorios", "rec", { grupo: f.dataset.recNuevo, titulo: v("t"), cadaMeses: +v("m"), proxima: "", nota: "" }, v("t")); f.reset(); }
      else if (f.id === "gasto-nuevo") { ev.preventDefault(); añadir("coche_gastos", "gastos", { fecha: v("f"), tipo: v("t"), importe: +v("i") }, "gasto"); f.elements.i.value = ""; }
      else if (f.id === "clase-nueva") { ev.preventDefault(); añadir("practico_clases", "clases", { fecha: v("f"), minutos: +v("m"), maniobras: [...f.querySelectorAll("[name=man]:checked")].map(x => x.value), fallos: v("fallos"), ido: (f.querySelector("[name=ido]:checked") || {}).value || "" }, "clase"); }
      else if (f.id === "canal-nuevo") { ev.preventDefault(); añadir("canal", "canal", { titulo: v("t"), tipo: v("tipo"), estado: "idea", fecha: "" }, v("t")); f.reset(); }
      else if (f.id === "vac-nuevo") { ev.preventDefault(); const d = v("f"); if (d && !diasVacaciones().includes(d)) guardarAjuste("vacaciones", { dias: diasVacaciones().concat(d) }); }
    });
  }
  function añadir(coleccion, clave, datos, base) {
    const nuevo = Object.assign({ id: id(base) }, datos);
    st[clave].push(nuevo); pintar();
    const { id: _, ...resto } = nuevo;
    col(coleccion).doc(nuevo.id).set(resto).catch(() => { st[clave] = st[clave].filter(x => x !== nuevo); pintar(); fallo(); });
  }
  /* Dos toques para borrar: el primero pide confirmación. */
  function confirmarYBorrar(boton, coleccion, docId, clave) {
    if (boton.dataset.seguro !== "1") { boton.dataset.seguro = "1"; boton.textContent = "¿Seguro?"; setTimeout(() => { if (boton.isConnected) { boton.dataset.seguro = ""; pintar(); } }, 3000); return; }
    st[clave] = st[clave].filter(x => x.id !== docId); pintar();
    col(coleccion).doc(docId).delete().catch(fallo);
  }

  /* ---------- Datos ---------- */
  function escuchar(coleccion, clave, alCargar) {
    col(coleccion).onSnapshot(snap => {
      st[clave] = snap.docs.filter(d => d.exists).map(d => Object.assign({ id: d.id }, d.data() || {}));
      const primera = !st.cargado.has(clave); st.cargado.add(clave);
      if (primera && alCargar) alCargar();
      pintar();
    }, () => {});
  }
  async function sembrar() {
    const yaHecho = ajuste("semillas");
    if (!yaHecho.recordatorios && st.cargado.has("rec")) {
      await guardarAjuste("semillas", { recordatorios: true });
      const faltan = SEMILLAS_RECORDATORIOS.filter(s => !st.rec.some(r => r.id === s.id));
      faltan.forEach(({ id: rid, ...datos }) => { st.rec.push(Object.assign({ id: rid, proxima: "" }, datos)); col("recordatorios").doc(rid).set(Object.assign({ proxima: "" }, datos)).catch(() => {}); });
      pintar();
    }
    if (!ajuste("vacaciones").dias && !yaHecho.vacaciones) { await guardarAjuste("semillas", { vacaciones: true }); guardarAjuste("vacaciones", { dias: VACACIONES_INICIALES }); }
  }
  async function iniciar() {
    montar(); enlazar(); pintar();
    try { db = window.claude && window.claude.use ? await window.claude.use("db") : null; } catch (e) { db = null; }
    if (!db) { $("#hoy-avisos").textContent = "Sin conexión con tus datos."; return; }
    const ajustesListos = new Promise(res => escuchar("ajustes", "ajustes_lista", res));
    escuchar("examenes", "exams");
    escuchar("coche_gastos", "gastos");
    escuchar("practico_clases", "clases");
    escuchar("canal", "canal");
    await ajustesListos;
    escuchar("recordatorios", "rec", sembrar);
  }
  /* La colección «ajustes» llega como lista; se guarda también como mapa para leerla por clave. */
  Object.defineProperty(st, "ajustes_lista", { set(lista) { st.ajustes = {}; lista.forEach(d => { const { id: k, ...v } = d; st.ajustes[k] = v; }); }, get() { return Object.keys(st.ajustes).map(k => Object.assign({ id: k }, st.ajustes[k])); } });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
