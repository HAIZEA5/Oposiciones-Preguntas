/**
 * Centro de Control de Haizea · Apps Script
 * Va pegado a la hoja «Centro de Control – datos» (Extensiones → Apps Script).
 * Sirve tres páginas: ?app=panel (por defecto), ?app=tests y ?app=labores.
 * El diseño de las páginas se carga del repositorio público HAIZEA5/oposiciones-preguntas (carpeta app/);
 * los datos viven SOLO en esta hoja y en tu Drive.
 */
var REPO = 'HAIZEA5/oposiciones-preguntas';
var APPS = {
  panel:   { dir: 'app/panel/',   titulo: 'Panel de Haizea' },
  tests:   { dir: 'app/tests/',   titulo: 'Tests de oposiciones' },
  labores: { dir: 'app/labores/', titulo: 'Mis labores' }
};
var CARPETA_ARCHIVOS = 'Centro de Control – archivos';
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
function codificar_(v) {
  if (v === undefined) return '';
  var t = typeof v === 'string' ? v : JSON.stringify(v);
  if (t.length > MAX_CELDA) {
    var f = carpeta_().createFile('dato.json', t, MimeType.PLAIN_TEXT);
    return '@archivo:' + f.getId();
  }
  return t;
}
function decodificar_(c) {
  if (c === '' || c === null || c === undefined) return undefined;
  var t = String(c);
  if (t.indexOf('@archivo:') === 0) {
    try { t = DriveApp.getFileById(t.slice(9)).getBlob().getDataAsString('UTF-8'); } catch (e) { return undefined; }
  }
  if (/^[\[{]/.test(t) || /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t) || t === 'true' || t === 'false' || t === 'null') {
    try { return JSON.parse(t); } catch (e) {}
  }
  return t;
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
    out.push({ id: id, data: d, fila: i + 1 });
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
  var r = filas_(sh).filas.filter(function (x) { return x.id === String(id); })[0];
  return r ? r.data : null;
}
function guardar_(col, id, data, mezclar) {
  if (!id) throw new Error('Falta el id');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = hoja_(col, true);
    var t = filas_(sh), cab = t.cab;
    var actual = t.filas.filter(function (x) { return x.id === String(id); })[0];
    var d = mezclar && actual ? Object.assign({}, actual.data, data) : Object.assign({}, data);
    Object.keys(d).forEach(function (k) { if (d[k] && d[k].__delete__ === true) delete d[k]; });
    Object.keys(d).forEach(function (k) {
      if (cab.indexOf(k) < 0) { cab.push(k); sh.getRange(1, cab.length).setNumberFormat('@').setValue(k); }
    });
    var fila = cab.map(function (k, j) { return j === 0 ? String(id) : (k in d ? codificar_(d[k]) : ''); });
    var n = actual ? actual.fila : sh.getLastRow() + 1;
    sh.getRange(n, 1, 1, fila.length).setNumberFormat('@').setValues([fila]);
    return true;
  } finally { lock.releaseLock(); }
}
function borrar_(col, id) {
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var sh = hoja_(col, false);
    if (!sh) return true;
    var r = filas_(sh).filas.filter(function (x) { return x.id === String(id); })[0];
    if (r) sh.deleteRow(r.fila);
    return true;
  } finally { lock.releaseLock(); }
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
function carpeta_() {
  var it = DriveApp.getFoldersByName(CARPETA_ARCHIVOS);
  return it.hasNext() ? it.next() : DriveApp.createFolder(CARPETA_ARCHIVOS);
}
function subirFoto_(b64, mime, nombre) {
  var blob = Utilities.newBlob(Utilities.base64Decode(b64), mime || 'image/jpeg', nombre || 'foto.jpg');
  var f = carpeta_().createFile(blob);
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { id: f.getId(), url: 'https://lh3.googleusercontent.com/d/' + f.getId() + '=w1200' };
}
function borrarFoto_(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} return true; }

/* Para probar desde el editor: ejecútala una vez y acepta los permisos. */
function probar() {
  Logger.log(ultimoCommit_());
  Logger.log(JSON.stringify(listar_('tasks')).slice(0, 300));
  Logger.log(CalendarApp.getDefaultCalendar().getName());
}
