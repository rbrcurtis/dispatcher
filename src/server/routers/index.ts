import { router } from '../trpc';
import { cardsRouter } from './cards';
import { reposRouter } from './repos';

export const appRouter = router({
  cards: cardsRouter,
  repos: reposRouter,
});

export type AppRouter = typeof appRouter;
