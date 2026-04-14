#!/bin/bash
###############################################################################
# env_setup.sh — Tải và cài đặt mọi thứ VÀO THƯ MỤC DỰ ÁN (self-contained)
#
# Cấu trúc tạo ra:
#   - python/              Python virtual environment
#   - ollama/bin/ollama    Ollama binary (local)
#   - models/              Ollama model storage
#   - vscode-extension/node_modules/  Node dependencies
#   - vscode-extension/out/           Extension compiled
#
# Usage: chmod +x env_setup.sh && ./env_setup.sh
###############################################################################

# ============================================================
# ERROR HANDLERS
# ============================================================
error_network() {
    echo ""
    echo "[LỖI] Yêu cầu mạng thất bại."
    echo "Kiểm tra kết nối internet và thử lại."
    read -p "Nhấn Enter để đóng..."
    exit 1
}

error_extract() {
    echo ""
    echo "[LỖI] Không thể giải nén hoặc tạo Python venv."
    echo "Đảm bảo đã cài: sudo apt install python3 python3-pip python3-venv"
    read -p "Nhấn Enter để đóng..."
    exit 1
}

error_pip() {
    echo ""
    echo "[LỖI] Cài đặt pip hoặc packages thất bại."
    read -p "Nhấn Enter để đóng..."
    exit 1
}

error_ollama_install() {
    echo ""
    echo "[LỖI] Cài đặt Ollama thất bại."
    read -p "Nhấn Enter để đóng..."
    exit 1
}

error_model() {
    echo ""
    echo "[LỖI] Tải model thất bại."
    read -p "Nhấn Enter để đóng..."
    exit 1
}

error_general() {
    echo ""
    echo "[LỖI] Đã xảy ra lỗi không mong đợi."
    read -p "Nhấn Enter để đóng..."
    exit 1
}

# ============================================================
# CONFIGURATION
# ============================================================
SCRIPTROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# System Python (dùng để tạo venv)
SYSTEM_PYTHON=$(which python3)
if [ -z "$SYSTEM_PYTHON" ]; then
    echo "[LỖI] Python3 không tìm thấy trên hệ thống!"
    echo "Cài Python 3.10+: sudo apt install python3 python3-pip python3-venv"
    error_general
fi

# Paths — tất cả nằm trong dự án
VENV_DIR="${SCRIPTROOT}/python"
PYTHON_EXE="${VENV_DIR}/bin/python3"
EXT_DIR="${SCRIPTROOT}/vscode-extension"

OLLAMA_DIR="${SCRIPTROOT}/ollama"
OLLAMA_TAR="ollama-linux-amd64.tgz"
OLLAMA_DOWNLOAD_URL="https://github.com/ollama/ollama/releases/download/v0.20.3/ollama-linux-amd64.tgz"
OLLAMA_CHECKSUM_URL="https://github.com/ollama/ollama/releases/download/v0.20.3/sha256sum.txt"

OLLAMA_BIN="${OLLAMA_DIR}/bin/ollama"
OLLAMA_HOST="http://127.0.0.1:11435"
OLLAMA_MODELS="${SCRIPTROOT}/models"

export OLLAMA_HOST
export OLLAMA_MODELS

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Agent Code — Cài đặt môi trường (Self-Contained)"
echo "═══════════════════════════════════════════════════════"
echo ""

###############################################################################
# 1. CREATE PYTHON VIRTUAL ENVIRONMENT
###############################################################################
echo "── [1/7] Python Virtual Environment ──"

if [ -f "$PYTHON_EXE" ] && "$PYTHON_EXE" -m pip --version > /dev/null 2>&1; then
    info "Python venv đã có tại python/. Bỏ qua."
else
    if [ -d "$VENV_DIR" ]; then
        warn "Venv cũ bị lỗi (thiếu pip). Tạo lại..."
        rm -rf "$VENV_DIR"
    fi
    echo "  → Tạo virtual environment bằng system Python ($SYSTEM_PYTHON)..."
    "$SYSTEM_PYTHON" -m venv "$VENV_DIR" || error_extract
    info "Virtual environment đã tạo."

    # Đảm bảo pip có trong venv
    if ! "$PYTHON_EXE" -m pip --version > /dev/null 2>&1; then
        echo "  → pip chưa có trong venv, bootstrap với ensurepip..."
        "$PYTHON_EXE" -m ensurepip --upgrade || error_pip
    fi
fi

if [ ! -f "$PYTHON_EXE" ]; then
    error_extract
fi

