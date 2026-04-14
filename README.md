# Agent Code

AI-powered CLI coding assistant sử dụng LLM local (DeepSeek-Coder via Ollama).

## Cài đặt

### Prerequisites
- Python 3.10+
- [Ollama](https://ollama.com) đã cài và chạy
- Git

### Setup
```bash
# 1. Pull model
ollama pull deepseek-coder-v2:16b

# 2. Install agent-code
cd /home/vietpv/Desktop/AgentCode
pip install -e .

# 3. Verify
agent-code --help
```

## Sử dụng

### Edit — Sửa code theo mô tả
```bash
agent-code edit "add logging to all functions" --file app.py
agent-code edit "fix the bug in authentication" 
agent-code edit "add input validation" --no-git
```

### Explain — Giải thích code
```bash
agent-code explain --file utils.py
```

### Review — Tìm bug & vấn đề
```bash
agent-code review --file api.py
```

### Generate — Tạo code mới
```bash
agent-code generate "create a FastAPI server with /users CRUD"
agent-code generate "create unit tests for models.py"
```

### Config — Cấu hình
```bash
agent-code config --show
agent-code config --model deepseek-coder:6.7b
agent-code config --url http://localhost:11434
```

## Architecture Flow

```
User (CLI command)
   ↓
CLI Interface (Typer)
   ↓
Agent Core (Planner + Rules)
   ↓
Context Builder (đọc code liên quan)
   ↓
LLM (DeepSeek-Coder local via Ollama)
   ↓
Patch Generator (diff)
   ↓
Git Handler (branch + apply)
   ↓
File System (project code)
   ↓
Result → CLI output
```
