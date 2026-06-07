# Project Extensions

Files in this directory are project-specific. They are NEVER overwritten by sync.sh.

## How to extend

- **Custom agents:** Drop .md files in agents/ — they appear alongside base agents
- **Custom rules:** Drop .md files in rules/ — auto-loaded with base rules (same name = override)
- **Custom skills:** Drop directories with SKILL.md in skills/ — appear alongside base skills
- **Custom hooks:** Drop .sh files in hooks/, register in settings.local.json
