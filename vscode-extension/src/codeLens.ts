/**
 * CodeLens Provider — show "🤖 Explain | Edit" actions above functions/classes.
 */
import * as vscode from 'vscode';

/**
 * Simple regex-based symbol detection for CodeLens.
 * Matches function/class definitions in common languages.
 */
const SYMBOL_PATTERNS: Record<string, RegExp[]> = {
    python: [
        /^(\s*)(def\s+\w+)/,
        /^(\s*)(class\s+\w+)/,
        /^(\s*)(async\s+def\s+\w+)/,
    ],
    javascript: [
        /^(\s*)(function\s+\w+)/,
        /^(\s*)(class\s+\w+)/,
        /^(\s*)(const\s+\w+\s*=\s*(?:async\s+)?(?:\([^)]*\)|[^=])\s*=>)/,
        /^(\s*)((?:async\s+)?\w+\s*\([^)]*\)\s*\{)/,
    ],
    typescript: [
        /^(\s*)(function\s+\w+)/,
        /^(\s*)(class\s+\w+)/,
        /^(\s*)((?:export\s+)?(?:async\s+)?function\s+\w+)/,
        /^(\s*)((?:export\s+)?class\s+\w+)/,
    ],
    java: [
        /^(\s*)((?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)+\w+\s*\()/,
        /^(\s*)((?:public|private|protected)?\s*class\s+\w+)/,
    ],
    go: [
        /^()(func\s+(?:\([^)]+\)\s+)?\w+)/,
    ],
    rust: [
        /^(\s*)((?:pub\s+)?fn\s+\w+)/,
        /^(\s*)((?:pub\s+)?struct\s+\w+)/,
        /^(\s*)(impl\s+\w+)/,
    ],
};

export class AgentCodeLensProvider implements vscode.CodeLensProvider {
    private _onDidChange = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this._onDidChange.event;

    provideCodeLenses(
        document: vscode.TextDocument,
        _token: vscode.CancellationToken,
    ): vscode.CodeLens[] {
        const lenses: vscode.CodeLens[] = [];
        const lang = document.languageId;
        const patterns = SYMBOL_PATTERNS[lang] || SYMBOL_PATTERNS['python'];

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const text = line.text;

            for (const pattern of patterns) {
                if (pattern.test(text)) {
                    const range = new vscode.Range(i, 0, i, text.length);

                    // "Explain" lens
                    lenses.push(new vscode.CodeLens(range, {
                        title: '🤖 Explain',
                        command: 'agent-code.explainAtLine',
                        arguments: [document.uri, i],
                    }));

                    // "Edit" lens
                    lenses.push(new vscode.CodeLens(range, {
                        title: '✏️ Edit',
                        command: 'agent-code.editAtLine',
                        arguments: [document.uri, i],
                    }));

                    break; // only one match per line
                }
            }
        }

        return lenses;
    }

    refresh(): void {
        this._onDidChange.fire();
    }
}
