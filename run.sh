#!/bin/bash
###############################################################################
# run.sh — Khởi động Ollama + mở VS Code với Agent Code extension
#
# Tự động:
#   1. Activate Python venv
#   2. Start Ollama server
#   3. Check model
#   4. Compile extension nếu cần
#   5. Mở VS Code
#
# Usage: ./run.sh
###############################################################################
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
EXT_DIR="$SCRIPT_DIR/vscode-extension"

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
echo "  🤖 Agent Code — Khởi động"
echo "═══════════════════════════════════════════════════"
echo ""

# ── 1. Check env_setup đã chạy chưa ──────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    error "Chưa setup! Chạy ./env_setup.sh trước."
fi

if ! command -v ollama &>/dev/null; then
    error "Ollama chưa cài! Chạy ./env_setup.sh trước."
fi

if ! command -v code &>/dev/null; then
    error "VS Code chưa cài! Tải tại: https://code.visualstudio.com"
fi

# ── 2. Activate Python venv ───────────────────────────────────────
echo "── Activate Python venv ──"
source "$VENV_DIR/bin/activate"
info "Python venv activated: $(which python)"

# ── 3. Start Ollama server ────────────────────────────────────────
echo ""
echo "── Khởi động Ollama server ──"

if curl -s http://localhost:11434/api/tags &>/dev/null; then
    info "Ollama đã chạy trên :11434"
else
    ollama serve &>/dev/null &
    OLLAMA_PID=$!
    echo -n "  Đang khởi động Ollama..."

    for i in {1..15}; do
        if curl -s http://localhost:11434/api/tags &>/dev/null; then
            echo ""
            info "Ollama đã start (PID: $OLLAMA_PID)"
            break
        fi
        echo -n "."
        sleep 1
    done

    if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
        echo ""
        error "Ollama không khởi động được!"
    fi
fi

# ── 4. Check model ────────────────────────────────────────────────
echo ""
echo "── Check model ──"

if ollama list 2>/dev/null | grep -q "deepseek-coder-v2:16b"; then
    info "Model deepseek-coder-v2:16b sẵn sàng"
else
    warn "Model chưa tải. Đang pull..."
    ollama pull deepseek-coder-v2:16b
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
echo "  Ollama: http://localhost:11434"
echo "  Nhấn Ctrl+C để thoát (Ollama vẫn chạy nền)"
echo ""

wait 2>/dev/null || true
