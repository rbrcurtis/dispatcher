#!/usr/bin/env tsx
import Database from 'better-sqlite3';

const dbPath = process.argv.find((_, i, a) => a[i - 1] === '--db') ?? 'data/orchestrel.db';
const dryRun = process.argv.includes('--dry-run');

function main() {
  const db = new Database(dbPath);

  // Backfill: cards with use_worktree=1 but no worktree_branch get branch from title
  const needBranch = db
    .prepare('SELECT id, title FROM cards WHERE use_worktree = 1 AND worktree_branch IS NULL')
    .all() as { id: number; title: string }[];

  for (const row of needBranch) {
    const slug = row.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    console.log(`  card ${row.id}: set worktree_branch = '${slug}' (from title '${row.title}')`);
    if (!dryRun) {
      db.prepare('UPDATE cards SET worktree_branch = ? WHERE id = ?').run(slug, row.id);
    }
  }

  // Report cards with use_worktree=0 but worktree_branch set (keep branch as source of truth)
  const ambiguous = db
    .prepare('SELECT id, worktree_branch FROM cards WHERE use_worktree = 0 AND worktree_branch IS NOT NULL')
    .all() as { id: number; worktree_branch: string }[];

  if (ambiguous.length > 0) {
    console.log(`\nNote: ${ambiguous.length} card(s) have use_worktree=0 but worktree_branch set.`);
    console.log('Keeping worktree_branch (branch is source of truth).');
    for (const row of ambiguous) {
      console.log(`  card ${row.id}: keeping worktree_branch='${row.worktree_branch}'`);
    }
  }

  if (!dryRun) {
    console.log('\nDropping columns...');
    db.exec('ALTER TABLE cards DROP COLUMN worktree_path');
    console.log('  dropped worktree_path');
    db.exec('ALTER TABLE cards DROP COLUMN use_worktree');
    console.log('  dropped use_worktree');
  } else {
    console.log('\n[dry-run] Would drop columns: worktree_path, use_worktree');
  }

  db.close();
  console.log('Done.');
}

main();
