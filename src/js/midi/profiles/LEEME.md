# Perfiles MIDI incluidos

Cada perfil se hace **solo con la documentación MIDI pública del fabricante** (tablas «MIDI Message List»,
«MIDI Commands», «MIDI Map»…). Su URL va en `source` y la explicación en `"//"`, al principio del archivo.
No se copian mapeos ni código de Mixxx (GPL) ni de programas comerciales. Lo que el fabricante no documenta
no se inventa: se deja fuera y se anota en `missing`.

Para añadir un perfil: crea el JSON, añádelo a `index.json` y ejecuta `node tools/test-perfiles-midi.mjs`.
El patrón de nombre (`match`) no puede coincidir con el de otro modelo.

| Campo | Qué es |
|---|---|
| `id`, `name`, `manufacturer`, `models` | Identificador, nombre que se enseña, marca y modelos que cubre |
| `match` | Expresiones regulares (sin distinguir mayúsculas) sobre el nombre del puerto MIDI |
| `source`, `sourceTitle` | Documento oficial del que salen los datos |
| `decks` | 2 o 4 |
| `init` | Mensajes que se envían al conectar (3 bytes o SysEx `F0 … F7`; los SysEx, solo si hay permiso) |
| `mappings` | `{ key, action, kind?, enc?, inv?, ticksPerRev? }`: `key` = `n` (nota) / `c` (CC) / `p` (pitch bend) + canal 0-15 + `:` + número decimal; `kind` = `button` (por defecto), `abs` o `rel`; `enc` = `twos` (complemento a dos), `offset` (64 = centro) o `sign`; `inv` invierte; `ticksPerRev` = pasos del jog por vuelta, si el fabricante los da (se convierte a la escala de referencia, 605) |
| `leds` | `{ key, action, on?, off? }`: LED que refleja el estado de la acción (valores 0-127; por defecto 127/0) |
| `vu` | `{ key, source, min?, max? }`: vúmetro; `source` = `deck1`…`deck4`, `masterL`, `masterR` o `master` |
| `missing` | Lo que no está documentado o no se ha podido asignar |
| `generic: true` | Familia sin controles: solo nombra la marca en Ajustes y en el aviso de controladora nueva |
