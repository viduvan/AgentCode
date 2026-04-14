#!/bin/bash
###############################################################################
# env_setup.sh — One-time setup: install all dependencies for Agent Code
#
# Usage: chmod +x env_setup.sh && ./env_setup.sh
###############################################################################
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
error() { echo -e "${RED}[✗]${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Agent Code — Environment Setup"
echo "═══════════════════════════════════════════════════"
echo ""

# ── 1. Check / Install Python ─────────────────────────────────────
echo "── [1/6] Checking Python ──"
if command -v python3 &>/dev/null; then
    PY_VERSION=$(python3 --version 2>&1)
    info "Python found: $PY_VERSION"
else
    warn "Python3 not found. Installing..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq
        sudo apt-get install -y python3 python3-pip python3-venv
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y python3 python3-pip
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm python python-pip
    else
        error "Cannot detect package manager. Please install Python 3.10+ manually."
        exit 1
    fi
    info "Python installed: $(python3 --version)"
fi

# ── 2. Check / Install Node.js ────────────────────────────────────
echo ""
echo "── [2/6] Checking Node.js ──"
if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version 2>&1)
    info "Node.js found: $NODE_VERSION"
else
    warn "Node.js not found. Installing via NodeSource..."
    if command -v apt-get &>/dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo dnf install -y nodejs
    else
        error "Please install Node.js 18+ manually: https://nodejs.org"
        exit 1
    fi
    info "Node.js installed: $(node --version)"
fi

# ── 3. Check / Install Git ────────────────────────────────────────
echo ""
echo "── [3/6] Checking Git ──"
if command -v git &>/dev/null; then
    info "Git found: $(git --version)"
else
    warn "Git not found. Installing..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y git
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y git
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm git
    fi
    info "Git installed: $(git --version)"
fi

# ── 4. Check / Install Ollama ─────────────────────────────────────
echo ""
echo "── [4/6] Checking Ollama ──"
if command -v ollama &>/dev/null; then
    info "Ollama found: $(ollama --version 2>&1 | head -1)"
else
    warn "Ollama not found. Installing..."
    curl -fsSL https://ollama.com/install.sh | sh
    info "Ollama installed"
fi

# ── 5. Pull LLM Model ─────────────────────────────────────────────
echo ""
echo "── [5/6] Pulling DeepSeek-Coder-v2:16b model ──"
warn "This may take a while (~10GB download)..."

# Start Ollama in background if not running
if ! pgrep -x "ollama" &>/dev/null; then
    ollama serve &>/dev/null &
    OLLAMA_PID=$!
    sleep 3
    info "Ollama server started (PID: $OLLAMA_PID)"
fi

if ollama list 2>/dev/null | grep -q "deepseek-coder-v2:16b"; then
    info "Model deepseek-coder-v2:16b already downloaded"
else
    ollama pull deepseek-coder-v2:16b
    info "Model deepseek-coder-v2:16b downloaded"
fi

# ── 6. Install Project Dependencies ───────────────────────────────
echo ""
echo "── [6/6] Installing project dependencies ──"

# CLI Tool (Python)
echo "  → Installing CLI tool (Python)..."
cd "$SCRIPT_DIR"
pip install -e . --quiet 2>&1 | tail -3
info "CLI tool 'agent-code' installed"

# VS Code Extension (Node.js)
echo "  → Installing VS Code extension dependencies..."
cd "$SCRIPT_DIR/vscode-extension"
npm install --silent 2>&1 | tail -3
info "Node.js dependencies installed"

# Compile TypeScript
echo "  → Compiling TypeScript..."
npx tsc -p ./ 2>&1
info "Extension compiled"

# ── Done ───────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✅ Setup complete!"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  What was installed:"
echo "    • Python 3         $(python3 --version 2>&1)"
echo "    • Node.js          $(node --version 2>&1)"
echo "    • Git              $(git --version 2>&1 | head -1)"
echo "    • Ollama           $(ollama --version 2>&1 | head -1)"
echo "    • Model            deepseek-coder-v2:16b"
echo "    • CLI tool         agent-code"
echo "    • VS Code ext      compiled ✓"
echo ""
echo "  Next: run ./run.sh to start everything!"
echo ""
