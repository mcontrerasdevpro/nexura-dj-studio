# Novedades de Nexura DJ Studio

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
