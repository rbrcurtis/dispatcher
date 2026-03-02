import { z } from 'zod';
import { router, publicProcedure } from '../trpc';
import { repos } from '../db/schema';
import { eq } from 'drizzle-orm';
import { readdir } from 'fs/promises';
import { join } from 'path';

export const reposRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(repos);
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      displayName: z.string().min(1),
      path: z.string().min(1),
      host: z.enum(['github', 'bitbucket']),
      setupCommands: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [repo] = await ctx.db.insert(repos).values(input).returning();
      return repo;
    }),

  update: publicProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).optional(),
      displayName: z.string().min(1).optional(),
      path: z.string().min(1).optional(),
      host: z.enum(['github', 'bitbucket']).optional(),
      setupCommands: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const [repo] = await ctx.db.update(repos)
        .set(data)
        .where(eq(repos.id, id))
        .returning();
      return repo;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(repos).where(eq(repos.id, input.id));
    }),

  // Directory browser for selecting repo paths
  browse: publicProcedure
    .input(z.object({ path: z.string() }))
    .query(async ({ input }) => {
      try {
        const entries = await readdir(input.path, { withFileTypes: true });
        const dirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .map(e => ({
            name: e.name,
            path: join(input.path, e.name),
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        const isGitRepo = entries.some(e => e.name === '.git' && e.isDirectory());
        return { dirs, isGitRepo, currentPath: input.path };
      } catch {
        return { dirs: [], isGitRepo: false, currentPath: input.path, error: 'Cannot read directory' };
      }
    }),
});
