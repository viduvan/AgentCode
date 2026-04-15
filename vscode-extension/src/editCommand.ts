/**
 * Edit Command — select code, describe change, get LLM edit with diff preview.
 *
 * Flow: Selection → Instruction input → LLM → Diff view → Accept/Reject
 */
import * as vscode from 'vscode';
import { OllamaClient } from './ollama';
import { ContextBuilder } from './contextBuilder';
import { DiffManager } from './diffManager';

const SYSTEM_PROMPT = `You are an expert code editor. Follow these rules:
1. Return ONLY the modified code, no explanations before or after
2. Do not wrap the code in markdown code blocks
3. Preserve indentation and coding style
4. Only change what is requested — keep everything else identical
5. Return the complete modified code snippet (not just the diff)`;

export class EditCommand {
    constructor(
        private ollama: OllamaClient,
        private diffManager: DiffManager,
    ) { }

    /**
     * Execute the edit command: ask for instruction, call LLM, show diff.
     */
    async execute(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
            vscode.window.showWarningMessage('Select code to edit first.');
            return;
        }

        // Get the selected code
        const selectedCode = editor.document.getText(selection);

        // Ask user for instruction
        const instruction = await vscode.window.showInputBox({
            title: 'Agent Code: Edit',
            prompt: 'Describe what you want to change',
            placeHolder: 'e.g., add error handling, add logging, optimize performance',
        });

        if (!instruction) {
            return; // cancelled
        }

        // Build prompt
        const fileName = editor.document.fileName;
        const lang = editor.document.languageId;
        const prompt = this.buildPrompt(selectedCode, instruction, fileName, lang);

        // Call LLM with progress
        let result: string | undefined;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Agent Code: Editing...`,
                cancellable: true,
            },
            async (progress, token) => {
                progress.report({ message: 'Sending to LLM...' });

                const abortController = new AbortController();
                token.onCancellationRequested(() => abortController.abort());

                try {
                    result = await this.ollama.generate({
                        prompt,
                        system: SYSTEM_PROMPT,
                        signal: abortController.signal,
                    });
                } catch (err: any) {
                    if (err.message !== 'Request aborted') {
                        vscode.window.showErrorMessage(`LLM Error: ${err.message}`);
                    }
                }
            },
        );

        if (!result) {
            return;
        }

        // Clean up LLM response — strip markdown code fences if present
        const cleanedResult = this.cleanResponse(result, lang);

        // Show diff view
        await this.diffManager.showDiff(
            editor.document.uri,
            selectedCode,
            cleanedResult,
            selection,
        );
    }

    private buildPrompt(code: string, instruction: string, fileName: string, lang: string): string {
        return `File: ${fileName}
Language: ${lang}

Original code:
${code}

Instruction: ${instruction}

Return the complete modified code. Do not add any explanations.`;
    }

    private cleanResponse(response: string, lang: string): string {
        let cleaned = response.trim();

        // Remove markdown code fences if LLM wrapped them
        const fenceRegex = /^```(?:\w+)?\n([\s\S]*?)```$/;
        const match = cleaned.match(fenceRegex);
        if (match) {
            cleaned = match[1];
        }

        // Remove leading/trailing blank lines
        cleaned = cleaned.replace(/^\n+/, '').replace(/\n+$/, '');

        return cleaned;
    }
}

/**
 * Explain Command — explain selected code.
 */
export class ExplainCommand {
    constructor(private ollama: OllamaClient) { }

    async execute(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }

        const selection = editor.selection;
        const code = selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(selection);

        const lang = editor.document.languageId;
        const prompt = `Explain the following ${lang} code clearly and concisely. ALWAYS respond in Vietnamese (tiếng Việt):\n\n${code}`;
        const system = `You are a code explainer. Provide clear, structured explanations using markdown.
Use headings and bullet points. Focus on what the code does, not how to improve it.
IMPORTANT: Your entire response MUST be in Vietnamese (tiếng Việt).`;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Agent Code: Explaining...',
                cancellable: true,
            },
            async (progress, token) => {
                const abortController = new AbortController();
                token.onCancellationRequested(() => abortController.abort());

                try {
                    const result = await this.ollama.generate({
                        prompt,
                        system,
                        signal: abortController.signal,
                    });

                    // Show result in a new untitled document
                    const doc = await vscode.workspace.openTextDocument({
                        language: 'markdown',
                        content: `#  Giải thích Code\n\n${result}`,
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                } catch (err: any) {
                    if (err.message !== 'Request aborted') {
                        vscode.window.showErrorMessage(`LLM Error: ${err.message}`);
                    }
                }
            },
        );
    }
}

