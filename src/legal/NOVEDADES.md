# Novedades de Nexura DJ Studio

## 1.0.0-rc.8 · noviembre de 2026

### Cuadrar dos temas: el grid y el SYNC, al milisegundo
- Arreglado: con muchos temas **el beat se iba** aunque el SYNC estuviera puesto. La culpa era de la **rejilla (beatgrid)**: el BPM se redondeaba (a 0,01 o al entero más cercano), el primer beat caía unos milisegundos tarde o en el contratiempo y, en temas de tempo constante, se colaban marcas de BPM variable con saltos. En un tema de 6 minutos eso son decenas o cientos de milisegundos: los dos bombos acaban sonando como un galope.
- Ahora el análisis escucha **los golpes de bombo de todo el tema**: ajusta el **BPM con 4 decimales** (por ejemplo 131,9971 o 142,4891) y pone el **primer beat justo en el ataque del bombo**. Si el tema es de tempo constante (casi toda la música electrónica), **la rejilla es constante**, sin saltos.
- Medido con **14 temas reales** de house, trance, makina, remember y bases: la rejilla se separaba del bombo **hasta 229 ms**; ahora, **como mucho 8 ms** del principio al final del tema (casi siempre 1-4 ms). Con dos temas a distinto BPM y **SYNC durante 3 minutos**, los bombos se separaban **hasta 189 ms**; ahora **menos de 7 ms**, también con **KEY LOCK**.
- Tus pistas ya analizadas **se vuelven a analizar solas** al cargarlas en un deck (o con **Analizar**) para tener la rejilla nueva. Si corregiste tú el BPM o el grid, se respeta.

### Cuadrar a mano, como en cabina
- **BPM con dos decimales** en el deck, en la forma de onda y en la biblioteca (127.97 no es 128.00).
- **Pitch fino**: botones **−.01** y **+.01** debajo del pitch, ±0,01 BPM por pulsación. También se pueden asignar a la controladora (**Pitch fino −0,01 BPM / +0,01 BPM**).
- **Pitch bend progresivo** (botones − y + del pitch, teclado y controladora): empieza suave (±1 %) para retoques de unos milisegundos y, si lo mantienes, sube hasta ±4 % en 1,5 s (con Mayús, hasta ±12 %).
- **Comparación de fase en la forma de onda**: los beats del otro deck salen como **triángulos de su color** arriba y abajo de la onda. Si caen sobre las líneas del grid, los bombos coinciden; si van por delante o por detrás, ves hacia dónde empujar. El zoom va en segundos reales: con dos temas a distinto pitch, los beats quedan a la misma distancia en pantalla.

### Las carpetas, en árbol
- El panel **Archivos** es ahora un **árbol de carpetas en la barra lateral**, como en otros programas DJ: en **CARPETAS** despliega **«Carpetas del equipo»** y verás **Música, Documentos, Escritorio, Descargas y tus unidades**. Cada carpeta se despliega con **▸** (o con las flechas ← →) y sus subcarpetas salen debajo.
- **Al pulsar una carpeta, su música sale en la lista de la derecha, también la de sus subcarpetas**: si tienes una carpeta con tus estilos (House, Trance, Makina…), al pulsarla lo ves todo. La columna **«Carpeta»** te dice en qué subcarpeta está cada tema. Con **«Incluir subcarpetas»** (activado) eliges si quieres verlas; se buscan hasta 5.000 archivos y 6 niveles, y ves cómo avanza la búsqueda.
- **Carpetas favoritas**: clic derecho en una carpeta → **«Añadir a favoritos»**. Salen arriba del árbol con **★** (por ejemplo, tu carpeta «Para sesión»).
- La app **recuerda la última carpeta** y las que tenías desplegadas. Lo de siempre sigue igual: arrastrar a un deck o a una crate, **«Añadir esta carpeta a la biblioteca»** y los temas que aún no están en tu biblioteca, más apagados y con ◌.
- Adiós a las columnas de carpetas encima de la lista y al aviso que se montaba sobre ellas: si una carpeta no tiene música, te lo dice dentro de la lista.

