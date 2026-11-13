# Novedades de Nexura DJ Studio

## 1.0.0-rc.4 · en preparación

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
