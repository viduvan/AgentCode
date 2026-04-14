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
exports.ContextBuilder = void 0;
/**
 * Context builder — gathers relevant code context from the editor.
 */
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
class ContextBuilder {
    /**
     * Build context from the current editor selection or entire file.
     */
    static fromSelection(editor) {
        const selection = editor.selection;
        const doc = editor.document;
        const cfg = (0, config_1.getConfig)();
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
    static fromDocument(doc) {
        const cfg = (0, config_1.getConfig)();
        const totalLines = doc.lineCount;
        const maxLines = cfg.maxContextLines;
        let content;
        if (totalLines <= maxLines) {
            content = doc.getText();
        }
        else {
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
    static forInlineCompletion(doc, position) {
        const cfg = (0, config_1.getConfig)();
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
    static async getProjectTree() {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return '(no workspace open)';
        }
        const root = folders[0].uri;
        const lines = [`📁 ${folders[0].name}/`];
        try {
            const entries = await vscode.workspace.fs.readDirectory(root);
            const sorted = entries.sort((a, b) => {
                if (a[1] !== b[1]) {
                    return a[1] === vscode.FileType.Directory ? -1 : 1;
                }
                return a[0].localeCompare(b[0]);
            });
            for (const [name, type] of sorted.slice(0, 30)) {
                if (name.startsWith('.') || name === 'node_modules' || name === '__pycache__') {
                    continue;
                }
                const icon = type === vscode.FileType.Directory ? '📁' : '📄';
                lines.push(`  ${icon} ${name}`);
            }
        }
        catch {
            // ignore
        }
        return lines.join('\n');
    }
}
exports.ContextBuilder = ContextBuilder;
//# sourceMappingURL=contextBuilder.js.map