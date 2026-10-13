// PNG export without runtime dependencies: hands the SVG to a converter that is
// already installed (rsvg-convert, resvg, or a headless Chrome/Chromium/Edge).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHROMES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'microsoft-edge',
];

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'ignore', timeout: 60000 });
}

function sizeOf(svg) {
  const m = /width="(\d+)" height="(\d+)"/.exec(svg);
  return m ? [+m[1], +m[2]] : [512, 1024];
}

/** Writes `out` as a 2x PNG. Returns the converter used; throws with a hint if none works. */
export function writePng(svg, out, scale = 2) {
  out = resolve(out);
  rmSync(out, { force: true });
  const dir = mkdtempSync(join(tmpdir(), 'tokenreceipt-'));
  const src = join(dir, 'receipt.svg');
  writeFileSync(src, svg);
  const [w, h] = sizeOf(svg);
  try {
    const attempts = [
      ['rsvg-convert', () => run('rsvg-convert', ['-z', String(scale), '-o', out, src])],
      ['resvg', () => run('resvg', ['--zoom', String(scale), src, out])],
      ...CHROMES.filter(Boolean)
        .filter((c) => !/[\\/]/.test(c) || existsSync(c))
        .map((c) => [
          c.split(/[\\/]/).pop(),
          () =>
            run(c, [
              '--headless',
              '--disable-gpu',
              '--hide-scrollbars',
              `--force-device-scale-factor=${scale}`,
              `--window-size=${w},${h}`,
              `--screenshot=${out}`,
              pathToFileURL(src).href,
            ]),
        ]),
    ];
    for (const [name, fn] of attempts) {
      try {
        fn();
        if (existsSync(out)) return name;
      } catch {
        // try the next converter
      }
    }
    throw new Error('no SVG converter found; install rsvg-convert (librsvg) or Chrome, or open the --svg file in a browser and screenshot it');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
