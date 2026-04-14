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
exports.OllamaClient = void 0;
/**
 * Ollama API client for VS Code extension.
 * Handles streaming generation, connection checks, and retries.
 */
const http = __importStar(require("http"));
const config_1 = require("./config");
class OllamaClient {
    constructor() {
        const cfg = (0, config_1.getConfig)();
        this.baseUrl = cfg.ollamaUrl;
        this.model = cfg.model;
    }
    /** Reload settings (call when config changes). */
    reload() {
        const cfg = (0, config_1.getConfig)();
        this.baseUrl = cfg.ollamaUrl;
        this.model = cfg.model;
    }
    /** Check if Ollama server is reachable. */
    async checkConnection() {
        try {
            const url = new URL('/api/tags', this.baseUrl);
            return new Promise((resolve) => {
                const req = http.get(url, { timeout: 5000 }, (res) => {
                    resolve(res.statusCode === 200);
                    res.resume();
                });
                req.on('error', () => resolve(false));
                req.on('timeout', () => { req.destroy(); resolve(false); });
            });
        }
        catch {
            return false;
        }
    }
    /**
     * Generate a completion from Ollama with streaming.
     * Returns the full response text.
     */
    async generate(options) {
        const cfg = (0, config_1.getConfig)();
        const payload = JSON.stringify({
            model: this.model,
            prompt: options.prompt,
            system: options.system || '',
            stream: true,
            options: {
                temperature: options.temperature ?? cfg.temperature,
            },
        });
        const url = new URL('/api/generate', this.baseUrl);
        return new Promise((resolve, reject) => {
            const collected = [];
            const req = http.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
                timeout: 120_000,
            }, (res) => {
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (!line.trim()) {
                            continue;
                        }
                        try {
                            const data = JSON.parse(line);
                            const token = data.response || '';
                            if (token) {
                                collected.push(token);
                                options.onToken?.(token);
                            }
                            if (data.done) {
                                resolve(collected.join(''));
                                return;
                            }
                        }
                        catch {
                            // skip malformed lines
                        }
                    }
                });
                res.on('end', () => {
                    resolve(collected.join(''));
                });
                res.on('error', (err) => {
                    reject(new Error(`Ollama response error: ${err.message}`));
                });
            });
            // Handle abort signal
            if (options.signal) {
                options.signal.addEventListener('abort', () => {
                    req.destroy();
                    reject(new Error('Request aborted'));
                });
            }
            req.on('error', (err) => {
                reject(new Error(`Cannot connect to Ollama at ${this.baseUrl}. ` +
                    `Make sure it is running (ollama serve). Error: ${err.message}`));
            });
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Ollama request timed out (120s).'));
            });
            req.write(payload);
            req.end();
        });
    }
    /**
     * Non-streaming generation — simpler for inline completions.
     */
    async generateSimple(prompt, system) {
        const cfg = (0, config_1.getConfig)();
        const payload = JSON.stringify({
            model: this.model,
            prompt,
            system: system || '',
            stream: false,
            options: {
                temperature: cfg.temperature,
            },
        });
        const url = new URL('/api/generate', this.baseUrl);
        return new Promise((resolve, reject) => {
            const req = http.request(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                },
                timeout: 120_000,
            }, (res) => {
                let body = '';
                res.on('data', (chunk) => { body += chunk.toString(); });
                res.on('end', () => {
                    try {
                        const data = JSON.parse(body);
                        resolve(data.response || '');
                    }
                    catch {
                        resolve(body);
                    }
                });
                res.on('error', (err) => reject(err));
            });
            req.on('error', (err) => {
                reject(new Error(`Cannot connect to Ollama: ${err.message}`));
            });
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.write(payload);
            req.end();
        });
    }
}
exports.OllamaClient = OllamaClient;
//# sourceMappingURL=ollama.js.map