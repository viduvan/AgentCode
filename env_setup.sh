#!/bin/bash
###############################################################################
# env_setup.sh — Tải và cài đặt mọi thứ cần thiết VÀO THƯ MỤC DỰ ÁN
#
# Sẽ tạo:
#   - .venv/              Python virtual environment
#   - vscode-extension/node_modules/  Node dependencies
#   - Tải Ollama nếu chưa có
#   - Pull model deepseek-coder-v2:16b
#
# Usage: chmod +x env_setup.sh && ./env_setup.sh
###############################################################################

# Giữ terminal mở khi có lỗi
trap 'echo ""; echo "⚠️  Script gặp lỗi. Nhấn Enter để đóng."; read' ERR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
EXT_DIR="$SCRIPT_DIR/vscode-extension"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

# Lấy major version number từ string
get_major_version() {
    echo "$1" | grep -oP '\d+' | head -1
}

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Agent Code — Cài đặt môi trường vào dự án"
echo "═══════════════════════════════════════════════════════"
echo ""

###############################################################################
# 1. Python
###############################################################################
echo "── [1/7] Python ──"
if command -v python3 &>/dev/null; then
    info "Python đã có: $(python3 --version 2>&1)"
else
    warn "Python3 chưa có. Đang cài..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y python3 python3-pip python3-venv
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y python3 python3-pip
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm python python-pip
    else
        err "Không nhận diện package manager. Cài Python 3.10+ thủ công."
        echo "Nhấn Enter để tiếp tục..."; read
    fi
    if command -v python3 &>/dev/null; then
        info "Python đã cài: $(python3 --version 2>&1)"
    fi
fi

# Đảm bảo python3-venv đã cài (cần cho bước 5)
if ! python3 -c "import venv" 2>/dev/null; then
    warn "python3-venv chưa cài. Đang cài..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y python3-venv
    fi
fi

###############################################################################
# 2. Node.js (YÊU CẦU v18+)
###############################################################################
echo ""
echo "── [2/7] Node.js (cần v18+) ──"

NEED_NODE_INSTALL=false

if command -v node &>/dev/null; then
    NODE_VERSION=$(node --version 2>&1)
    NODE_MAJOR=$(get_major_version "$NODE_VERSION")
    
    if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
        warn "Node.js $NODE_VERSION quá cũ! TypeScript cần v18+. Đang nâng cấp..."
        NEED_NODE_INSTALL=true
    else
        info "Node.js đã có: $NODE_VERSION"
    fi
else
    warn "Node.js chưa có. Đang cài v20..."
    NEED_NODE_INSTALL=true
fi

if [ "$NEED_NODE_INSTALL" = true ]; then
    if command -v apt-get &>/dev/null; then
        echo "  → Xóa Node.js cũ + packages conflict..."
        sudo apt-get remove -y nodejs npm libnode-dev nodejs-doc libnode72 2>/dev/null || true
        sudo apt-get autoremove -y 2>/dev/null || true
        
        echo "  → Cài Node.js 20 từ NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &>/dev/null; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
        sudo dnf install -y nodejs
    else
        err "Cài Node.js 18+ thủ công: https://nodejs.org"
        echo "Nhấn Enter để tiếp tục..."; read
    fi
    
    if command -v node &>/dev/null; then
        info "Node.js đã nâng cấp: $(node --version 2>&1)"
    else
        err "Không cài được Node.js"
    fi
fi

###############################################################################
# 3. Git
###############################################################################
echo ""
echo "── [3/7] Git ──"
if command -v git &>/dev/null; then
    info "Git đã có: $(git --version 2>&1)"
else
    warn "Git chưa có. Đang cài..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y git
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y git
    elif command -v pacman &>/dev/null; then
        sudo pacman -S --noconfirm git
    fi
    if command -v git &>/dev/null; then
        info "Git đã cài: $(git --version 2>&1)"
    else
        err "Không cài được Git"
    fi
fi

###############################################################################
# 4. Ollama
###############################################################################
echo ""
echo "── [4/7] Ollama ──"
if command -v ollama &>/dev/null; then
    info "Ollama đã có"
