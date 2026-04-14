"""Prompt template for the EDIT action."""

EDIT_PROMPT = """## Task
Modify the following code according to this instruction:
**"{instruction}"**

{project_context}

## Instructions
1. Read the code carefully
2. Apply the requested changes
3. Return the COMPLETE modified file(s) inside fenced code blocks
4. Use the filename as the code block language tag, e.g.:
   ```path/to/file.py
   # complete file content here
   ```
5. Only modify what is necessary — do not rewrite unrelated code
6. If multiple files need changes, include a code block for each file
"""
