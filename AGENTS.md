# Project development rules

## Language

- Use English for all content maintained in this directory, including source code, comments, documentation, development rules, skill metadata, configuration text, test fixtures, file names, and directory names.
- Chinese text and Chinese characters must not appear in this directory. Check changed file contents and names before delivering changes.

## TypeScript

For TypeScript development, refactoring, engineering reviews, and related CLI, template, test, or npm distribution work, follow the local [TypeScript engineering guidelines](.agents/skills/typescript-quality/SKILL.md). Read that file before starting a relevant task and load its linked references as needed.

- The local guidelines are authoritative for this repository. When they differ from the global skill of the same name, use the local version. Global guidance may supplement topics not covered locally; explicit instructions from the user take precedence.
- Maintain additions and revisions directly in `.agents/skills/typescript-quality/`, and review and version them with the project code.
- Keep an independent local copy rather than a symlink to a global directory. Review differences before importing global updates and preserve project-specific changes.
