/**
 * Ollama API client for VS Code extension.
 * Handles streaming generation, connection checks, and retries.
 */
import * as http from 'http';
import { getConfig } from './config';

export interface GenerateOptions {
    prompt: string;
    system?: string;
    temperature?: number;
    onToken?: (token: string) => void;
    signal?: AbortSignal;
}

export class OllamaClient {
    private baseUrl: string;
    private model: string;

    constructor() {
        const cfg = getConfig();
        this.baseUrl = cfg.ollamaUrl;
        this.model = cfg.model;
    }

    /** Reload settings (call when config changes). */
    reload(): void {
        const cfg = getConfig();
        this.baseUrl = cfg.ollamaUrl;
        this.model = cfg.model;
    }

    /** Check if Ollama server is reachable. */
    async checkConnection(): Promise<boolean> {
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
        } catch {
            return false;
        }
    }

    /**
     * Generate a completion from Ollama with streaming.
     * Returns the full response text.
     */
    async generate(options: GenerateOptions): Promise<string> {
        const cfg = getConfig();
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

        return new Promise<string>((resolve, reject) => {
            const collected: string[] = [];

            const req = http.request(
                url,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload),
                    },
                    timeout: 120_000,
                },
                (res) => {
                    let buffer = '';

                    res.on('data', (chunk: Buffer) => {
                        buffer += chunk.toString();
                        const lines = buffer.split('\n');
                        buffer = lines.pop() || '';

                        for (const line of lines) {
                            if (!line.trim()) { continue; }
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
                            } catch {
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
                },
            );

            // Handle abort signal
            if (options.signal) {
                options.signal.addEventListener('abort', () => {
                    req.destroy();
                    reject(new Error('Request aborted'));
                });
            }

            req.on('error', (err) => {
                reject(new Error(
                    `Cannot connect to Ollama at ${this.baseUrl}. ` +
                    `Make sure it is running (ollama serve). Error: ${err.message}`
                ));
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
    async generateSimple(prompt: string, system?: string): Promise<string> {
        const cfg = getConfig();
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

        return new Promise<string>((resolve, reject) => {
            const req = http.request(
                url,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload),
                    },
                    timeout: 120_000,
                },
                (res) => {
                    let body = '';
                    res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
                    res.on('end', () => {
                        try {
                            const data = JSON.parse(body);
                            resolve(data.response || '');
                        } catch {
                            resolve(body);
                        }
                    });
                    res.on('error', (err) => reject(err));
                },
            );

            req.on('error', (err) => {
                reject(new Error(`Cannot connect to Ollama: ${err.message}`));
            });
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.write(payload);
            req.end();
        });
    }
}
