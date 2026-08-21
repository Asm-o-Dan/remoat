import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger';

export interface ScannedSkill {
    name: string;
    description: string;
    filePath: string;
    source: 'user' | 'builtin' | 'workspace';
}

/**
 * Parses simple YAML frontmatter from a SKILL.md file.
 */
function parseSkillFile(filePath: string, source: 'user' | 'builtin' | 'workspace'): ScannedSkill | null {
    try {
        if (!fs.existsSync(filePath)) return null;
        const content = fs.readFileSync(filePath, 'utf-8');

        let name = '';
        let description = '';

        // Check for YAML frontmatter between --- and ---
        const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (fmMatch) {
            const fm = fmMatch[1];
            const nameMatch = fm.match(/^name:\s*(.+)$/m);
            if (nameMatch) {
                name = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
            }

            // Match multiline or single line description
            const descMatch = fm.match(/^description:\s*(?:>-|>)?\r?\n?([\s\S]*?)(?=\r?\n[a-zA-Z0-9_-]+:|$)/m);
            if (descMatch) {
                description = descMatch[1]
                    .split(/\r?\n/)
                    .map(line => line.trim())
                    .filter(Boolean)
                    .join(' ');
            }
        }

        // Fallback: derive name from folder name if frontmatter name is missing
        if (!name) {
            name = path.basename(path.dirname(filePath));
        }

        // Fallback description from first paragraph after heading
        if (!description) {
            const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').trim();
            const lines = body.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
            for (const line of lines) {
                if (!line.startsWith('#')) {
                    description = line.slice(0, 150);
                    break;
                }
            }
        }

        if (!name) return null;

        return {
            name,
            description: description || 'No description available.',
            filePath,
            source,
        };
    } catch (e) {
        logger.debug(`[skillsScanner] Failed to parse ${filePath}:`, e);
        return null;
    }
}

/**
 * Recursively scans a root directory for folders containing SKILL.md.
 */
function scanSkillsDirectory(rootDir: string, source: 'user' | 'builtin' | 'workspace'): ScannedSkill[] {
    const results: ScannedSkill[] = [];
    if (!fs.existsSync(rootDir)) return results;

    try {
        const entries = fs.readdirSync(rootDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const skillMdPath = path.join(rootDir, entry.name, 'SKILL.md');
                if (fs.existsSync(skillMdPath)) {
                    const parsed = parseSkillFile(skillMdPath, source);
                    if (parsed) results.push(parsed);
                } else {
                    // Check subdirectories 1 level deeper
                    try {
                        const subEntries = fs.readdirSync(path.join(rootDir, entry.name), { withFileTypes: true });
                        for (const sub of subEntries) {
                            if (sub.isDirectory()) {
                                const deepSkillPath = path.join(rootDir, entry.name, sub.name, 'SKILL.md');
                                if (fs.existsSync(deepSkillPath)) {
                                    const parsed = parseSkillFile(deepSkillPath, source);
                                    if (parsed) results.push(parsed);
                                }
                            }
                        }
                    } catch {}
                }
            }
        }
    } catch (e) {
        logger.debug(`[skillsScanner] Error scanning directory ${rootDir}:`, e);
    }

    return results;
}

/**
 * Scans all Antigravity skill directories dynamically.
 * Discovers user skills, builtin skills, and workspace-scoped skills.
 */
export function scanInstalledSkills(workspacePath?: string): ScannedSkill[] {
    const skillsMap = new Map<string, ScannedSkill>();
    const home = os.homedir();

    // 1. Builtin skills
    const builtinDir = path.join(home, '.gemini', 'antigravity', 'builtin', 'skills');
    const builtinSkills = scanSkillsDirectory(builtinDir, 'builtin');
    for (const s of builtinSkills) {
        skillsMap.set(s.name.toLowerCase(), s);
    }

    // 2. User config skills
    const userConfigDir = path.join(home, '.gemini', 'config', 'skills');
    const userSkills = scanSkillsDirectory(userConfigDir, 'user');
    for (const s of userSkills) {
        skillsMap.set(s.name.toLowerCase(), s);
    }

    // 3. Workspace skills (if provided)
    if (workspacePath) {
        const wsSkillsDir = path.join(workspacePath, '.gemini', 'skills');
        const wsSkills = scanSkillsDirectory(wsSkillsDir, 'workspace');
        for (const s of wsSkills) {
            skillsMap.set(s.name.toLowerCase(), s);
        }
    }

    const allSkills = Array.from(skillsMap.values());
    allSkills.sort((a, b) => a.name.localeCompare(b.name));
    return allSkills;
}
