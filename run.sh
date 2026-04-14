#!/bin/bash
###############################################################################
# run.sh — Start Ollama + open VS Code with Agent Code extension
#
# Usage: chmod +x run.sh && ./run.sh
###############################################################################
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$SCRIPT_DIR/vscode-extension"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════"
echo "  🤖 Agent Code — Starting"
echo "═══════════════════════════════════════════════════"
echo ""

# ── 1. Check prerequisites ────────────────────────────────────────
echo "── Checking prerequisites ──"

if ! command -v ollama &>/dev/null; then
    error "Ollama not installed! Run ./env_setup.sh first."
    exit 1
fi

if ! command -v code &>/dev/null; then
    error "VS Code ('code' command) not found!"
    echo "  Install VS Code: https://code.visualstudio.com"
    echo "  Then enable 'code' in PATH: Cmd Palette → 'Shell Command: Install'"
    exit 1
fi

if [ ! -d "$EXT_DIR/out" ]; then
    warn "Extension not compiled. Compiling now..."
    cd "$EXT_DIR"
    npm install --silent 2>&1 | tail -2
    npx tsc -p ./ 2>&1
    info "Extension compiled"
fi

info "All prerequisites OK"

# ── 2. Start Ollama server ─────────────────────────────────────────
echo ""
echo "── Starting Ollama server ──"

if curl -s http://localhost:11434/api/tags &>/dev/null; then
    info "Ollama already running on :11434"
else
    ollama serve &>/dev/null &
    OLLAMA_PID=$!
    echo -n "  Starting Ollama..."
    for i in {1..10}; do
        if curl -s http://localhost:11434/api/tags &>/dev/null; then
            echo ""
            info "Ollama started (PID: $OLLAMA_PID)"
            break
        fi
        echo -n "."
        sleep 1
    done

    if ! curl -s http://localhost:11434/api/tags &>/dev/null; then
        echo ""
        error "Ollama failed to start!"
        exit 1
    fi
fi

# ── 3. Check model is available ────────────────────────────────────
echo ""
echo "── Checking model ──"

if ollama list 2>/dev/null | grep -q "deepseek-coder-v2:16b"; then
    info "Model deepseek-coder-v2:16b ready"
else
    warn "Model not found. Pulling deepseek-coder-v2:16b..."
    ollama pull deepseek-coder-v2:16b
    info "Model downloaded"
fi

# ── 4. Open VS Code with extension ────────────────────────────────
echo ""
echo "── Opening VS Code ──"

# Open VS Code in the extension dev folder so user can press F5
code "$EXT_DIR" \
    --goto "$EXT_DIR/src/extension.ts:1" \
    2>/dev/null

info "VS Code opened at vscode-extension/"

# ── 5. Print usage guide ──────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo -e "  ${GREEN}✅ Everything is running!${NC}"
echo "═══════════════════════════════════════════════════"
echo ""
echo -e "  ${CYAN}Bước tiếp theo trong VS Code:${NC}"
echo "  1. Nhấn F5 để chạy Extension Development Host"
echo "  2. Trong cửa sổ mới, mở project code bạn muốn edit"
echo ""
echo -e "  ${CYAN}Cách sử dụng:${NC}"
echo "  • Chọn code → Ctrl+Shift+E     → Edit với diff preview"
echo "  • Chọn code → Ctrl+Shift+H     → Explain code"
echo "  • Right-click → Agent Code: Review"
echo "  • Click 🤖 sidebar              → Chat panel"
echo "  • CodeLens trên function        → 🤖 Explain | ✏️ Edit"
echo ""
echo -e "  ${CYAN}CLI tool (terminal):${NC}"
echo "  • agent-code edit \"add logging\" --file app.py"
echo "  • agent-code explain --file utils.py"
echo "  • agent-code review --file api.py"
echo "  • agent-code generate \"Flask API server\""
echo ""
echo "  Ollama đang chạy trên http://localhost:11434"
echo "  Nhấn Ctrl+C để tắt script (Ollama vẫn chạy nền)"
echo ""

# Keep script alive so user sees output
# Ollama runs in background, script can be Ctrl+C'd
wait 2>/dev/null || true
