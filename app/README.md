# Centro de Control (versión Google)

Páginas del Centro de Control de Haizea servidas por Google Apps Script.

- `Code.gs`: el Apps Script que va pegado a la hoja «Centro de Control – datos». Sirve las páginas (`?app=panel`, `?app=tests`, `?app=labores`) y guarda los datos en la hoja.
- `shim.js`: capa que conecta las páginas con el Apps Script (`google.script.run`).
- `panel/`, `tests/`, `labores/`: las páginas.

Aquí solo hay diseño y preguntas de test: ningún dato personal. Los datos viven en la hoja de Google y en el Drive de su dueña.