/**
 * Review Command — review code for bugs and issues.
 */
export class ReviewCommand {
    constructor(private ollama: OllamaClient) { }

    async execute(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage('No active editor.');
            return;
        }

        const context = ContextBuilder.fromDocument(editor.document);
        const lang = editor.document.languageId;
        const prompt = `Review the following ${lang} code for bugs, security issues, and improvements. ALWAYS respond in Vietnamese (tiếng Việt):\n\n${context}`;
        const system = `You are a code reviewer. Analyze code and report issues with this format:
- **[SEVERITY]** \`filename:line\` — Description
  - Suggestion: How to fix
Severity: CRITICAL | WARNING | INFO
If no issues found, say "Không tìm thấy vấn đề đáng kể."
Do NOT rewrite code — only report issues.
IMPORTANT: Your entire response MUST be in Vietnamese (tiếng Việt).`;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Agent Code: Reviewing...',
                cancellable: true,
            },
            async (progress, token) => {
                const abortController = new AbortController();
                token.onCancellationRequested(() => abortController.abort());

                try {
                    const result = await this.ollama.generate({
                        prompt,
                        system,
                        signal: abortController.signal,
                    });

                    const doc = await vscode.workspace.openTextDocument({
                        language: 'markdown',
                        content: `#  Đánh giá Code\n\n${result}`,
                    });
                    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                } catch (err: any) {
                    if (err.message !== 'Request aborted') {
                        vscode.window.showErrorMessage(`LLM Error: ${err.message}`);
                    }
                }
            },
        );
    }
}

/**
 * Generate Command — generate new code from description.
 */
export class GenerateCommand {
    constructor(
        private ollama: OllamaClient,
        private diffManager: DiffManager,
    ) { }

    async execute(): Promise<void> {
        const instruction = await vscode.window.showInputBox({
            title: 'Agent Code: Generate',
            prompt: 'Describe what code to generate',
            placeHolder: 'e.g., Flask REST API with /users CRUD, pytest tests for auth module',
        });

        if (!instruction) { return; }

        const prompt = `Generate code based on this description:\n\n${instruction}\n\nReturn complete, working code. Include imports and proper structure.`;
        const system = `You are a code generator. Return ONLY code inside a single code block.
Use proper language-specific conventions. Include docstrings/comments in Vietnamese.
Do NOT include explanations outside the code block.`;

        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Agent Code: Generating...',
                cancellable: true,
            },
            async (progress, token) => {
                const abortController = new AbortController();
                token.onCancellationRequested(() => abortController.abort());

                try {
                    const result = await this.ollama.generate({
                        prompt,
                        system,
                        signal: abortController.signal,
                    });

                    // Clean code from response
                    let code = result.trim();
                    const fenceRegex = /```(?:\w+)?\n([\s\S]*?)```/;
                    const match = code.match(fenceRegex);
                    if (match) { code = match[1]; }

                    // Open as new untitled document
                    const doc = await vscode.workspace.openTextDocument({
                        content: code,
                    });
                    await vscode.window.showTextDocument(doc);

                    vscode.window.showInformationMessage(
                        'Generated! Save the file with Ctrl+S to keep it.',
                    );
                } catch (err: any) {
                    if (err.message !== 'Request aborted') {
                        vscode.window.showErrorMessage(`LLM Error: ${err.message}`);
                    }
                }
            },
        );
    }
}
