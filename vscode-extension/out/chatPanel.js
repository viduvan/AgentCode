"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatPanelProvider = void 0;
/**
 * Chat Panel — Conversational AI Agent sidebar.
 *
 * All user messages go through AgentWorkflow for automatic intent detection.
 * No slash commands needed — just chat naturally.
 *
 * Features:
 * - Conversation persistence via globalState
 * - Multi-conversation support (new, switch, delete)
 * - Markdown rendering, code blocks with Copy/Insert/Apply
 * - Plan preview with Approve/Reject buttons
 * - Task progress indicators
 */
const vscode = __importStar(require("vscode"));
const crypto = __importStar(require("crypto"));
const diffManager_1 = require("./diffManager");
const agentWorkflow_1 = require("./agentWorkflow");
const STORAGE_KEY = 'agentCode.conversations';
const ACTIVE_KEY = 'agentCode.activeConversation';
class ChatPanelProvider {
    constructor(extensionUri, ollama, diffManager, globalState) {
        this.extensionUri = extensionUri;
        this.workflow = new agentWorkflow_1.AgentWorkflow(ollama, diffManager);
        this.globalState = globalState;
    }
    /** Expose workflow for extension.ts to register commands. */
    getWorkflow() {
        return this.workflow;
    }
    // ── Conversation Storage ─────────────────────────────────────
    getConversations() {
        return this.globalState.get(STORAGE_KEY, []);
    }
    saveConversations(convos) {
        this.globalState.update(STORAGE_KEY, convos);
    }
    getActiveId() {
        return this.globalState.get(ACTIVE_KEY, '');
    }
    setActiveId(id) {
        this.globalState.update(ACTIVE_KEY, id);
    }
    getOrCreateActive() {
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
    addMessageToStorage(role, text) {
        const convos = this.getConversations();
        const active = convos.find(c => c.id === this.getActiveId());
        if (active) {
            active.messages.push({ role, text });
            if (role === 'user' && active.title === 'New Chat') {
                active.title = text.slice(0, 40) + (text.length > 40 ? '...' : '');
            }
            this.saveConversations(convos);
        }
    }
    // ── WebviewView lifecycle ────────────────────────────────────
    resolveWebviewView(webviewView, _context, _token) {
        this.view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        const nonce = crypto.randomBytes(16).toString('base64');
        webviewView.webview.html = this.getHtml(nonce);
        // Connect workflow callbacks to webview
        this.setupWorkflowCallbacks();
        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(async (msg) => {
            console.log('[Agent Code] Received:', msg.type);
            try {
                switch (msg.type) {
                    case 'chat':
                        this.addMessageToStorage('user', msg.text);
                        await this.workflow.handleMessage(msg.text);
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
                    case 'approvePlan':
                        this.workflow.approvePlan();
                        break;
                    case 'rejectPlan':
                        this.workflow.rejectPlan();
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
            }
            catch (err) {
                console.error('[Agent Code] Error:', err);
                this.postMessage({ type: 'error', text: 'Error: ' + err.message });
                this.postMessage({ type: 'thinking', show: false });
            }
        });
    }
    /**
     * Wire up AgentWorkflow callbacks → webview messages.
     */
    setupWorkflowCallbacks() {
        const callbacks = {
            sendMessage: (role, text) => {
                this.addMessageToStorage(role, text);
                this.postMessage({ type: 'assistantMessage', text });
            },
            streamToken: (text) => {
                this.postMessage({ type: 'streamToken', text });
            },
            setThinking: (show, label) => {
                this.postMessage({ type: 'thinking', show, label });
            },
            showPlan: (plan) => {
                this.postMessage({ type: 'showPlan', plan });
            },
            updateProgress: (stepIndex, total, description, status) => {
                this.postMessage({ type: 'taskProgress', stepIndex, total, description, status });
            },
            showResult: (success, message) => {
                this.addMessageToStorage('assistant', message);
                this.postMessage({ type: 'taskResult', success, text: message });
            },
        };
        this.workflow.setCallbacks(callbacks);
    }
    postMessage(msg) {
        this.view?.webview.postMessage(msg);
    }
    // ── Conversation management ──────────────────────────────────
    createNewChat() {
        const conv = {
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
    switchChat(id) {
        this.setActiveId(id);
        this.restoreCurrentChat();
    }
    deleteChat(id) {
        let convos = this.getConversations();
        convos = convos.filter(c => c.id !== id);
        this.saveConversations(convos);
        if (this.getActiveId() === id) {
            if (convos.length > 0) {
                this.setActiveId(convos[0].id);
            }
            else {
                this.setActiveId('');
                this.getOrCreateActive();
            }
            this.restoreCurrentChat();
        }
        this.sendChatList();
    }
    restoreCurrentChat() {
        const conv = this.getOrCreateActive();
        this.postMessage({ type: 'restoreMessages', messages: conv.messages, title: conv.title });
        this.sendChatList();
    }
    sendChatList() {
        const convos = this.getConversations();
        const activeId = this.getActiveId();
        this.postMessage({
            type: 'chatList',
            chats: convos.map(c => ({ id: c.id, title: c.title, active: c.id === activeId })),
        });
    }
    // ── Code actions ─────────────────────────────────────────────
    async insertCodeToEditor(code) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }
        await editor.edit(eb => eb.insert(editor.selection.active, code));
        vscode.window.showInformationMessage('Code inserted!');
    }
    async applyCodeToEditor(code, _lang) {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }
        const sel = editor.selection;
        const orig = sel.isEmpty ? editor.document.getText() : editor.document.getText(sel);
        const range = sel.isEmpty
            ? new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(orig.length))
            : sel;
        const diffManager = new diffManager_1.DiffManager();
        await diffManager.showDiff(editor.document.uri, orig, code, range);
    }
    // ── HTML ─────────────────────────────────────────────────────
    getHtml(nonce) {
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
            // Code block wrapper
            '.cbw { margin: 6px 0; border-radius: 6px; overflow: hidden; border: 1px solid var(--vscode-panel-border); }\n' +
            '.cbh { display: flex; align-items: center; justify-content: space-between; padding: 3px 8px; background: var(--vscode-titleBar-activeBackground, rgba(255,255,255,0.05)); font-size: 10px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); }\n' +
            '.cbl { font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }\n' +
            '.cba { display: flex; gap: 1px; }\n' +
            '.cba button { background: transparent; color: var(--vscode-foreground); border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 10px; opacity: 0.6; }\n' +
            '.cba button:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; }\n' +
            '.cbw pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px; margin: 0; overflow-x: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.4; }\n' +
            '.cbw pre code { background: none; padding: 0; }\n' +
            // Thinking indicator
            '#thinking { padding: 6px 12px; color: var(--vscode-descriptionForeground); display: none; align-items: center; gap: 6px; font-size: 11px; }\n' +
            '#thinking.show { display: flex; }\n' +
            '.dp { display: flex; gap: 3px; } .dp span { width: 5px; height: 5px; border-radius: 50%; background: var(--vscode-button-background); animation: p 1.2s ease-in-out infinite; }\n' +
            '.dp span:nth-child(2) { animation-delay: .15s; } .dp span:nth-child(3) { animation-delay: .3s; }\n' +
            '@keyframes p { 0%,80%,100% { transform: scale(.6); opacity: .4; } 40% { transform: scale(1); opacity: 1; } }\n' +
            // Plan card
            '.plan-card { margin: 6px 0; border: 1px solid var(--vscode-panel-border); border-radius: 8px; overflow: hidden; background: var(--vscode-editor-background); }\n' +
            '.plan-header { padding: 8px 12px; background: linear-gradient(135deg, #667eea22, #764ba222); border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 6px; }\n' +
            '.plan-steps { padding: 8px 12px; }\n' +
            '.plan-step { padding: 4px 0; font-size: 12px; display: flex; align-items: center; gap: 6px; }\n' +
            '.plan-step .step-icon { width: 18px; text-align: center; }\n' +
            '.plan-step.done .step-icon { color: #4ec9b0; }\n' +
            '.plan-step.running .step-icon { color: #dcdcaa; }\n' +
            '.plan-step.failed .step-icon { color: #f44747; }\n' +
            '.plan-actions { padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 6px; }\n' +
            '.plan-btn { padding: 4px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; }\n' +
            '.plan-btn.approve { background: #4ec9b0; color: #1e1e1e; }\n' +
            '.plan-btn.approve:hover { background: #3db89f; }\n' +
            '.plan-btn.reject { background: var(--vscode-input-background); color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); }\n' +
            '.plan-btn.reject:hover { background: var(--vscode-inputValidation-errorBackground); }\n' +
            // Result badge
            '.result-badge { margin: 6px 0; padding: 8px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; }\n' +
            '.result-badge.success { background: #4ec9b022; border: 1px solid #4ec9b044; color: #4ec9b0; }\n' +
            '.result-badge.fail { background: #f4474722; border: 1px solid #f4474744; color: #f44747; }\n' +
            // Input area
            '#ia { padding: 8px 8px 10px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 5px; align-items: flex-end; }\n' +
            '#ia textarea { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; padding: 7px 10px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); resize: none; outline: none; min-height: 34px; max-height: 120px; line-height: 1.4; }\n' +
            '#ia textarea:focus { border-color: var(--vscode-focusBorder); }\n' +
            '#sb { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; width: 32px; height: 32px; cursor: pointer; font-size: 15px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }\n' +
            '#sb:hover { background: var(--vscode-button-hoverBackground); }\n' +
            '#sb:disabled { opacity: .4; cursor: not-allowed; }\n' +
            '</style></head><body>\n' +
            // Header
            '<div id="chat-header">\n' +
            '  <span id="chat-title">Agent Code</span>\n' +
            '  <button class="hdr-btn" id="btn-list" title="Conversations">&#9776;</button>\n' +
            '  <button class="hdr-btn" id="btn-new" title="New Chat">&#43;</button>\n' +
            '</div>\n' +
            '<div id="chat-list-panel"></div>\n' +
            '<div id="messages"></div>\n' +
            '<div id="thinking"><div class="dp"><span></span><span></span><span></span></div> <span id="think-label">Thinking...</span></div>\n' +
            // Input area (no slash command hints — just chat naturally)
            '<div id="ia">\n' +
            '  <textarea id="inp" rows="1" placeholder="Hỏi bất kỳ điều gì hoặc yêu cầu sửa code..."></textarea>\n' +
            '  <button id="sb" title="Send">&#8593;</button>\n' +
            '</div>\n' +
            '<script nonce="' + nonce + '">\n' +
            'var api = acquireVsCodeApi();\n' +
            'var msgEl = document.getElementById("messages");\n' +
            'var inp = document.getElementById("inp");\n' +
            'var sb = document.getElementById("sb");\n' +
            'var thk = document.getElementById("thinking");\n' +
            'var thkLabel = document.getElementById("think-label");\n' +
            'var listPanel = document.getElementById("chat-list-panel");\n' +
            'var titleEl = document.getElementById("chat-title");\n' +
            'var sEl = null, busy = false;\n' +
            '\n' +
            'function esc(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }\n' +
            '\n' +
            'function md(text) {\n' +
            '  var cb = [];\n' +
            '  var p = text.replace(/```(\\\\w*)\\\\n([\\\\s\\\\S]*?)```/g, function(m, l, c) { var i = cb.length; cb.push({l:l||"",c:c.replace(/\\\\n$/,"")}); return "%%C"+i+"%%"; });\n' +
            '  p = esc(p);\n' +
            '  p = p.replace(/^### (.+)$/gm,"<h3>$1</h3>");\n' +
            '  p = p.replace(/^## (.+)$/gm,"<h2>$1</h2>");\n' +
            '  p = p.replace(/^# (.+)$/gm,"<h1>$1</h1>");\n' +
            '  p = p.replace(/\\\\*\\\\*([^*]+)\\\\*\\\\*/g,"<strong>$1</strong>");\n' +
            '  p = p.replace(/\\\\*([^*]+)\\\\*/g,"<em>$1</em>");\n' +
            '  p = p.replace(/`([^`]+)`/g,"<code>$1</code>");\n' +
            '  p = p.replace(/^[\\\\s]*[-] (.+)$/gm,"<li>$1</li>");\n' +
            '  p = p.replace(/\\\\n\\\\n/g,"</p><p>");\n' +
            '  p = p.replace(/\\\\n/g,"<br>");\n' +
            '  p = "<p>" + p + "</p>";\n' +
            '  p = p.replace(/<p><\\\\/p>/g,"");\n' +
            '  p = p.replace(/%%C(\\\\d+)%%/g, function(m, i) {\n' +
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
            '  m.innerHTML = "Xin ch\\u00e0o! T\\u00f4i l\\u00e0 <strong>Agent Code</strong> \\u2014 AI assistant th\\u00f4ng minh ch\\u1ea1y local.<br><br>" +\n' +
            '    "Ch\\u1ec9 c\\u1ea7n chat t\\u1ef1 nhi\\u00ean, t\\u00f4i s\\u1ebd t\\u1ef1 hi\\u1ec3u b\\u1ea1n c\\u1ea7n g\\u00ec:<br>" +\n' +
            '    "\\u2022 <strong>H\\u1ecfi \\u0111\\u00e1p</strong> \\u2014 \\u201cGi\\u1ea3i th\\u00edch \\u0111o\\u1ea1n code n\\u00e0y\\u201d<br>" +\n' +
            '    "\\u2022 <strong>S\\u1eeda code</strong> \\u2014 \\u201cTh\\u00eam error handling v\\u00e0o h\\u00e0m fetchData\\u201d<br>" +\n' +
            '    "\\u2022 <strong>T\\u1ea1o code</strong> \\u2014 \\u201cT\\u1ea1o file server Express v\\u1edbi REST API\\u201d<br>" +\n' +
            '    "\\u2022 <strong>Review</strong> \\u2014 \\u201cKi\\u1ec3m tra file n\\u00e0y c\\u00f3 bug kh\\u00f4ng\\u201d<br>" +\n' +
            '    "\\u2022 <strong>L\\u1eadp k\\u1ebf ho\\u1ea1ch</strong> \\u2014 \\u201cX\\u00e2y d\\u1ef1ng h\\u1ec7 th\\u1ed1ng auth ho\\u00e0n ch\\u1ec9nh\\u201d";\n' +
            '  w.appendChild(a); w.appendChild(m); msgEl.appendChild(w);\n' +
            '}\n' +
            '\n' +
            // Show plan card
            'function showPlan(plan) {\n' +
            '  var w = document.createElement("div"); w.className = "mw assistant";\n' +
            '  var a = document.createElement("div"); a.className = "av b"; a.textContent = "A";\n' +
            '  var card = document.createElement("div"); card.className = "plan-card";\n' +
            '  var hdr = document.createElement("div"); hdr.className = "plan-header";\n' +
            '  hdr.innerHTML = "\\ud83d\\udcdd " + esc(plan.title);\n' +
            '  card.appendChild(hdr);\n' +
            '  var stepsDiv = document.createElement("div"); stepsDiv.className = "plan-steps"; stepsDiv.id = "plan-steps";\n' +
            '  plan.steps.forEach(function(s, i) {\n' +
            '    var step = document.createElement("div"); step.className = "plan-step"; step.id = "plan-step-"+i;\n' +
            '    step.innerHTML = \'<span class="step-icon">\\u25cb</span> <span>\\u0042\\u01b0\\u1edbc \' + (i+1) + \': \' + esc(s.description) + \' <em style="opacity:0.5">(\' + s.type + \': \' + esc(s.target||"") + \')</em></span>\';\n' +
            '    stepsDiv.appendChild(step);\n' +
            '  });\n' +
            '  card.appendChild(stepsDiv);\n' +
            '  var actions = document.createElement("div"); actions.className = "plan-actions";\n' +
            '  actions.innerHTML = \'<button class="plan-btn approve" id="btn-approve">\\u2705 Approve</button><button class="plan-btn reject" id="btn-reject">\\u274c Reject</button>\';\n' +
            '  card.appendChild(actions);\n' +
            '  w.appendChild(a); w.appendChild(card); msgEl.appendChild(w);\n' +
            '  msgEl.scrollTop = msgEl.scrollHeight;\n' +
            '  document.getElementById("btn-approve").addEventListener("click", function() {\n' +
            '    api.postMessage({type:"approvePlan"}); this.disabled = true; this.textContent = "Approved \\u2714";\n' +
            '    document.getElementById("btn-reject").style.display = "none";\n' +
            '  });\n' +
            '  document.getElementById("btn-reject").addEventListener("click", function() {\n' +
            '    api.postMessage({type:"rejectPlan"}); this.disabled = true; this.textContent = "Rejected";\n' +
            '    document.getElementById("btn-approve").style.display = "none";\n' +
            '  });\n' +
            '}\n' +
            '\n' +
            // Update plan step status
            'function updatePlanStep(index, status) {\n' +
            '  var el = document.getElementById("plan-step-"+index); if(!el) return;\n' +
            '  el.className = "plan-step " + status;\n' +
            '  var icon = el.querySelector(".step-icon");\n' +
            '  if(status==="running") icon.textContent = "\\u25d4";\n' +
            '  else if(status==="done") icon.textContent = "\\u2714";\n' +
            '  else if(status==="failed") icon.textContent = "\\u2718";\n' +
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
            '    case "thinking":\n' +
            '      thk.className=m.show?"show":"";\n' +
            '      if(m.label) thkLabel.textContent=m.label;\n' +
            '      if(!m.show){busy=false;sb.disabled=false;}\n' +
            '      break;\n' +
            '    case "error": addMsg("error",m.text); busy=false; sb.disabled=false; break;\n' +
            '    case "clearMessages": msgEl.innerHTML=""; titleEl.textContent="Agent Code"; showWelcome(); break;\n' +
            '    case "restoreMessages":\n' +
            '      msgEl.innerHTML="";\n' +
            '      titleEl.textContent=m.title||"Agent Code";\n' +
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
            '    case "showPlan":\n' +
            '      showPlan(m.plan);\n' +
            '      break;\n' +
            '    case "taskProgress":\n' +
            '      updatePlanStep(m.stepIndex, m.status);\n' +
            '      break;\n' +
            '    case "taskResult":\n' +
            '      var rb = document.createElement("div"); rb.className = "result-badge " + (m.success?"success":"fail");\n' +
            '      rb.innerHTML = md(m.text);\n' +
            '      var rw = document.createElement("div"); rw.className = "mw assistant";\n' +
            '      var ra = document.createElement("div"); ra.className = "av b"; ra.textContent = "A";\n' +
            '      rw.appendChild(ra); rw.appendChild(rb); msgEl.appendChild(rw);\n' +
            '      msgEl.scrollTop = msgEl.scrollHeight;\n' +
            '      busy=false; sb.disabled=false;\n' +
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
exports.ChatPanelProvider = ChatPanelProvider;
ChatPanelProvider.viewType = 'agent-code.chatView';
//# sourceMappingURL=chatPanel.js.map