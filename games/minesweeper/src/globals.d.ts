/// <reference types="vite/client" />

// Window globals exposed by the classic-script minesweeper game and this module's QA hooks.
interface Window {
  __ms_onReveal?: (cells: number) => void;
  __ms_forceReveal?: (cells: number) => void;
  __gm?: {
    room: import('@flayerlabs/gamemode-client').Room<any, any, any>;
    claim(cells?: number): Promise<any>;
    resetFirstRun(): void;
  };
}
