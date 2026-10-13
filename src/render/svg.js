// The shareable card: a thermal till receipt on a flat surface. Pure SVG, no fonts or
// images embedded. Text is laid on the same 42-column grid as the terminal receipt and
// each line is pinned to the paper width with textLength, so columns stay aligned in
// any monospace font.
import { WIDTH, buildLines, code39, receiptNumber } from './receipt.js';

export const THEMES = {
  paper: {
    surface: '#d8d4cb',
    paper: '#f7f5ef',
    ink: '#2a2925',
    accent: '#2a2925',
    shadow: 0.22,
    grain: 0.018,
  },
  // Standard Compute palette: navy surface, lifted panel, brass accents
  dark: {
    surface: '#141926',
    paper: '#1d2434',
    ink: '#e8e2d4',
    accent: '#c9a158',
    shadow: 0.5,
    grain: 0.018,
  },
};

const FONT = `'IBM Plex Mono','JetBrains Mono','SF Mono',SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono','Liberation Mono',monospace`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function renderSvg(report, { theme = 'paper' } = {}) {
  const T = THEMES[theme] || THEMES.paper;
  const PAPER_W = 384; // about 80 mm at 4.8 px/mm
  const PAD = 24;
  const CW = PAPER_W - PAD * 2; // 336 px = 42 columns of 8 px
  const FS = (CW / WIDTH) / 0.6; // monospace advance is 0.6 em in most fonts
  const LH = 19;
  const MARGIN = 64;
  const X0 = MARGIN;
  const L = X0 + PAD;
  const W = PAPER_W + MARGIN * 2;
  const tone = { ink: [T.ink, 400], bold: [T.ink, 700], faint: [T.ink, 400, 0.72], accent: [T.accent, 700] };

  const body = [];
  let y = MARGIN + 40;

  // Every run of characters is placed on its grid column and pinned to its grid width,
  // so alignment never depends on the font or on whitespace handling.
  const CHAR = CW / WIDTH;
  const textLine = (segs, { scaleX = 1, scaleY = 1 } = {}) => {
    const cells = WIDTH / segs.reduce((n, s) => n + s.text.length, 0); // 2 for double-width lines
    const cw = (CHAR * cells) / scaleX;
    const out = [];
    let col = 0;
    for (const s of segs) {
      const [fill, weight, opacity] = tone[s.tone] || tone.ink;
      // runs separated by 2+ spaces are placed separately so no renderer can collapse the gap
      for (const m of s.text.matchAll(/\S+(?: \S+)*/g)) {
        const t = m[0];
        const x = ((col + m.index) * cw).toFixed(2);
        const len = t.length > 1 ? ` textLength="${(t.length * cw).toFixed(2)}" lengthAdjust="spacing"` : '';
        out.push(`<text x="${x}" y="0"${len}${fill !== T.ink ? ` fill="${fill}"` : ''}${weight !== 400 ? ` font-weight="${weight}"` : ''}${opacity ? ` fill-opacity="${opacity}"` : ''}>${esc(t)}</text>`);
      }
      col += s.text.length;
    }
    const scale = scaleX !== 1 || scaleY !== 1 ? ` scale(${scaleX} ${scaleY})` : '';
    body.push(`<g transform="translate(${L} ${y.toFixed(1)})${scale}">${out.join('')}</g>`);
  };

  for (const line of buildLines(report)) {
    if (line.blank) {
      y += LH * 0.6;
    } else if (line.barcode) {
      // Code 39 of the receipt number, about 60% of the paper width
      const widths = code39(line.barcode);
      const units = widths.reduce((a, b) => a + b, 0);
      const unit = (PAPER_W * 0.6) / units;
      let x = X0 + (PAPER_W - units * unit) / 2;
      const rects = [];
      widths.forEach((w, i) => {
        if (i % 2 === 0) rects.push(`<rect x="${x.toFixed(2)}" y="${(y - 8).toFixed(1)}" width="${(w * unit).toFixed(2)}" height="40"/>`);
        x += w * unit;
      });
      body.push(`<g fill="${T.ink}">${rects.join('')}</g>`);
      y += 40 + 10;
    } else if (line.size === 'wide') {
      // double-width, double-height print, like a receipt printer's header mode
      y += LH * 0.9;
      textLine(line.segs, { scaleX: 2, scaleY: 2 });
      y += LH * 1.25;
    } else if (line.size === 'tall') {
      // double-height print for the total
      y += LH * 0.45;
      textLine(line.segs, { scaleY: 1.6 });
      y += LH * 1.35;
    } else {
      textLine(line.segs);
      y += LH;
    }
  }

  const top = MARGIN;
  const bottom = y + 6;
  const H = Math.ceil(bottom + MARGIN);
  const edge = tornEdges(X0, top, PAPER_W, bottom, receiptNumber(report));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Token receipt">
<defs>
<filter id="shadow" x="-10%" y="-5%" width="120%" height="110%"><feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="#000" flood-opacity="${T.shadow}"/></filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="7" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${T.grain * 6} -${T.grain * 2.4}"/><feComposite in2="SourceGraphic" operator="in"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="${T.surface}"/>
<path d="${edge}" fill="${T.paper}" filter="url(#shadow)"/>
<path d="${edge}" fill="#000" filter="url(#grain)"/>
<g font-family="${FONT}" font-size="${FS.toFixed(2)}" fill="${T.ink}" style="font-variant-numeric:tabular-nums">
${body.join('\n')}
</g>
</svg>
`;
}

/** Paper outline: straight blade cut at the top, irregular tear at the bottom (deterministic). */
function tornEdges(x0, top, w, bottom, seedHex) {
  let s = parseInt(seedHex, 16) || 1;
  const rnd = () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x6d2b79f5 >>> 0) / 2 ** 32);
  const pts = [];
  for (let x = w; x > 0; ) {
    pts.push([x0 + x, bottom + 1 + rnd() * 5]);
    x -= 3 + rnd() * 9;
  }
  pts.push([x0, bottom + 2 + rnd() * 3]);
  const f = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  return `M${x0} ${top}L${x0 + w} ${top}L${pts.map(f).join('L')}Z`;
}