### Botón de pantalla completa
- Nuevo botón **⛶** arriba a la derecha, junto a los ajustes: pone la app en **pantalla completa** (lo mismo que **F11**). En pantalla completa el icono cambia y te dice cómo salir: con el botón, **F11** o **Esc**.

## 1.0.0-rc.7 · noviembre de 2026

### Las sugerencias vuelven a llegar
- Arreglado: **«Enviar informe o sugerencia»** fallaba siempre con «No se ha podido enviar directamente». La versión publicada se había quedado sin la dirección del servicio de sugerencias. Ahora tus mensajes vuelven a llegar al momento y verás **«Enviado»**.
- Si alguna vez no se puede enviar, la app te dice el motivo de verdad (sin conexión, el servicio no responde…) y te abre el correo con el informe listo para adjuntar.

### Actualizaciones automáticas en las versiones de prueba
- Arreglado: si tenías instalada una versión de prueba (rc), la app no veía las versiones nuevas y decía que no había ninguna publicada: había que bajarlas a mano de GitHub. Ahora **te avisa de la siguiente versión de prueba** como de cualquier actualización.
- En **Ajustes → General**, **«Recibir versiones de prueba»** sale activado y fijo mientras tengas una versión de prueba, con una nota que lo explica. Si no hay nada nuevo, **«Buscar ahora»** te dice **«Tienes la última versión»**.

### Arranque más rápido
- La app ya no se queda esperando a que Windows elija la tarjeta de sonido: si tarda, empieza con la salida que ya tiene y cambia a la tuya en cuanto está lista, sin cortar nada. La salida de auriculares (cue) tampoco hace esperar al arranque.

### Sugerencias de IA por género y BPM
- **«Siguiente pista (IA)»** ya no te propone un tema de pop cuando estás pinchando house. Ahora manda el **género** (mismo género o de su familia: house, deep house y tech house; techno y tech house; pop y dance pop…) y el **BPM**: solo salen pistas que puedes mezclar de verdad, a **±6 %** de tu tempo (o al doble o la mitad).
- La **tonalidad** y la **energía** siguen contando, pero detrás del género y del BPM. Las pistas sin analizar no se sugieren o van al final.
- Junto a cada sugerencia ves **por qué** se sugiere, por ejemplo **«mismo género · 126 BPM · 8A→9A»**.
- Va rápido con bibliotecas grandes (probado con 28.000 pistas): sugerir no frena la app.

### Perfil para la THE NEXT BEAT
- La controladora **THE NEXT BEAT** se reconoce y se configura sola al conectarla: play, cue, sync, platos, pitch, faders, ecualizador, filtros, pads, loops, navegador y crossfader. Es un **perfil aportado por la comunidad**: lo configuró un usuario con el asistente y nos lo envió. ¡Gracias!

## 1.0.0-rc.6 · noviembre de 2026

### Vista Biblioteca: más pistas a la vista
- Nuevo botón **▤ BIBLIOTECA** en la barra superior (o la tecla **F10**): los decks se vuelven compactos arriba, con la **forma de onda grande en el centro**, y la biblioteca ocupa el resto de la pantalla. En una pantalla de 1920 × 1080 pasas de ver **8 pistas a ver 30**.
- Cada deck compacto lleva lo que usas en cabina: título en una línea, tonalidad y BPM, plato pequeño con el **tiempo transcurrido y el restante**, los **8 pads** con sus modos, **loops rápidos de 1/8 a 16**, CUE, PLAY, SYNC, pitch y un **vúmetro** del canal.
- **Cambiar de vista no corta nada**: los decks siguen sonando y todo queda como estaba. La app recuerda la vista que usabas.
- El **mezclador** se oculta (lo llevas en la controladora) y aparece cuando lo necesitas con el botón **MIXER**. El sonido no cambia: solo se esconde en pantalla.
- **Franjas plegables** entre los decks y la biblioteca: **grabación** (botón REC: grabar o parar, nombre de la mezcla, dónde se guarda, nivel y tiempo grabado), **efectos** (botón FX: las dos unidades con sus tres efectos, canal y beats) y **sampler**. Se cierran con su **▲** y se recuerda cuáles tenías abiertas.
- Accesos rápidos encima de la tabla: **Todas, Prepare, Historial, Explorar y Añadir**. **Explorar** filtra la vista abierta por **género → BPM → artista** con un clic en cada columna.

