/**
 * The in-game coin render: a pink-and-white coin with the ticker's digits embossed.
 * Used wherever the launch carries no art — the HUD coin icon and the game-board paint —
 * so a launch without an image still reads as a branded coin, not a broken <img>.
 */
export function makeCoinRender(symbol) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, cy = S / 2;

  // coin body — pink-and-white
  const body = g.createRadialGradient(cx - 30, cy - 40, 20, cx, cy, S / 2);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.4, '#ffe6ee');
  body.addColorStop(1, '#ff7fa8');
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 4, 0, Math.PI * 2);
  g.fill();

  // milled rim
  g.strokeStyle = '#e63e75';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.9)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 16, 0, Math.PI * 2);
  g.stroke();

  // ticker, stamped into the face
  const digits = /[0-9]/.test(symbol || '') ? symbol.replace(/[^0-9]/g, '') : '';
  const text = digits.slice(0, 4) || 'MINE';
  g.font = `900 ${S * 0.4}px 'Arial Black', Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255,255,255,.95)';
  g.lineWidth = 14;
  g.strokeText(text, cx, cy + 8);
  g.fillStyle = '#a3244f';
  g.fillText(text, cx, cy + 8);

  return c.toDataURL('image/png');
}
