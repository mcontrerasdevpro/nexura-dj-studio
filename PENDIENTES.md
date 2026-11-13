# Nexura DJ Studio — estado y pendientes

Última actualización: 10 de noviembre de 2026 · rama `aviso-actualizacion` (desde main, sin commit) · versión **1.0.0-rc.2** en `package.json`. Resúmenes en `.revision/RESUMEN-aviso-actualizacion.md`, `.revision/RESUMEN-rc2.md` y `.revision/RESUMEN-rc1.md`.

## 1.0.0-rc.4 (en preparación) — menos azul: temas de color (11 nov 2026, rama `colores-neutros`, sin commit)
- Petición de siempre: «hay mucho color azul, demasiado». Tema nuevo por defecto **Grafito** (gris oscuro neutro) y selector en Ajustes → General → Apariencia: Grafito (recomendado) · Carbón (más oscuro) · Azul noche (clásico, la paleta anterior tal cual). `settings.theme`, por defecto `grafito` también para quien actualiza; se aplica al momento (`src/js/ui/theme.js`, `html[data-theme]`).
- Todo el color de `app.css` va en variables de la sección 1 (`:root` = Grafito, `:root[data-theme="carbon"]`, `:root[data-theme="azul"]`); el bloque «Acentos de color» del final se ha repartido en las reglas originales de cada sección. Los canvas (ondas, plato) leen sus colores del tema (`TC`).
- Color solo con significado: Deck 1 azul `#2f9bff` y Deck 2 rojo `#ff4d5e` (número, borde superior, onda, canal del mezclador, play encendido), selección y foco ámbar, verde = sonando/OK, rojo = grabar/aviso, morado = FX/IA, tonalidades en su color. Hot cues y sampler sin azul (`CUE_COLORS` 5 y 6: turquesa y lima).
- Pruebas: `node tools/check-colores.cjs` (azules que quedan + contraste por tema; lo ejecuta `test-todo`) y, con `npm run web`, `npx electron tools/ui-check-colores.cjs` (3 temas, diálogos, contraste real; `.revision/colores-neutros/`). Resumen en `.revision/RESUMEN-colores-neutros.md`.
- Pendiente: actualizar el CLAUDE.md del checkout principal (paleta y `settings.theme`); al subir la versión a rc.4, quitar «en preparación» de NOVEDADES.md.

## 1.0.0-rc.3 (en preparación) — aviso de actualización más visible (10 nov 2026, rama `aviso-actualizacion`, sin commit)
- Petición: el aviso «Nexura X disponible · Descargar» de la barra de estado «se ve poco».
- Segunda petición: «o una ventana de alerta abajo a la izquierda al iniciar el programa». Ahora es una ventana ámbar de 360 px abajo a la IZQUIERDA (encima de la barra lateral de la biblioteca, sin subir nunca por encima de ella: con poco alto quita líneas de novedades), «Hay una versión nueva de Nexura», versión actual → nueva, hasta 3 líneas de las notas de la release, «Descargar ahora» / «Más tarde» (no vuelve hasta el siguiente arranque); 14 px, icono, sombra y pulso los primeros 30 s. Botón «⬆ Actualizar» en la barra superior junto a «?». Estados: descargando (barra ámbar), lista (verde, con pulso) y «Se instalará al cerrar Nexura». Nada de animación con «reducir movimiento» de Windows.
- `NOVEDADES.md` tiene ya la sección «1.0.0-rc.3 · en preparación»: al subir la versión a rc.3, quitar «en preparación» del título (lo exige `tools/test-novedades.mjs`).
- Ojo: el aviso lo dibuja la versión **instalada**. Quien tenga la rc.2 verá el aviso antiguo (discreto) al salir la rc.3; el nuevo se verá a partir de la siguiente (rc.3 → rc.4/1.0.0).
- Por probar a mano: una actualización real desde una app con la rc.3 instalada (ventana, novedades reales de la release de GitHub, botón de arriba, descarga, reinicio y «al cerrar» con música). Escribir las notas de la release con las 2-3 primeras líneas pensadas para el aviso.

