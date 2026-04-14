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
exports.InlineCompletionProvider = void 0;
/**
 * Inline Completion Provider — Copilot-style ghost text suggestions.
 *
 * Triggers after user stops typing (debounced).
 * Shows ghost text → Tab to accept, Esc to dismiss.
 */
const vscode = __importStar(require("vscode"));
const contextBuilder_1 = require("./contextBuilder");
const config_1 = require("./config");
const INLINE_SYSTEM = `You are a code completion engine. Given the code context, predict the NEXT few lines of code.
Rules:
1. Return ONLY the code to insert — no explanations, no markdown fences
2. Complete the current line if partially typed, then add a few more lines
3. Match the existing indentation and coding style exactly
4. Be concise — suggest 1-5 lines maximum
5. If unsure, suggest nothing (return empty)`;
class InlineCompletionProvider {
    constructor(ollama) {
        this.enabled = true;
        this.ollama = ollama;
        this.enabled = (0, config_1.getConfig)().inlineEnabled;
    }
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    async provideInlineCompletionItems(document, position, context, token) {
        if (!this.enabled) {
            return undefined;
        }
        // Cancel any previous request
        if (this.lastCancel) {
            this.lastCancel.abort();
        }
        const cfg = (0, config_1.getConfig)();
        // Debounce: wait for user to stop typing
        await new Promise((resolve) => {
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
        const { prefix, suffix } = contextBuilder_1.ContextBuilder.forInlineCompletion(document, position);
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
                new vscode.InlineCompletionItem(cleaned, new vscode.Range(position, position)),
            ];
        }
        catch {
            // Silently fail for inline completions
            return undefined;
        }
    }
    buildPrompt(prefix, suffix, lang) {
        let prompt = `Language: ${lang}\n\n`;
        prompt += `// Code before cursor:\n${prefix}`;
        if (suffix.trim()) {
            prompt += `\n// Code after cursor:\n${suffix}`;
        }
        prompt += '\n\n// Complete the code at the cursor position. Return only the completion:';
        return prompt;
    }
    cleanCompletion(text) {
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
    dispose() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        if (this.lastCancel) {
            this.lastCancel.abort();
        }
    }
}
exports.InlineCompletionProvider = InlineCompletionProvider;
//# sourceMappingURL=inlineProvider.js.map