### Biblioteca compacta
- Nuevo ajuste **«Densidad de la biblioteca»** en **Ajustes → Biblioteca**: **Normal** (la de siempre), **Compacta** (filas finas de 23 px y letra de 13 px) o **Automática**, que usa la Compacta en la vista Biblioteca y la Normal en la vista Mezcla.
- Con la densidad Compacta, el **árbol de crates también se aprieta**: filas finas, iconos pequeños y subcrates sangrados, para ver muchas más crates sin hacer scroll.

### Funciona con más controladoras
- **Se reconocen y se configuran solas** nuevas controladoras, además de la Denon DJ MC4000: **Pioneer DJ DDJ-400, DDJ-FLX4 y DDJ-SB3**, **Hercules DJControl Inpulse 200, 300 y 500** y **Reloop Mixtour y Mixon 4**. Los perfiles están hechos con la documentación MIDI oficial de cada fabricante e incluyen LEDs y vúmetros donde el fabricante los documenta.
- Al conectar una controladora, la app te dice **«Controladora X detectada: perfil cargado»**. Si es un modelo sin perfil, te ofrece **configurarla con el asistente**, **importar un mapeo de Mixxx** (con un enlace a su lista oficial de controladoras) o **«Ahora no»**, y no vuelve a insistir con esa controladora.
- En **Ajustes → MIDI** ves cada controladora conectada con el perfil que usa (incluido, asistente, importado o ninguno), puedes cambiarlo o reconfigurarla, y tienes la lista de modelos con perfil incluido.
- El **informe de errores** indica qué controladora tienes conectada y con qué tipo de perfil, y el formulario de sugerencias tiene un campo opcional **«¿Qué controladora usas?»**.

### Arranque sin esperar a la controladora
- Arreglado: a veces, con cualquier controladora conectada, la app arrancaba pero **la forma de onda, los relojes y los vúmetros se quedaban quietos** aunque la música sonara, y el teclado no respondía. Pasaba cuando Windows tardaba en contestar por la controladora y la app se quedaba esperándolo.
- Ahora la app **arranca siempre sin esperar a la controladora**. Si no responde en 5 segundos, verás un aviso discreto, **«La controladora no responde; reconéctala o pulsa Reintentar»**, con su botón **Reintentar**. La app lo sigue intentando sola y, en cuanto responde, la controladora funciona.

### Panel Archivos
- Nuevo acceso **Archivos** junto a Todas, Prepare, Historial y Explorar (y en el árbol de la biblioteca, también en la vista Mezcla): navega por **Música, Documentos y todas las unidades** del equipo (con su nombre) en columnas. Al pulsar una carpeta se abre la siguiente columna y **su música sale en la lista**.
- Las canciones que ya tienes en la biblioteca salen con sus datos; las demás, **más apagadas** y con el título, el artista, el BPM y la duración de sus etiquetas.
- **Arrástralas a un deck** para pincharlas **sin añadirlas** a la biblioteca, o **a una crate o a Prepare** para añadirlas. Con **«Añadir esta carpeta a la biblioteca»** importas la carpeta entera, como con «Añadir música».
- La app **recuerda la última carpeta** que abriste. No muestra las carpetas del sistema ni las ocultas.

### Buscar solo donde quieres
- Junto al buscador, un **icono con casillas** para elegir en qué buscar: **título, artista, álbum, género, comentario, BPM, tonalidad y año**. Por defecto, en todos. Si desmarcas alguno, el icono se marca para que lo sepas. Se recuerda.

### Elige dónde se guardan tus grabaciones
- Botón **«Cambiar…»** en la franja de grabación y en **Ajustes → Audio → Grabación**. Si esa carpeta deja de existir (por ejemplo, un disco desconectado), la grabación **no se pierde**: se guarda en la de siempre (Música › Nexura DJ Studio › Grabaciones) y te avisa.

