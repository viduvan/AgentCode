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
exports.AgentCodeLensProvider = void 0;
/**
 * CodeLens Provider — show " Explain | Edit" actions above functions/classes.
 */
const vscode = __importStar(require("vscode"));
/**
 * Simple regex-based symbol detection for CodeLens.
 * Matches function/class definitions in common languages.
 */
const SYMBOL_PATTERNS = {
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
class AgentCodeLensProvider {
    constructor() {
        this._onDidChange = new vscode.EventEmitter();
        this.onDidChangeCodeLenses = this._onDidChange.event;
    }
    provideCodeLenses(document, _token) {
        const lenses = [];
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
                        title: 'Explain',
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
    refresh() {
        this._onDidChange.fire();
    }
}
exports.AgentCodeLensProvider = AgentCodeLensProvider;
//# sourceMappingURL=codeLens.js.map