## 1.0.0-rc.2 — versión pequeña para probar las actualizaciones desde la rc1 (10 nov 2026, sin commit)
- **Datos del responsable** en la licencia y la privacidad (Miguel Contreras Gallardo, NIF, domicilio en Getafe); la privacidad (v1.1) explica la búsqueda de YouTube sin clave.
- **Clave de YouTube oculta** («AIza••••••••», 👁 5 s, también el Client secret) y **«Comprobar clave»** con el error en claro.
- **Buscar en YouTube sin configurar nada** por un servicio de NexuraIA (n8n): 30 búsquedas/día por instalación, caché de 7 días, solo se envía `{id, q, max}`; la clave propia tiene prioridad. Mensaje claro al llegar al límite y, sin servicio ni clave, aviso con la guía del README (sección nueva «YouTube»).
- **Novedades de la versión**: aviso «Nexura se ha actualizado a la X · Ver novedades» al arrancar tras actualizar (`src/legal/NOVEDADES.md`), también en «?» y Acerca de.
- **n8n**: carpeta «Nexura DJ Studio» con tres flujos `[DEV]` desactivados (Buscar en YouTube, Informes y sugerencias, Estadísticas); copia en `tools/n8n/`.
- Incluye el cambio anterior sin commit (tiempo y barra de progreso de YouTube).

### Lo que tiene que hacer Miguel antes de publicar la rc2 (detalle en `.revision/RESUMEN-rc2.md`)
- Crear en n8n la credencial «Query Auth» con la clave de YouTube de NexuraIA y elegirla en los dos nodos HTTP del flujo de búsqueda.
- Probar y activar los tres flujos; poner sus URL de producción en `src/config/servicios.json` (`feedbackUrl`, `statsUrl`, `searchUrl`). Sin `searchUrl` la rc2 funciona igual que antes (búsqueda solo con clave propia), pero las novedades prometen las 30 búsquedas gratis.
- Revisar con alguien de confianza la licencia y la privacidad con los datos ya puestos; publicar la privacidad en nexuraia.com.

### Por probar a mano (rc2)
- La actualización real rc1 → rc2: aviso en la barra de estado, descarga, reinicio y, al abrir, «Nexura se ha actualizado a la 1.0.0-rc.2 · Ver novedades».
- Búsqueda real por el servicio (con el flujo activo): resultados, la 31.ª búsqueda del día → mensaje de límite, y la caché (repetir una búsqueda no gasta cuota de Google).
- «Comprobar clave» con una clave real (correcta, mal copiada y con la API sin habilitar).
- El resumen diario de estadísticas por correo a las 8:00.

## 1.0-rc1 — lo imprescindible para distribuirla gratis (10 nov 2026, sin commit)
- **Actualizaciones automáticas** (electron-updater + GitHub Releases de `mcontrerasdevpro/nexura-dj-studio`): aviso en la barra de estado, descarga con progreso, «Reiniciar para actualizar» (con música sonando se instala al cerrar); Ajustes → General; canal de versiones de prueba opcional; sin red o sin releases, silencio. `npm run release` publica un borrador (necesita `GH_TOKEN`).
- **Copias de seguridad de la biblioteca**: al arrancar (una al día) y antes de cada actualización, 14 últimas en `<datos>\copias`; Ajustes → Biblioteca (lista, hacer, restaurar, abrir carpeta); si al arrancar la biblioteca está dañada ofrece restaurar la última copia buena.
- **Informe de errores y sugerencias**: registro local rotativo (`<datos>\logs`, 5 × 1 MB), diálogo con tipo, email opcional y «Adjuntar registro técnico» con vista previa anonimizada; POST a `feedbackUrl` o, si no, correo + .txt.
- **Contador anónimo de uso** opcional y explicado (`statsUrl`, vacío = desactivado).
- **Bienvenida** de 4 pasos, **textos legales** (EULA en el instalador, privacidad, licencias de terceros), **menú de ayuda «?»** y **Acerca de** nuevo.
- **Microsoft Store** preparada (`npm run store`, iconos en `build/appx`), sin identidad todavía.
- **Botón Ordenar crates** (⇅ junto a «+ Nuevo» en la cabecera CRATES): abre el menú de orden que antes solo estaba en el clic derecho y en Ajustes, con textos más claros («Como se crearon», «Por nombre (A → Z)», «Personalizado (arrastrar)») y ✓ en el actual; el tooltip dice el orden activo. La lógica de orden y el arrastre no cambian. Prueba: `npx electron tools/ui-check-orden-crates.cjs` (`.revision/orden-crates/`).

