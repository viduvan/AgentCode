"""Prompt template for the EXPLAIN action."""

EXPLAIN_PROMPT = """## Task
Explain the following code clearly and concisely. ALWAYS respond in Vietnamese.

{project_context}

## Instructions
1. Describe what the code does at a high level
2. Explain the key functions/classes and their roles
3. Describe the data flow and control flow
4. Point out any notable design patterns or techniques
5. Use clear, simple language
6. Structure your explanation with headings and bullet points
7. Do NOT suggest changes — only explain what exists
8. IMPORTANT: Your entire response MUST be in Vietnamese (tiếng Việt)
"""
