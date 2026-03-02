import { router } from '../trpc';
import { cardsRouter } from './cards';
import { claudeRouter } from './claude';
import { reposRouter } from './repos';

export const appRouter = router({
  cards: cardsRouter,
  claude: claudeRouter,
  repos: reposRouter,
});

export type AppRouter = typeof appRouter;
