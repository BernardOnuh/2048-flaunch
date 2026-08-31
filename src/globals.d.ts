/// <reference types="vite/client" />

// Window globals exposed by the classic-script 2048 game and this module's QA hooks.
interface Window {
  __gm_manager?: any;
  __gm_manager_mode?: any;
  __gm?: {
    room: import('@flayerlabs/gamemode-client').Room<any, any, any>;
    claim(batch?: number): Promise<any>;
    resetFirstRun(): void;
  };
}

// The classic-script 2048 manager shape this integration reads.
interface GameManagerShape {
  onMove?: (score: number) => void;
  score: number;
}
