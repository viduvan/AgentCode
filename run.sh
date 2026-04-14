#!/bin/bash
###############################################################################
# run.sh — Khởi động Ollama local + mở VS Code với Agent Code extension
#
# Tự động:
#   1. Activate Python venv (python/)
#   2. Start Ollama local (ollama/bin/ollama)
#   3. Check model (models/)
#   4. Compile extension nếu cần
#   5. Mở VS Code
#
# Usage: ./run.sh
###############################################################################
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/python"
PYTHON_EXE="$VENV_DIR/bin/python3"
EXT_DIR="$SCRIPT_DIR/vscode-extension"

OLLAMA_BIN="$SCRIPT_DIR/ollama/bin/ollama"
OLLAMA_HOST="http://127.0.0.1:11435"
OLLAMA_MODELS="$SCRIPT_DIR/models"

export OLLAMA_HOST
export OLLAMA_MODELS

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; exit 1; }

echo ""
echo "═══════════════════════════════════════════════════"
echo "  🤖 Agent Code — Khởi động (Self-Contained)"
echo "═══════════════════════════════════════════════════"
echo ""

# ── 1. Check env_setup đã chạy chưa ──────────────────────────────
if [ ! -d "$VENV_DIR" ] || [ ! -f "$PYTHON_EXE" ]; then
    error "Chưa setup! Chạy ./env_setup.sh trước."
fi

if [ ! -f "$OLLAMA_BIN" ]; then
    error "Ollama chưa cài! Chạy ./env_setup.sh trước."
fi

if ! command -v code &>/dev/null; then
    error "VS Code chưa cài! Tải tại: https://code.visualstudio.com"
fi

# ── 2. Activate Python venv ───────────────────────────────────────
echo "── Activate Python venv ──"
source "$VENV_DIR/bin/activate"
info "Python venv activated: $(which python)"

# ── 3. Start Ollama local server ──────────────────────────────────
echo ""
echo "── Khởi động Ollama local ──"

if curl -s --max-time 2 "$OLLAMA_HOST/api/tags" &>/dev/null; then
    info "Ollama local đã chạy trên :11435"
else
    OLLAMA_HOST="$OLLAMA_HOST" OLLAMA_MODELS="$OLLAMA_MODELS" "$OLLAMA_BIN" serve &>/dev/null &
    OLLAMA_PID=$!
    echo -n "  Đang khởi động Ollama local..."

    for i in {1..15}; do
        if curl -s --max-time 2 "$OLLAMA_HOST/api/tags" &>/dev/null; then
            echo ""
            info "Ollama local đã start (PID: $OLLAMA_PID)"
            break
        fi
        echo -n "."
        sleep 1
    done

    if ! curl -s --max-time 2 "$OLLAMA_HOST/api/tags" &>/dev/null; then
        echo ""
        error "Ollama local không khởi động được!"
    fi
fi

# ── 4. Check model ────────────────────────────────────────────────
echo ""
echo "── Check model ──"

if OLLAMA_HOST="$OLLAMA_HOST" "$OLLAMA_BIN" list 2>/dev/null | grep -q "deepseek-coder-v2:16b"; then
    info "Model deepseek-coder-v2:16b sẵn sàng"
else
    warn "Model chưa tải. Đang pull..."
    OLLAMA_HOST="$OLLAMA_HOST" OLLAMA_MODELS="$OLLAMA_MODELS" "$OLLAMA_BIN" pull deepseek-coder-v2:16b
    info "Model đã tải xong"
fi

# ── 5. Compile extension nếu cần ──────────────────────────────────
echo ""
echo "── Check extension ──"

if [ ! -d "$EXT_DIR/out" ] || [ ! -f "$EXT_DIR/out/extension.js" ]; then
    warn "Extension chưa compile. Đang compile..."
    cd "$EXT_DIR"
    npm install --silent 2>&1 | tail -2
    npx tsc -p ./ 2>&1
    info "Extension compiled"
else
    info "Extension đã compile sẵn"
fi

# ── 6. Mở VS Code ─────────────────────────────────────────────────
echo ""
echo "── Mở VS Code ──"

code "$EXT_DIR" 2>/dev/null
info "VS Code đã mở tại vscode-extension/"

# ── Hướng dẫn sử dụng ─────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "  ${GREEN}✅ Mọi thứ đã sẵn sàng!${NC}"
echo "═══════════════════════════════════════════════════"
echo ""
echo -e "  ${CYAN}Trong VS Code:${NC}"
echo "    1. Nhấn F5 → chạy Extension Development Host"
echo "    2. Trong cửa sổ mới, mở project bạn muốn edit"
echo ""
echo -e "  ${CYAN}Phím tắt:${NC}"
echo "    Ctrl+Shift+E  → Edit code (chọn code trước)"
echo "    Ctrl+Shift+H  → Explain code"
echo "    Ctrl+Shift+Y  → Accept changes"
echo "    Ctrl+Shift+N  → Reject changes"
echo ""
echo -e "  ${CYAN}CLI (terminal với venv đã activate):${NC}"
echo "    agent-code edit \"add logging\" --file app.py"
echo "    agent-code explain --file utils.py"
echo "    agent-code review --file api.py"
echo "    agent-code generate \"Flask server\""
echo ""
echo "  Ollama local: $OLLAMA_HOST"
echo "  Nhấn Ctrl+C để thoát (Ollama vẫn chạy nền)"
echo ""

wait 2>/dev/null || true
