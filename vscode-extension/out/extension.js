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
exports.activate = activate;
exports.deactivate = deactivate;
/**
 * Agent Code — VS Code Extension Entry Point
 *
 * Registers all providers, commands, and the sidebar chat panel.
 */
const vscode = __importStar(require("vscode"));
const ollama_1 = require("./ollama");
const diffManager_1 = require("./diffManager");
const editCommand_1 = require("./editCommand");
const inlineProvider_1 = require("./inlineProvider");
const codeLens_1 = require("./codeLens");
const chatPanel_1 = require("./chatPanel");
function activate(context) {
    console.log('Agent Code extension activated');
    // ── Shared instances ──────────────────────────────────────────
    const ollama = new ollama_1.OllamaClient();
    const diffManager = new diffManager_1.DiffManager();
    const editCmd = new editCommand_1.EditCommand(ollama, diffManager);
    const explainCmd = new editCommand_1.ExplainCommand(ollama);
    const reviewCmd = new editCommand_1.ReviewCommand(ollama);
    const generateCmd = new editCommand_1.GenerateCommand(ollama, diffManager);
    const inlineProvider = new inlineProvider_1.InlineCompletionProvider(ollama);
    const codeLensProvider = new codeLens_1.AgentCodeLensProvider();
    // ── Chat Sidebar ──────────────────────────────────────────────
    const chatProvider = new chatPanel_1.ChatPanelProvider(context.extensionUri, ollama);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(chatPanel_1.ChatPanelProvider.viewType, chatProvider));
    // ── Commands ──────────────────────────────────────────────────
    context.subscriptions.push(vscode.commands.registerCommand('agent-code.edit', () => editCmd.execute()), vscode.commands.registerCommand('agent-code.explain', () => explainCmd.execute()), vscode.commands.registerCommand('agent-code.review', () => reviewCmd.execute()), vscode.commands.registerCommand('agent-code.generate', () => generateCmd.execute()), vscode.commands.registerCommand('agent-code.acceptEdit', () => diffManager.acceptEdit()), vscode.commands.registerCommand('agent-code.rejectEdit', () => diffManager.rejectEdit()));
    // Toggle inline completions
    context.subscriptions.push(vscode.commands.registerCommand('agent-code.toggleInline', () => {
        const current = vscode.workspace.getConfiguration('agentCode').get('inlineEnabled', true);
        vscode.workspace.getConfiguration('agentCode').update('inlineEnabled', !current, true);
        inlineProvider.setEnabled(!current);
        vscode.window.showInformationMessage(`Inline completions ${!current ? 'enabled' : 'disabled'}`);
    }));
    // Focus chat panel
    context.subscriptions.push(vscode.commands.registerCommand('agent-code.chatFocus', () => {
        vscode.commands.executeCommand('agent-code.chatView.focus');
    }));
    // ── CodeLens commands (triggered when clicking CodeLens) ──────
    context.subscriptions.push(vscode.commands.registerCommand('agent-code.explainAtLine', async (uri, line) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        // Select the function/class body (rough: select until next definition or end)
        const endLine = findBlockEnd(doc, line);
        const range = new vscode.Range(line, 0, endLine, doc.lineAt(endLine).text.length);
        editor.selection = new vscode.Selection(range.start, range.end);
        await explainCmd.execute();
    }), vscode.commands.registerCommand('agent-code.editAtLine', async (uri, line) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const endLine = findBlockEnd(doc, line);
        const range = new vscode.Range(line, 0, endLine, doc.lineAt(endLine).text.length);
        editor.selection = new vscode.Selection(range.start, range.end);
        await editCmd.execute();
    }));
    // ── Inline Completion Provider ────────────────────────────────
    context.subscriptions.push(vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, inlineProvider));
    // ── CodeLens Provider ─────────────────────────────────────────
    const supportedLanguages = [
        'python', 'javascript', 'typescript', 'java', 'go', 'rust',
        'javascriptreact', 'typescriptreact',
    ];
    for (const lang of supportedLanguages) {
        context.subscriptions.push(vscode.languages.registerCodeLensProvider({ language: lang }, codeLensProvider));
    }
    // ── Config change listener ────────────────────────────────────
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('agentCode')) {
            ollama.reload();
            const cfg = vscode.workspace.getConfiguration('agentCode');
            inlineProvider.setEnabled(cfg.get('inlineEnabled', true));
        }
    }));
    // ── Status bar item ───────────────────────────────────────────
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBar.text = '$(hubot) Agent Code';
    statusBar.command = 'agent-code.chatFocus';
    statusBar.tooltip = 'Open Agent Code Chat';
    statusBar.show();
    context.subscriptions.push(statusBar);
    // ── Startup: Check Ollama connection ──────────────────────────
    ollama.checkConnection().then((ok) => {
        if (ok) {
            statusBar.text = '$(hubot) Agent Code ✓';
        }
        else {
            statusBar.text = '$(hubot) Agent Code ✗';
            statusBar.tooltip = 'Ollama not connected — click to open chat';
            vscode.window.showWarningMessage('Agent Code: Cannot connect to Ollama. Make sure it is running (ollama serve).');
        }
    });
}
/**
 * Find the end line of a code block starting at `startLine`.
 * Simple heuristic: find next line at same or lower indentation.
 */
function findBlockEnd(doc, startLine) {
    const startIndent = doc.lineAt(startLine).firstNonWhitespaceCharacterIndex;
    let endLine = startLine + 1;
    while (endLine < doc.lineCount - 1) {
        const line = doc.lineAt(endLine);
        if (line.text.trim() === '') {
            endLine++;
            continue;
        }
        const indent = line.firstNonWhitespaceCharacterIndex;
        if (indent <= startIndent && endLine > startLine + 1) {
            return endLine - 1;
        }
        endLine++;
    }
    return doc.lineCount - 1;
}
function deactivate() {
    console.log('Agent Code extension deactivated');
}
//# sourceMappingURL=extension.js.map