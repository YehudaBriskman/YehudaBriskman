#!/usr/bin/env node
/*
 * readme-art: animated, terminal-styled SVG panels for a GitHub README.
 *
 *   node scripts/readme-art.mjs [--user YehudaBriskman] [--out assets] [--palette violet|green]
 *
 * Writes into --out:
 *   hero.svg           a typed prompt, a blinking cursor and the roles
 *   contributions.svg  the year's contribution grid, drawn in cell by cell
 *   whoami.svg         an ASCII portrait that scans in (assets/portrait.txt), beside stat
 *                      cards and a monthly bar chart that grow in
 *
 * Why SVG: GitHub shows a README <img> through its camo proxy. CSS @keyframes
 * and CSS animations survive it; scripts, web fonts and external requests do
 * not. So every file here is one self-contained SVG: system monospace fonts,
 * CSS animation only, and @media (prefers-reduced-motion) switches it all off.
 *
 * Data: the GraphQL contributionCalendar of --user. The token comes from
 * GH_TOKEN / GITHUB_TOKEN, else `gh auth token`. No dependencies.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const USER = arg("user", "YehudaBriskman");
const OUT = join(here, "..", arg("out", "assets"));
const PALETTE = arg("palette", "violet");
const ROLES = arg("roles", "Full-Stack Engineer|Technical Lead|Product Builder").split("|");
const NAME = arg("name", "Yehuda Briskman");

/* ------------------------------------------------------------- palette -- */

const PALETTES = {
  violet: { levels: ["#1b1f2a", "#3a2a6e", "#5b3fb8", "#8a63f2", "#c3a8ff"], accent: "#a78bfa", hot: "#5eead4" },
  green: { levels: ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"], accent: "#39d353", hot: "#7ee787" },
};
const P = PALETTES[PALETTE] ?? PALETTES.violet;
const C = {
  bg: "#0b0e14",
  panel: "#0f131b",
  card: "#121722",
  line: "#232a38",
  text: "#e6edf3",
  dim: "#8b95a7",
  faint: "#5b6475",
};
const FONT = "ui-monospace,'SF Mono','JetBrains Mono',SFMono-Regular,Menlo,Consolas,'DejaVu Sans Mono','Liberation Mono',monospace";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (n) => n.toLocaleString("en-US");
const dayLabel = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;

/* ---------------------------------------------------------------- data -- */

function token() {
  const t = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (t) return t;
  return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
}

async function calendar() {
  const query = `query($login:String!){ user(login:$login){ contributionsCollection{ contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } } } }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", "User-Agent": "readme-art" },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const body = await res.json();
  const cal = body?.data?.user?.contributionsCollection?.contributionCalendar;
  if (!res.ok || !cal) throw new Error(`GitHub GraphQL failed: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
  return { total: cal.totalContributions, weeks: cal.weeks.map((w) => w.contributionDays) };
}

/** Streaks, best day, active days and per-month totals from the calendar. */
export function stats(cal) {
  const days = cal.weeks.flat();
  const today = days.at(-1).date;
  let longest = { n: 0, from: null, to: null };
  let run = { n: 0, from: null };
  for (const d of days) {
    if (d.contributionCount > 0) {
      if (run.n === 0) run.from = d.date;
      run.n += 1;
      if (run.n > longest.n) longest = { n: run.n, from: run.from, to: d.date };
    } else run = { n: 0, from: null };
  }
  /* The current streak survives a zero today: the day is not over yet. */
  let i = days.length - 1;
  if (days[i].contributionCount === 0) i -= 1;
  let cur = { n: 0, from: null, to: i >= 0 ? days[i].date : null };
  for (; i >= 0 && days[i].contributionCount > 0; i -= 1) cur = { n: cur.n + 1, from: days[i].date, to: cur.to };
  const active = days.filter((d) => d.contributionCount > 0);
  const best = active.reduce((a, d) => (d.contributionCount > (a?.contributionCount ?? 0) ? d : a), null);
  const byMonth = new Map();
  for (const d of days) {
    const key = d.date.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + d.contributionCount);
  }
  const months = [...byMonth].map(([key, n]) => ({ key, label: MONTHS[+key.slice(5)-1], n })).slice(-12);
  return {
    total: cal.total,
    today,
    from: days[0].date,
    spanDays: days.length,
    activeDays: active.length,
    current: cur,
    longest,
    best,
    avg: active.length ? cal.total / active.length : 0,
    months,
  };
}

