/**
 * Diff Manager — manages diff view with accept/reject for code edits.
 *
 * Flow:
 * 1. Original code is saved to a temp file
 * 2. Modified code is saved to another temp file
 * 3. vscode.diff opens both side-by-side
 * 4. User clicks Accept (write to real file) or Reject (discard)
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface PendingEdit {
    originalUri: vscode.Uri;
    originalContent: string;
    modifiedContent: string;
    originalTempUri: vscode.Uri;
    modifiedTempUri: vscode.Uri;
    selection?: vscode.Range;
}

export class DiffManager {
    private pendingEdit: PendingEdit | null = null;
    private tempDir: string;

    constructor() {
        this.tempDir = path.join(os.tmpdir(), 'agent-code-diff');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    /**
     * Show a diff between original and modified code.
     * User can then Accept or Reject.
     */
    async showDiff(
        originalUri: vscode.Uri,
        originalContent: string,
        modifiedContent: string,
        selection?: vscode.Range,
    ): Promise<void> {
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
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalTempUri,
            modifiedTempUri,
            `Agent Code: ${baseName} (Review Changes)`,
            { preview: true },
        );

        // Show accept/reject notification
        const action = await vscode.window.showInformationMessage(
            'Agent Code: Review the changes above',
            { modal: false },
            '✅ Accept',
            '❌ Reject',
        );

        if (action === '✅ Accept') {
            await this.acceptEdit();
        } else {
            await this.rejectEdit();
        }
    }

    /**
     * Accept pending edit — write modified content to the real file.
     */
    async acceptEdit(): Promise<boolean> {
        if (!this.pendingEdit) {
            vscode.window.showWarningMessage('No pending Agent Code edit to accept.');
            return false;
        }

        const { originalUri, modifiedContent, selection } = this.pendingEdit;

        try {
            // If we have a selection, only replace that part
            const editor = vscode.window.visibleTextEditors.find(
                e => e.document.uri.fsPath === originalUri.fsPath
            );

            if (editor && selection) {
                await editor.edit(editBuilder => {
                    editBuilder.replace(selection, modifiedContent);
                });
            } else {
                // Replace entire file
                const doc = await vscode.workspace.openTextDocument(originalUri);
                const fullRange = new vscode.Range(
                    doc.positionAt(0),
                    doc.positionAt(doc.getText().length),
                );
                const edit = new vscode.WorkspaceEdit();
                edit.replace(originalUri, fullRange, modifiedContent);
                await vscode.workspace.applyEdit(edit);
            }

            vscode.window.showInformationMessage('✅ Agent Code: Changes applied!');

            // Close diff tabs
            await this.closeDiffTabs();
            this.cleanup();
            return true;
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to apply changes: ${err.message}`);
            this.cleanup();
            return false;
        }
    }

    /**
     * Reject pending edit — discard changes.
     */
    async rejectEdit(): Promise<void> {
        if (!this.pendingEdit) {
            vscode.window.showWarningMessage('No pending Agent Code edit to reject.');
            return;
        }

        vscode.window.showInformationMessage('❌ Agent Code: Changes rejected.');
        await this.closeDiffTabs();
        this.cleanup();
    }

    hasPendingEdit(): boolean {
        return this.pendingEdit !== null;
    }

    /**
     * Clean up temp files.
     */
    private cleanup(): void {
        if (this.pendingEdit) {
            try {
                const origPath = this.pendingEdit.originalTempUri.fsPath;
                const modPath = this.pendingEdit.modifiedTempUri.fsPath;
                if (fs.existsSync(origPath)) { fs.unlinkSync(origPath); }
                if (fs.existsSync(modPath)) { fs.unlinkSync(modPath); }
            } catch {
                // ignore cleanup errors
            }
            this.pendingEdit = null;
        }
    }

    /**
     * Close the diff editor tabs.
     */
    private async closeDiffTabs(): Promise<void> {
        // Close active diff tab
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }

    dispose(): void {
        this.cleanup();
    }
}
