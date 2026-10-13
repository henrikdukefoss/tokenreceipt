import { buildLines } from './receipt.js';

export function renderTerminal(report, { color = false } = {}) {
  const sgr = { ink: '', bold: '1', faint: '2', accent: '1' };
  const paint = (text, tone) => (color && sgr[tone] && text.trim() ? `\x1b[${sgr[tone]}m${text}\x1b[0m` : text);
  const out = [];
  for (const line of buildLines(report)) {
    if (line.blank) {
      out.push('');
    } else if (line.barcode) {
      // a terminal cell is too coarse for a scannable barcode; the caption line below carries the number
      continue;
    } else if (line.size === 'wide') {
      // double-width print: one character spread over two cells
      out.push(line.segs.map((s) => paint(s.text.split('').map((c) => c + ' ').join(''), s.tone)).join('').trimEnd());
    } else {
      out.push(line.segs.map((s) => paint(s.text, s.tone)).join('').trimEnd());
    }
  }
  return out.join('\n') + '\n';
}
