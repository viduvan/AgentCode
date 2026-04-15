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
 * Diff Manager — manages diff view with accept/reject for code edits.
 *
 * Flow:
 * 1. Original code is saved to a temp file
 * 2. Modified code is saved to another temp file
 * 3. vscode.diff opens both side-by-side
 * 4. User clicks Accept (write to real file) or Reject (discard)
 */
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
class DiffManager {
    constructor() {
        this.pendingEdit = null;
        this.tempDir = path.join(os.tmpdir(), 'agent-code-diff');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }
    /**
     * Show a diff between original and modified code.
     * User can then Accept or Reject.
     */
    async showDiff(originalUri, originalContent, modifiedContent, selection) {
        // Clean up previous pending edit
        this.cleanup();
        const baseName = path.basename(originalUri.fsPath);
        const timestamp = Date.now();
        // Write temp files
        const originalTempPath = path.join(this.tempDir, `original-${timestamp}-${baseName}`);
        const modifiedTempPath = path.join(this.tempDir, `modified-${timestamp}-${baseName}`);
        fs.writeFileSync(originalTempPath, originalContent, 'utf-8');
        fs.writeFileSync(modifiedTempPath, modifiedContent, 'utf-8');
        const originalTempUri = vscode.Uri.file(originalTempPath);
        const modifiedTempUri = vscode.Uri.file(modifiedTempPath);
        this.pendingEdit = {
            originalUri,
            originalContent,
            modifiedContent,
            originalTempUri,
            modifiedTempUri,
            selection,
        };
        // Open diff view
        await vscode.commands.executeCommand('vscode.diff', originalTempUri, modifiedTempUri, `Agent Code: ${baseName} (Review Changes)`, { preview: true });
        // Show accept/reject notification
        const action = await vscode.window.showInformationMessage('Agent Code: Review the changes above', { modal: false }, '✅ Accept', '❌ Reject');
        if (action === '✅ Accept') {
            await this.acceptEdit();
        }
        else {
            await this.rejectEdit();
        }
    }
    /**
     * Accept pending edit — write modified content to the real file.
     */
    async acceptEdit() {
        if (!this.pendingEdit) {
            vscode.window.showWarningMessage('No pending Agent Code edit to accept.');
            return false;
        }
        const { originalUri, modifiedContent, selection } = this.pendingEdit;
        try {
            // If we have a selection, only replace that part
            const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.fsPath === originalUri.fsPath);
            if (editor && selection) {
                await editor.edit(editBuilder => {
                    editBuilder.replace(selection, modifiedContent);
                });
            }
            else {
                // Replace entire file
                const doc = await vscode.workspace.openTextDocument(originalUri);
                const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
                const edit = new vscode.WorkspaceEdit();
                edit.replace(originalUri, fullRange, modifiedContent);
                await vscode.workspace.applyEdit(edit);
            }
            vscode.window.showInformationMessage('✅ Agent Code: Changes applied!');
            // Close diff tabs
            await this.closeDiffTabs();
            this.cleanup();
            return true;
        }
        catch (err) {
            vscode.window.showErrorMessage(`Failed to apply changes: ${err.message}`);
            this.cleanup();
            return false;
        }
    }
    /**
     * Reject pending edit — discard changes.
     */
    async rejectEdit() {
        if (!this.pendingEdit) {
            vscode.window.showWarningMessage('No pending Agent Code edit to reject.');
            return;
        }
        vscode.window.showInformationMessage('❌ Agent Code: Changes rejected.');
        await this.closeDiffTabs();
        this.cleanup();
    }
    hasPendingEdit() {
        return this.pendingEdit !== null;
    }
    /**
     * Clean up temp files.
     */
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
    /**
     * Close the diff editor tabs.
     */
    async closeDiffTabs() {
        // Close active diff tab
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
    dispose() {
        this.cleanup();
    }
}
exports.DiffManager = DiffManager;
//# sourceMappingURL=diffManager.js.map