## 1.0.0-rc.5 · noviembre de 2026

### Ves más de lo que viene
- La línea blanca que marca lo que suena ya no tiene que estar en el centro de la forma de onda: ahora, de serie, está **a la izquierda**, así que ves el triple de lo que viene que de lo que ya ha pasado.
- Elígelo en **Ajustes → Reproducción → «Posición del cabezal»**: **Izquierda (25 %)**, **Un tercio (33 %)** o **Centro (50 %)**, como antes. Se aplica al momento en todos los decks y se recuerda.
- Los cues, loops, el beatgrid y las marcas siguen exactamente en su sitio respecto a lo que oyes.

### Plato y forma de onda más suaves
- **Un clic ya no mueve la pista.** Antes, con VINYL, pulsar el plato o la onda mientras sonaba la frenaba todo el rato que mantenías el botón, y la mezcla se descolocaba. Ahora hay que arrastrar al menos 3 píxeles para que haga algo.
- Se acabaron los saltos de dos beats al tocar el plato cerca del centro: ahora cuenta lo que mueves el ratón, no el ángulo, y el movimiento es proporcional y sin tirones.
- **Rueda del ratón sobre el plato**: parado, cada paso mueve 1/16 de beat (búsqueda fina); sonando, adelanta o atrasa unos 15 ms, suave, sin cambio de tono brusco.
- Nuevo ajuste **«Sensibilidad del plato y de la onda»** (Baja, Normal o Alta) en Ajustes → Reproducción. El scratch con intención en modo VINYL suena igual que siempre, y el jog de la controladora no cambia.

### Cues automáticos con sentido
- Ahora la IA pone **como mucho 5 cues por tema**, siempre en los mismos pads: **1 Inicio** (el primer golpe, aunque haya silencio delante), **2 Entrada** (cuando acaba la intro), **3 Drop** (la subida principal), **4 Break** (la bajada principal) y **5 Outro** (donde empieza la salida).
- Todos caen **cuadrados a la frase** (cada 8 compases, o 4 si el tema va así) y con al menos 16 compases entre uno y otro. Si una parte no está clara, no se pone: mejor 3 cues buenos que 5 sin sentido.
- **Tus cues no se tocan nunca.** Los automáticos que ya tenías se recalculan al cargar la pista o con clic derecho → «✨ Cues automáticos (IA)».

### Fluida también en equipos con procesador antiguo
- **La forma de onda ya no se queda parada mientras analizas.** Analizar tus pistas se hace ahora en segundo plano, en otro núcleo del procesador: la música, la onda y los platos siguen fluidos aunque estés analizando cientos de temas mientras pinchas. En un equipo lento, antes la onda se paraba hasta 2 segundos cada pocas pistas.
- **Con bibliotecas grandes (miles de pistas) ya no hay tirones al guardar.** La biblioteca se guarda agrupando los cambios y en los momentos de calma, sin parar la onda. Al cerrar la app se guarda todo lo pendiente: no se pierde nada.
- **El «Modo rendimiento» va de verdad a 30 fps regulares.** Antes, en un equipo justo, se quedaba en unos 20 fps a tirones y se veía peor que sin él.
- Cargar una pista larga en un deck mientras suena el otro ya no da un tirón a la onda.
- Nuevo ajuste **«Aceleración por GPU»** en **Ajustes → Audio → Rendimiento**: **Automática** (la de siempre) o **Desactivada**. Con algunas tarjetas gráficas y controladores la forma de onda puede quedarse congelada aunque la música siga; si te pasa, desactívala y pulsa **«Reiniciar ahora»**. Si la app detecta que la onda se ha congelado con la música sonando, te lo sugiere ella misma.
- El **informe de errores** puede llevar ahora un **diagnóstico de rendimiento** (procesador, memoria, tarjeta gráfica, número de pistas y lo fluida que ha ido la onda en los últimos minutos), sin tus canciones ni tus carpetas, para que podamos ayudarte si tu equipo va justo.

## 1.0.0-rc.4 · noviembre de 2026

