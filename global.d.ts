import { Axie } from './src/services/marketplaceService';
import { SweepPreview } from './src/services/sweepService';

declare global {
  namespace NodeJS {
    interface Global {
      /**
       * Stores an Axie object for use across test functions
       */
      testAxie: Axie | null;
      
      /**
       * Stores a sweep preview for use in mock execution tests
       */
      sweepPreview: SweepPreview | null;
    }
  }
}

// This export is needed to make this a module
export {};
