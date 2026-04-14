/**
 * Context builder — gathers relevant code context from the editor.
 */
import * as vscode from 'vscode';
import { getConfig } from './config';

export class ContextBuilder {

    /**
     * Build context from the current editor selection or entire file.
     */
    static fromSelection(editor: vscode.TextEditor): string {
        const selection = editor.selection;
        const doc = editor.document;
        const cfg = getConfig();

        if (!selection.isEmpty) {
            const selectedText = doc.getText(selection);
            const startLine = selection.start.line + 1;
            return `=== File: ${doc.fileName} (lines ${startLine}-${selection.end.line + 1}) ===\n${selectedText}\n`;
        }

        // Full file context (capped)
        return this.fromDocument(doc);
    }

    /**
     * Build context from a full document (capped to maxContextLines).
     */
    static fromDocument(doc: vscode.TextDocument): string {
        const cfg = getConfig();
        const totalLines = doc.lineCount;
        const maxLines = cfg.maxContextLines;

        let content: string;
        if (totalLines <= maxLines) {
            content = doc.getText();
        } else {
            // Take first half and last half
            const halfMax = Math.floor(maxLines / 2);
            const firstPart = doc.getText(new vscode.Range(0, 0, halfMax, 0));
            const lastPart = doc.getText(new vscode.Range(totalLines - halfMax, 0, totalLines, 0));
            content = firstPart + `\n... (${totalLines - maxLines} lines omitted) ...\n` + lastPart;
        }

        return `=== File: ${doc.fileName} ===\n${content}\n`;
    }

    /**
     * Build context for inline completion — surrounding code around cursor.
     */
    static forInlineCompletion(doc: vscode.TextDocument, position: vscode.Position): { prefix: string; suffix: string } {
        const cfg = getConfig();
        const halfLines = Math.floor(cfg.maxContextLines / 2);

        const prefixStart = Math.max(0, position.line - halfLines);
        const prefixRange = new vscode.Range(prefixStart, 0, position.line, position.character);
        const prefix = doc.getText(prefixRange);

        const suffixEnd = Math.min(doc.lineCount, position.line + halfLines);
        const suffixRange = new vscode.Range(position.line, position.character, suffixEnd, 0);
        const suffix = doc.getText(suffixRange);

        return { prefix, suffix };
    }

    /**
     * Get a workspace file tree summary (simple version).
     */
    static async getProjectTree(): Promise<string> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return '(no workspace open)';
        }

        const root = folders[0].uri;
        const lines: string[] = [`📁 ${folders[0].name}/`];

        try {
            const entries = await vscode.workspace.fs.readDirectory(root);
            const sorted = entries.sort((a, b) => {
                if (a[1] !== b[1]) { return a[1] === vscode.FileType.Directory ? -1 : 1; }
                return a[0].localeCompare(b[0]);
            });

            for (const [name, type] of sorted.slice(0, 30)) {
                if (name.startsWith('.') || name === 'node_modules' || name === '__pycache__') {
                    continue;
                }
                const icon = type === vscode.FileType.Directory ? '📁' : '📄';
                lines.push(`  ${icon} ${name}`);
            }
        } catch {
            // ignore
        }

        return lines.join('\n');
    }
}
