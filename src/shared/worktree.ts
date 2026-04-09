export function resolveWorkDir(worktreeBranch: string | null, projectPath: string): string {
  return worktreeBranch ? `${projectPath}/.worktrees/${worktreeBranch}` : projectPath;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
