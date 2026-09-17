Configura mi statusline de Claude Code exactamente como te indico. No la rediseñes ni "mejores" el script: cópialo literal.

## 1. Crea el script

Escribe el archivo `~/.claude/statusline-command.sh` con este contenido exacto (respeta los caracteres Unicode `▒ ░ 󰧑` tal cual) y dale permisos de ejecución con `chmod +x`:

```bash
#!/usr/bin/env bash
input=$(cat)

val() { echo "$input" | grep -o "\"$1\":[^,}]*" | head -1 | sed 's/.*://;s/"//g;s/^ *//'; }
nested() { echo "$input" | grep -o "\"$1\":{[^}]*}" | head -1 | grep -o "\"$2\":[^,}]*" | head -1 | sed 's/.*://;s/"//g;s/^ *//'; }
# like nested(), but tolerates one level of sub-objects inside the target object
nested2() { echo "$input" | grep -oE "\"$1\":\{([^{}]|\{[^{}]*\})*\}" | head -1 | grep -o "\"$2\":[^,}]*" | head -1 | sed 's/.*://;s/"//g;s/^ *//'; }

round() { [ -n "$1" ] && [ "$1" != "null" ] && printf "%.0f" "$1" 2>/dev/null; }

project=$(basename "$(val project_dir)")
[ -z "$project" ] && project=$(basename "$(pwd)")
model=$(val display_name)
model_raw="$model"
model="${model% (*context)}"
model="${model% (*tokens)}"
case "$model_raw" in *1M*|*1m*) model="${model} - 1M";; esac
ctx_pct=$(round "$(nested2 context_window used_percentage)")

session_pct=$(round "$(nested five_hour used_percentage)")
session_reset=$(nested five_hour resets_at)
week_pct=$(round "$(nested seven_day used_percentage)")
week_reset=$(nested seven_day resets_at)

time_left() {
  local reset=$1 now
  now=$(date +%s)
  [ -z "$reset" ] && return
  [ "$reset" -le "$now" ] 2>/dev/null && return
  local diff=$((reset - now))
  local days=$((diff / 86400))
  local hours=$(( (diff % 86400) / 3600 ))
  local mins=$(( (diff % 3600) / 60 ))
  if [ "$days" -gt 0 ]; then
    printf "%dd %02dh" "$days" "$hours"
  else
    printf "%02d:%02d" "$hours" "$mins"
  fi
}

session_time=$(time_left "$session_reset")
week_time=$(time_left "$week_reset")

make_bar() {
  local pct=${1:-0} width=8
  local filled_8ths=$(awk -v p="$pct" -v w="$width" 'BEGIN{ v=int((p/100)*w*8+0.5); if(v>w*8)v=w*8; if(v<0)v=0; print v }')
  local full=$((filled_8ths / 8))
  local frac=$((filled_8ths % 8))
  local bar="" i
  local parts=(" " "▏" "▎" "▍" "▌" "▋" "▊" "▉")
  for ((i=0; i<full && i<width; i++)); do bar="${bar}▒"; done
  if [ "$full" -lt "$width" ] && [ "$frac" -gt 0 ]; then
    bar="${bar}▒"
    full=$((full + 1))
  fi
  for ((i=full; i<width; i++)); do bar="${bar}░"; done
  echo "$bar"
}

R="\033[0m"
BOLD="\033[1m"
FG_BLK="\033[30m"
FG_WHT="\033[97m"
BG_GRN="\033[42m"
BG_YLW="\033[43m"
BG_RED="\033[41m"
BG_MAG="\033[45m"

pill_bg() {
  local p=${1:-0}
  if [ "$p" -ge 80 ] 2>/dev/null; then echo "$BG_RED$FG_WHT"
  elif [ "$p" -ge 60 ] 2>/dev/null; then echo "$BG_YLW$FG_BLK"
  else echo "$BG_GRN$FG_BLK"
  fi
}

out=""
n=0
pill() {
  local icon="$1" label="$2" bg="${3:-$BG_GRN$FG_BLK}"
  [ $n -gt 0 ] && out="${out} "
  out="${out}${bg}${BOLD} ${icon} ${label} ${R}"
  n=$((n + 1))
}

bar_pill() {
  local pct="$1" label="$2"
  local bg; bg=$(pill_bg "$pct")
  local bar; bar=$(make_bar "$pct")
  [ $n -gt 0 ] && out="${out} "
  out="${out}${bg}${BOLD} ${bar} ${label} ${R}"
  n=$((n + 1))
}

[ -n "$project" ]     && pill "" "$project"
[ -n "$model" ]       && pill "󰧑" "$model"
[ -n "$ctx_pct" ]     && bar_pill "$ctx_pct" "${ctx_pct}%"
if [ -n "$session_pct" ]; then
  local_bg=$(pill_bg "$session_pct")
  bar_pill "$session_pct" "Today ${session_pct}%"
  [ -n "$session_time" ] && pill "" "$session_time" "$local_bg"
fi
if [ -n "$week_pct" ]; then
  local_bg=$(pill_bg "$week_pct")
  bar_pill "$week_pct" "Week ${week_pct}%"
  [ -n "$week_time" ] && pill "" "$week_time" "$local_bg"
fi

printf "%b" "$out"
```

## 2. Actívalo en settings

En `~/.claude/settings.json` añade (o reemplaza) la clave `statusLine`, **sin borrar el resto de claves que ya tenga el archivo**:

```json
"statusLine": {
  "type": "command",
  "command": "bash ~/.claude/statusline-command.sh",
  "padding": 0
}
```

Si el archivo no existe, créalo con solo ese objeto dentro de `{ }`.

## 3. Verifica antes de darlo por hecho

Ejecuta esta prueba y muéstrame la salida. Deben verse 7 "píldoras" con fondo de color: proyecto, modelo, barra de contexto 42%, "Today 14%" + temporizador, "Week 71%" + temporizador (esta última en amarillo):

```bash
echo '{"model":{"display_name":"Fable 5.1 (1M context)"},"workspace":{"project_dir":"/tmp/demo"},"context_window":{"context_window_size":1000000,"current_usage":{"input_tokens":1},"used_percentage":42.4},"rate_limits":{"five_hour":{"used_percentage":14.000000000000002,"resets_at":'$(( $(date +%s) + 7200 ))'},"seven_day":{"used_percentage":71,"resets_at":'$(( $(date +%s) + 200000 ))'}}}' | bash ~/.claude/statusline-command.sh; echo
```

Colores esperados: verde < 60 %, amarillo 60–79 %, rojo ≥ 80 %.

## Notas

- El icono `󰧑` del modelo es un glifo de Nerd Fonts (nf-md-brain). Si mi terminal no usa una Nerd Font y se ve un cuadro vacío, sustitúyelo por una cadena vacía `""` en la línea `pill "󰧑" "$model"`. No cambies nada más.
- El script no necesita `jq` ni ninguna dependencia: solo bash, grep, sed y awk.
- La statusline se refresca al abrir una sesión nueva de Claude Code; si no aparece, reinicia la sesión.
