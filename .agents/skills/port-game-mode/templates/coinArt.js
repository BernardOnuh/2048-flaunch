/**
 * The in-game coin render: a gold token with basketball seams and the ticker's initial.
 * Used wherever the launch carries no art — the HUD coin icon and the centre-court paint —
 * so a live launch without an image still reads as a branded coin, not a broken <img>.
 */
export function makeCoinRender(symbol) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const cx = S / 2, cy = S / 2;

  // coin body
  const body = g.createRadialGradient(cx - 34, cy - 40, 20, cx, cy, S / 2);
  body.addColorStop(0, '#ffe9a3');
  body.addColorStop(0.55, '#f2b53a');
  body.addColorStop(1, '#b97b12');
  g.fillStyle = body;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 4, 0, Math.PI * 2);
  g.fill();

  // milled rim
  g.strokeStyle = '#8a5a0c';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 8, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,240,190,.8)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(cx, cy, S / 2 - 16, 0, Math.PI * 2);
  g.stroke();

  // basketball seams, embossed into the face
  g.save();
  g.beginPath();
  g.arc(cx, cy, S / 2 - 22, 0, Math.PI * 2);
  g.clip();
  g.strokeStyle = 'rgba(138,90,12,.55)';
  g.lineWidth = 5;
  g.beginPath(); g.moveTo(cx, 22); g.lineTo(cx, S - 22); g.stroke();
  g.beginPath(); g.moveTo(22, cy); g.lineTo(S - 22, cy); g.stroke();
  g.beginPath(); g.arc(-26, cy, 132, -Math.PI / 2.6, Math.PI / 2.6); g.stroke();
  g.beginPath(); g.arc(S + 26, cy, 132, Math.PI - Math.PI / 2.6, Math.PI + Math.PI / 2.6); g.stroke();
  g.restore();

  // ticker initial, stamped
  const letter = (symbol || 'S').replace(/^\$/, '').charAt(0).toUpperCase() || 'S';
  g.font = `900 ${S * 0.5}px 'Arial Black', Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(120,74,8,.9)';
  g.lineWidth = 14;
  g.strokeText(letter, cx, cy + 8);
  g.fillStyle = '#fff3cf';
  g.fillText(letter, cx, cy + 8);

  return c.toDataURL('image/png');
}
