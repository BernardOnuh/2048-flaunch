/**
 * The in-game coin render: a gold 2048 tile with the ticker's digits embossed.
 * Used wherever the launch carries no art — the HUD coin icon and the game-board paint —
 * so a launch without an image still reads as a branded coin, not a broken <img>.
 */
export function makeCoinRender(symbol) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, cy = S / 2;

  // tile body — the warm 2048 tile palette
  const body = g.createRadialGradient(cx - 30, cy - 40, 20, cx, cy, S / 2);
  body.addColorStop(0, '#f9f6f2');
  body.addColorStop(0.4, '#ede0c8');
  body.addColorStop(1, '#b8873a');
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 4, 0, Math.PI * 2);
  g.fill();

  // milled rim like a 2048 tile edge
  g.strokeStyle = '#8e6b2f';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,246,230,.8)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 16, 0, Math.PI * 2);
  g.stroke();

  // ticker, stamped into the face
  const digits = /[0-9]/.test(symbol || '') ? symbol.replace(/[^0-9]/g, '') : '2048';
  const text = digits.slice(0, 4) || '2048';
  g.font = `900 ${S * 0.4}px 'Arial Black', Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(120,74,8,.9)';
  g.lineWidth = 14;
  g.strokeText(text, cx, cy + 8);
  g.fillStyle = '#6d4b1f';
  g.fillText(text, cx, cy + 8);

  return c.toDataURL('image/png');
}
