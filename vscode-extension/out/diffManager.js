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
exports.DiffManager = void 0;
/**
 * Diff Manager — manages diff view with accept/reject for code edits and generation.
 *
 * Features:
 * - Uses vscode.diff for visual coloring (green = additions, red = deletions)
 * - CodeLens buttons directly on the code editor for Accept/Reject
 * - Supports both "edit" (modify existing) and "generate" (create new file) flows
 */
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
// ── CodeLens Provider — shows Accept/Reject on the code surface ──
class DiffActionCodeLensProvider {
    constructor() {
        this.pendingUri = null;
        this.description = '';
        this._onDidChangeCodeLenses = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    }
    setPending(uri, description = '') {
        this.pendingUri = uri;
        this.description = description;
        this._onDidChangeCodeLenses.fire();
    }
    provideCodeLenses(document) {
        if (!this.pendingUri || document.uri.fsPath !== this.pendingUri.fsPath) {
            return [];
        }
        const topLine = new vscode.Range(0, 0, 0, 0);
        return [
            new vscode.CodeLens(topLine, {
                title: '$(file-diff) ' + this.description,
                command: '',
            }),
            new vscode.CodeLens(topLine, {
                title: '$(check) Accept',
                command: 'agent-code.acceptEdit',
            }),
            new vscode.CodeLens(topLine, {
                title: '$(x) Reject',
                command: 'agent-code.rejectEdit',
            }),
        ];
    }
}
// ── Diff Manager ─────────────────────────────────────────────────
class DiffManager {
    constructor() {
        this.pendingEdit = null;
        this.tempDir = path.join(os.tmpdir(), 'agent-code-diff');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
        this.codeLensProvider = new DiffActionCodeLensProvider();
        this.codeLensDisposable = vscode.languages.registerCodeLensProvider({ pattern: '**' }, this.codeLensProvider);
    }
    // ── Edit Flow ────────────────────────────────────────────────
    async showDiff(originalUri, originalContent, modifiedContent, selection) {
        this.cleanup();
        const baseName = path.basename(originalUri.fsPath);
        const timestamp = Date.now();
        const originalTempPath = path.join(this.tempDir, `original-${timestamp}-${baseName}`);
        const modifiedTempPath = path.join(this.tempDir, `modified-${timestamp}-${baseName}`);
        fs.writeFileSync(originalTempPath, originalContent, 'utf-8');
        fs.writeFileSync(modifiedTempPath, modifiedContent, 'utf-8');
        const originalTempUri = vscode.Uri.file(originalTempPath);
        const modifiedTempUri = vscode.Uri.file(modifiedTempPath);
        this.pendingEdit = {
            type: 'edit',
            originalUri,
            originalContent,
            modifiedContent,
            originalTempUri,
            modifiedTempUri,
            selection,
        };
        await vscode.commands.executeCommand('vscode.diff', originalTempUri, modifiedTempUri, `Agent Code: ${baseName} (Review Changes)`, { preview: true });
        this.codeLensProvider.setPending(modifiedTempUri, `Review: ${baseName}`);
    }
    // ── Generate Flow ────────────────────────────────────────────
    async showNewFilePreview(code, suggestedFileName, languageId) {
        this.cleanup();
        const timestamp = Date.now();
        const originalTempPath = path.join(this.tempDir, `empty-${timestamp}-${suggestedFileName}`);
        const modifiedTempPath = path.join(this.tempDir, `generated-${timestamp}-${suggestedFileName}`);
        fs.writeFileSync(originalTempPath, '', 'utf-8');
        fs.writeFileSync(modifiedTempPath, code, 'utf-8');
        const originalTempUri = vscode.Uri.file(originalTempPath);
        const modifiedTempUri = vscode.Uri.file(modifiedTempPath);
        this.pendingEdit = {
            type: 'generate',
            originalUri: modifiedTempUri,
            originalContent: '',
            modifiedContent: code,
            originalTempUri,
            modifiedTempUri,
            suggestedFileName,
            languageId,
        };
        await vscode.commands.executeCommand('vscode.diff', originalTempUri, modifiedTempUri, `Agent Code: ${suggestedFileName} (Generated — New File)`, { preview: true });
        this.codeLensProvider.setPending(modifiedTempUri, `New file: ${suggestedFileName}`);
    }
    // ── Accept / Reject ──────────────────────────────────────────
    async acceptEdit() {
        if (!this.pendingEdit) {
            vscode.window.showWarningMessage('No pending Agent Code edit to accept.');
            return false;
        }
        const pending = this.pendingEdit;
        try {
            if (pending.type === 'generate') {
                // Save directly to workspace folder — no dialog
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
                const fileName = pending.suggestedFileName || 'generated_code.txt';
                const saveUri = workspaceFolder
                    ? vscode.Uri.joinPath(workspaceFolder, fileName)
                    : vscode.Uri.file(path.join(os.homedir(), fileName));
                fs.writeFileSync(saveUri.fsPath, pending.modifiedContent, 'utf-8');
                await this.closeDiffTabs();
                this.codeLensProvider.setPending(null);
                this.cleanup();
                const savedDoc = await vscode.workspace.openTextDocument(saveUri);
                await vscode.window.showTextDocument(savedDoc);
                vscode.window.showInformationMessage(`File đã lưu: ${path.basename(saveUri.fsPath)}`);
                return true;
            }
            else {
                // Edit: apply changes to the original file
                const { originalUri, modifiedContent, selection } = pending;
                const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === originalUri.fsPath);
                if (editor && selection) {
                    await editor.edit(editBuilder => {
                        editBuilder.replace(selection, modifiedContent);
                    });
                }
                else {
                    const doc = await vscode.workspace.openTextDocument(originalUri);
                    const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                    const edit = new vscode.WorkspaceEdit();
                    edit.replace(originalUri, fullRange, modifiedContent);
                    await vscode.workspace.applyEdit(edit);
                }
                vscode.window.showInformationMessage('Agent Code: Changes applied!');
                await this.closeDiffTabs();
                this.codeLensProvider.setPending(null);
                this.cleanup();
                return true;
            }
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to apply changes: ${err.message}`);
            this.codeLensProvider.setPending(null);
            this.cleanup();
            return false;
        }
    }
    async rejectEdit() {
        if (!this.pendingEdit) {
            vscode.window.showWarningMessage('No pending Agent Code edit to reject.');
            return;
        }
        vscode.window.showInformationMessage('Agent Code: Changes rejected.');
        await this.closeDiffTabs();
        this.codeLensProvider.setPending(null);
        this.cleanup();
    }
    hasPendingEdit() {
        return this.pendingEdit !== null;
    }
    // ── Internal helpers ─────────────────────────────────────────
    cleanup() {
        if (this.pendingEdit) {
            try {
                const origPath = this.pendingEdit.originalTempUri.fsPath;
                const modPath = this.pendingEdit.modifiedTempUri.fsPath;
                if (fs.existsSync(origPath)) {
                    fs.unlinkSync(origPath);
                }
                if (fs.existsSync(modPath)) {
                    fs.unlinkSync(modPath);
                }
            }
            catch {
                // ignore cleanup errors
            }
            this.pendingEdit = null;
        }
    }
    async closeDiffTabs() {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
    getFileFilters(languageId) {
        const filters = {
            python: { 'Python': ['py'] },
            javascript: { 'JavaScript': ['js'] },
            typescript: { 'TypeScript': ['ts'] },
            java: { 'Java': ['java'] },
            go: { 'Go': ['go'] },
            rust: { 'Rust': ['rs'] },
            html: { 'HTML': ['html'] },
            css: { 'CSS': ['css'] },
            cpp: { 'C++': ['cpp', 'cc'] },
            c: { 'C': ['c'] },
        };
        return filters[languageId] || { 'All Files': ['*'] };
    }
    dispose() {
        this.codeLensProvider.setPending(null);
        this.codeLensDisposable.dispose();
        this.cleanup();
    }
}
exports.DiffManager = DiffManager;
//# sourceMappingURL=diffManager.js.map