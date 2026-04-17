/**
 * Diff Manager — manages diff view with accept/reject for code edits and generation.
 *
 * Features:
 * - Uses vscode.diff for visual coloring (green = additions, red = deletions)
 * - Centered status bar buttons for Accept/Reject
 * - Supports both "edit" (modify existing) and "generate" (create new file) flows
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

interface PendingEdit {
    type: 'edit' | 'generate';
    originalUri: vscode.Uri;
    originalContent: string;
    modifiedContent: string;
    originalTempUri: vscode.Uri;
    modifiedTempUri: vscode.Uri;
    selection?: vscode.Range;
    // Generate-specific
    suggestedFileName?: string;
    languageId?: string;
}

export class DiffManager {
    private pendingEdit: PendingEdit | null = null;
    private tempDir: string;
    private acceptBtn?: vscode.StatusBarItem;
    private rejectBtn?: vscode.StatusBarItem;
    private separatorBtn?: vscode.StatusBarItem;

    constructor() {
        this.tempDir = path.join(os.tmpdir(), 'agent-code-diff');
        if (!fs.existsSync(this.tempDir)) {
            fs.mkdirSync(this.tempDir, { recursive: true });
        }
    }

    // ── Edit Flow: show diff between original and modified code ───

    async showDiff(
        originalUri: vscode.Uri,
        originalContent: string,
        modifiedContent: string,
        selection?: vscode.Range,
    ): Promise<void> {
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

        // Open diff view — shows green for additions, red for deletions
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalTempUri,
            modifiedTempUri,
            `Agent Code: ${baseName} (Review Changes)`,
            { preview: true },
        );

        // Show centered Accept/Reject buttons in status bar
        this.showActionButtons('Review changes and Accept or Reject');
    }

    // ── Generate Flow: show diff with empty file → all green ─────

    async showNewFilePreview(
        code: string,
        suggestedFileName: string,
        languageId: string,
    ): Promise<void> {
        this.cleanup();

        const timestamp = Date.now();

        // Empty original → all code shows as green (additions)
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

        // Open diff: empty vs generated → all code appears in GREEN
        await vscode.commands.executeCommand(
            'vscode.diff',
            originalTempUri,
            modifiedTempUri,
            `Agent Code: ${suggestedFileName} (Generated — New File)`,
            { preview: true },
        );

        this.showActionButtons(`New file: ${suggestedFileName}`);
    }

    // ── Centered Status Bar Buttons ──────────────────────────────

    private showActionButtons(description: string): void {
        this.hideActionButtons();

        // Description label (centered via priority 0)
        this.separatorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -998);
        this.separatorBtn.text = `$(file-diff) ${description}`;
        this.separatorBtn.tooltip = 'Agent Code: Pending changes';
        this.separatorBtn.show();

        // Accept button — green background
        this.acceptBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -999);
        this.acceptBtn.text = '$(check) Accept';
        this.acceptBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        this.acceptBtn.command = 'agent-code.acceptEdit';
        this.acceptBtn.tooltip = 'Accept and apply changes';
        this.acceptBtn.show();

        // Reject button — red background
        this.rejectBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1000);
        this.rejectBtn.text = '$(x) Reject';
        this.rejectBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.rejectBtn.command = 'agent-code.rejectEdit';
        this.rejectBtn.tooltip = 'Reject and discard changes';
        this.rejectBtn.show();
    }

    private hideActionButtons(): void {
        this.separatorBtn?.dispose();
        this.acceptBtn?.dispose();
        this.rejectBtn?.dispose();
        this.separatorBtn = undefined;
        this.acceptBtn = undefined;
        this.rejectBtn = undefined;
    }

    // ── Accept / Reject handlers ─────────────────────────────────

    async acceptEdit(): Promise<boolean> {
        if (!this.pendingEdit) {
            vscode.window.showWarningMessage('No pending Agent Code edit to accept.');
            return false;
        }

        const pending = this.pendingEdit;

        try {
            if (pending.type === 'generate') {
                // Generate: save to new file via save dialog
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
                const fileName = pending.suggestedFileName || 'generated_code.txt';
                const defaultUri = workspaceFolder
                    ? vscode.Uri.joinPath(workspaceFolder, fileName)
                    : vscode.Uri.file(path.join(os.homedir(), fileName));

                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri,
                    filters: this.getFileFilters(pending.languageId || ''),
                    title: 'Lưu file generated',
                });

                if (saveUri) {
                    fs.writeFileSync(saveUri.fsPath, pending.modifiedContent, 'utf-8');
                    await this.closeDiffTabs();
                    this.hideActionButtons();
                    this.cleanup();

                    const savedDoc = await vscode.workspace.openTextDocument(saveUri);
                    await vscode.window.showTextDocument(savedDoc);
                    vscode.window.showInformationMessage(`✅ File đã lưu: ${path.basename(saveUri.fsPath)}`);
                    return true;
                } else {
                    // User cancelled save dialog — keep diff open
                    vscode.window.showInformationMessage('Chưa lưu. Nhấn Accept lần nữa để lưu.');
                    return false;
                }
            } else {
                // Edit: apply changes to the original file
                const { originalUri, modifiedContent, selection } = pending;

                const editor = vscode.window.visibleTextEditors.find(
                    e => e.document.uri.fsPath === originalUri.fsPath,
                );

                if (editor && selection) {
                    await editor.edit(editBuilder => {
                        editBuilder.replace(selection, modifiedContent);
                    });
                } else {
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
                await this.closeDiffTabs();
                this.hideActionButtons();
                this.cleanup();
                return true;
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to apply changes: ${err.message}`);
            this.hideActionButtons();
            this.cleanup();
            return false;
        }
    }

    async rejectEdit(): Promise<void> {
        if (!this.pendingEdit) {
            vscode.window.showWarningMessage('No pending Agent Code edit to reject.');
            return;
        }

        vscode.window.showInformationMessage('❌ Agent Code: Changes rejected.');
        await this.closeDiffTabs();
        this.hideActionButtons();
        this.cleanup();
    }

    hasPendingEdit(): boolean {
        return this.pendingEdit !== null;
    }

    // ── Internal helpers ─────────────────────────────────────────

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

    private async closeDiffTabs(): Promise<void> {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }

    private getFileFilters(languageId: string): Record<string, string[]> {
        const filters: Record<string, Record<string, string[]>> = {
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

    dispose(): void {
        this.hideActionButtons();
        this.cleanup();
    }
}