### Limpiar biblioteca
- Nueva herramienta para poner orden en tu música con un botón: **🧹 Limpiar** en «Todas las pistas» (también en el menú **≡** de la biblioteca y en **? → Herramientas**). Revisa toda la biblioteca o solo la crate abierta, en segundo plano y sin cortar la música: si suena algo, va más despacio. La segunda vez es casi instantánea.
- **Duplicados**: encuentra los archivos repetidos (también si tienen otras etiquetas) y la misma canción en otra calidad, y te propone cuál conservar: la de mejor calidad, luego la que tiene más datos en Nexura y luego la que está mejor ordenada. Al resolver, los cues, crates, valoración, reproducciones e historial pasan a la que conservas, y las otras copias van a la **Papelera de Windows** (nunca se borran del todo). Las remezclas, versiones extendidas y directos se enseñan aparte y no se tocan.
- **Etiquetas**: detecta pistas sin artista o título, «Pista 01», basura de vídeos («(Official Video)», «VEVO», «[HD]»), guiones bajos, MAYÚSCULAS, etiquetas que no coinciden con el nombre del archivo y pistas sin año, género o carátula. Te propone el arreglo y te dice de dónde sale y cuánto nos fiamos; si quieres, lo busca en **internet** (bases de datos libres de música, con carátula). Se guarda también en el archivo en MP3 y FLAC, sin tocar el sonido.
- **Calidad**: te avisa de archivos de poca calidad, formatos que conviene convertir, dañados, perdidos (con enlace a «Relocalizar») y duraciones raras, y crea una crate con ellos para revisarlos después.
- **Historial de cambios**: todo se puede deshacer, incluso días después: vuelven las pistas con sus datos, los archivos salen de la Papelera y las etiquetas originales regresan a los archivos. Antes de cada cambio se hace una copia de seguridad de la biblioteca.

### Menos azul: nuevo tema «Grafito»
- La interfaz ya no es toda azul marino. El tema nuevo, **Grafito**, es un gris oscuro neutro, como el de los programas DJ profesionales, y el color solo aparece donde dice algo: el **Deck 1 en azul** y el **Deck 2 en rojo** (su número, el borde de arriba, la forma de onda, su canal del mezclador y el play cuando suena), la **selección en ámbar**, el **verde** para lo que suena o está bien, el **rojo** para grabar y los avisos, y el **morado** para los efectos y la IA.
- Los botones, pestañas, knobs, menús, cabeceras de la tabla y diálogos pasan a gris. Un botón encendido (EN DECK, SUPERIOR, LAPTOP, el modo de los pads…) se ve en gris claro.
- Elige tu tema en **Ajustes → General → Apariencia**: **Grafito** (recomendado, el de serie), **Carbón** (aún más oscuro y sobrio) o **Azul noche (clásico)**, la paleta azul de siempre para quien la prefiera. Se aplica al momento y se recuerda.
- Los colores de los hot cues y del sampler ya no incluyen azul, para no confundirlos con el Deck 1 (los cues que ya tenías conservan su color).
- Textos más legibles: todos los textos de Grafito y Carbón tienen buen contraste sobre su fondo.

### SYNC fiable
- **SYNC** iguala el BPM y alinea los beats al pulsarlo, y los mantiene alineados todo el tiempo: en 5 minutos de mezcla la diferencia ya no pasa de un par de milésimas (antes podía irse a 40-80 ms tras tocar el plato o con el otro deck parado).
- Nuevo botón **MASTER** en cada deck para elegir el deck maestro; por defecto lo es el primero que suena. Si cambias el tempo del maestro, los decks con SYNC lo siguen.
- **Medidor de fase** junto al BPM: punto verde en el centro cuando los beats van a la par; a un lado, si van por delante o por detrás.
- Mover el pitch de un deck con SYNC cambia el tempo de los dos a la vez, sin desfasarlos.
- Funciona con beatgrids de tempo variable, con BPM muy distintos (×2 / ½), con un deck parado y al cargar otra pista con SYNC activo.
- Con **KEY LOCK** (también en Automix y Autoplay) los golpes se oyen mucho más juntos: antes se separaban hasta 55 ms; ahora, unos 10 como mucho.
- En los vídeos de YouTube SYNC no se activa y se explica por qué (su reproductor no permite ajustar el tempo con precisión).

