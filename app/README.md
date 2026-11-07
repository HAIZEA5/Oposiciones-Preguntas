# Centro de Control (versión Google)

Páginas del Centro de Control de Haizea servidas por Google Apps Script.

- `Code.gs`: el Apps Script que va pegado a la hoja «Centro de Control – datos». Sirve las páginas (`?app=panel`, `?app=tests`, `?app=labores`) y guarda los datos en la hoja.
- `shim.js`: capa que conecta las páginas con el Apps Script (`google.script.run`).
- `panel/`, `tests/`, `labores/`: las páginas.

Aquí solo hay diseño y preguntas de test: ningún dato personal. Los datos viven en la hoja de Google y en el Drive de su dueña.

## Instalación (una vez)

1. Abre la hoja «Centro de Control – datos» (carpeta «Centro de Control» de Drive) → Extensiones → Apps Script.
2. Borra lo que haya y pega `Code.gs`. Guarda.
3. Elige la función `instalar` y pulsa Ejecutar. Acepta los permisos. Pasa a la hoja los datos de los archivos `centro-de-control-importar-*.json` y los manda a la papelera.
4. Implementar → Nueva implementación → Aplicación web. Ejecutar como: yo. Acceso: solo yo. Copia la URL que acaba en `/exec`.
5. Esa URL abre el panel; `?app=tests` los tests y `?app=labores` Mis labores.

Todo lo que crea el sistema (fotos, datos grandes) va a la subcarpeta `archivos` de la carpeta de la hoja.
