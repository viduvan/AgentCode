/**
 * Intent Router — classifies user messages into actionable intents.
 *
 * Uses a lightweight LLM call to determine what the user wants,
 * then routes to the appropriate handler.
 */
import { OllamaClient } from './ollama';
import { INTENT_SYSTEM, buildIntentPrompt } from './prompts';

export type IntentType = 'chat' | 'explain' | 'edit' | 'generate' | 'review' | 'plan';
export type Complexity = 'simple' | 'complex';

export interface IntentResult {
    intent: IntentType;
    confidence: number;
    targetFile: string | null;
    instruction: string;
    complexity: Complexity;
}

/**
 * Default fallback if LLM classification fails.
 */
function fallbackIntent(userMessage: string): IntentResult {
    return {
        intent: 'chat',
        confidence: 0.5,
        targetFile: null,
        instruction: userMessage,
        complexity: 'simple',
    };
}

export class IntentRouter {
    constructor(private ollama: OllamaClient) {}

    /**
     * Classify a user message into an intent.
     *
     * @param userMessage The raw user message
     * @param activeFile Currently open file path (if any)
     * @param hasSelection Whether the user has code selected
     */
    async classify(
        userMessage: string,
        activeFile?: string,
        hasSelection?: boolean,
    ): Promise<IntentResult> {
        const prompt = buildIntentPrompt(userMessage, activeFile, hasSelection);

        try {
            const raw = await this.ollama.generateSimple(prompt, INTENT_SYSTEM);
            return this.parseResponse(raw, userMessage);
        } catch (err) {
            console.error('[IntentRouter] Classification failed:', err);
            return fallbackIntent(userMessage);
        }
    }

    /**
     * Parse the LLM JSON response into a typed IntentResult.
     */
    private parseResponse(raw: string, originalMessage: string): IntentResult {
        try {
            // Try to extract JSON from the response (LLM may add extra text)
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.warn('[IntentRouter] No JSON found in response:', raw);
                return fallbackIntent(originalMessage);
            }

            const parsed = JSON.parse(jsonMatch[0]);

            // Validate required fields
            const validIntents: IntentType[] = ['chat', 'explain', 'edit', 'generate', 'review', 'plan'];
            const intent = validIntents.includes(parsed.intent) ? parsed.intent : 'chat';

            return {
                intent,
                confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
                targetFile: parsed.targetFile || null,
                instruction: parsed.instruction || originalMessage,
                complexity: parsed.complexity === 'complex' ? 'complex' : 'simple',
            };
        } catch (err) {
            console.warn('[IntentRouter] Failed to parse JSON:', err, raw);
            return fallbackIntent(originalMessage);
        }
    }
}