### Lo que tiene que hacer Miguel antes de distribuir la rc1
- ~~Completar los datos del responsable en la licencia y la privacidad~~ (hecho en la rc2; falta que lo revise alguien de confianza en lo legal).
- Rellenar `feedbackUrl` y `statsUrl` en `src/config/servicios.json` → ahora con los flujos de n8n de la rc2 (ver arriba).
- `GH_TOKEN` para `npm run release`; publicar la privacidad en nexuraia.com (la pide la Store).
- Partner Center (Microsoft Store): alta, reservar el nombre y copiar la identidad a `build/store-identidad.json`.

### Por probar a mano (rc1)
- Una actualización real de extremo a extremo: publicar 1.0.0-rc.1 como prerelease, instalarla, publicar una rc.2 de prueba y comprobar aviso → descarga → reinicio (y que con un deck sonando espera al cierre).
- El instalador: que muestre la licencia con las tildes bien y que la actualización silenciosa no enseñe el mensaje de agradecimiento.
- Restaurar una copia con la biblioteca real (miles de pistas) y el aviso de biblioteca dañada (por ejemplo, dejando `library.json` vacío).
- El correo de respaldo del informe con el programa de correo que tengas (Outlook / Correo de Windows / ninguno).

## Tiempo y barra de progreso en los vídeos de YouTube (10 nov 2026, rama `yt-tiempo`, sin commit)
- Petición: «al reproducir la pista de YouTube las ondas no aparecen y tendría que haber un contador de tiempo».
- **Causa:** la duración se leía una sola vez al cargar, cuando el reproductor todavía da 0, y los vídeos importados sin clave de API no traen duración → REMAIN en 0, vista general vacía y el Autoplay no fundía (paraba a los 5 s de acabar el vídeo).
- **Hecho:** duración tomada del reproductor en cuanto la da (y guardada en la biblioteca); ELAPSED/REMAIN fluidos (también con tempo ≠ 1) y aviso de los últimos 30 s; en lugar de forma de onda, barra de progreso del color del deck con cursor, hot cues y clic para saltar (arriba, en el deck y en la vista general) con el texto «Vídeo de YouTube · sin forma de onda». El audio de YouTube sigue sin tocarse. Resumen en `.revision/RESUMEN-yt-tiempo.md`.
- **Por probar a mano:** con vídeos reales (con y sin clave de API): que REMAIN aparezca en 1-2 s, que el clic en la barra salte bien y que el Autoplay funda al final de un vídeo de una lista.

