/**
 * Centro de Control de Haizea · Apps Script
 * Va pegado a la hoja «Centro de Control – datos» (Extensiones → Apps Script).
 * Sirve tres páginas: ?app=panel (por defecto), ?app=tests y ?app=labores.
 * El diseño de las páginas se carga del repositorio público HAIZEA5/Oposiciones-Preguntas (carpeta app/);
 * los datos viven SOLO en esta hoja y en tu Drive.
 */
var REPO = 'HAIZEA5/Oposiciones-Preguntas';
var APPS = {
  panel:   { dir: 'app/panel/',   titulo: 'Panel de Haizea' },
  tests:   { dir: 'app/tests/',   titulo: 'Tests de oposiciones' },
  labores: { dir: 'app/labores/', titulo: 'Mis labores' }
};
var SUBCARPETA_ARCHIVOS = 'archivos';   // fotos y datos grandes, dentro de la carpeta de la hoja
var MAX_CELDA = 45000;

/* ---------- Páginas ---------- */
function doGet(e) {
  var p = (e && e.parameter) || {};
  var app = APPS[p.app] ? p.app : 'panel';
  var sha = ultimoCommit_();
  var cdn = 'https://cdn.jsdelivr.net/gh/' + REPO + '@' + sha + '/';
  var base = cdn + APPS[app].dir;
  var html = descargar_(base + 'index.html');
  var shim = descargar_(cdn + 'app/shim.js');
  html = absolutizarRutas_(html, base);
  var cfg = { app: app, hash: p.h || '', url: ScriptApp.getService().getUrl() };
  var cabeza = '<script>window.__CDC=' + JSON.stringify(cfg) + ';</script><script>' + shim + '</script>';
  if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, function (m) { return m + cabeza; });
  else html = html.replace(/<!doctype html>/i, function (m) { return m + cabeza; });
  return HtmlService.createHtmlOutput(html)
    .setTitle(APPS[app].titulo)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Las rutas relativas de <script>, <link> e <img> (datos de los tests, iconos…) pasan a apuntar al repositorio. */
function absolutizarRutas_(html, base) {
  return html.replace(/(<(?:script|link|img)\b[^>]*?\s(?:src|href)=")(?!https?:|data:|#|\$\{)([^"]+)"/gi,
    function (m, inicio, ruta) { return inicio + base + ruta + '"'; });
}

function ultimoCommit_() {
  var cache = CacheService.getScriptCache();
  var sha = cache.get('sha');
  if (sha) return sha;
  try {
    var r = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/commits/main',
      { headers: { Accept: 'application/vnd.github.sha' }, muteHttpExceptions: true });
    if (r.getResponseCode() === 200) { sha = r.getContentText().trim(); cache.put('sha', sha, 300); return sha; }
  } catch (e) {}
  return 'main';
}

function descargar_(url) {
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('No se ha podido cargar ' + url + ' (' + r.getResponseCode() + ')');
  return r.getContentText('UTF-8');
}

/* ---------- API que usan las páginas (google.script.run.api) ---------- */
function api(accion, json) {
  var a = JSON.parse(json || '{}');
  var out;
  switch (accion) {
    case 'list': out = listar_(a.col); break;
    case 'get': out = obtener_(a.col, a.id); break;
    case 'set': out = guardar_(a.col, a.id, a.data, false); break;
    case 'update': out = guardar_(a.col, a.id, a.data, true); break;
    case 'delete': out = borrar_(a.col, a.id); break;
    case 'mcp': out = conector_(a.server, a.tool, a.args || {}); break;
    case 'asset_upload': out = subirFoto_(a.b64, a.mime, a.name); break;
    case 'asset_delete': out = borrarFoto_(a.id); break;
    default: throw new Error('Acción desconocida: ' + accion);
  }
  return JSON.stringify(out === undefined ? null : out);
}

/* ---------- Almacén: una pestaña por colección, una fila por documento ---------- */
function hoja_(col, crear) {
  if (!/^[A-Za-z0-9_\-]+$/.test(col)) throw new Error('Colección no válida');
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(col);
  if (!sh && crear) {
    sh = ss.insertSheet(col);
    sh.getRange('A:Z').setNumberFormat('@');
    sh.getRange(1, 1).setValue('id');
    sh.setFrozenRows(1);
  }
  return sh;
}
/**
 * Cada celda guarda un valor. Los textos van tal cual, salvo los que podrían confundirse
 * con otro tipo (empiezan por { [ " o parecen número/booleano): esos van entre comillas JSON.
 * Lo que pasa de MAX_CELDA se guarda en un archivo de Drive y la celda apunta a él.
 */