/* --------------------------------------------------------- shared bits -- */

const CSS_BASE = `
  text{font-family:${FONT}}
  @media (prefers-reduced-motion: reduce){*{animation:none!important}.rise,.pop,.grow,.line,.fade{opacity:1!important;transform:none!important}.type-clip{width:100%!important}}
`;

function window_(w, h, title, body, defs = "") {
  return `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="12" fill="${C.panel}" stroke="${C.line}"/>
  <path d="M0.5 12.5a12 12 0 0 1 12-12h${w - 25}a12 12 0 0 1 12 12V34H0.5z" fill="#141a26"/>
  <line x1="0.5" y1="34.5" x2="${w - 0.5}" y2="34.5" stroke="${C.line}"/>
  <circle cx="20" cy="18" r="5.5" fill="#ff5f57"/><circle cx="38" cy="18" r="5.5" fill="#febc2e"/><circle cx="56" cy="18" r="5.5" fill="#28c840"/>
  <text x="${w / 2}" y="22" text-anchor="middle" font-size="11.5" fill="${C.dim}">${esc(title)}</text>${defs}${body}`;
}

/** A prompt line that types itself in: `user@github ~ $ cmd`. */
function prompt(cx, y, cmd, { delay = 0, size = 15, id }) {
  const chars = `${USER.toLowerCase()}@github ~ $ ${cmd}`.length;
  const tw = chars * size * 0.6; // monospace advance, pinned below with textLength
  const x = Math.round(cx - tw / 2); // centred on cx
  const dur = Math.max(0.5, chars * 0.045);
  return `<clipPath id="${id}"><rect class="type-clip" x="${x - 2}" y="${y - size - 2}" width="0" height="${size + 10}" style="animation:type ${dur}s steps(${chars},end) ${delay}s forwards;--w:${Math.ceil(tw) + 6}px"/></clipPath>
  <text x="${x}" y="${y}" font-size="${size}" font-weight="700" textLength="${tw.toFixed(1)}" lengthAdjust="spacing" clip-path="url(#${id})"><tspan fill="${P.accent}">${esc(USER.toLowerCase())}@github</tspan><tspan fill="${C.dim}"> ~ </tspan><tspan fill="${P.hot}">$ </tspan><tspan fill="${C.text}">${esc(cmd)}</tspan></text>`;
}

const KEYFRAMES = `
  @keyframes type{to{width:var(--w)}}
  @keyframes pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}
  @keyframes rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
  @keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
  @keyframes fade{from{opacity:0}to{opacity:1}}
  @keyframes blink{0%,49%{opacity:1}50%,100%{opacity:0}}
  @keyframes glow{0%,100%{opacity:1}50%{opacity:.55}}
  @keyframes scan{from{transform:translateY(-8px);opacity:0}8%{opacity:.9}to{transform:translateY(var(--h));opacity:0}}
`;