## Hecho en esta sesión (frente a Serato DJ Pro 5)
- **Fase 1 — biblioteca:** importar M3U/M3U8, proteger biblioteca (candado), reiniciar pistas tocadas, columnas configurables (valoración, Explicit, carátula, año, energía, comentario), colores y orden de crates, buscar en crate, «mostrar en qué crates está», archivos perdidos y relocalizar, modo de pads Cue Loop, retorno del slip, altura mínima de la biblioteca (8 filas en 1496×885).
- **Fase 2 — análisis y efectos:** beatgrid con cambios de tempo (detección y edición), Stems FX y Stem Slip, 17 efectos nuevos (36 en total) con presets de fábrica.
- **Spotify:** importar listas solo con metadatos (sin cuenta: listas públicas ≤ ~100 pistas; con cuenta Premium: API oficial). Empareja con la música local, reproductor oficial de YouTube para las que faltan y enlaces de compra. **Nunca se descarga audio.**
- **Subcrates:** árbol con plegado, arrastrar/mover sin ciclos, pistas de los subcrates en el padre, color heredado.
- **Carpetas → subcrates:** soltar una carpeta sobre un crate crea la jerarquía (Dance › 2020 › …); «+ Carpeta» con estructura.
- **Teclado:** Supr quita del crate/Prepare (o de la biblioteca con confirmación); Ctrl+Supr elimina de la biblioteca al instante con Deshacer / Ctrl+Z (ver abajo).
- **Autoplay** sobre un crate: en orden de la lista o aleatorio; transición seguida, fundido o sync; repetir y saltar tocadas; excluyente con Automix.
- **Selección en ámbar** (variante «C · Ámbar» elegida en Claude Design).
- **Autoplay con una pista sonando** (10 nov 2026, sin commit): activarlo ya no corta lo que suena; esa pista sigue en su deck (también el 3/4) y la lista continúa después de ella, con la transición elegida al final. Resumen en `.revision/RESUMEN-autoplay-supr.md`.
- **Ctrl+Supr rápido** (10 nov 2026, sin commit): elimina de la biblioteca al instante, sin diálogo, con «Deshacer» y Ctrl+Z (vuelven cues, beatgrid, crates, Prepare…); funciona con la pista seleccionada aunque el foco esté en la barra lateral; tras eliminar queda seleccionada la siguiente.
- **Borrar listas de YouTube** (10 nov 2026, sin commit): menú de «YouTube · todos los vídeos» → quitar todos los vídeos de la biblioteca (con confirmación y Deshacer; sin vídeos, la entrada desaparece y se abre «Todas las pistas»); en las listas importadas, «Eliminar lista y sus vídeos de la biblioteca» (solo los que no están en otra lista ni en un crate); Supr/Ctrl+Supr en la fila de la lista la elimina con confirmación.
- **Barra lateral rediseñada** (Claude Design: A «Árbol claro» + C «Barra de iconos»), sin commit todavía: árbol único con BIBLIOTECA / CRATES / SMART CRATES / LISTAS ONLINE, buscador de crates y listas, iconos de color por tipo, un botón por sección, pie «+ Añadir música» / «Importar…», barra de iconos automática en modo laptop y ≤ 1100 px (Ajustes → Biblioteca: Automática / Siempre / Nunca), cabecera de la tabla con icono y ruta. Resumen en `.revision/RESUMEN-barra-lateral.md`.

## Por probar a mano (no se puede simular)
- Arrastrar una carpeta real desde el Explorador de Windows sobre un crate.
- Autoplay con una lista de YouTube (también activarlo con un vídeo ya sonando: debe seguir y fundir al final).
- Autoplay activado a mitad de una pista real con la controladora (oír que no hay corte ni cambio de tono).
- Ctrl+Supr con la biblioteca real (miles de pistas): que sea instantáneo y que Ctrl+Z devuelva todo.
- Quitar los 148 vídeos de YouTube de la biblioteca real y deshacer (y que no vuelvan a aparecer al reiniciar la app).
- Sonido real por la tarjeta/controladora; controladora MIDI física con el asistente.
- Spotify con cuenta (requiere Premium; de momento no se usa).
- Barra lateral nueva con la biblioteca real (cientos de crates): soltura del buscador, arrastrar pistas y crates con el ratón de verdad y lectura con un lector de pantalla.

## Pendiente
- **Para la rc3:** traducción de la interfaz al **inglés** y **micrófono** con talkover.
- **Para la 1.0 final:** firma de código del instalador (SmartScreen), página de descarga en nexuraia.com con la política de privacidad, y decidir qué hacer con «💬 SUGERENCIAS» (ahora duplica «? → Enviar informe o sugerencia»).
- **Fase 3 — interfaz y actuación:** formas de onda en vertical; paneles Prepare/Historial en vertical; sampler con vista ampliada; Scratch Bank; micrófono con talkover; Ableton Link; Flip completo (ahora beta).
- **Fase 4 — audio avanzado y expansiones:** keylock de alta calidad (nivel Pitch 'n Time); DVS (vinilos/CDJ de control); vídeo.
- **Opcional:** «quitar de la lista» en listas de YouTube importadas; decidir si los FX se muestran siempre en pantallas de poca altura (ahora quedan tras ☰ con alto ≤ 900 px); más luminosidad en tonalidades azules/violetas de `keyColor`.
- **No viable:** streaming de Spotify/Tidal/Beatport/Apple Music/SoundCloud (requiere acuerdos comerciales); CDJ en modo HID.

## Cómo se trabaja
- Los cambios los hace Claude Code en el PC con un encargo en `.revision/encargo-*.md` (sin commit ni beta); después se prueban con Playwright/Electron (prueba general de DJ de 51 comprobaciones + pruebas de cada novedad) y, si todo pasa, commit, push y `npm run beta`.
