/**
 * Chat Panel — sidebar webview with chat interface.
 *
 * Supports natural language queries, slash commands (/edit, /explain, /review).
 * Communicates with extension via postMessage.
 */
import * as vscode from 'vscode';
import { OllamaClient } from './ollama';
import { ContextBuilder } from './contextBuilder';

export class ChatPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'agent-code.chatView';
    private view?: vscode.WebviewView;
    private ollama: OllamaClient;

    constructor(
        private readonly extensionUri: vscode.Uri,
        ollama: OllamaClient,
    ) {
        this.ollama = ollama;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
        };

        webviewView.webview.html = this.getHtml();

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            switch (msg.type) {
                case 'chat':
                    await this.handleChat(msg.text);
                    break;
                case 'insertCode':
                    await this.insertCodeToEditor(msg.code);
                    break;
            }
        });
    }

    /**
     * Send a message programmatically to the chat.
     */
    public postMessage(msg: any): void {
        this.view?.webview.postMessage(msg);
    }

    private async handleChat(text: string): Promise<void> {
        // Show user message
        this.postMessage({ type: 'userMessage', text });

        // Build context from active editor
        let context = '';
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            const selection = editor.selection;
            if (!selection.isEmpty) {
                context = ContextBuilder.fromSelection(editor);
            } else {
                context = ContextBuilder.fromDocument(editor.document);
            }
        }

        // Determine system prompt based on slash command
        let system = 'You are a helpful coding assistant. Answer concisely using markdown formatting.';
        let prompt = text;

        if (text.startsWith('/explain')) {
            system = 'You are a code explainer. Explain the code clearly using markdown. ALWAYS respond in Vietnamese (tiếng Việt).';
            prompt = text.replace('/explain', '').trim() || 'Explain the following code. Respond in Vietnamese';
            prompt += '\n\n' + context;
        } else if (text.startsWith('/review')) {
            system = 'You are a code reviewer. Report issues with severity levels. Do not rewrite code.';
            prompt = text.replace('/review', '').trim() || 'Review the following code';
            prompt += '\n\n' + context;
        } else if (text.startsWith('/edit')) {
            system = 'You are a code editor. Return only the modified code in a code block.';
            prompt = text.replace('/edit', '').trim();
            prompt += '\n\nCode to edit:\n' + context;
        } else if (context) {
            prompt = text + '\n\nContext:\n' + context;
        }

        // Show thinking indicator
        this.postMessage({ type: 'thinking', show: true });

        try {
            const collected: string[] = [];
            await this.ollama.generate({
                prompt,
                system,
                onToken: (token) => {
                    collected.push(token);
                    // Send partial response every few tokens
                    if (collected.length % 5 === 0) {
                        this.postMessage({
                            type: 'streamToken',
                            text: collected.join(''),
                        });
                    }
                },
            });

            // Send final response
            this.postMessage({
                type: 'assistantMessage',
                text: collected.join(''),
            });
        } catch (err: any) {
            this.postMessage({
                type: 'error',
                text: `Error: ${err.message}`,
            });
        }

        this.postMessage({ type: 'thinking', show: false });
    }

    private async insertCodeToEditor(code: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor to insert code.');
            return;
        }

        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, code);
        });
    }

    private getHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
    }

    #chat-header {
        padding: 12px 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
    }

    #messages {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .message {
        padding: 10px 14px;
        border-radius: 8px;
        max-width: 95%;
        line-height: 1.5;
        word-wrap: break-word;
        white-space: pre-wrap;
    }

    .message.user {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        align-self: flex-end;
        border-radius: 8px 8px 2px 8px;
    }

    .message.assistant {
        background: var(--vscode-editor-background);
        border: 1px solid var(--vscode-panel-border);
        align-self: flex-start;
        border-radius: 8px 8px 8px 2px;
    }

    .message.error {
        background: var(--vscode-inputValidation-errorBackground);
        border: 1px solid var(--vscode-inputValidation-errorBorder);
        align-self: flex-start;
    }

    .message code {
        background: var(--vscode-textCodeBlock-background);
        padding: 2px 6px;
        border-radius: 4px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.9em;
    }

    .message pre {
        background: var(--vscode-textCodeBlock-background);
        padding: 10px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 8px 0;
        position: relative;
    }

    .message pre code {
        background: none;
        padding: 0;
    }

    .insert-btn {
        position: absolute;
        top: 4px;
        right: 4px;
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        padding: 3px 8px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .message pre:hover .insert-btn { opacity: 1; }
    .insert-btn:hover { background: var(--vscode-button-hoverBackground); }

    #thinking {
        padding: 8px 14px;
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        display: none;
    }
    #thinking.show { display: block; }

    #input-area {
        padding: 12px;
        border-top: 1px solid var(--vscode-panel-border);
        display: flex;
        gap: 8px;
    }

    #input-area textarea {
        flex: 1;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 6px;
        padding: 8px 12px;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
        resize: none;
        outline: none;
        min-height: 36px;
        max-height: 120px;
    }

    #input-area textarea:focus {
        border-color: var(--vscode-focusBorder);
    }

    #send-btn {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: 6px;
        padding: 8px 14px;
        cursor: pointer;
        font-weight: 600;
        align-self: flex-end;
    }
    #send-btn:hover { background: var(--vscode-button-hoverBackground); }

    .slash-hint {
        padding: 4px 12px;
        color: var(--vscode-descriptionForeground);
        font-size: 0.85em;
        border-top: 1px solid var(--vscode-panel-border);
    }