const svg = (w, h, title, css, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <style>${KEYFRAMES}${CSS_BASE}${css}</style>
  ${inner}
</svg>
`;

/* ---------------------------------------------------------------- hero -- */

function hero() {
  const W = 960;
  const H = 160;
  const roles = ROLES.map(esc);
  /* Each role types in, holds, and is replaced: one clip per role on its own loop slice. */
  const slice = 3.2;
  const total = slice * roles.length;
  const css = roles
    .map((_, i) => {
      const a = ((i * slice) / total) * 100;
      const b = a + (1.6 / total) * 100;
      const c = a + ((slice - 0.5) / total) * 100;
      const d = ((i + 1) * slice) / total * 100;
      return `@keyframes role${i}{0%,${a.toFixed(2)}%{width:0}${b.toFixed(2)}%,${c.toFixed(2)}%{width:var(--w)}${Math.min(d, 100).toFixed(2)}%,100%{width:${i === roles.length - 1 ? "var(--w)" : "0"}}}`;
    })
    .join("");
  const roleText = roles
    .map((r, i) => {
      const w = Math.ceil(ROLES[i].length * 28 * 0.6) + 8;
      return `<clipPath id="role-clip-${i}"><rect x="64" y="64" height="48" width="0" class="type-clip" style="animation:role${i} ${total}s steps(${ROLES[i].length},end) infinite;--w:${w}px"/></clipPath>
  <text x="64" y="100" font-size="28" font-weight="700" fill="${C.text}" clip-path="url(#role-clip-${i})">${r}</text>`;
    })
    .join("\n  ");
  return svg(
    W,
    H,
    `${NAME}: ${ROLES.join(", ")}`,
    css + `.cursor{animation:blink 1s steps(1) infinite}`,
    window_(
      W,
      H,
      `~/${USER.toLowerCase()}`,
      `${prompt(W / 2, 58, "whoami", { id: "p-hero", size: 15 })}
  <g class="rise" style="animation:rise .6s ease-out .9s both"><text x="${W / 2}" y="104" text-anchor="middle" font-size="32" font-weight="800" fill="${P.accent}">${esc(NAME)}</text></g>
  <g class="rise" style="animation:rise .6s ease-out 1.3s both"><text x="${W / 2}" y="132" text-anchor="middle" font-size="14" fill="${C.dim}">${roles.join(`  <tspan fill="${C.faint}">·</tspan>  `)}</text></g>
  <rect class="cursor" x="${Math.round(W / 2 + (NAME.length * 32 * 0.6) / 2 + 8)}" y="82" width="14" height="26" fill="${P.hot}"/>`,
    ),
  );
}

/* ------------------------------------------------------- contributions -- */

function contributions(cal, s) {
  const W = 960;
  const cell = 13;
  const pitch = 16;
  const x0 = 62;
  const y0 = 112;
  const H = y0 + 7 * pitch + 58;
  const max = Math.max(1, ...cal.weeks.flat().map((d) => d.contributionCount));
  const level = (n) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const cells = [];
  const labels = [];
  let lastMonth = -1;
  cal.weeks.forEach((week, wi) => {
    const first = week[0];
    const m = +first.date.slice(5, 7) - 1;
    if (m !== lastMonth && wi < cal.weeks.length - 2) {
      labels.push(`<text x="${x0 + wi * pitch}" y="${y0 - 10}" font-size="11" fill="${C.dim}">${MONTHS[m]}</text>`);
      lastMonth = m;
    }
    week.forEach((d, di) => {
      const lv = level(d.contributionCount);
      const delay = (1.0 + wi * 0.022 + di * 0.012).toFixed(3);
      const hot = lv === 4 ? `;animation-name:pop,glow;animation-duration:.4s,3.2s;animation-delay:${delay}s,${(+delay + 1.5 + (wi % 7) * 0.4).toFixed(2)}s;animation-iteration-count:1,infinite` : `;animation-delay:${delay}s`;
      cells.push(
        `<rect class="pop" x="${x0 + wi * pitch}" y="${y0 + di * pitch}" width="${cell}" height="${cell}" rx="3" fill="${P.levels[lv]}" style="animation:pop .4s cubic-bezier(.2,.9,.3,1.3) both${hot}"><title>${d.contributionCount} on ${dayLabel(d.date)}</title></rect>`,
      );
    });
  });
  const dayLabels = [1, 3, 5].map((d) => `<text x="${x0 - 12}" y="${y0 + d * pitch + 10.5}" text-anchor="end" font-size="11" fill="${C.dim}">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]}</text>`).join("");
  const gridW = cal.weeks.length * pitch;
  const legend = [0, 1, 2, 3, 4].map((l, i) => `<rect x="${x0 + gridW - 5 * pitch - 40 + i * pitch}" y="${y0 + 7 * pitch + 14}" width="${cell}" height="${cell}" rx="3" fill="${P.levels[l]}"/>`).join("");
  return svg(
    W,
    H,
    `${fmt(s.total)} contributions in the last year`,
    "",
    window_(
      W,
      H,
      `~/${USER.toLowerCase()}/contributions.sh`,
      `${prompt(W / 2, 66, "./contributions.sh", { id: "p-contrib" })}
  ${labels.join("")}${dayLabels}
  ${cells.join("\n  ")}
  <g class="fade" style="animation:fade .6s ease-out ${(1.0 + cal.weeks.length * 0.022).toFixed(2)}s both">
    <text x="${x0}" y="${y0 + 7 * pitch + 24}" font-size="13" font-weight="700" fill="${C.text}">${fmt(s.total)} <tspan font-weight="400" fill="${C.dim}">contributions in the last year</tspan></text>
    <text x="${x0 + gridW - 5 * pitch - 70}" y="${y0 + 7 * pitch + 24}" text-anchor="end" font-size="11" fill="${C.dim}">less</text>
    ${legend}
    <text x="${x0 + gridW - 5 * pitch + 44}" y="${y0 + 7 * pitch + 24}" font-size="11" fill="${C.dim}">more</text>
  </g>
  <rect x="${x0}" y="${y0 - 4}" width="${gridW}" height="2" rx="1" fill="${P.hot}" opacity="0" style="animation:scan 2.4s ease-in 1s 1 both;--h:${7 * pitch + 6}px"/>`,
    ),
  );
}

/* -------------------------------------------------------------- whoami -- */

function whoami(s) {
  const W = 960;
  const H = 520;
  const lx = 16;
  const lw = 452;
  const rx = 484;
  const rw = 460;
  const top = 46;
  const ph = H - top - 16;

  /* Left: the portrait, a line at a time, with a bright scan line sweeping down it. */
  let portrait = "";
  const txt = join(OUT, "portrait.txt");
  if (existsSync(txt)) {
    const lines = readFileSync(txt, "utf8").replace(/\s+$/, "").replace(/^(\s*\n)+/, "").split("\n");
    const cols = Math.max(...lines.map((l) => l.length));
    const fs = Math.min(13, (lw - 32) / (cols * 0.6), (ph - 90) / (lines.length * 1.667));
    const lh = fs * 1.667;
    const cw = fs * 0.6;
    const y0 = top + 44 + (ph - 44 - lines.length * lh) / 2;
    portrait = lines
      .map((l, i) => {
        if (!l.trim()) return "";
        return `<text class="line" xml:space="preserve" x="${lx + (lw - cols * cw) / 2}" y="${y0 + i * lh}" font-size="${fs.toFixed(2)}" textLength="${(l.length * cw).toFixed(1)}" lengthAdjust="spacing" fill="${P.accent}" style="animation:fade .25s ease-out ${(0.9 + i * 0.035).toFixed(3)}s both">${esc(l)}</text>`;
      })
      .join("\n    ");
    portrait += `\n    <rect x="${lx + 12}" y="${y0 - lh}" width="${lw - 24}" height="2" rx="1" fill="${P.hot}" opacity="0" style="animation:scan ${(lines.length * 0.035).toFixed(2)}s linear .9s 1 both;--h:${(lines.length * lh).toFixed(0)}px"/>`;
  }

  /* Right: six stat cards and the monthly bars. */
  const cw = (rw - 16 * 3) / 2;
  const ch = 76;
  const card = (i, label, value, unit, sub, hot) => {
    const cx = rx + 16 + (i % 2) * (cw + 16);
    const cy = top + 52 + Math.floor(i / 2) * (ch + 12);
    return `<g class="rise" style="animation:rise .55s ease-out ${(0.8 + i * 0.12).toFixed(2)}s both">
      <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="8" fill="${C.card}" stroke="${C.line}"/>
      <text x="${cx + 14}" y="${cy + 20}" font-size="11" fill="${C.dim}">$ ${esc(label)}</text>
      <text x="${cx + 14}" y="${cy + 51}" font-size="30" font-weight="800" fill="${hot ? P.hot : C.text}">${esc(value)}<tspan font-size="13" font-weight="400" fill="${C.dim}"> ${esc(unit)}</tspan></text>
      <text x="${cx + 14}" y="${cy + 68}" font-size="10.5" fill="${C.faint}">${esc(sub)}</text>
    </g>`;
  };
  const span = (a) => (a.from ? `${dayLabel(a.from)} – ${dayLabel(a.to)}` : "no streak yet");
  const cards = [
    card(0, "current streak", fmt(s.current.n), s.current.n === 1 ? "day" : "days", span(s.current), true),
    card(1, "longest streak", fmt(s.longest.n), s.longest.n === 1 ? "day" : "days", span(s.longest), false),
    card(2, "contributions", fmt(s.total), "", "in the last year", false),
    card(3, "active days", fmt(s.activeDays), `/ ${s.spanDays}`, `${Math.round((s.activeDays / s.spanDays) * 100)}% of the year`, false),
    card(4, "best day", fmt(s.best?.contributionCount ?? 0), "", s.best ? dayLabel(s.best.date) : "n/a", false),
    card(5, "avg / active day", s.avg.toFixed(1), "", "contributions", false),
  ].join("\n    ");

  const by = top + 52 + 3 * (ch + 12);
  const bh = H - 16 - by;
  const maxM = Math.max(1, ...s.months.map((m) => m.n));
  const bw = (rw - 32 - 16) / s.months.length;
  const baseY = by + bh - 24;
  const barMax = bh - 24 - 34;
  const bars = s.months
    .map((m, i) => {
      const h = Math.max(2, (m.n / maxM) * barMax);
      const x = rx + 24 + i * bw;
      const isMax = m.n === maxM;
      return `<g><rect class="grow" x="${x.toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${(bw - 5).toFixed(1)}" height="${h.toFixed(1)}" rx="2.5" fill="${isMax ? P.hot : P.levels[3]}" style="transform-box:fill-box;transform-origin:bottom;animation:grow .7s cubic-bezier(.2,.9,.3,1) ${(1.5 + i * 0.07).toFixed(2)}s both"><title>${m.label}: ${fmt(m.n)}</title></rect>
      <text x="${(x + (bw - 5) / 2).toFixed(1)}" y="${baseY + 15}" text-anchor="middle" font-size="10" fill="${C.faint}">${m.label[0]}</text>
      ${isMax ? `<text class="fade" x="${(x + (bw - 5) / 2).toFixed(1)}" y="${(baseY - h - 6).toFixed(1)}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${P.hot}" style="animation:fade .4s ease-out 2.4s both">${fmt(m.n)}</text>` : ""}</g>`;
    })
    .join("\n      ");
  const chart = `<g class="rise" style="animation:rise .55s ease-out 1.4s both">
      <rect x="${rx + 16}" y="${by}" width="${rw - 32}" height="${bh}" rx="8" fill="${C.card}" stroke="${C.line}"/>
      <text x="${rx + 30}" y="${by + 20}" font-size="11" fill="${C.dim}">$ contributions / month</text>
    </g>
    ${bars}`;

  return svg(
    W,
    H,
    `${NAME}: stats from the last year`,
    "",
    `<rect x="${lx}" y="0.5" width="${lw}" height="${H - 1}" rx="12" fill="${C.panel}" stroke="${C.line}"/>
  <rect x="${rx}" y="0.5" width="${rw}" height="${H - 1}" rx="12" fill="${C.panel}" stroke="${C.line}"/>
  <path d="M${lx} 12.5a12 12 0 0 1 12-12h${lw - 24}a12 12 0 0 1 12 12V34H${lx}z" fill="#141a26"/>
  <path d="M${rx} 12.5a12 12 0 0 1 12-12h${rw - 24}a12 12 0 0 1 12 12V34H${rx}z" fill="#141a26"/>
  <g><circle cx="${lx + 20}" cy="18" r="5" fill="#ff5f57"/><circle cx="${lx + 36}" cy="18" r="5" fill="#febc2e"/><circle cx="${lx + 52}" cy="18" r="5" fill="#28c840"/>
  <circle cx="${rx + 20}" cy="18" r="5" fill="#ff5f57"/><circle cx="${rx + 36}" cy="18" r="5" fill="#febc2e"/><circle cx="${rx + 52}" cy="18" r="5" fill="#28c840"/></g>
  <text x="${lx + lw / 2}" y="22" text-anchor="middle" font-size="11" fill="${C.dim}">~/portrait.sh</text>
  <text x="${rx + rw / 2}" y="22" text-anchor="middle" font-size="11" fill="${C.dim}">~/stats.sh</text>
  ${prompt(lx + lw / 2, top + 22, "whoami", { id: "p-who", size: 14 })}
  ${prompt(rx + rw / 2, top + 22, "./stats.sh", { id: "p-stats", size: 14 })}
  ${portrait}
  ${cards}
  ${chart}`,
  );
}

/* ----------------------------------------------------------------- run -- */

const cal = await calendar();
const s = stats(cal);
mkdirSync(OUT, { recursive: true });
const files = { "hero.svg": hero(), "contributions.svg": contributions(cal, s), "whoami.svg": whoami(s) };
for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body);
console.log(`wrote ${Object.keys(files).join(", ")} to ${OUT}: ${fmt(s.total)} contributions, streak ${s.current.n}, longest ${s.longest.n}`);
