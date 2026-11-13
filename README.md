<div align="center">

<img src="docs/img/icono.png" alt="" width="96">

# Nexura DJ Studio

**Software DJ gratuito para Windows, con herramientas de IA que funcionan en tu ordenador.**

Mezcla tu música local y listas de YouTube, conecta cualquier controladora MIDI y deja que la IA te ayude a preparar el set.

[![Descargar](https://img.shields.io/github/v/release/mcontrerasdevpro/nexura-dj-studio?include_prereleases&label=descargar&color=ffa31a)](https://github.com/mcontrerasdevpro/nexura-dj-studio/releases)
[![Pruebas](https://github.com/mcontrerasdevpro/nexura-dj-studio/actions/workflows/pruebas.yml/badge.svg)](https://github.com/mcontrerasdevpro/nexura-dj-studio/actions/workflows/pruebas.yml)
![Windows 10/11](https://img.shields.io/badge/Windows-10%20%7C%2011-1f6feb)
![Gratis](https://img.shields.io/badge/precio-gratis-3fd6a4)

<img src="docs/img/nexura-principal.png" alt="Nexura DJ Studio: dos decks con forma de onda, stems separados por IA, mezclador y biblioteca" width="100%">

</div>

---

## Descargar

1. Ve a [**Versiones**](https://github.com/mcontrerasdevpro/nexura-dj-studio/releases) y descarga `Nexura-DJ-Studio-Setup-<versión>.exe` (o el `.zip` portable).
2. Ejecútalo. Si Windows muestra «Windows protegió su PC», pulsa **Más información → Ejecutar de todas formas** (el instalador todavía no está firmado).
3. Sigue la bienvenida: añade tu carpeta de música y, si tienes, conecta tu controladora.

La app se **actualiza sola**: cuando hay una versión nueva te avisa y se instala al cerrarla, nunca en mitad de una sesión.

## Qué puedes hacer

<table>
<tr>
<td width="50%" valign="top">

### 🎚️ Mezclar
2 o 4 decks con sync de tempo y fase, key lock de alta calidad, hot cues, loops, slip, censor y vinyl. Mezclador con EQ de 3 bandas, filtro, crossfader con curvas y vúmetros. 36 efectos sincronizados al BPM y sampler de 32 ranuras.

### 🤖 IA en local
Separa cualquier canción en **voz, batería, bajo y melodía** (stems) con tu tarjeta gráfica. Sugiere la siguiente pista por tonalidad, BPM y energía, crea sets a partir de una frase y pincha sola con **Automix**. Ningún dato sale de tu ordenador.

</td>
<td width="50%" valign="top">

### 📚 Organizar
Crates y subcrates (arrastra una carpeta y se crean solas), smart crates, Prepare e historial. Importa tu biblioteca de rekordbox, Traktor, VirtualDJ o Serato, y listas M3U. **Autoplay** sobre cualquier crate, en orden o aleatorio.

### 🎛️ Tu controladora
Funciona con **cualquier controladora MIDI**: un asistente aprende cada control moviéndolo, y hay MIDI Learn, importación de mapeos de Mixxx y monitor MIDI. Salida a tarjeta de 4 canales o a una mesa de mezclas externa.

</td>
</tr>
</table>

<div align="center">
<img src="docs/img/nexura-4-decks-autoplay.png" alt="Cuatro decks con el Autoplay pinchando un crate" width="49%">
<img src="docs/img/nexura-biblioteca.png" alt="Biblioteca con crates por décadas" width="49%">
</div>

## Funciones en detalle

| Área | Incluye |
|---|---|
| **Decks** | 2 o 4 decks; play/cue, sync de tempo y fase, key lock, transposición y key sync, slip, censor, vinyl/jog, freno y arranque de motor, pitch bend, rangos ±8/16/50 % |
| **Pads** | Hot Cue (8, con colores y nombres), Cue Loops, Saved Loop, Roll, Slicer, Beat Jump, Sampler, Pitch Play y Stems |
| **Beatgrid** | BPM y primer tiempo automáticos, **BPM variable** (directos, temas sin claqueta), editor de marcas, tap tempo, ×2 / ½, «1 aquí» |
| **Mezclador** | 2 o 4 canales; gain, EQ con kill, filtro, PFL, faders, crossfader con 4 curvas, master con limitador, cue mix, split |
| **Efectos** | 2 unidades × 3 ranuras, 36 efectos sincronizados al BPM (echo, reverb, flanger, filtros, bitcrush, risers…) y presets |
| **Biblioteca** | Archivos y carpetas, etiquetas ID3/FLAC, búsqueda, columnas configurables, crates y subcrates ordenables, smart crates, Prepare, historial (CSV), Camelot. Ctrl+Supr elimina al instante con Deshacer |
| **Limpiar biblioteca** | Duplicados (exactos, también con otras etiquetas, y la misma canción en otra calidad) con propuesta de cuál conservar y fusión de cues/crates/historial; etiquetas sucias o que faltan con propuestas (nombre del archivo, carpeta, tu biblioteca e internet, con carátula) y escritura en MP3/FLAC sin tocar el audio; avisos de calidad; Papelera de Windows y deshacer todo |
| **Importar** | rekordbox (XML), Traktor (NML), VirtualDJ, Serato (`.crate`), M3U/M3U8, cues y beatgrid guardados en MP3/FLAC |
| **Online** | Listas de YouTube con el reproductor oficial; listas de Spotify (solo metadatos, para encontrar las canciones en tu biblioteca) |
| **Análisis** | BPM, tonalidad, forma de onda de 3 bandas, auto-gain, estructura (intro, drops, breaks, outro) y energía 1-10 |
| **Grabación** | WAV del master en `Música\Nexura DJ Studio\Grabaciones` |
| **Seguridad** | Copia de seguridad diaria de la biblioteca (14 últimas) y recuperación si se daña |

**Formatos:** MP3, WAV, FLAC, OGG, OPUS, M4A/AAC.

> **YouTube:** los vídeos se reproducen en su reproductor oficial dentro del deck. Sus condiciones no permiten procesar el audio, así que en esas pistas no hay EQ, efectos, scratch, loops ni stems.

## YouTube y Spotify

**Sin configurar nada** puedes:
- Importar listas de YouTube pegando su enlace (hasta 200 vídeos por lista) y pincharlas.
- Importar listas de Spotify pegando su enlace: Nexura lee título, artistas, duración y carátula y las busca **en tu música**. No se descarga audio de Spotify ni de YouTube.

**Con una clave gratuita de YouTube** además puedes **buscar** en YouTube (por ejemplo «▶ Buscar en YouTube las que faltan» al importar una lista de Spotify) e importar listas completas de más de 200 vídeos.

<details>
<summary><b>Cómo conseguir la clave de YouTube (5 minutos, gratis)</b></summary>

1. Entra en [console.cloud.google.com](https://console.cloud.google.com) con tu cuenta de Google. No hace falta tarjeta.
2. En el selector de proyectos de arriba, pulsa **Proyecto nuevo**, ponle un nombre (por ejemplo «Nexura DJ») y créalo.
3. Ve a **APIs y servicios → Biblioteca**, busca **YouTube Data API v3** y pulsa **Habilitar**.
4. Ve a **APIs y servicios → Credenciales → Crear credenciales → Clave de API**.
5. En **Restricciones de API**, escribe «YouTube» en el filtro, marca solo **YouTube Data API v3** y pulsa **Aceptar**. En restricciones de aplicación deja **Ninguna**. Pulsa **Crear** y copia la clave (empieza por `AIza…`).
6. En Nexura: **⚙ Ajustes → YouTube → Clave de API**, pega la clave y haz clic fuera del campo para guardarla.

La clave gratuita permite unas 100 búsquedas al día. Es personal: no la compartas ni la publiques. Si crees que alguien la ha visto, regenérala en **Credenciales** y pega la nueva en Nexura.

Si aparece un aviso sobre «cuenta de servicio», ignóralo: solo afecta a otras APIs de Google.

</details>

**Mis listas (opcional):** para ver tus listas privadas de YouTube, crea en la misma consola un cliente OAuth de tipo «Aplicación de escritorio» y pon su Client ID y Client secret en **Ajustes → YouTube → Conectar cuenta**.

## Controladoras

Al conectar una controladora, Nexura la detecta sola. En **Ajustes → MIDI / Controladores**:

- **Añadir controladora:** el asistente te pide mover cada control y detecta el tipo de mensaje, la codificación de platos y encoders y los pasos del jog.
- **MIDI Learn** para asignar cualquier acción, **importar mapeos de Mixxx** (`.midi.xml`) y exportar/importar perfiles.
- **4 decks:** aparecen solos con controladoras de 4 decks; los decks 1/3 comparten el lado izquierdo y 2/4 el derecho.

Las controladoras que solo funcionan por HID no son compatibles.

## Atajos de teclado

| | |
|---|---|
| Deck 1 | `Z` cue · `X` play · `C` sync · `V` loop · `A`/`S` bend · `1`–`8` pads |
| Deck 2 | `N` cue · `M` play · `,` sync · `.` loop · `K`/`L` bend · `Q`–`I` pads |
| Biblioteca | `↑`/`↓` · `Mayús+←/→` cargar · `Ctrl+F` buscar · `Supr` quitar del crate · `Ctrl+Supr` eliminar · `Ctrl+Z` deshacer |
| General | `F6` Split Cue · `F7` Automix · `Mayús+F7` Autoplay · `F8` modo portátil · `F9` grabar · `F11` pantalla completa |

## Privacidad

Tu música, tu biblioteca y los stems se quedan en tu ordenador. Solo se envía algo si tú lo eliges: un informe o sugerencia (con vista previa, sin rutas ni nombres de canciones) o las estadísticas anónimas de uso (desactivables en Ajustes). Si buscas en YouTube sin clave propia, el servicio de NexuraIA recibe solo el texto buscado y un identificador anónimo de la instalación (para el límite diario). Detalles en [`PRIVACIDAD.txt`](src/legal/PRIVACIDAD.txt) y [`LICENCIA.txt`](src/legal/LICENCIA.txt).

## Desarrollo

Requisitos: Windows 10/11 y [Node.js 20 LTS o superior](https://nodejs.org).

```powershell
git clone https://github.com/mcontrerasdevpro/nexura-dj-studio.git
cd nexura-dj-studio
npm install
npm start
```

| Comando | Para qué |
|---|---|
| `npm run dev` | La app con herramientas de desarrollo |
| `npm run web` | La interfaz en http://localhost:5180, sin Electron |
| `npm run beta` | Instalador y `.zip` en `dist\` |
| `node tools/test-todo.cjs` | Todas las pruebas de Node y comprobación de sintaxis |

**Publicar una versión:** sube la versión en `package.json`, haz commit y crea la etiqueta (`git tag v1.0.0 && git push --tags`). GitHub Actions pasa las pruebas, genera el instalador y crea un borrador en *Versiones* para revisarlo y publicarlo. Cada pull request ejecuta las pruebas automáticamente.

**Herramientas opcionales:** stems con [uv](https://docs.astral.sh/uv/), ffmpeg y, mejor, una GPU NVIDIA (se instala desde **Ajustes → ✨ IA**); sets por texto con [Ollama](https://ollama.com) en el mismo equipo.

<details>
<summary>Estructura del código</summary>

- `main.js`, `main/` y `preload.js`: proceso principal de Electron (archivos, etiquetas, almacenamiento, actualizaciones, copias, registro).
- `src/js/audio/`: motor de audio, decks (AudioWorklet), beatgrid, stems, efectos y sampler.
- `src/js/analysis/`: BPM, beatgrid variable, tonalidad, estructura y energía.
- `src/js/library/`: biblioteca e importadores.
- `src/js/midi/`: MIDI universal, asistente, perfiles e importación de Mixxx.
- `src/js/ai/`: Automix, Autoplay, sugerencias y sets por texto.
- `src/js/ui/`: interfaz.
- `tools/`: pruebas, servidor web y motor de stems (Python, Demucs).

</details>

## Contacto

¿Un error o una idea? Usa **? → Enviar informe o sugerencia** dentro de la app o escribe a **contacto@nexuraia.com**.

<div align="center">

<img src="docs/img/nexura-bienvenida.png" alt="Pantalla de bienvenida de Nexura DJ Studio" width="70%">

Hecho por **[NexuraIA](https://nexuraia.com)** · © 2026

</div>
