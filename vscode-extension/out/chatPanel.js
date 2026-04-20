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
        const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
        return /* html */ `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--vscode-font-family, sans-serif); font-size: var(--vscode-font-size, 13px); color: var(--vscode-foreground); background: var(--vscode-sideBar-background); display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
#chat-header { padding: 8px 12px; border-bottom: 1px solid var(--vscode-panel-border); display: flex; align-items: center; gap: 6px; font-size: 12px; }
#chat-title { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-foreground); }
.hdr-btn { background: transparent; border: none; color: var(--vscode-foreground); cursor: pointer; padding: 4px 6px; border-radius: 4px; font-size: 14px; opacity: 0.7; }
.hdr-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.1)); opacity: 1; }
#chat-list-panel { display: none; border-bottom: 1px solid var(--vscode-panel-border); max-height: 200px; overflow-y: auto; background: var(--vscode-editor-background); }
#chat-list-panel.show { display: block; }
.chat-item { padding: 6px 12px; cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--vscode-panel-border); }
.chat-item:hover { background: var(--vscode-list-hoverBackground); }
.chat-item.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.chat-item-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-item-del { opacity: 0; font-size: 11px; padding: 2px 4px; border: none; background: transparent; color: var(--vscode-foreground); cursor: pointer; border-radius: 3px; }
.chat-item:hover .chat-item-del { opacity: 0.6; }
.chat-item-del:hover { opacity: 1; background: var(--vscode-inputValidation-errorBackground); }
#messages { flex: 1; overflow-y: auto; padding: 12px 10px; display: flex; flex-direction: column; gap: 10px; scroll-behavior: smooth; }
#messages::-webkit-scrollbar { width: 5px; }
#messages::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background); border-radius: 4px; }
.mw { display: flex; gap: 8px; align-items: flex-start; animation: fi 0.2s ease; }
.mw.user { flex-direction: row-reverse; }
@keyframes fi { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.av { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; font-weight: 700; }
.av.u { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
.av.b { background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; }
.msg { padding: 8px 12px; border-radius: 8px; max-width: 90%; line-height: 1.5; word-wrap: break-word; overflow-wrap: break-word; }
.msg.user { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-radius: 8px 8px 2px 8px; }
.msg.assistant { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 8px 8px 8px 2px; }
.msg.error { background: var(--vscode-inputValidation-errorBackground); border: 1px solid var(--vscode-inputValidation-errorBorder); }
.msg h1,.msg h2,.msg h3 { margin: 6px 0 3px; } .msg h1 { font-size: 1.2em; } .msg h2 { font-size: 1.1em; } .msg h3 { font-size: 1.05em; }
.msg p { margin: 3px 0; } .msg ul,.msg ol { margin: 3px 0 3px 16px; } .msg li { margin: 1px 0; }
.msg strong { font-weight: 700; } .msg em { font-style: italic; }
.msg code:not(pre code) { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); font-size: 0.9em; }
.cbw { margin: 6px 0; border-radius: 6px; overflow: hidden; border: 1px solid var(--vscode-panel-border); }
.cbh { display: flex; align-items: center; justify-content: space-between; padding: 3px 8px; background: var(--vscode-titleBar-activeBackground, rgba(255,255,255,0.05)); font-size: 10px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-panel-border); }
.cbl { font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
.cba { display: flex; gap: 1px; }
.cba button { background: transparent; color: var(--vscode-foreground); border: none; padding: 2px 6px; border-radius: 3px; cursor: pointer; font-size: 10px; opacity: 0.6; }
.cba button:hover { background: var(--vscode-button-background); color: var(--vscode-button-foreground); opacity: 1; }
.cbw pre { background: var(--vscode-textCodeBlock-background); padding: 8px 10px; margin: 0; overflow-x: auto; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 1.4; }
.cbw pre code { background: none; padding: 0; }
#thinking { padding: 6px 12px; color: var(--vscode-descriptionForeground); display: none; align-items: center; gap: 6px; font-size: 11px; }
#thinking.show { display: flex; }
.dp { display: flex; gap: 3px; } .dp span { width: 5px; height: 5px; border-radius: 50%; background: var(--vscode-button-background); animation: p 1.2s ease-in-out infinite; }
.dp span:nth-child(2) { animation-delay: .15s; } .dp span:nth-child(3) { animation-delay: .3s; }
@keyframes p { 0%,80%,100% { transform: scale(.6); opacity: .4; } 40% { transform: scale(1); opacity: 1; } }
.plan-card { margin: 6px 0; border: 1px solid var(--vscode-panel-border); border-radius: 8px; overflow: hidden; background: var(--vscode-editor-background); }
.plan-header { padding: 8px 12px; background: linear-gradient(135deg, #667eea22, #764ba222); border-bottom: 1px solid var(--vscode-panel-border); font-weight: 600; font-size: 12px; display: flex; align-items: center; gap: 6px; }
.plan-steps { padding: 8px 12px; }
.plan-step { padding: 4px 0; font-size: 12px; display: flex; align-items: center; gap: 6px; }
.plan-step .step-icon { width: 18px; text-align: center; }
.plan-step.done .step-icon { color: #4ec9b0; }
.plan-step.running .step-icon { color: #dcdcaa; }
.plan-step.failed .step-icon { color: #f44747; }
.plan-actions { padding: 8px 12px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 6px; }
.plan-btn { padding: 4px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600; }
.plan-btn.approve { background: #4ec9b0; color: #1e1e1e; }
.plan-btn.approve:hover { background: #3db89f; }
.plan-btn.reject { background: var(--vscode-input-background); color: var(--vscode-foreground); border: 1px solid var(--vscode-panel-border); }
.plan-btn.reject:hover { background: var(--vscode-inputValidation-errorBackground); }
.result-badge { margin: 6px 0; padding: 8px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; }
.result-badge.success { background: #4ec9b022; border: 1px solid #4ec9b044; color: #4ec9b0; }
.result-badge.fail { background: #f4474722; border: 1px solid #f4474744; color: #f44747; }
#ia { padding: 8px 8px 10px; border-top: 1px solid var(--vscode-panel-border); display: flex; gap: 5px; align-items: flex-end; }
#ia textarea { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; padding: 7px 10px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); resize: none; outline: none; min-height: 34px; max-height: 120px; line-height: 1.4; }
#ia textarea:focus { border-color: var(--vscode-focusBorder); }
#sb { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 6px; width: 32px; height: 32px; cursor: pointer; font-size: 15px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
#sb:hover { background: var(--vscode-button-hoverBackground); }
#sb:disabled { opacity: .4; cursor: not-allowed; }
</style></head><body>
<div id="chat-header">
  <span id="chat-title">Agent Code</span>
  <button class="hdr-btn" id="btn-list" title="Conversations">&#9776;</button>
  <button class="hdr-btn" id="btn-new" title="New Chat">&#43;</button>
</div>
<div id="chat-list-panel"></div>
<div id="messages"></div>
<div id="thinking"><div class="dp"><span></span><span></span><span></span></div> <span id="think-label">Thinking...</span></div>
<div id="ia">
  <textarea id="inp" rows="1" placeholder="H\u1ecfi b\u1ea5t k\u1ef3 \u0111i\u1ec1u g\u00ec ho\u1eb7c y\u00eau c\u1ea7u s\u1eeda code..."></textarea>
  <button id="sb" title="Send">&#8593;</button>
</div>
<script nonce="${nonce}">
var api = acquireVsCodeApi();
var msgEl = document.getElementById("messages");
var inp = document.getElementById("inp");
var sb = document.getElementById("sb");
var thk = document.getElementById("thinking");
var thkLabel = document.getElementById("think-label");
var listPanel = document.getElementById("chat-list-panel");
var titleEl = document.getElementById("chat-title");
var sEl = null, busy = false;

function esc(t) { var d = document.createElement("div"); d.textContent = t; return d.innerHTML; }

function md(text) {
  var cb = [];
  var p = text.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, function(m, l, c) { var i = cb.length; cb.push({l:l||"",c:c.replace(/\\n$/,"")}); return "%%C"+i+"%%"; });
  p = esc(p);
  p = p.replace(/^### (.+)$/gm,"<h3>$1</h3>");
  p = p.replace(/^## (.+)$/gm,"<h2>$1</h2>");
  p = p.replace(/^# (.+)$/gm,"<h1>$1</h1>");
  p = p.replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>");
  p = p.replace(/\\*([^*]+)\\*/g,"<em>$1</em>");
  p = p.replace(/\`([^\`]+)\`/g,"<code>$1</code>");
  p = p.replace(/^[\\s]*[-] (.+)$/gm,"<li>$1</li>");
  p = p.replace(/\\n\\n/g,"</p><p>");
  p = p.replace(/\\n/g,"<br>");
  p = "<p>" + p + "</p>";
  p = p.replace(/<p><\\/p>/g,"");
  p = p.replace(/%%C(\\d+)%%/g, function(m, i) {
    var b = cb[parseInt(i)]; var e = esc(b.c); var ll = b.l || "code";
    return '<div class="cbw" data-lang="'+ll+'"><div class="cbh"><span class="cbl">'+ll+'</span><div class="cba"><button class="xc">Copy</button><button class="xi">Insert</button><button class="xa">Apply</button></div></div><pre><code>'+e+'</code></pre></div>';
  });
  return p;
}

function addMsg(role, text) {
  var w = document.createElement("div"); w.className = "mw " + role;
  var a = document.createElement("div"); a.className = "av " + (role==="user"?"u":"b"); a.textContent = role==="user"?"U":"A";
  var m = document.createElement("div"); m.className = "msg " + role;
  if (role==="user") m.textContent = text; else m.innerHTML = md(text);
  w.appendChild(a); w.appendChild(m); msgEl.appendChild(w);
  msgEl.scrollTop = msgEl.scrollHeight;
  return m;
}

function showWelcome() {
  var w = document.createElement("div"); w.className = "mw assistant";
  var a = document.createElement("div"); a.className = "av b"; a.textContent = "A";
  var m = document.createElement("div"); m.className = "msg assistant";
  m.innerHTML = "Xin ch\u00e0o! T\u00f4i l\u00e0 <strong>Agent Code</strong> \u2014 AI assistant th\u00f4ng minh ch\u1ea1y local.<br><br>" +
    "Ch\u1ec9 c\u1ea7n chat t\u1ef1 nhi\u00ean, t\u00f4i s\u1ebd t\u1ef1 hi\u1ec3u b\u1ea1n c\u1ea7n g\u00ec:<br>" +
    "\u2022 <strong>H\u1ecfi \u0111\u00e1p</strong> \u2014 \u201cGi\u1ea3i th\u00edch \u0111o\u1ea1n code n\u00e0y\u201d<br>" +
    "\u2022 <strong>S\u1eeda code</strong> \u2014 \u201cTh\u00eam error handling v\u00e0o h\u00e0m fetchData\u201d<br>" +
    "\u2022 <strong>T\u1ea1o code</strong> \u2014 \u201cT\u1ea1o file server Express v\u1edbi REST API\u201d<br>" +
    "\u2022 <strong>Review</strong> \u2014 \u201cKi\u1ec3m tra file n\u00e0y c\u00f3 bug kh\u00f4ng\u201d<br>" +
    "\u2022 <strong>L\u1eadp k\u1ebf ho\u1ea1ch</strong> \u2014 \u201cX\u00e2y d\u1ef1ng h\u1ec7 th\u1ed1ng auth ho\u00e0n ch\u1ec9nh\u201d";
  w.appendChild(a); w.appendChild(m); msgEl.appendChild(w);
}

function showPlan(plan) {
  var w = document.createElement("div"); w.className = "mw assistant";
  var a = document.createElement("div"); a.className = "av b"; a.textContent = "A";
  var card = document.createElement("div"); card.className = "plan-card";
  var hdr = document.createElement("div"); hdr.className = "plan-header";
  hdr.innerHTML = "\ud83d\udcdd " + esc(plan.title);
  card.appendChild(hdr);
  var stepsDiv = document.createElement("div"); stepsDiv.className = "plan-steps"; stepsDiv.id = "plan-steps";
  plan.steps.forEach(function(s, i) {
    var step = document.createElement("div"); step.className = "plan-step"; step.id = "plan-step-"+i;
    step.innerHTML = '<span class="step-icon">\u25cb</span> <span>B\u01b0\u1edbc ' + (i+1) + ': ' + esc(s.description) + ' <em style="opacity:0.5">(' + s.type + ': ' + esc(s.target||"") + ')</em></span>';
    stepsDiv.appendChild(step);
  });
  card.appendChild(stepsDiv);
  var actions = document.createElement("div"); actions.className = "plan-actions";
  actions.innerHTML = '<button class="plan-btn approve" id="btn-approve">\u2705 Approve</button><button class="plan-btn reject" id="btn-reject">\u274c Reject</button>';
  card.appendChild(actions);
  w.appendChild(a); w.appendChild(card); msgEl.appendChild(w);
  msgEl.scrollTop = msgEl.scrollHeight;
  document.getElementById("btn-approve").addEventListener("click", function() {
    api.postMessage({type:"approvePlan"}); this.disabled = true; this.textContent = "Approved \u2714";
    document.getElementById("btn-reject").style.display = "none";
  });
  document.getElementById("btn-reject").addEventListener("click", function() {
    api.postMessage({type:"rejectPlan"}); this.disabled = true; this.textContent = "Rejected";
    document.getElementById("btn-approve").style.display = "none";
  });
}

function updatePlanStep(index, status) {
  var el = document.getElementById("plan-step-"+index); if(!el) return;
  el.className = "plan-step " + status;
  var icon = el.querySelector(".step-icon");
  if(status==="running") icon.textContent = "\u25d4";
  else if(status==="done") icon.textContent = "\u2714";
  else if(status==="failed") icon.textContent = "\u2718";
}

function send() {
  var t = inp.value.trim(); if (!t || busy) return;
  inp.value = ""; inp.style.height = "auto";
  busy = true; sb.disabled = true;
  addMsg("user", t);
  api.postMessage({type:"chat",text:t});
}

sb.addEventListener("click", function() { send(); });
inp.addEventListener("keydown", function(e) { if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();} });
inp.addEventListener("input", function() { inp.style.height="auto"; inp.style.height=Math.min(inp.scrollHeight,120)+"px"; });

// Code block actions
msgEl.addEventListener("click", function(e) {
  var btn = e.target; if(!btn||!btn.classList) return;
  var w = btn.closest(".cbw"); if(!w) return;
  var c = w.querySelector("pre code"); if(!c) return;
  var code = c.textContent||"", lang = w.getAttribute("data-lang")||"";
  if(btn.classList.contains("xc")){api.postMessage({type:"copyCode",code:code});btn.textContent="OK!";setTimeout(function(){btn.textContent="Copy";},1500);}
  else if(btn.classList.contains("xi")){api.postMessage({type:"insertCode",code:code});}
  else if(btn.classList.contains("xa")){api.postMessage({type:"applyCode",code:code,language:lang});btn.textContent="...";setTimeout(function(){btn.textContent="Apply";},3000);}
});

// Header buttons
document.getElementById("btn-new").addEventListener("click", function() { api.postMessage({type:"newChat"}); });
document.getElementById("btn-list").addEventListener("click", function() { listPanel.classList.toggle("show"); if(listPanel.classList.contains("show")) api.postMessage({type:"getChats"}); });

// Chat list clicks
listPanel.addEventListener("click", function(e) {
  var del = e.target.closest(".chat-item-del");
  if(del) { api.postMessage({type:"deleteChat",id:del.getAttribute("data-id")}); return; }
  var item = e.target.closest(".chat-item");
  if(item) { api.postMessage({type:"switchChat",id:item.getAttribute("data-id")}); listPanel.classList.remove("show"); }
});

// Messages from extension
window.addEventListener("message", function(ev) {
  var m = ev.data;
  switch(m.type) {
    case "assistantMessage":
      if(sEl){sEl.innerHTML=md(m.text);sEl=null;} else addMsg("assistant",m.text);
      busy=false; sb.disabled=false; break;
    case "streamToken":
      if(!sEl){var w=document.createElement("div");w.className="mw assistant";var a=document.createElement("div");a.className="av b";a.textContent="A";var d=document.createElement("div");d.className="msg assistant";w.appendChild(a);w.appendChild(d);msgEl.appendChild(w);sEl=d;}
      sEl.innerHTML=md(m.text); msgEl.scrollTop=msgEl.scrollHeight; break;
    case "thinking":
      thk.className=m.show?"show":"";
      if(m.label) thkLabel.textContent=m.label;
      if(!m.show){busy=false;sb.disabled=false;}
      break;
    case "error": addMsg("error",m.text); busy=false; sb.disabled=false; break;
    case "clearMessages": msgEl.innerHTML=""; titleEl.textContent="Agent Code"; showWelcome(); break;
    case "restoreMessages":
      msgEl.innerHTML="";
      titleEl.textContent=m.title||"Agent Code";
      if(m.messages&&m.messages.length>0) m.messages.forEach(function(msg){addMsg(msg.role,msg.text);});
      else showWelcome();
      break;
    case "chatList":
      listPanel.innerHTML="";
      if(m.chats) m.chats.forEach(function(c){
        var d=document.createElement("div"); d.className="chat-item"+(c.active?" active":""); d.setAttribute("data-id",c.id);
        d.innerHTML='<span class="chat-item-title">'+esc(c.title)+'</span><button class="chat-item-del" data-id="'+c.id+'" title="Delete">&#10005;</button>';
        listPanel.appendChild(d);
      });
      break;
    case "showPlan":
      showPlan(m.plan);
      break;
    case "taskProgress":
      updatePlanStep(m.stepIndex, m.status);
      break;
    case "taskResult":
      var rb = document.createElement("div"); rb.className = "result-badge " + (m.success?"success":"fail");
      rb.innerHTML = md(m.text);
      var rw = document.createElement("div"); rw.className = "mw assistant";
      var ra = document.createElement("div"); ra.className = "av b"; ra.textContent = "A";
      rw.appendChild(ra); rw.appendChild(rb); msgEl.appendChild(rw);
      msgEl.scrollTop = msgEl.scrollHeight;
      busy=false; sb.disabled=false;
      break;
  }
});

// On load, request restore
api.postMessage({type:"ready"});
inp.focus();
</script></body></html>`;
    }
}
exports.ChatPanelProvider = ChatPanelProvider;
ChatPanelProvider.viewType = 'agent-code.chatView';
//# sourceMappingURL=chatPanel.js.map