###############################################################################
# 2. CONFIGURE ENVIRONMENT
###############################################################################
echo ""
echo "── [2/7] Cấu hình Python ──"
info "Python environment configured: $PYTHON_EXE"

###############################################################################
# 3. UPGRADE PIP
###############################################################################
echo ""
echo "── [3/7] Nâng cấp pip ──"
"$PYTHON_EXE" -m pip install --upgrade pip --no-warn-script-location --quiet || error_pip
info "pip đã cập nhật"

###############################################################################
# 4. INSTALL AGENT-CODE CLI TOOL
###############################################################################
echo ""
echo "── [4/7] Cài đặt agent-code CLI ──"

echo "  → Cài agent-code từ pyproject.toml..."
"$PYTHON_EXE" -m pip install -e "$SCRIPTROOT" --no-warn-script-location --quiet 2>/dev/null || {
    warn "Cài lần đầu gặp lỗi, thử lại..."
    "$PYTHON_EXE" -m pip install -e "$SCRIPTROOT" --no-warn-script-location 2>&1 | tail -5 || error_pip
}
info "CLI tool 'agent-code' đã cài"

###############################################################################
# 5. DOWNLOAD OLLAMA (vào ollama/ trong dự án)
###############################################################################
echo ""
echo "── [5/7] Tải Ollama (local) ──"

if [ -f "$OLLAMA_BIN" ]; then
    info "Ollama đã có tại ollama/bin/ollama. Bỏ qua."
else
    cd "$SCRIPTROOT"

    # Tải checksum
    echo "  → Tải checksums..."
    wget -q --show-progress -O sha256sum.txt "$OLLAMA_CHECKSUM_URL" || error_network

    # Lấy expected hash
    EXPECTED_HASH=$(grep "$OLLAMA_TAR" sha256sum.txt | awk '{print $1}')

    # Kiểm tra file .tgz cũ nếu có
    if [ -f "$OLLAMA_TAR" ]; then
        if [ -n "$EXPECTED_HASH" ]; then
            echo "  → Tìm thấy ${OLLAMA_TAR}. Kiểm tra checksum..."
            FILE_HASH=$(sha256sum "$OLLAMA_TAR" | awk '{print $1}')
            if [ "$FILE_HASH" != "$EXPECTED_HASH" ]; then
                echo "  → Checksum không khớp, xóa file cũ..."
                rm -f "$OLLAMA_TAR"
            else
                echo "  → Checksum OK."
            fi
        fi
    fi

    # Tải nếu chưa có
    if [ ! -f "$OLLAMA_TAR" ]; then
        echo "  → Đang tải ${OLLAMA_TAR}..."
        wget -q --show-progress -O "$OLLAMA_TAR" "$OLLAMA_DOWNLOAD_URL" || error_network

        # Verify
        if [ -n "$EXPECTED_HASH" ]; then
            FILE_HASH=$(sha256sum "$OLLAMA_TAR" | awk '{print $1}')
            if [ "$FILE_HASH" != "$EXPECTED_HASH" ]; then
                err "Checksum file tải về không khớp!"
                rm -f "$OLLAMA_TAR"
                error_network
            fi
        fi
    fi

    # Dọn checksum
    rm -f sha256sum.txt

    # Giải nén vào ollama/
    echo "  → Giải nén vào ollama/..."
    mkdir -p "$OLLAMA_DIR"
    tar -xzf "$OLLAMA_TAR" -C "$OLLAMA_DIR" --strip-components=0 || error_ollama_install

    # Verify binary
    if [ -f "$OLLAMA_BIN" ]; then
        chmod +x "$OLLAMA_BIN"
        info "Ollama đã cài tại: ollama/bin/ollama"
    else
        # Thử tìm binary nếu cấu trúc khác
        FOUND_BIN=$(find "$OLLAMA_DIR" -name "ollama" -type f 2>/dev/null | head -1)
        if [ -n "$FOUND_BIN" ]; then
            mkdir -p "${OLLAMA_DIR}/bin"
            mv "$FOUND_BIN" "$OLLAMA_BIN"
            chmod +x "$OLLAMA_BIN"
            info "Ollama đã cài tại: ollama/bin/ollama"
        else
            err "Không tìm thấy binary ollama sau giải nén!"
            error_ollama_install
        fi
    fi

    # Dọn file .tgz
    rm -f "$OLLAMA_TAR"
fi

###############################################################################
# 6. NODE MODULES + COMPILE EXTENSION
###############################################################################
echo ""
echo "── [6/7] Cài Node modules + compile extension ──"

