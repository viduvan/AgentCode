/**
 * Configuration helper — reads VS Code settings for Agent Code.
 */
import * as vscode from 'vscode';

export interface AgentCodeConfig {
    ollamaUrl: string;
    model: string;
    inlineEnabled: boolean;
    inlineDelay: number;
    temperature: number;
    maxContextLines: number;
}

export function getConfig(): AgentCodeConfig {
    const cfg = vscode.workspace.getConfiguration('agentCode');
    return {
        ollamaUrl: cfg.get<string>('ollamaUrl', 'http://localhost:11434'),
        model: cfg.get<string>('model', 'deepseek-coder-v2:16b'),
        inlineEnabled: cfg.get<boolean>('inlineEnabled', true),
        inlineDelay: cfg.get<number>('inlineDelay', 600),
        temperature: cfg.get<number>('temperature', 0.1),
        maxContextLines: cfg.get<number>('maxContextLines', 100),
    };
}