</style>
</head>
<body>
    <div id="chat-header">🤖 Agent Code Chat</div>

    <div id="messages">
        <div class="message assistant">
            Xin chào! Tôi là <strong>Agent Code</strong> — trợ lý AI chạy local.<br><br>
            Commands: <code>/edit</code> <code>/explain</code> <code>/review</code><br>
            Hoặc hỏi tự nhiên bất kỳ câu gì.
        </div>
    </div>

    <div id="thinking">🧠 Thinking...</div>

    <div class="slash-hint">💡 /edit, /explain, /review — or ask anything</div>

    <div id="input-area">
        <textarea id="input" rows="1" placeholder="Ask me anything..."></textarea>
        <button id="send-btn">Send</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const messagesEl = document.getElementById('messages');
        const inputEl = document.getElementById('input');
        const sendBtn = document.getElementById('send-btn');
        const thinkingEl = document.getElementById('thinking');
        let streamingEl = null;

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatMessage(text) {
            // Simple markdown: code blocks
            let formatted = escapeHtml(text);

            // Code blocks
            formatted = formatted.replace(/\`\`\`(\\w*)?\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
                return '<pre><code>' + code + '</code><button class="insert-btn" onclick="insertCode(this)">📋 Insert</button></pre>';
            });

            // Inline code
            formatted = formatted.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

            // Bold
            formatted = formatted.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');

            return formatted;
        }

        function addMessage(role, text) {
            const div = document.createElement('div');
            div.className = 'message ' + role;
            if (role === 'assistant' || role === 'error') {
                div.innerHTML = formatMessage(text);
            } else {
                div.textContent = text;
            }
            messagesEl.appendChild(div);
            messagesEl.scrollTop = messagesEl.scrollHeight;
            return div;
        }

        function send() {
            const text = inputEl.value.trim();
            if (!text) return;
            inputEl.value = '';
            inputEl.style.height = 'auto';
            vscode.postMessage({ type: 'chat', text });
        }

        sendBtn.addEventListener('click', send);

        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
            }
        });

        // Auto-resize textarea
        inputEl.addEventListener('input', () => {
            inputEl.style.height = 'auto';
            inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
        });

        // Insert code button handler
        window.insertCode = function(btn) {
            const code = btn.parentElement.querySelector('code').textContent;
            vscode.postMessage({ type: 'insertCode', code });
        };

        // Handle messages from extension
        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.type) {
                case 'userMessage':
                    addMessage('user', msg.text);
                    break;
                case 'assistantMessage':
                    if (streamingEl) {
                        streamingEl.innerHTML = formatMessage(msg.text);
                        streamingEl = null;
                    } else {
                        addMessage('assistant', msg.text);
                    }
                    break;
                case 'streamToken':
                    if (!streamingEl) {
                        streamingEl = addMessage('assistant', '');
                    }
                    streamingEl.innerHTML = formatMessage(msg.text);
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                    break;
                case 'thinking':
                    thinkingEl.className = msg.show ? 'show' : '';
                    break;
                case 'error':
                    addMessage('error', msg.text);
                    break;
            }
        });

        inputEl.focus();
    </script>
</body>
</html>`;
    }
}