var PARECE_OTRO_TIPO = /^([\[{"]|-?\d+(\.\d+)?(e[+-]?\d+)?$|true$|false$|null$)/i;
function codificar_(v) {
  if (v === undefined) return '';
  var t = typeof v !== 'string' ? JSON.stringify(v) : (PARECE_OTRO_TIPO.test(v) ? JSON.stringify(v) : v);
  if (t.length > MAX_CELDA) return '@archivo:' + carpeta_().createFile('dato.json', t, MimeType.PLAIN_TEXT).getId();
  return t;
}
function decodificar_(c) {
  if (c === '' || c === null || c === undefined) return undefined;
  var t = String(c);
  if (esArchivo_(t)) {
    try { t = DriveApp.getFileById(t.slice(9)).getBlob().getDataAsString('UTF-8'); } catch (e) { return undefined; }
  }
  if (PARECE_OTRO_TIPO.test(t)) { try { return JSON.parse(t); } catch (e) {} }
  return t;
}
function esArchivo_(c) { return String(c).indexOf('@archivo:') === 0; }
/** Al sobrescribir o borrar una fila, los archivos a los que apuntaba van a la papelera. */
function soltarArchivos_(celdas) {
  celdas.forEach(function (c) { if (esArchivo_(c)) { try { DriveApp.getFileById(String(c).slice(9)).setTrashed(true); } catch (e) {} } });
}
function filas_(sh) {
  var v = sh.getDataRange().getValues();
  var cab = v[0].map(String);
  var out = [];
  for (var i = 1; i < v.length; i++) {
    var id = String(v[i][0] || '');
    if (!id) continue;
    var d = {};
    for (var j = 1; j < cab.length; j++) {
      if (!cab[j]) continue;
      var x = decodificar_(v[i][j]);
      if (x !== undefined) d[cab[j]] = x;
    }
    out.push({ id: id, data: d, fila: i + 1, celdas: v[i] });
  }
  return { cab: cab, filas: out };
}
function listar_(col) {
  var sh = hoja_(col, false);
  if (!sh) return [];
  return filas_(sh).filas.map(function (r) { return { id: r.id, data: r.data }; });
}
function obtener_(col, id) {
  var sh = hoja_(col, false);
  if (!sh) return null;
  var r = buscar_(filas_(sh), id);
  return r ? r.data : null;
}
function guardar_(col, id, data, mezclar) {
  if (!id) throw new Error('Falta el id');
  return conCerrojo_(function () {
    var sh = hoja_(col, true);
    var t = filas_(sh);
    var actual = buscar_(t, id);
    var d = mezclar && actual ? Object.assign({}, actual.data, data) : Object.assign({}, data);
    Object.keys(d).forEach(function (k) { if (d[k] && d[k].__delete__ === true) delete d[k]; });
    asegurarColumnas_(sh, t.cab, Object.keys(d));
    var n = actual ? actual.fila : sh.getLastRow() + 1;
    escribirFila_(sh, n, t.cab, id, d);
    if (actual) soltarArchivos_(actual.celdas);
    return true;
  });
}
/** Importa muchos documentos de una vez (una sola lectura y escritura de la pestaña). */
function guardarVarios_(col, docs) {
  return conCerrojo_(function () {
    var sh = hoja_(col, true);
    var t = filas_(sh);
    docs.forEach(function (doc) { asegurarColumnas_(sh, t.cab, Object.keys(doc.data)); });
    docs.forEach(function (doc) {
      var actual = buscar_(t, doc.id);
      var n = actual ? actual.fila : sh.getLastRow() + 1;
      escribirFila_(sh, n, t.cab, doc.id, doc.data);
      if (actual) soltarArchivos_(actual.celdas);
    });
    return docs.length;
  });
}
function borrar_(col, id) {
  return conCerrojo_(function () {
    var sh = hoja_(col, false);
    if (!sh) return true;
    var r = buscar_(filas_(sh), id);
    if (r) { sh.deleteRow(r.fila); soltarArchivos_(r.celdas); }
    return true;
  });
}
function conCerrojo_(fn) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function buscar_(t, id) { return t.filas.filter(function (x) { return x.id === String(id); })[0]; }
function asegurarColumnas_(sh, cab, campos) {
  campos.forEach(function (k) {
    if (cab.indexOf(k) < 0) { cab.push(k); sh.getRange(1, cab.length).setNumberFormat('@').setValue(k); }
  });
}
function escribirFila_(sh, n, cab, id, d) {
  var fila = cab.map(function (k, j) { return j === 0 ? String(id) : (k in d ? codificar_(d[k]) : ''); });
  sh.getRange(n, 1, 1, fila.length).setNumberFormat('@').setValues([fila]);
}

/* ---------- Lo que antes hacían los conectores de Claude ---------- */
function conector_(server, tool, a) {
  if (server === 'Google Calendar' && tool === 'list_events') return eventos_(a);
  if (server === 'Google Calendar' && tool === 'create_event') return crearEvento_(a);
  if (server === 'Google Sheets' && tool === 'get_values') {
    var r = SpreadsheetApp.openById(a.spreadsheetId).getRange(a.range);
    return { range: a.range, values: r.getDisplayValues() };
  }
  if (server === 'Google Drive' && tool === 'read_file_content') return { fileContent: hojaComoTexto_(a.fileId) };
  throw new Error('Conector no disponible: ' + server + ' / ' + tool);
}
function fecha_(s) { var p = String(s).split(/[-T:]/).map(Number); return new Date(p[0], p[1] - 1, p[2], p[3] || 0, p[4] || 0, p[5] || 0); }
function ymd_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function eventos_(a) {
  var ini = fecha_(a.startTime), fin = fecha_(a.endTime);
  var tz = Session.getScriptTimeZone();
  var evs = CalendarApp.getDefaultCalendar().getEvents(ini, fin);
  return { events: evs.map(function (e) {
    var o = { id: e.getId(), summary: e.getTitle(), location: e.getLocation(), status: 'confirmed' };
    if (e.isAllDayEvent()) {
      o.start = { date: ymd_(e.getAllDayStartDate()) };
      o.end = { date: ymd_(e.getAllDayEndDate()) };
    } else {
      o.start = { dateTime: Utilities.formatDate(e.getStartTime(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX") };
      o.end = { dateTime: Utilities.formatDate(e.getEndTime(), tz, "yyyy-MM-dd'T'HH:mm:ssXXX") };
    }
    return o;
  }) };
}
function crearEvento_(a) {
  var cal = CalendarApp.getDefaultCalendar();
  var op = a.description ? { description: a.description } : {};
  var e = a.allDay ? cal.createAllDayEvent(a.summary, fecha_(a.startTime), op)
                   : cal.createEvent(a.summary, fecha_(a.startTime), fecha_(a.endTime), op);
  return { id: e.getId() };
}
function hojaComoTexto_(id) {
  var ss = SpreadsheetApp.openById(id), out = [];
  ss.getSheets().forEach(function (sh) {
    out.push('### Sheet Name: ' + sh.getName());
    sh.getDataRange().getDisplayValues().forEach(function (r) { out.push('| ' + r.join(' | ') + ' |'); });
  });
  return out.join('\n');
}

/* ---------- Fotos de Terminadas (carpeta de tu Drive) ---------- */
/** La carpeta de Drive donde está la hoja («Centro de Control»): todo lo del sistema vive ahí. */
function carpetaPrincipal_() {
  var padres = DriveApp.getFileById(SpreadsheetApp.getActive().getId()).getParents();
  return padres.hasNext() ? padres.next() : DriveApp.getRootFolder();
}
function subcarpeta_(nombre) {
  var raiz = carpetaPrincipal_();
  var it = raiz.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : raiz.createFolder(nombre);
}
function carpeta_() { return subcarpeta_(SUBCARPETA_ARCHIVOS); }
function subirFoto_(b64, mime, nombre) {
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime || 'image/jpeg', nombre || 'foto.jpg');
  var f = carpeta_().createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { id: f.getId(), url: 'https://lh3.googleusercontent.com/d/' + f.getId() + '=w1200' };
}
function borrarFoto_(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} return true; }

/* ---------- Tareas automáticas (las programa instalar) ---------- */
var HORA_VISPERA = 20;          // el aviso de la víspera de un examen sale a las 20:00
var COPIAS_QUE_GUARDAR = 8;     // copias semanales de la hoja (dos meses)
var CERRADA = /^\s*(cerrad|no me presento)/i;

/** Cada mañana: pone en tu calendario la víspera de cada examen, el último día de cada plazo y las fechas de coche, perro y práctico. */
function avisosCalendario() {
  var props = PropertiesService.getScriptProperties();
  var cal = CalendarApp.getDefaultCalendar();
  var hoy = ymd_(new Date());
  avisosPendientes_().forEach(function (a) {
    var clave = 'aviso|' + a.clave, previo = (props.getProperty(clave) || '').split('|');
    if (previo[0] === a.fecha) return;
    if (previo[1]) { try { cal.getEventById(previo[1]).deleteEvent(); } catch (e) {} }
    if (a.fecha < hoy) { props.deleteProperty(clave); return; }
    var ev = a.vispera ? eventoVispera_(cal, a) : cal.createAllDayEvent(a.titulo, fecha_(a.fecha), { description: a.detalle || '' });
    if (!ev) return;
    if (!a.vispera) ev.addPopupReminder(15 * 60);   // a las 9:00 del día anterior
    props.setProperty(clave, a.fecha + '|' + ev.getId());
  });
}
function eventoVispera_(cal, a) {
  var ini = fecha_(a.fecha); ini.setDate(ini.getDate() - 1); ini.setHours(HORA_VISPERA, 0, 0, 0);
  if (ini < new Date()) return null;
  var ev = cal.createEvent(a.titulo, ini, new Date(ini.getTime() + 15 * 60000), { description: a.detalle || '' });
  ev.addPopupReminder(0);
  return ev;
}
function avisosPendientes_() {
  var out = [];
  listar_('panel_examenes').forEach(function (r) {
    var e = r.data, f = e.ficha || {}, nombre = (e.organismo || '') + ' · ' + (e.puesto || '');
    if (CERRADA.test(e.estado || '')) return;
    if (e.examen) out.push({ clave: 'examen|' + r.id, fecha: e.examen, vispera: true, titulo: 'Mañana: examen ' + nombre,
      detalle: [e.nota, f.llevar ? 'Llevar: ' + f.llevar : 'Llevar: DNI original y bolígrafo azul o negro.'].filter(Boolean).join('\n') });
    if (f.impugnar_hasta) out.push({ clave: 'plazo|' + r.id, fecha: f.impugnar_hasta, titulo: 'Último día: ' + (f.impugnar_txt || 'reclamar') + ' · ' + nombre });
  });
  listar_('panel_recordatorios').forEach(function (r) {
    var x = r.data;
    if (x.proxima) out.push({ clave: 'rec|' + r.id, fecha: x.proxima, titulo: (x.grupo === 'perro' ? 'Perro: ' : 'Coche: ') + x.titulo, detalle: x.nota || '' });
  });
  var practico = obtener_('panel_ajustes', 'practico') || {};
  if (practico.examen) out.push({ clave: 'practico', fecha: practico.examen, vispera: true, titulo: 'Mañana: examen práctico del carnet',
    detalle: (practico.hora ? 'A las ' + practico.hora + '. ' : '') + 'Duerme bien y lleva el DNI.' });
  return out;
}

/** Cada domingo: guarda una copia de la hoja en «copias» y deja solo las últimas. */
function copiaSemanal() {
  var carpeta = subcarpeta_('copias');
  DriveApp.getFileById(SpreadsheetApp.getActive().getId()).makeCopy('Copia ' + ymd_(new Date()), carpeta);
  var copias = [], it = carpeta.getFiles();
  while (it.hasNext()) copias.push(it.next());
  copias.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  copias.slice(COPIAS_QUE_GUARDAR).forEach(function (f) { f.setTrashed(true); });
}

function programarTareas_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['avisosCalendario', 'copiaSemanal'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('avisosCalendario').timeBased().everyDays(1).atHour(7).create();
  ScriptApp.newTrigger('copiaSemanal').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
}

/* ---------- Instalación (se ejecuta una vez desde el editor) ---------- */
var PREFIJO_IMPORTAR = 'centro-de-control-importar';

/**
 * Pide los permisos, programa los avisos y la copia semanal, pasa a la hoja los datos que vienen de las páginas antiguas de Claude
 * (archivos «centro-de-control-importar-*.json» de la carpeta «Centro de Control») y los manda a la papelera.
 * Cada archivo es { "col": "app_coleccion", "docs": [ { "id": …, "data": { … } } ] }.
 * Un campo «json» que venga como objeto se guarda como texto, que es como lo leen las páginas.
 */
function instalar() {
  var it = carpetaPrincipal_().searchFiles('title contains "' + PREFIJO_IMPORTAR + '" and trashed = false');
  while (it.hasNext()) {
    var f = it.next();
    try {
      var lote = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
      var docs = lote.docs.map(function (doc) {
        var data = Object.assign({}, doc.data);
        if (data.json && typeof data.json === 'object') data.json = JSON.stringify(data.json);
        return { id: doc.id, data: data };
      });
      Logger.log(f.getName() + ': ' + guardarVarios_(lote.col, docs) + ' en ' + lote.col);
      f.setTrashed(true);
    } catch (e) {
      Logger.log('ERROR en ' + f.getName() + ': ' + e.message + ' (el archivo se queda en Drive)');
    }
  }
  programarTareas_();
  avisosCalendario();
  probar();
}

/** Comprueba que todo responde. */
function probar() {
  Logger.log('Versión de las páginas: ' + ultimoCommit_());
  Logger.log('Tareas: ' + listar_('panel_tasks').length + ' · Oposiciones: ' + listar_('panel_examenes').length +
    ' · Patrones: ' + listar_('labores_patrones').length);
  Logger.log('Calendario: ' + CalendarApp.getDefaultCalendar().getName());
}