else
    warn "Ollama chưa có. Đang tải và cài..."
    curl -fsSL https://ollama.com/install.sh | sh || {
        err "Không cài được Ollama. Cài thủ công: https://ollama.com"
        echo "Nhấn Enter để tiếp tục..."; read
    }
    if command -v ollama &>/dev/null; then
        info "Ollama đã cài"
    fi
fi

###############################################################################
# 5. Python venv + CLI tool
###############################################################################
echo ""
echo "── [5/7] Tạo Python venv ──"

# Xóa venv cũ nếu bị lỗi
if [ -d "$VENV_DIR" ] && [ ! -f "$VENV_DIR/bin/activate" ]; then
    warn "Venv cũ bị lỗi, xóa và tạo lại..."
    rm -rf "$VENV_DIR"
fi

if [ ! -d "$VENV_DIR" ]; then
    echo "  → Tạo virtual environment..."
    python3 -m venv "$VENV_DIR" || {
        err "Không tạo được venv."
        echo "  Thử chạy: sudo apt install python3-venv"
        echo "Nhấn Enter để tiếp tục..."; read
    }
fi

if [ -f "$VENV_DIR/bin/activate" ]; then
    source "$VENV_DIR/bin/activate"
    info "Venv activated: $VENV_DIR"

    pip install --upgrade pip --quiet 2>/dev/null

    echo "  → Cài agent-code CLI tool..."
    pip install -e "$SCRIPT_DIR" --quiet 2>/dev/null || {
        warn "Cài CLI tool gặp lỗi, thử lại..."
        pip install -e "$SCRIPT_DIR" 2>&1 | tail -5
    }
    info "CLI tool 'agent-code' đã cài"
else
    err "Không tìm thấy venv. Thử chạy: sudo apt install python3.10-venv"
fi

###############################################################################
# 6. Node modules + compile extension
###############################################################################
echo ""
echo "── [6/7] Cài Node modules + compile ──"

if [ -d "$EXT_DIR" ]; then
    cd "$EXT_DIR"

    echo "  → npm install..."
    npm install 2>&1 | tail -3 || {
        err "npm install thất bại"
        echo "Nhấn Enter để tiếp tục..."; read
    }
    info "node_modules đã cài"

    echo "  → Compile TypeScript..."
    npx tsc -p ./ 2>&1 || {
        err "TypeScript compile thất bại"
        echo "  Kiểm tra Node.js version: $(node --version 2>&1)"
        echo "  Cần Node.js 18+!"
        echo "Nhấn Enter để tiếp tục..."; read
    }
    info "Extension compiled"
else
    err "Không tìm thấy $EXT_DIR"
fi

###############################################################################
# 7. Pull model
###############################################################################
echo ""
echo "── [7/7] Tải model DeepSeek-Coder-v2:16b ──"

if command -v ollama &>/dev/null; then
    if ! curl -s --max-time 3 http://localhost:11434/api/tags &>/dev/null; then
        echo "  → Khởi động Ollama server..."
        nohup ollama serve &>/dev/null &
        sleep 4
    fi

    if curl -s --max-time 3 http://localhost:11434/api/tags &>/dev/null; then
        if ollama list 2>/dev/null | grep -q "deepseek-coder-v2:16b"; then
            info "Model đã có sẵn"
        else
            warn "Đang tải model (~10GB), vui lòng chờ..."
            ollama pull deepseek-coder-v2:16b || {
                err "Tải model thất bại. Thử lại: ollama pull deepseek-coder-v2:16b"
            }
        fi
    else
        err "Ollama server không khởi động được"
        echo "  Thử chạy thủ công: ollama serve"
    fi
else
    warn "Bỏ qua — Ollama chưa cài"
fi

###############################################################################
# Tổng kết
###############################################################################
echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "  ${GREEN}✅ Cài đặt hoàn tất!${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Đã tạo trong dự án:"
echo "    📁 .venv/                          Python venv"
echo "    📁 vscode-extension/node_modules/  Node deps"
echo "    📁 vscode-extension/out/           Extension compiled"
echo ""
echo "  Python: $(python3 --version 2>&1)"
echo "  Node:   $(node --version 2>&1)"
echo ""
echo "  Chạy ./run.sh để bắt đầu sử dụng."
echo ""
echo "Nhấn Enter để đóng..."
read
