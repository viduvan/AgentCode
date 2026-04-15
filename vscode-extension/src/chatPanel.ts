/**
 * Chat Panel — Copilot-style sidebar webview with persistent chat history.
 *
 * Features:
 * - Conversation persistence via globalState
 * - Multi-conversation support (new, switch, delete)
 * - Markdown rendering, code blocks with Copy/Insert/Apply
 * - Slash commands: /edit, /explain, /review, /generate, /file
 */
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { OllamaClient } from './ollama';
import { ContextBuilder } from './contextBuilder';
import { DiffManager } from './diffManager';

interface ChatMessage {
    role: 'user' | 'assistant' | 'error';
    text: string;
}

interface Conversation {
    id: string;
    title: string;
    messages: ChatMessage[];
    createdAt: number;
}

const STORAGE_KEY = 'agentCode.conversations';
const ACTIVE_KEY = 'agentCode.activeConversation';

export class ChatPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'agent-code.chatView';
    private view?: vscode.WebviewView;
    private ollama: OllamaClient;
    private diffManager: DiffManager;
    private globalState: vscode.Memento;

    constructor(
        private readonly extensionUri: vscode.Uri,
        ollama: OllamaClient,
        diffManager: DiffManager,
        globalState: vscode.Memento,
    ) {
        this.ollama = ollama;
        this.diffManager = diffManager;
        this.globalState = globalState;
    }

    // ── Conversation Storage ─────────────────────────────────────

    private getConversations(): Conversation[] {
        return this.globalState.get<Conversation[]>(STORAGE_KEY, []);
    }

    private saveConversations(convos: Conversation[]): void {
        this.globalState.update(STORAGE_KEY, convos);
    }

    private getActiveId(): string {
        return this.globalState.get<string>(ACTIVE_KEY, '');
    }

    private setActiveId(id: string): void {
        this.globalState.update(ACTIVE_KEY, id);
    }

    private getOrCreateActive(): Conversation {
        const convos = this.getConversations();
        const activeId = this.getActiveId();
        let active = convos.find(c => c.id === activeId);
        if (!active) {
            active = { id: crypto.randomUUID(), title: 'New Chat', messages: [], createdAt: Date.now() };
            convos.unshift(active);
            this.saveConversations(convos);
            this.setActiveId(active.id);
        }
        return active;
    }

    private addMessageToStorage(role: 'user' | 'assistant' | 'error', text: string): void {
        const convos = this.getConversations();
        const active = convos.find(c => c.id === this.getActiveId());
        if (active) {
            active.messages.push({ role, text });
            // Auto-title from first user message
            if (role === 'user' && active.title === 'New Chat') {
                active.title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
            }
            this.saveConversations(convos);
        }
    }

    // ── WebviewView lifecycle ────────────────────────────────────

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };

        const nonce = crypto.randomBytes(16).toString('base64');
        webviewView.webview.html = this.getHtml(nonce);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            console.log('[Agent Code] Received:', msg.type);
            try {
                switch (msg.type) {
                    case 'chat':
                        this.addMessageToStorage('user', msg.text);
                        await this.handleChat(msg.text);
                        break;
                    case 'insertCode':
                        await this.insertCodeToEditor(msg.code);
                        break;
                    case 'applyCode':
                        await this.applyCodeToEditor(msg.code, msg.language);
                        break;
                    case 'copyCode':
                        await vscode.env.clipboard.writeText(msg.code);
                        vscode.window.showInformationMessage('Code copied!');
                        break;
                    case 'readFile':
                        await this.sendFileContext();
                        break;
                    case 'newChat':
                        this.createNewChat();
                        break;
                    case 'switchChat':
                        this.switchChat(msg.id);
                        break;
                    case 'deleteChat':
                        this.deleteChat(msg.id);
                        break;
                    case 'getChats':
                        this.sendChatList();
                        break;
                    case 'ready':
                        this.restoreCurrentChat();
                        break;
                }
            } catch (err: any) {
                console.error('[Agent Code] Error:', err);
                this.postMessage({ type: 'error', text: 'Error: ' + err.message });
                this.postMessage({ type: 'thinking', show: false });
            }
        });
    }

    public postMessage(msg: any): void {
        this.view?.webview.postMessage(msg);
    }

    // ── Conversation management ──────────────────────────────────

    private createNewChat(): void {
        const conv: Conversation = {
            id: crypto.randomUUID(),
            title: 'New Chat',
            messages: [],
            createdAt: Date.now(),
        };
        const convos = this.getConversations();
        convos.unshift(conv);
        this.saveConversations(convos);
        this.setActiveId(conv.id);
        this.postMessage({ type: 'clearMessages' });
        this.sendChatList();
    }

    private switchChat(id: string): void {
        this.setActiveId(id);
        this.restoreCurrentChat();
    }

    private deleteChat(id: string): void {
        let convos = this.getConversations();
        convos = convos.filter(c => c.id !== id);
        this.saveConversations(convos);
        if (this.getActiveId() === id) {
            if (convos.length > 0) {
                this.setActiveId(convos[0].id);
            } else {
                this.setActiveId('');
                this.getOrCreateActive();
            }
            this.restoreCurrentChat();
        }
        this.sendChatList();
    }

    private restoreCurrentChat(): void {
        const conv = this.getOrCreateActive();
        this.postMessage({ type: 'restoreMessages', messages: conv.messages, title: conv.title });
        this.sendChatList();
    }

    private sendChatList(): void {
        const convos = this.getConversations();
        const activeId = this.getActiveId();
        this.postMessage({
            type: 'chatList',
            chats: convos.map(c => ({ id: c.id, title: c.title, active: c.id === activeId })),
        });
    }

    // ── Chat logic ───────────────────────────────────────────────

    private async handleChat(text: string): Promise<void> {
        console.log('[Agent Code] handleChat:', text);

        // Build context (only for slash commands or selections)
        const editor = vscode.window.activeTextEditor;
        const needsContext = text.startsWith('/explain') || text.startsWith('/review') ||
            text.startsWith('/edit') || text.startsWith('/generate') || text.startsWith('/file');
        let context = '';
        if (editor && needsContext) {
            const selection = editor.selection;
            context = selection.isEmpty
                ? ContextBuilder.fromDocument(editor.document)
                : ContextBuilder.fromSelection(editor);
        } else if (editor && !editor.selection.isEmpty) {
            context = ContextBuilder.fromSelection(editor);
        }

        let system = 'You are a helpful coding assistant. Answer concisely using markdown. When providing code, wrap it in markdown code blocks with the language specified.';
        let prompt = text;

        if (text.startsWith('/explain')) {
            system = 'You are a code explainer. Explain clearly using markdown. ALWAYS respond in Vietnamese.';
            prompt = (text.replace('/explain', '').trim() || 'Explain this code') + '\n\n' + context;
        } else if (text.startsWith('/review')) {
            system = 'You are a code reviewer. Report issues with severity. Do not rewrite code. Respond in Vietnamese.';
            prompt = (text.replace('/review', '').trim() || 'Review this code') + '\n\n' + context;
        } else if (text.startsWith('/edit')) {
            system = 'You are a code editor. Return ONLY the modified code in a markdown code block. No explanations.';
            prompt = text.replace('/edit', '').trim() + '\n\nCode to edit:\n' + context;
        } else if (text.startsWith('/generate')) {
            system = 'You are a code generator. Return complete code in a markdown code block. Add comments in Vietnamese.';
            const desc = text.replace('/generate', '').trim();
            if (!desc) {
                const msg = 'Vui long mo ta code can tao. Vi du: /generate tao ham fibonacci';
                this.addMessageToStorage('assistant', msg);
                this.postMessage({ type: 'assistantMessage', text: msg });
                return;
            }
            prompt = 'Generate code:\n\n' + desc;
            if (context) { prompt += '\n\nContext:\n' + context; }
        } else if (text.startsWith('/file')) {
            await this.sendFileContext();
            return;
        } else if (context) {
            prompt = text + '\n\nSelected code:\n' + context;
        }

        this.postMessage({ type: 'thinking', show: true });

        try {
            const collected: string[] = [];
            await this.ollama.generate({
                prompt,
                system,
                onToken: (token) => {
                    collected.push(token);
                    if (collected.length % 3 === 0) {
                        this.postMessage({ type: 'streamToken', text: collected.join('') });
                    }
                },
            });
            const fullText = collected.join('');
            this.addMessageToStorage('assistant', fullText);
            this.postMessage({ type: 'assistantMessage', text: fullText });
        } catch (err: any) {
            const errText = 'Error: ' + err.message;
            this.addMessageToStorage('error', errText);
            this.postMessage({ type: 'error', text: errText });
        }
        this.postMessage({ type: 'thinking', show: false });
    }

    private async sendFileContext(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            this.postMessage({ type: 'assistantMessage', text: 'No file is open.' });
            return;
        }
        const doc = editor.document;
        const name = doc.fileName.split('/').pop() || doc.fileName;
        const text = '**' + name + '** (' + doc.lineCount + ' lines, ' + doc.languageId + ')\n\n```' + doc.languageId + '\n' + doc.getText() + '\n```';
        this.addMessageToStorage('assistant', text);
        this.postMessage({ type: 'assistantMessage', text });
    }

    private async insertCodeToEditor(code: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('No active editor.'); return; }
        await editor.edit(eb => eb.insert(editor.selection.active, code));
        vscode.window.showInformationMessage('Code inserted!');
    }

    private async applyCodeToEditor(code: string, _lang?: string): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { vscode.window.showWarningMessage('No active editor.'); return; }
        const sel = editor.selection;
        const orig = sel.isEmpty ? editor.document.getText() : editor.document.getText(sel);
        const range = sel.isEmpty
            ? new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(orig.length))
            : sel;
        await this.diffManager.showDiff(editor.document.uri, orig, code, range);
    }

    // ── HTML ─────────────────────────────────────────────────────

    private getHtml(nonce: string): string {
        return '<!DOCTYPE html>\n' +
            '<html lang="en"><head>\n' +
            '<meta charset="UTF-8">\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
            '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'nonce-' + nonce + '\';">\n' +
            '<style>\n' +
            '* { box-sizing: border-box; margin: 0; padding: 0; }\n' +
            'body { font-family: var(--vscode-font-family, sans-serif); font-size: var(--vscode-font-size, 13px); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }\n' +
            '#chat-header { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 6px; font-size: 12px; }\n' +
            '#chat-title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-foreground); }\n' +
            '.hdr-btn { background: transparent; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 14px; opacity: 0.7; }\n' +
            '.hdr-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1)); opacity: 1; }\n' +
            '#chat-list-panel { display: none; border-bottom: 1px solid var(--vscode-panel-border); max-height: 200px; overflow-y: auto; background: var(--vscode-editor-background); }\n' +
            '#chat-list-panel.show { display: block; }\n' +
            '.chat-item { padding: 6px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--vscode-panel-border); }\n' +
            '.chat-item:hover { background: var(--vscode-list-hoverBackground); }\n' +
            '.chat-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }\n' +
            '.chat-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n' +
            '.chat-item-del { opacity: 0; font-size: 11px; padding: 2px 4px; border: none; background: transparent; color: var(--vscode-foreground); cursor: pointer; border-radius: 3px; }\n' +
            '.chat-item:hover .chat-item-del { opacity: 0.6; }\n' +
            '.chat-item-del:hover { opacity: 1; background: var(--vscode-inputValidation-errorBackground); }\n' +
            '#messages { flex: 1; overflow-y: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }\n' +
            '#messages::-webkit-scrollbar { width: 5px; }\n' +
            '#messages::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 4px; }\n' +
            '.mw { display: flex; gap: 8px; align-items: flex-start; animation: fi 0.2s ease; }\n' +
            '.mw.user { flex-direction: row-reverse; }\n' +
            '@keyframes fi { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }\n' +
            '.av { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; font-weight: 700; }\n' +
            '.av.u { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }\n' +
            '.av.b { background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; }\n' +
            '.msg { padding: 8px 12px; border-radius: 8px; max-width: 90%; line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word; }\n' +
            '.msg.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 8px 8px 2px 8px; }\n' +
            '.msg.assistant { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px 8px 8px 2px; }\n' +
            '.msg.error { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }\n' +
            '.msg h1,.msg h2,.msg h3 { margin: 6px 0 3px; } .msg h1 { font-size: 1.2em; } .msg h2 { font-size: 1.1em; } .msg h3 { font-size: 1.05em; }\n' +
            '.msg p { margin: 3px 0; } .msg ul,.msg ol { margin: 3px 0 3px 16px; } .msg li { margin: 1px 0; }\n' +
            '.msg strong { font-weight: 700; } .msg em { font-style: italic; }\n' +
            '.msg code:not(pre code) { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }\n' +
            '.cbw { margin: 6px 0; border-radius: 6px; overflow: hidden; border: 1px solid var(--vscode-panel-border); }\n' +
            '.cbh { display: flex; align-items: center; justify-content: space-between; padding: 3px 8px; background: var(--vscode-titleBar-activeBackground, rgba(255,255,255,0.05)); font-size: 10px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); }\n' +
            '.cbl { font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }\n' +
            '.cba { display: flex; gap: 1px; }\n' +
            '.cba button { background: transparent; color: var(--vscode-foreground); border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 10px; opacity: 0.6; }\n' +
            '.cba button:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; }\n' +
            '.cbw pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px; margin: 0; overflow-x: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.4; }\n' +
            '.cbw pre code { background: none; padding: 0; }\n' +
            '#thinking { padding: 6px 12px; color: var(--vscode-descriptionForeground); display: none; align-items: center; gap: 6px; font-size: 11px; }\n' +
            '#thinking.show { display: flex; }\n' +
            '.dp { display: flex; gap: 3px; } .dp span { width: 5px; height: 5px; border-radius: 50%; background: var(--vscode-button-background); animation: p 1.2s ease-in-out infinite; }\n' +
            '.dp span:nth-child(2) { animation-delay: .15s; } .dp span:nth-child(3) { animation-delay: .3s; }\n' +
            '@keyframes p { 0%,80%,100% { transform: scale(.6); opacity: .4; } 40% { transform: scale(1); opacity: 1; } }\n' +
            '.sh { padding: 5px 10px; color: var(--vscode-descriptionForeground); font-size: 10px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 4px; flex-wrap: wrap; }\n' +
            '.st { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); padding: 1px 5px; border-radius: 3px; font-family: var(--vscode-editor-font-family); font-size: 10px; cursor: pointer; }\n' +
            '#ia { padding: 8px 8px 10px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 5px; align-items: flex-end; }\n' +
            '#ia textarea { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; padding: 7px 10px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); resize: none; outline: none; min-height: 34px; max-height: 120px; line-height: 1.4; }\n' +
            '#ia textarea:focus { border-color: var(--vscode-focusBorder); }\n' +
            '#sb { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; width: 32px; height: 32px; cursor: pointer; font-size: 15px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }\n' +
            '#sb:hover { background: var(--vscode-button-hoverBackground); }\n' +
            '#sb:disabled { opacity: .4; cursor: not-allowed; }\n' +
            '</style></head><body>\n' +
            '<div id="chat-header">\n' +
            '  <span id="chat-title">New Chat</span>\n' +
            '  <button class="hdr-btn" id="btn-list" title="Conversations">&#9776;</button>\n' +
            '  <button class="hdr-btn" id="btn-new" title="New Chat">&#43;</button>\n' +
            '</div>\n' +
            '<div id="chat-list-panel"></div>\n' +
            '<div id="messages"></div>\n' +
            '<div id="thinking"><div class="dp"><span></span><span></span><span></span></div> Thinking...</div>\n' +
            '<div class="sh">\n' +
            '  <span class="st" data-cmd="/edit ">/edit</span>\n' +
            '  <span class="st" data-cmd="/explain ">/explain</span>\n' +
            '  <span class="st" data-cmd="/review ">/review</span>\n' +
            '  <span class="st" data-cmd="/generate ">/generate</span>\n' +
            '  <span class="st" data-cmd="/file">/file</span>\n' +
            '</div>\n' +
            '<div id="ia">\n' +
            '  <textarea id="inp" rows="1" placeholder="Ask anything..."></textarea>\n' +
            '  <button id="sb" title="Send">&#8593;</button>\n' +
            '</div>\n' +
            '<script nonce="' + nonce + '">\n' +
            'var api = acquireVsCodeApi();\n' +
            'var msgEl = document.getElementById("messages");\n' +
            'var inp = document.getElementById("inp");\n' +
            'var sb = document.getElementById("sb");\n' +
            'var thk = document.getElementById("thinking");\n' +
            'var listPanel = document.getElementById("chat-list-panel");\n' +
            'var titleEl = document.getElementById("chat-title");\n' +
            'var sEl = null, busy = false;\n' +
            '\n' +
            'function esc(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }\n' +
            '\n' +
            'function md(text) {\n' +
            '  var cb = [];\n' +
            '  var p = text.replace(/```(\\w*)\\n([\\s\\S]*?)```/g, function(m, l, c) { var i = cb.length; cb.push({l:l||"",c:c.replace(/\\n$/,"")}); return "%%C"+i+"%%"; });\n' +
            '  p = esc(p);\n' +
            '  p = p.replace(/^### (.+)$/gm,"<h3>$1</h3>");\n' +
            '  p = p.replace(/^## (.+)$/gm,"<h2>$1</h2>");\n' +
            '  p = p.replace(/^# (.+)$/gm,"<h1>$1</h1>");\n' +
            '  p = p.replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>");\n' +
            '  p = p.replace(/\\*([^*]+)\\*/g,"<em>$1</em>");\n' +
            '  p = p.replace(/`([^`]+)`/g,"<code>$1</code>");\n' +
            '  p = p.replace(/^[\\s]*[-] (.+)$/gm,"<li>$1</li>");\n' +
            '  p = p.replace(/\\n\\n/g,"</p><p>");\n' +
            '  p = p.replace(/\\n/g,"<br>");\n' +
            '  p = "<p>" + p + "</p>";\n' +
            '  p = p.replace(/<p><\\/p>/g,"");\n' +
            '  p = p.replace(/%%C(\\d+)%%/g, function(m, i) {\n' +
            '    var b = cb[parseInt(i)]; var e = esc(b.c); var ll = b.l || "code";\n' +
            '    return \'<div class="cbw" data-lang="\'+ll+\'"><div class="cbh"><span class="cbl">\'+ll+\'</span><div class="cba"><button class="xc">Copy</button><button class="xi">Insert</button><button class="xa">Apply</button></div></div><pre><code>\'+e+\'</code></pre></div>\';\n' +
            '  });\n' +
            '  return p;\n' +
            '}\n' +
            '\n' +
            'function addMsg(role, text) {\n' +
            '  var w = document.createElement("div"); w.className = "mw " + role;\n' +
            '  var a = document.createElement("div"); a.className = "av " + (role==="user"?"u":"b"); a.textContent = role==="user"?"U":"A";\n' +
            '  var m = document.createElement("div"); m.className = "msg " + role;\n' +
            '  if (role==="user") m.textContent = text; else m.innerHTML = md(text);\n' +
            '  w.appendChild(a); w.appendChild(m); msgEl.appendChild(w);\n' +
            '  msgEl.scrollTop = msgEl.scrollHeight;\n' +
            '  return m;\n' +
            '}\n' +
            '\n' +
            'function showWelcome() {\n' +
            '  var w = document.createElement("div"); w.className = "mw assistant";\n' +
            '  var a = document.createElement("div"); a.className = "av b"; a.textContent = "A";\n' +
            '  var m = document.createElement("div"); m.className = "msg assistant";\n' +
            '  m.innerHTML = "Xin ch\\u00e0o! T\\u00f4i l\\u00e0 <strong>Agent Code</strong> \\u2014 tr\\u1ee3 l\\u00ed AI assistant ch\\u1ea1y local.<br><br>" +\n' +
            '    "T\\u00f4i c\\u00f3 th\\u1ec3 gi\\u00fap b\\u1ea1n:<br>" +\n' +
            '    "\\u2022 Chat v\\u00e0 h\\u1ecfi v\\u1ec1 code<br>" +\n' +
            '    "\\u2022 \\u0110\\u1ecdc file hi\\u1ec7n t\\u1ea1i (<code>/file</code>)<br>" +\n' +
            '    "\\u2022 T\\u1ea1o code m\\u1edbi (<code>/generate</code>)<br>" +\n' +
            '    "\\u2022 S\\u1eeda code v\\u00e0 apply (<code>/edit</code>)<br>" +\n' +
            '    "\\u2022 Review code (<code>/review</code>)";\n' +
            '  w.appendChild(a); w.appendChild(m); msgEl.appendChild(w);\n' +
            '}\n' +
            '\n' +
            'function send() {\n' +
            '  var t = inp.value.trim(); if (!t || busy) return;\n' +
            '  inp.value = ""; inp.style.height = "auto";\n' +
            '  busy = true; sb.disabled = true;\n' +
            '  addMsg("user", t);\n' +
            '  api.postMessage({type:"chat",text:t});\n' +
            '}\n' +
            '\n' +
            'sb.addEventListener("click", function() { send(); });\n' +
            'inp.addEventListener("keydown", function(e) { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();} });\n' +
            'inp.addEventListener("input", function() { inp.style.height="auto"; inp.style.height=Math.min(inp.scrollHeight,120)+"px"; });\n' +
            'document.querySelector(".sh").addEventListener("click", function(e) { var t=e.target; if(t.classList&&t.classList.contains("st")){inp.value=t.getAttribute("data-cmd")||"";inp.focus();} });\n' +
            '\n' +
            '// Code block actions\n' +
            'msgEl.addEventListener("click", function(e) {\n' +
            '  var btn = e.target; if(!btn||!btn.classList) return;\n' +
            '  var w = btn.closest(".cbw"); if(!w) return;\n' +
            '  var c = w.querySelector("pre code"); if(!c) return;\n' +
            '  var code = c.textContent||"", lang = w.getAttribute("data-lang")||"";\n' +
            '  if(btn.classList.contains("xc")){api.postMessage({type:"copyCode",code:code});btn.textContent="OK!";setTimeout(function(){btn.textContent="Copy";},1500);}\n' +
            '  else if(btn.classList.contains("xi")){api.postMessage({type:"insertCode",code:code});}\n' +
            '  else if(btn.classList.contains("xa")){api.postMessage({type:"applyCode",code:code,language:lang});btn.textContent="...";setTimeout(function(){btn.textContent="Apply";},3000);}\n' +
            '});\n' +
            '\n' +
            '// Header buttons\n' +
            'document.getElementById("btn-new").addEventListener("click", function() { api.postMessage({type:"newChat"}); });\n' +
            'document.getElementById("btn-list").addEventListener("click", function() { listPanel.classList.toggle("show"); if(listPanel.classList.contains("show")) api.postMessage({type:"getChats"}); });\n' +
            '\n' +
            '// Chat list clicks\n' +
            'listPanel.addEventListener("click", function(e) {\n' +
            '  var del = e.target.closest(".chat-item-del");\n' +
            '  if(del) { api.postMessage({type:"deleteChat",id:del.getAttribute("data-id")}); return; }\n' +
            '  var item = e.target.closest(".chat-item");\n' +
            '  if(item) { api.postMessage({type:"switchChat",id:item.getAttribute("data-id")}); listPanel.classList.remove("show"); }\n' +
            '});\n' +
            '\n' +
            '// Messages from extension\n' +
            'window.addEventListener("message", function(ev) {\n' +
            '  var m = ev.data;\n' +
            '  switch(m.type) {\n' +
            '    case "assistantMessage":\n' +
            '      if(sEl){sEl.innerHTML=md(m.text);sEl=null;} else addMsg("assistant",m.text);\n' +
            '      busy=false; sb.disabled=false; break;\n' +
            '    case "streamToken":\n' +
            '      if(!sEl){var w=document.createElement("div");w.className="mw assistant";var a=document.createElement("div");a.className="av b";a.textContent="A";var d=document.createElement("div");d.className="msg assistant";w.appendChild(a);w.appendChild(d);msgEl.appendChild(w);sEl=d;}\n' +
            '      sEl.innerHTML=md(m.text); msgEl.scrollTop=msgEl.scrollHeight; break;\n' +
            '    case "thinking": thk.className=m.show?"show":""; if(!m.show){busy=false;sb.disabled=false;} break;\n' +
            '    case "error": addMsg("error",m.text); busy=false; sb.disabled=false; break;\n' +
            '    case "clearMessages": msgEl.innerHTML=""; titleEl.textContent="New Chat"; showWelcome(); break;\n' +
            '    case "restoreMessages":\n' +
            '      msgEl.innerHTML="";\n' +
            '      titleEl.textContent=m.title||"Chat";\n' +
            '      if(m.messages&&m.messages.length>0) m.messages.forEach(function(msg){addMsg(msg.role,msg.text);});\n' +
            '      else showWelcome();\n' +
            '      break;\n' +
            '    case "chatList":\n' +
            '      listPanel.innerHTML="";\n' +
            '      if(m.chats) m.chats.forEach(function(c){\n' +
            '        var d=document.createElement("div"); d.className="chat-item"+(c.active?" active":""); d.setAttribute("data-id",c.id);\n' +
            '        d.innerHTML=\'<span class="chat-item-title">\'+esc(c.title)+\'</span><button class="chat-item-del" data-id="\'+c.id+\'" title="Delete">&#10005;</button>\';\n' +
            '        listPanel.appendChild(d);\n' +
            '      });\n' +
            '      break;\n' +
            '  }\n' +
            '});\n' +
            '\n' +
            '// On load, request restore\n' +
            'api.postMessage({type:"ready"});\n' +
            'inp.focus();\n' +
            '</script></body></html>';
    }
}
