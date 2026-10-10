# Tests de oposiciones

Web de preguntas de test, pensada para usar en el móvil: https://haizea5.github.io/Oposiciones-Preguntas/

## Añadir otra oposición
1. Crear `data/nombre.js` con el mismo formato que `data/biblioteca-dfb.js` (`OPOSICIONES.push({...})`).
2. Añadir su línea `<script src="data/nombre.js"></script>` en `index.html`.
3. Añadir el archivo a la lista de `sw.js` y subir el número de `CACHE`.
