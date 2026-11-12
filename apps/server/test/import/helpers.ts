import sharp from 'sharp';

/** A small JPEG as a base64 data URL, colored so that different colors give different files. */
export async function jpegDataUrl(color: string, width = 40, height = 20): Promise<string> {
  const bytes = await sharp({ create: { width, height, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

/** JSON safe inside <script>: `</` is written as `<\/`, as in the author's files. */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/<\//g, '<\\/');

const TIMELINE = `<div class="timeline"><div class="seg"><b>0–2</b><span>приветствие</span></div><div class="seg"><b>2–5</b><span>цель</span></div><div class="seg show"><b>5–15</b><span>теория</span></div><div class="seg pc"><b>15–37</b><span>практика: 9 + отдых 4 + 9</span></div><div class="seg"><b>37–42</b><span>рефлексия</span></div><div class="seg"><b>42–45</b><span>итог</span></div></div>`;

/** Minimal children's and teacher's files in the author's format: two lessons, all screen kinds. */
export async function authorFiles(): Promise<{ kids: string; teacher: string }> {
  const red = await jpegDataUrl('#ff0000');
  const blue = await jpegDataUrl('#0000ff');
  const green = await jpegDataUrl('#00ff00');
  const slide = (stage: string, body: string): string =>
    `<div class="s-text"><div class="s-stage">${stage}</div><h2>T</h2></div><div class="s-fig">${body}</div>`;
  const apps = [
    {
      id: 'g10',
      group: 'Информатика',
      title: 'Урок',
      sub: 'Подзаголовок',
      num: 10,
      icon: '<svg viewBox="0 0 2 2"><rect width="2" height="2"/></svg>',
      teacher: 't.html#g10',
      screens: [
        {
          t: 'slide',
          cls: 'title',
          html: '<div class="s-title"><h1 onclick="x()">Урок</h1></div>',
        },
        {
          t: 'slide',
          cls: 'text',
          html: slide('Приветствие', '<svg viewBox="0 0 1190 725"><use href="#a01"/></svg>'),
        },
        {
          t: 'slide',
          cls: 'text wide',
          html: slide(
            'Теоретическая часть',
            '<svg><rect fill="url(#dsk)"/></svg><script>alert(1)</script>',
          ),
        },
        { t: 'type', q: 'Что?', pic: '<svg viewBox="0 0 2 2"></svg>', word: 'СОК', n: 1, of: 1 },
        {
          t: 'game',
          n: 1,
          stage: 'Практическая часть',
          lv: { type: 'story', stars: 1, say: 'По порядку', cards: ['sun', 'rain'] },
        },
        {
          t: 'game',
          n: 2,
          stage: 'Практическая часть',
          lv: {
            type: 'pick',
            stars: 1,
            say: 'Выбери',
            opts: [
              ['pic', 'sun'],
              ['abc', 0],
              ['txt', 'да'],
            ],
            ok: 0,
          },
        },
        { t: 'slide', cls: 'text', html: slide('Рефлексия', '') },
        { t: 'slide', cls: 'text', html: slide('Заключение', '') },
      ],
    },
    {
      id: 'k10',
      group: 'Кружок · Paint',
      title: 'Радуга',
      sub: '',
      num: 10,
      icon: '<svg viewBox="0 0 2 2"></svg>',
      teacher: 't.html#k10',
      screens: [
        { t: 'slide', cls: 'title', html: '<div class="s-title"><h1>Радуга</h1></div>' },
        {
          t: 'slide',
          cls: 'step',
          html: `<div class="s-text"><div class="s-stage">Практическая часть</div><div class="s-num">Шаг 3</div><span class="stars" title="уровень 2">★★</span></div><svg><use href="#s02" x="10"/></svg>`,
        },
        {
          t: 'slide',
          cls: 'step',
          html: `<div class="s-text"><div class="s-stage">Практическая часть</div><div class="s-num">Шаг 4</div><span class="stars free">свободное</span></div><svg><use href="#a01"/></svg>`,
        },
      ],
    },
  ];
  const pics = {
    sun: '<svg viewBox="0 0 2 2"></svg>',
    rain: '<svg viewBox="0 0 2 2" onload="x()"></svg>',
  };
  const kids = `<!DOCTYPE html><html><head><style>.slide{color:#000}</style></head><body>
<svg width="0" height="0"><defs><linearGradient id="dsk"><stop offset="0"/></linearGradient><image id="a01" x="0" y="0" width="1190" height="725" href="${red}"/><image id="s02" x="0" y="0" width="1190" height="725" href="${blue}"/><image id="unused" href="${green}"/></defs></svg>
<script>const TITLE = "1 класс · II четверть", TEACHER = "t.html", APPS = ${scriptJson(apps)}, PICS = ${scriptJson(pics)}, ABC = ["А"], ABCC = ["#e53935"];
console.log(APPS.length);</script></body></html>`;
  const scenario = (title: string): string =>
    `<!DOCTYPE html><html><head><style>h1{color:red}</style></head><body><svg width="0" height="0"><defs><image id="g01" x="0" y="0" width="1190" height="725" href="${red}"/></defs></svg><header><div class="top-btns"><button data-open="0">▶</button><button onclick="window.print()">Печать</button></div></header><h1>${title}</h1>${TIMELINE}<figure><svg viewBox="0 0 1190 725"><use href="#g01"/></svg></figure><div id="deck" hidden><section class="slide"><svg><use href="#g01"/></svg></section></div><script>(function(){})();</script></body></html>`;
  const teacher = `<!DOCTYPE html><html><body>
<script type="application/json" id="d-g10">${scriptJson(scenario('g10'))}</script>
<script type="application/json" id="d-k10">${scriptJson(scenario('k10'))}</script>
<script>const IT = [{"id": "g10", "k": false}, {"id": "k10", "k": true}];</script></body></html>`;
  return { kids, teacher };
}
