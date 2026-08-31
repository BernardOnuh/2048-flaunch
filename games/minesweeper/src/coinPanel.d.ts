export interface StandingsEntry {
  player: string;
  dollars: number;
  you?: boolean;
}

export class CoinPanel {
  constructor(root: HTMLElement, room: any);
  setCoin(symbol: string, name: string, imageSrc: string): void;
  renderStandings(entries: StandingsEntry[]): void;
  noteClaim(dollars: number): void;
  noteRefusal(code: string): void;
}