### Zoom de la forma de onda en los dos decks a la vez
- Los botones **+ / −**, la rueda del ratón y las teclas **+ / −** cambian el zoom de todos los decks a la vez, arriba y en el deck.
- Si lo prefieres por separado: Ajustes → Reproducción → «Zoom de la forma de onda» → «Independiente por deck». Se recuerda al cerrar.

### Más ligero
- La interfaz usa unas tres veces menos CPU con dos decks sonando y la tarjeta gráfica trabaja cinco veces menos: se dibuja como mucho a 60 fps aunque tu pantalla sea de 144 o 240 Hz, la forma de onda se pinta por trozos ya preparados y solo se redibuja lo que cambia.
- Los efectos apagados ya no gastan CPU, y los decks vacíos tampoco.
- Nuevo **Modo rendimiento** (Ajustes → Audio): menos animaciones, sin brillos y forma de onda a 30 fps, para portátiles o equipos justos. En el mismo sitio verás si la aceleración por GPU está activa. Funciona con los tres temas.

## 1.0.0-rc.3 · noviembre de 2026

### Y además
- El aviso de nueva versión ya no pasa desapercibido: al abrir Nexura aparece una ventana ámbar abajo a la izquierda con la versión nueva y lo más destacado de sus novedades, y los botones **Descargar ahora** y **Más tarde** (late unos segundos al aparecer y luego se queda fija). Si eliges «Más tarde», no vuelve a salir hasta el siguiente arranque, y el botón **⬆ Actualizar** de la barra superior, junto a «?», sigue ahí. La descarga y el «listo para instalar» (en verde) se ven en la misma ventana.

## 1.0.0-rc.2 · noviembre de 2026

### Buscar en YouTube sin configurar nada (muy pronto)
- Nexura ya está preparada para buscar vídeos de YouTube sin crear ninguna clave, a través de un servicio gratuito de NexuraIA con **30 búsquedas al día**. Lo activaremos en una próxima actualización; mientras tanto, la búsqueda funciona con tu propia clave.
- Solo se envía lo que buscas y un identificador anónimo de esta instalación (para contar las búsquedas del día). Nada de tu música ni de tus datos.
- Si llegas al límite, te lo decimos claro: al día siguiente se renueva, o puedes poner tu propia clave.
- Si tienes tu propia clave de YouTube (o tu cuenta de Google conectada), se sigue usando la tuya, como siempre.

### Tus claves, más protegidas
- En Ajustes → YouTube la clave ya no se ve entera: aparece como «AIza••••••••». Con el botón 👁 la ves unos segundos.
- Lo mismo con el «Client secret» de la cuenta de Google.
- Nuevo botón **Comprobar clave**: te dice si la clave funciona o qué le pasa (no es válida, se ha gastado la cuota del día o falta activar la API de YouTube).

### Vídeos de YouTube con tiempo y barra de progreso
- Los vídeos de YouTube muestran el tiempo transcurrido y el que queda, igual que tus pistas.
- En lugar de la forma de onda aparece una barra de progreso con tus hot cues: haz clic en ella para saltar a ese punto.
- Aviso de los últimos 30 segundos y fundidos del Autoplay en el momento justo también con vídeos.

### Y además
- Esta ventana: cuando Nexura se actualice, te lo contará al abrirla. También la tienes en el menú «?» → Novedades.
- Textos legales completos con los datos del responsable, y la política de privacidad explica la búsqueda de YouTube.

## 1.0.0-rc.1 · noviembre de 2026

- Actualizaciones automáticas: aviso discreto en la barra de estado, descarga y «Reiniciar para actualizar» (con música sonando, se instala al cerrar).
- Copias de seguridad diarias de la biblioteca y recuperación si se daña.
- Enviar informes de errores y sugerencias desde la app, con vista previa de lo que se envía.
- Estadísticas anónimas de uso opcionales, bienvenida en 4 pasos, menú de ayuda «?» y textos legales.
