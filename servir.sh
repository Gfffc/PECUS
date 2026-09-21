#!/usr/bin/env bash
# =========================================================
# servir.sh — sobe o painel em http://localhost:5500
#
# Os módulos ES6 do projeto não carregam por file://: o navegador recusa
# import entre arquivos sem origem HTTP. Daí o servidor, mesmo sendo tudo
# estático.
#
#   ./servir.sh            sobe em segundo plano e devolve o terminal
#   ./servir.sh parar      derruba
#   ./servir.sh estado     diz se está de pé
#   ./servir.sh log        acompanha o log de acesso
#
#   PORTA=8080 ./servir.sh        outra porta
#   ENDERECO=0.0.0.0 ./servir.sh  expõe na rede local (padrão: só esta máquina)
# =========================================================
set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORTA="${PORTA:-5500}"
ENDERECO="${ENDERECO:-127.0.0.1}"
PID_ARQ="$RAIZ/.servidor.pid"
LOG="$RAIZ/.servidor.log"
URL="http://localhost:$PORTA"

vivo() {
  [[ -f "$PID_ARQ" ]] && kill -0 "$(cat "$PID_ARQ")" 2>/dev/null
}

conferir_base() {
  local faltando=()
  for f in index.html data/sif_uf_doencas.csv data/sif_uf_abates.csv \
           data/sif_municipio_doencas.csv data/ibge_malha_uf.geojson; do
    [[ -f "$RAIZ/$f" ]] || faltando+=("$f")
  done
  if (( ${#faltando[@]} )); then
    echo "Falta arquivo da base:" >&2
    printf '  %s\n' "${faltando[@]}" >&2
    echo "Rode: python3 data/preparar_dados.py" >&2
    exit 1
  fi
}

case "${1:-subir}" in
  parar)
    if vivo; then
      kill "$(cat "$PID_ARQ")" && rm -f "$PID_ARQ"
      echo "painel derrubado"
    else
      rm -f "$PID_ARQ"
      echo "não estava de pé"
    fi
    ;;

  estado)
    if vivo; then
      echo "de pé em $URL (pid $(cat "$PID_ARQ"))"
    else
      echo "fora do ar"
      exit 1
    fi
    ;;

  log)
    exec tail -f "$LOG"
    ;;

  subir)
    if vivo; then
      echo "já estava de pé em $URL (pid $(cat "$PID_ARQ"))"
      exit 0
    fi
    conferir_base
    command -v python3 >/dev/null || { echo "python3 não encontrado" >&2; exit 1; }

    # setsid solta o servidor do terminal: fechar o terminal não o derruba
    setsid python3 -m http.server "$PORTA" \
      --bind "$ENDERECO" --directory "$RAIZ" >"$LOG" 2>&1 < /dev/null &
    echo $! > "$PID_ARQ"

    for _ in $(seq 20); do
      if curl -fsS -o /dev/null --max-time 1 "$URL/index.html" 2>/dev/null; then
        echo "painel de pé em $URL (pid $(cat "$PID_ARQ"))"
        echo "  parar:  ./servir.sh parar"
        echo "  log:    ./servir.sh log"
        exit 0
      fi
      sleep 0.25
    done

    echo "o servidor subiu mas não respondeu em 5s — veja $LOG" >&2
    exit 1
    ;;

  *)
    echo "uso: ./servir.sh [subir|parar|estado|log]" >&2
    exit 2
    ;;
esac
