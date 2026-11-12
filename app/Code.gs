/**
 * Centro de Control de Haizea · CARGADOR (se pega UNA sola vez)
 * Va en la hoja «Centro de Control – datos» (Extensiones → Apps Script).
 *
 * No contiene la lógica: descarga el código de verdad (app/servidor.js del repositorio
 * HAIZEA5/Oposiciones-Preguntas) y lo ejecuta. Así los cambios se aplican solos en unos
 * 5 minutos, sin copiar ni pegar nada y sin «Nueva versión».
 * Si GitHub no contesta, usa la última versión que funcionó (guardada en la propia hoja).
 */
var REPO_CARGADOR = 'HAIZEA5/Oposiciones-Preguntas';
var RUTA_SERVIDOR = 'app/servidor.js';

function doGet(e)                { return servidor_().doGet(e); }
function api(accion, json)       { return servidor_().api(accion, json); }
function avisosCalendario()      { return servidor_().avisosCalendario(); }
function copiaSemanal()          { return servidor_().copiaSemanal(); }
function instalar()              { return servidor_().instalar(); }
function probar()                { return servidor_().probar(); }

var SERVIDOR_ = null;
function servidor_() {
  if (SERVIDOR_) return SERVIDOR_;
  var cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
  var sha = cache.get('sha');
  if (!sha) {
    sha = shaCargador_();
    if (sha) { cache.put('sha', sha, 300); props.setProperty('ultimo_sha', sha); }
  }
  var codigo = null;
  if (sha) {
    codigo = cache.get('srv:' + sha);
    if (!codigo) {
      try {
        var r = UrlFetchApp.fetch('https://cdn.jsdelivr.net/gh/' + REPO_CARGADOR + '@' + sha + '/' + RUTA_SERVIDOR,
          { muteHttpExceptions: true });
        if (r.getResponseCode() === 200) codigo = r.getContentText('UTF-8');
      } catch (err) {}
      if (codigo) {
        try { cache.put('srv:' + sha, codigo, 21600); } catch (err) {}
        guardarCopia_(props, sha, codigo);
      }
    }
  }
  if (!codigo) codigo = leerCopia_(props);
  if (!codigo) throw new Error('No se ha podido descargar el código del Centro de Control. Prueba en un rato.');
  try {
    SERVIDOR_ = arrancar_(codigo);
  } catch (err) {
    // Si la versión nueva tiene un fallo, se usa la última buena.
    var copia = leerCopia_(props, true);
    if (!copia || copia === codigo) throw err;
    SERVIDOR_ = arrancar_(copia);
  }
  return SERVIDOR_;
}

function arrancar_(codigo) {
  return new Function(codigo + '\n;return { doGet: doGet, api: api, avisosCalendario: avisosCalendario,' +
    ' copiaSemanal: copiaSemanal, instalar: instalar, probar: probar };')();
}

function shaCargador_() {
  try {
    var r = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO_CARGADOR + '/commits/main',
      { headers: { Accept: 'application/vnd.github.sha' }, muteHttpExceptions: true });
    var s = r.getContentText().trim();
    if (r.getResponseCode() === 200 && /^[0-9a-f]{40}$/.test(s)) return s;
  } catch (err) {}
  try {
    var j = UrlFetchApp.fetch('https://data.jsdelivr.com/v1/packages/gh/' + REPO_CARGADOR + '/resolved?specifier=main',
      { muteHttpExceptions: true });
    if (j.getResponseCode() === 200) {
      var v = JSON.parse(j.getContentText()).version;
      if (v && /^[0-9a-f]{7,40}$/.test(v)) return v;
    }
  } catch (err) {}
  return PropertiesService.getScriptProperties().getProperty('ultimo_sha');
}

/* Copia de seguridad del código en las propiedades del script (trozos de 8000 letras).
   Se guardan dos: la actual («srv») y la anterior («srv_prev»), por si la nueva falla. */
function guardarCopia_(props, sha, codigo) {
  try {
    if (props.getProperty('srv_sha') === sha) return;
    var viejo = leerCopia_(props);
    var todo = {};
    if (viejo) partir_(todo, 'srv_prev', viejo);
    partir_(todo, 'srv', codigo);
    todo.srv_sha = sha;
    props.setProperties(todo);
  } catch (err) {}
}
function partir_(obj, pre, txt) {
  var T = 8000, n = 0;
  for (var p = 0; p < txt.length; p += T) obj[pre + ':' + (n++)] = txt.slice(p, p + T);
  obj[pre + ':n'] = String(n);
}
function leerCopia_(props, anterior) {
  var pre = anterior ? 'srv_prev' : 'srv', n = +(props.getProperty(pre + ':n') || 0);
  if (!n) return null;
  var todo = props.getProperties(), txt = '';
  for (var i = 0; i < n; i++) { if (todo[pre + ':' + i] == null) return null; txt += todo[pre + ':' + i]; }
  return txt;
}

/* Nunca se ejecuta: solo sirve para que Google pida los mismos permisos que usa el código descargado
   (hoja, Drive, Calendario, tareas programadas e Internet). */
function permisos_() {
  SpreadsheetApp.getActive(); DriveApp.getRootFolder(); CalendarApp.getDefaultCalendar();
  ScriptApp.getProjectTriggers(); UrlFetchApp.fetch('https://example.com'); LockService.getScriptLock();
  HtmlService.createHtmlOutput('');
}
