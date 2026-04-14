/**
 * Inline Completion Provider — Copilot-style ghost text suggestions.
 *
 * Triggers after user stops typing (debounced).
 * Shows ghost text → Tab to accept, Esc to dismiss.
 */
import * as vscode from 'vscode';
import { OllamaClient } from './ollama';
import { ContextBuilder } from './contextBuilder';
import { getConfig } from './config';

const INLINE_SYSTEM = `You are a code completion engine. Given the code context, predict the NEXT few lines of code.
Rules:
1. Return ONLY the code to insert — no explanations, no markdown fences
2. Complete the current line if partially typed, then add a few more lines
3. Match the existing indentation and coding style exactly
4. Be concise — suggest 1-5 lines maximum
5. If unsure, suggest nothing (return empty)`;

export class InlineCompletionProvider implements vscode.InlineCompletionItemProvider {
    private ollama: OllamaClient;
    private debounceTimer: NodeJS.Timeout | undefined;
    private lastCancel: AbortController | undefined;
    private enabled: boolean = true;

    constructor(ollama: OllamaClient) {
        this.ollama = ollama;
        this.enabled = getConfig().inlineEnabled;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.InlineCompletionItem[] | undefined> {
        if (!this.enabled) {
            return undefined;
        }

        // Cancel any previous request
        if (this.lastCancel) {
            this.lastCancel.abort();
        }

        const cfg = getConfig();

        // Debounce: wait for user to stop typing
        await new Promise<void>((resolve) => {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = setTimeout(resolve, cfg.inlineDelay);
        });

        // Check if cancelled during debounce
        if (token.isCancellationRequested) {
            return undefined;
        }

        // Build context: code before and after cursor
        const { prefix, suffix } = ContextBuilder.forInlineCompletion(document, position);

        // Skip if line is empty or just whitespace (avoid noisy completions)
        const currentLine = document.lineAt(position.line).text;
        if (currentLine.trim().length === 0 && position.character === 0) {
            return undefined;
        }

        const prompt = this.buildPrompt(prefix, suffix, document.languageId);

        const abortController = new AbortController();
        this.lastCancel = abortController;

        // Also abort on VS Code cancellation
        token.onCancellationRequested(() => abortController.abort());

        try {
            const completion = await this.ollama.generateSimple(prompt, INLINE_SYSTEM);

            if (token.isCancellationRequested) {
                return undefined;
            }

            const cleaned = this.cleanCompletion(completion);
            if (!cleaned) {
                return undefined;
            }

            return [
                new vscode.InlineCompletionItem(
                    cleaned,
                    new vscode.Range(position, position),
                ),
            ];
        } catch {
            // Silently fail for inline completions
            return undefined;
        }
    }

    private buildPrompt(prefix: string, suffix: string, lang: string): string {
        let prompt = `Language: ${lang}\n\n`;
        prompt += `// Code before cursor:\n${prefix}`;

        if (suffix.trim()) {
            prompt += `\n// Code after cursor:\n${suffix}`;
        }

        prompt += '\n\n// Complete the code at the cursor position. Return only the completion:';
        return prompt;
    }

    private cleanCompletion(text: string): string {
        let cleaned = text.trim();

        // Remove markdown fences
        const fenceRegex = /^```(?:\w+)?\n([\s\S]*?)```$/;
        const match = cleaned.match(fenceRegex);
        if (match) {
            cleaned = match[1].trim();
        }

        // Limit to reasonable size (max 10 lines)
        const lines = cleaned.split('\n');
        if (lines.length > 10) {
            cleaned = lines.slice(0, 10).join('\n');
        }

        return cleaned;
    }

    dispose(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        if (this.lastCancel) {
            this.lastCancel.abort();
        }
    }
}
