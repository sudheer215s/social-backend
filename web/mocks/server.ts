import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Node (Vitest) MSW server. */
export const server = setupServer(...handlers);