# Check Node.js
if ! command -v node &>/dev/null; then
    err "Node.js chưa cài! Cần Node.js 18+."
    echo "  Cài: https://nodejs.org hoặc: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    read -p "Nhấn Enter để tiếp tục..."
else
    NODE_VERSION=$(node --version 2>&1)
    NODE_MAJOR=$(echo "$NODE_VERSION" | grep -oP '\d+' | head -1)
    if [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
        err "Node.js $NODE_VERSION quá cũ! Cần v18+."
        read -p "Nhấn Enter để tiếp tục..."
    else
        info "Node.js: $NODE_VERSION"
    fi
fi

if [ -d "$EXT_DIR" ]; then
    cd "$EXT_DIR"

    echo "  → npm install..."
    npm install 2>&1 | tail -3 || {
        err "npm install thất bại"
        read -p "Nhấn Enter để tiếp tục..."
    }
    info "node_modules đã cài"

    echo "  → Compile TypeScript..."
    npx tsc -p ./ 2>&1 || {
        err "TypeScript compile thất bại"
        echo "  Node.js version: $(node --version 2>&1)"
        read -p "Nhấn Enter để tiếp tục..."
    }
    info "Extension compiled"
else
    err "Không tìm thấy $EXT_DIR"
fi

###############################################################################
# 7. PULL MODEL (dùng Ollama local, lưu vào models/)
###############################################################################
echo ""
echo "── [7/7] Tải model DeepSeek-Coder-v2:16b ──"

if [ -f "$OLLAMA_BIN" ]; then
    # Tạo thư mục models
    mkdir -p "$OLLAMA_MODELS"

    # Dừng Ollama hệ thống nếu đang chạy trên cùng port
    if curl -s --max-time 2 "$OLLAMA_HOST/api/tags" &>/dev/null; then
        warn "Có Ollama đang chạy trên ${OLLAMA_HOST}, sẽ dùng instance mới..."
    fi

    # Khởi động Ollama local
    echo "  → Khởi động Ollama local (port 11435)..."
    OLLAMA_HOST="$OLLAMA_HOST" OLLAMA_MODELS="$OLLAMA_MODELS" "$OLLAMA_BIN" serve &>/dev/null &
    LOCAL_OLLAMA_PID=$!
    sleep 4

    if curl -s --max-time 3 "$OLLAMA_HOST/api/tags" &>/dev/null; then
        info "Ollama local đã start (PID: $LOCAL_OLLAMA_PID)"

        if OLLAMA_HOST="$OLLAMA_HOST" "$OLLAMA_BIN" list 2>/dev/null | grep -q "deepseek-coder-v2:16b"; then
            info "Model đã có sẵn trong models/"
        else
            warn "Đang tải model (~10GB), vui lòng chờ..."
            OLLAMA_HOST="$OLLAMA_HOST" OLLAMA_MODELS="$OLLAMA_MODELS" "$OLLAMA_BIN" pull deepseek-coder-v2:16b || {
                err "Tải model thất bại. Thử lại sau."
                kill $LOCAL_OLLAMA_PID 2>/dev/null
                error_model
            }
            info "Model đã tải xong vào models/"
        fi

        # Dừng Ollama local sau khi pull xong
        kill $LOCAL_OLLAMA_PID 2>/dev/null
        wait $LOCAL_OLLAMA_PID 2>/dev/null
    else
        err "Ollama local không khởi động được"
        kill $LOCAL_OLLAMA_PID 2>/dev/null
        echo "  Kiểm tra lại file ollama/bin/ollama"
        read -p "Nhấn Enter để tiếp tục..."
    fi
else
    warn "Bỏ qua — Ollama chưa cài"
fi

###############################################################################
# TỔNG KẾT
###############################################################################
echo ""
echo "═══════════════════════════════════════════════════════"
echo -e "  ${GREEN}✅ Cài đặt hoàn tất!${NC}"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Đã tạo trong dự án:"
echo "    📁 python/                         Python venv"
echo "    📁 ollama/bin/ollama               Ollama binary"
echo "    📁 models/                         Model storage"
echo "    📁 vscode-extension/node_modules/  Node deps"
echo "    📁 vscode-extension/out/           Extension compiled"
echo ""
echo "  Python: $($PYTHON_EXE --version 2>&1)"
echo "  Node:   $(node --version 2>&1)"
echo "  Ollama: $([ -f "$OLLAMA_BIN" ] && "$OLLAMA_BIN" --version 2>&1 || echo 'N/A')"
echo ""
echo "  Chạy ./run.sh để bắt đầu sử dụng."
echo ""
echo "Nhấn Enter để đóng..."
read
