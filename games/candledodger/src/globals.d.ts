/// <reference types="vite/client" />

// Window globals exposed by this module's QA hooks.
interface Window {
  __gm?: {
    room: import('@flayerlabs/gamemode-client').Room<any, any, any>;
    claim(seconds?: number, greens?: number): Promise<any>;
    resetFirstRun(): void;
  };
}
