/**
 * The in-game coin render: a dark neon coin with the ticker's digits stamped.
 * Used wherever the launch carries no art — the HUD coin icon and the game paint —
 * so a launch without an image still reads as a branded coin, not a broken <img>.
 */
export function makeCoinRender(symbol) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, cy = S / 2;

  // coin body — dark glass with a neon glow
  const body = g.createRadialGradient(cx - 30, cy - 40, 20, cx, cy, S / 2);
  body.addColorStop(0, '#3a2b3f');
  body.addColorStop(0.5, '#231a28');
  body.addColorStop(1, '#0e0b12');
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 4, 0, Math.PI * 2);
  g.fill();

  // neon rim
  g.strokeStyle = '#3ddc84';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,95,143,.7)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 16, 0, Math.PI * 2);
  g.stroke();

  // ticker, stamped into the face
  const digits = /[0-9]/.test(symbol || '') ? symbol.replace(/[^0-9]/g, '') : '';
  const text = digits.slice(0, 4) || 'DODGE';
  g.font = `900 ${S * 0.4}px 'Arial Black', Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,.9)';
  g.lineWidth = 16;
  g.strokeText(text, cx, cy + 8);
  g.fillStyle = '#3ddc84';
  g.fillText(text, cx, cy + 8);

  return c.toDataURL('image/png');
}
