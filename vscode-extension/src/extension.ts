/**
 * Agent Code — VS Code Extension Entry Point
 *
 * Registers all providers, commands, and the sidebar chat panel.
 */
import * as vscode from 'vscode';
import { OllamaClient } from './ollama';
import { DiffManager } from './diffManager';
import { EditCommand, ExplainCommand, ReviewCommand, GenerateCommand } from './editCommand';
import { InlineCompletionProvider } from './inlineProvider';
import { AgentCodeLensProvider } from './codeLens';
import { ChatPanelProvider } from './chatPanel';
import { ContextBuilder } from './contextBuilder';

export function activate(context: vscode.ExtensionContext): void {
    console.log('Agent Code extension activated');

    // ── Shared instances ──────────────────────────────────────────
    const ollama = new OllamaClient();
    const diffManager = new DiffManager();
    const editCmd = new EditCommand(ollama, diffManager);
    const explainCmd = new ExplainCommand(ollama);
    const reviewCmd = new ReviewCommand(ollama);
    const generateCmd = new GenerateCommand(ollama, diffManager);
    const inlineProvider = new InlineCompletionProvider(ollama);
    const codeLensProvider = new AgentCodeLensProvider();

    // ── Chat Sidebar ──────────────────────────────────────────────
    const chatProvider = new ChatPanelProvider(context.extensionUri, ollama);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ChatPanelProvider.viewType,
            chatProvider,
        ),
    );

    // ── Commands ──────────────────────────────────────────────────
    context.subscriptions.push(
        vscode.commands.registerCommand('agent-code.edit', () => editCmd.execute()),
        vscode.commands.registerCommand('agent-code.explain', () => explainCmd.execute()),
        vscode.commands.registerCommand('agent-code.review', () => reviewCmd.execute()),
        vscode.commands.registerCommand('agent-code.generate', () => generateCmd.execute()),
        vscode.commands.registerCommand('agent-code.acceptEdit', () => diffManager.acceptEdit()),
        vscode.commands.registerCommand('agent-code.rejectEdit', () => diffManager.rejectEdit()),
    );

    // Toggle inline completions
    context.subscriptions.push(
        vscode.commands.registerCommand('agent-code.toggleInline', () => {
            const current = vscode.workspace.getConfiguration('agentCode').get<boolean>('inlineEnabled', true);
            vscode.workspace.getConfiguration('agentCode').update('inlineEnabled', !current, true);
            inlineProvider.setEnabled(!current);
            vscode.window.showInformationMessage(
                `Inline completions ${!current ? 'enabled' : 'disabled'}`,
            );
        }),
    );

    // Focus chat panel
    context.subscriptions.push(
        vscode.commands.registerCommand('agent-code.chatFocus', () => {
            vscode.commands.executeCommand('agent-code.chatView.focus');
        }),
    );

    // ── CodeLens commands (triggered when clicking CodeLens) ──────
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'agent-code.explainAtLine',
            async (uri: vscode.Uri, line: number) => {
                const doc = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(doc);

                // Select the function/class body (rough: select until next definition or end)
                const endLine = findBlockEnd(doc, line);
                const range = new vscode.Range(line, 0, endLine, doc.lineAt(endLine).text.length);
                editor.selection = new vscode.Selection(range.start, range.end);

                await explainCmd.execute();
            },
        ),
        vscode.commands.registerCommand(
            'agent-code.editAtLine',
            async (uri: vscode.Uri, line: number) => {
                const doc = await vscode.workspace.openTextDocument(uri);
                const editor = await vscode.window.showTextDocument(doc);

                const endLine = findBlockEnd(doc, line);
                const range = new vscode.Range(line, 0, endLine, doc.lineAt(endLine).text.length);
                editor.selection = new vscode.Selection(range.start, range.end);

                await editCmd.execute();
            },
        ),
    );

    // ── Inline Completion Provider ────────────────────────────────
    context.subscriptions.push(
        vscode.languages.registerInlineCompletionItemProvider(
            { pattern: '**' },
            inlineProvider,
        ),
    );

    // ── CodeLens Provider ─────────────────────────────────────────
    const supportedLanguages = [
        'python', 'javascript', 'typescript', 'java', 'go', 'rust',
        'javascriptreact', 'typescriptreact',
    ];
    for (const lang of supportedLanguages) {
        context.subscriptions.push(
            vscode.languages.registerCodeLensProvider(
                { language: lang },
                codeLensProvider,
            ),
        );
    }

    // ── Config change listener ────────────────────────────────────
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('agentCode')) {
                ollama.reload();
                const cfg = vscode.workspace.getConfiguration('agentCode');
                inlineProvider.setEnabled(cfg.get<boolean>('inlineEnabled', true));
            }
        }),
    );

    // ── Status bar item ───────────────────────────────────────────
    const statusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100,
    );
    statusBar.text = '$(hubot) Agent Code';
    statusBar.command = 'agent-code.chatFocus';
    statusBar.tooltip = 'Open Agent Code Chat';
    statusBar.show();
    context.subscriptions.push(statusBar);

    // ── Startup: Check Ollama connection ──────────────────────────
    ollama.checkConnection().then((ok) => {
        if (ok) {
            statusBar.text = '$(hubot) Agent Code ✓';
        } else {
            statusBar.text = '$(hubot) Agent Code ✗';
            statusBar.tooltip = 'Ollama not connected — click to open chat';
            vscode.window.showWarningMessage(
                'Agent Code: Cannot connect to Ollama. Make sure it is running (ollama serve).',
            );
        }
    });
}

/**
 * Find the end line of a code block starting at `startLine`.
 * Simple heuristic: find next line at same or lower indentation.
 */
function findBlockEnd(doc: vscode.TextDocument, startLine: number): number {
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

export function deactivate(): void {
    console.log('Agent Code extension deactivated');
}
