import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const output = fileURLToPath(new URL('.', import.meta.url));
const characters = [
  {
    id: 'chief-sun',
    name: 'Chief',
    note: 'A little pocket of sunshine',
    light: '#fff1b8',
    mid: '#edc970',
    dark: '#dba35d',
    cheek: '#d98c72',
  },
  {
    id: 'manager-atlas',
    name: 'Atlas',
    note: 'A world of quiet curiosity',
    light: '#dce7c7',
    mid: '#a7c8b5',
    dark: '#7fa49a',
    cheek: '#d89880',
  },
  {
    id: 'manager-juno',
    name: 'Juno',
    note: 'Keeping everyone in orbit',
    light: '#ffe4bc',
    mid: '#e6b28a',
    dark: '#c9917c',
    cheek: '#cf8876',
  },
  {
    id: 'manager-vega',
    name: 'Vega',
    note: 'Dreaming in lavender',
    light: '#e8dfed',
    mid: '#bcb2cf',
    dark: '#998eaf',
    cheek: '#d49a9e',
  },
];
const body =
  'M160 77 C206 74 246 111 247 159 C251 208 216 246 166 249 C116 253 76 221 73 174 C69 128 105 80 160 77Z';
const path = (d, attrs = '') => `<path d="${d}" ${attrs}/>`;

function drawing(c) {
  const id = c.id;
  const defs = `<defs>
    <radialGradient id="${id}-wash" cx=".28" cy=".22" r=".86"><stop stop-color="${c.light}"/><stop offset=".55" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.dark}"/></radialGradient>
    <radialGradient id="${id}-blush"><stop stop-color="${c.cheek}" stop-opacity=".7"/><stop offset="1" stop-color="${c.cheek}" stop-opacity="0"/></radialGradient>
    <filter id="${id}-edge" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".055" numOctaves="3" seed="8" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="1.15" xChannelSelector="R" yChannelSelector="G"/></filter>
    <filter id="${id}-pigment" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="4" seed="12"/><feColorMatrix type="matrix" values="0 0 0 0 .43  0 0 0 0 .32  0 0 0 0 .21  0 0 0 .2 0"/><feComposite in2="SourceGraphic" operator="in"/><feBlend in2="SourceGraphic" mode="multiply"/></filter>
    <filter id="${id}-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" seed="4"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".14"/></feComponentTransfer><feComposite in2="SourceGraphic" operator="in"/><feBlend in2="SourceGraphic" mode="soft-light"/></filter>
    <clipPath id="${id}-body">${path(body)}</clipPath>
  </defs>`;
  const ink =
    'fill="none" stroke="#80634e" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
  let back = '';
  let surface = '';
  let front = '';
  let accessory = '';
  if (id === 'chief-sun') {
    back =
      `<g fill="#e5bc73" stroke="#a78050" stroke-width="1.6" filter="url(#${id}-edge)">` +
      Array.from(
        { length: 12 },
        (_, i) =>
          `<g transform="rotate(${i * 30 + 3} 160 163)">${path('M155 54 C150 46 153 31 159 30 C166 29 170 44 166 53 Q161 58 155 54Z')}<path d="M158 36 Q157 44 160 50" fill="none" stroke="#fff0c3" stroke-width="2.5" opacity=".65"/></g>`,
      ).join('') +
      '</g>';
    surface = `<path d="M98 128 Q112 94 150 91" stroke="#fff4cd" stroke-width="11" opacity=".32" fill="none" stroke-linecap="round"/>
    <g fill="#bc8b51" opacity=".48"><circle cx="107" cy="181" r="1.6"/><circle cx="117" cy="184" r="1.2"/><circle cx="102" cy="188" r="1.1"/><circle cx="207" cy="180" r="1.6"/><circle cx="217" cy="184" r="1.2"/><circle cx="210" cy="189" r="1"/></g>`;
  }
  if (id === 'manager-atlas') {
    surface = `<g fill="#8da784" stroke="#78947b" stroke-width="1" opacity=".78" filter="url(#${id}-edge)">
      ${path('M80 124 L99 113 Q106 102 121 105 L127 118 L120 127 L130 136 L122 146 L128 158 L115 169 L112 184 L97 178 L91 160 L77 155Z')}
      ${path('M145 80 L148 96 L137 104 L129 98 L126 87Z')}
      ${path('M191 84 L181 98 L187 108 L177 120 L185 132 L202 127 L210 139 L229 134 L242 144 L255 117Z')}
      ${path('M181 193 Q193 186 209 191 L219 202 L209 218 L197 225 L188 243 L174 249 L173 233 L164 223 L167 207Z')}
      ${path('M86 191 L110 197 L123 214 L118 232 L105 238 L95 221Z')}
      ${path('M224 221 Q232 211 235 222 L230 233 L224 235Z')}
    </g><g fill="none" stroke="#f6efd1" stroke-width="1.7" opacity=".4"><path d="M111 114 l8 7 m-17 3 l7 7 m82-28 l9 6 m-19 113 l10 9 m2-23 l13 10"/></g>`;
    accessory = `<g ${ink}><path d="M76 151 L101 156 M219 153 L245 147"/><path d="M103 152 C105 138 122 133 135 139 C150 145 152 169 142 179 C130 191 107 182 103 169 Q100 160 103 152Z" fill="#fff9e7" fill-opacity=".14"/><path d="M172 149 C179 134 202 132 213 145 C224 158 219 179 205 183 C188 189 170 178 169 165 Q168 155 172 149Z" fill="#fff9e7" fill-opacity=".14"/><path d="M149 156 Q159 149 170 155"/><path d="M110 148 Q116 142 123 143 M180 146 Q185 141 191 141" stroke="#fff9df" stroke-width="2.5" opacity=".7"/></g>`;
  }
  if (id === 'manager-juno') {
    back = `<path d="M76 174 C19 182 27 151 90 123 C147 97 232 80 270 99 C292 110 274 139 245 156" fill="none" stroke="#9a7a59" stroke-width="20"/><path d="M76 174 C19 182 27 151 90 123 C147 97 232 80 270 99 C292 110 274 139 245 156" fill="none" stroke="#e4cea1" stroke-width="17"/><path d="M77 174 C24 180 31 153 91 126 C153 98 230 85 268 101" fill="none" stroke="#f7e6bc" stroke-width="5"/>`;
    surface = `<g fill="none" stroke-linecap="round"><path d="M80 114 Q153 144 236 107" stroke="#fff0d2" stroke-width="12" opacity=".35"/><path d="M74 127 Q157 159 245 120" stroke="#cc9d7d" stroke-width="2" opacity=".35"/><path d="M86 207 Q166 229 242 190" stroke="#f3d2ac" stroke-width="17" opacity=".5"/></g>`;
    front = `<g fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}-edge)"><path d="M38 160 C16 194 78 217 171 188 C231 170 275 143 278 117" stroke="#947553" stroke-width="22"/><path d="M38 160 C16 194 78 217 171 188 C231 170 275 143 278 117" stroke="#ead6ae" stroke-width="19"/><path d="M34 167 C30 193 90 203 169 179 C225 162 266 139 274 119" stroke="#fff0cc" stroke-width="4" opacity=".85"/><path d="M48 189 Q97 208 181 181" stroke="#c6a97c" stroke-width="1.2" opacity=".75"/></g>`;
  }
  if (id === 'manager-vega') {
    surface = `<g fill="none" filter="url(#${id}-edge)"><path d="M75 121 C137 154 208 132 246 110" stroke="#e2d8e7" stroke-width="17" opacity=".72"/><path d="M77 132 C137 164 213 143 248 121" stroke="#9e91ad" stroke-width="1.5" opacity=".65"/><path d="M71 200 C128 224 201 216 251 187" stroke="#e4d9e5" stroke-width="18" opacity=".8"/><path d="M74 210 Q161 241 247 202" stroke="#9489a6" stroke-width="1.4" opacity=".7"/></g>`;
    accessory = `<g stroke="#735751" stroke-linejoin="round" stroke-linecap="round" filter="url(#${id}-edge)"><path d="M180 70 Q172 58 184 48" fill="none" stroke-width="5"/><path d="M133 79 C123 69 132 53 152 51 C184 44 225 63 233 82 C243 104 215 111 186 103 C166 99 142 88 133 79Z" fill="#a67978" stroke-width="2"/><path d="M136 72 Q171 82 196 94 Q217 101 230 93" fill="none" stroke-width="3"/><path d="M143 61 Q166 52 189 66" fill="none" stroke="#c69a94" stroke-width="6" opacity=".6"/><path d="M211 78 l3 5 6 1-4 4 1 6-6-3-5 2 1-6-4-4 6-1Z" fill="#ecd49c" stroke-width="1"/></g>`;
  }
  const hatch = Array.from({ length: 27 }, (_, i) => {
    const x = 105 + i * 5.7;
    const y = 238 - Math.max(0, i - 8) * 2.7;
    return path(
      `M${x.toFixed(1)} ${y.toFixed(1)} l9 -13`,
      'stroke="#87664d" stroke-width=".85" opacity=".15"',
    );
  }).join('');
  const faceY = id === 'manager-juno' ? -12 : 0;
  const eyes =
    id === 'chief-sun'
      ? '<path d="M124 159 Q130 149 137 159 M180 157 Q187 148 193 157" fill="none" stroke="#70513e" stroke-width="3.6" stroke-linecap="round"/>'
      : '<ellipse cx="130" cy="159" rx="4.8" ry="7.1" fill="#6d5146" transform="rotate(-5 130 159)"/><ellipse cx="190" cy="157" rx="4.5" ry="7" fill="#6d5146" transform="rotate(6 190 157)"/><g fill="#fff6db" opacity=".9"><circle cx="129" cy="157" r="1.3"/><circle cx="189" cy="155" r="1.2"/></g>';
  const face = `<g transform="translate(0 ${faceY})"><ellipse cx="112" cy="177" rx="22" ry="14" fill="url(#${id}-blush)"/><ellipse cx="211" cy="174" rx="22" ry="14" fill="url(#${id}-blush)"/>${eyes}<path d="M150 177 Q160 188 171 175" fill="none" stroke="#73503f" stroke-width="2.8" stroke-linecap="round"/><path d="M158 169 l3 1" fill="none" stroke="#ab8063" stroke-width="1.6" stroke-linecap="round"/><g stroke="#a37161" stroke-width=".9" opacity=".5"><path d="M104 175 l-1 4 m6-5 -1 4 m102-7 -1 4 m6-5 -1 4"/></g></g>`;
  return `${defs}<g stroke-linecap="round" stroke-linejoin="round">${back}<g filter="url(#${id}-grain)"><g filter="url(#${id}-pigment)">${path(body, `fill="url(#${id}-wash)" stroke="#967958" stroke-width="1.9" filter="url(#${id}-edge)"`)}<g clip-path="url(#${id}-body)">${surface}<path d="M86 177 C99 225 143 246 197 229 C221 222 238 205 249 184 L254 254 H73Z" fill="${c.dark}" opacity=".15"/>${hatch}<path d="M89 127 C101 100 123 88 146 87" fill="none" stroke="#fff9e1" stroke-width="2" opacity=".65"/><path d="M92 198 Q104 225 132 235 M212 227 Q231 213 238 192" fill="none" stroke="#937351" stroke-width=".8" opacity=".4"/></g></g>${face}${accessory}${front}</g></g>`;
}

for (const c of characters) {
  writeFileSync(
    `${output}${c.id}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" role="img" aria-labelledby="${c.id}-title ${c.id}-desc"><title id="${c.id}-title">${c.name} — storybook portrait</title><desc id="${c.id}-desc">${c.note}. A softly painted planet character with irregular brown pencil outlines, warm light and delicate paper grain. Transparent background.</desc>${drawing(c)}</svg>\n`,
  );
}

const landscape = `<g stroke="#9b9775" stroke-width="1.4" stroke-linejoin="round">
<path d="M0 720 Q175 639 340 718 Q501 649 668 721 Q876 626 1058 705 Q1196 664 1400 713 V900 H0Z" fill="#d9ddc2" stroke="none"/>
<path d="M0 785 Q218 681 433 789 Q652 675 877 773 Q1121 698 1400 756 V900 H0Z" fill="#c5ceb1" stroke="none"/>
<path d="M0 842 Q267 759 505 847 Q835 743 1069 838 Q1237 788 1400 827 V900 H0Z" fill="#b4c09e" stroke="none"/>
<path d="M719 900 Q713 818 814 753 Q730 815 799 900" fill="#e5d5ad" stroke="none"/>
<g transform="translate(110 737)"><path d="M0 5 L40-22 83 4 V58 H0Z" fill="#e9d7ae"/><path d="M-8 7 L38-29 91 6 82 12 39-17 0 14Z" fill="#b88d75"/><path d="M31 58 V27 Q43 16 54 27 V58" fill="#a49c7c"/><path d="M8 25 H21 V38 H8Z" fill="#f8edc9"/><path d="M14 25 V38 M8 31 H21"/><path d="M68-7 V-31 H77 V0" fill="#b88d75"/></g>
<g fill="#a2b396"><path d="M1134 807 V746" fill="none"/><path d="M1109 760 Q1090 740 1107 726 Q1103 702 1127 700 Q1148 688 1161 711 Q1189 716 1177 741 Q1183 762 1163 768Z"/><path d="M1213 825 V780" fill="none"/><path d="M1189 784 Q1173 763 1191 748 Q1189 726 1215 728 Q1245 725 1243 753 Q1261 780 1236 788Z"/></g>
<g fill="none" opacity=".65"><path d="M265 792 l109-17 m-97 0 1 33 m28-38 1 34 m27-39 1 34 m27-39 1 31"/><path d="M982 819 l91 9 m-80-21 -2 29 m30-24 -2 30 m30-25 -2 29"/></g>
<g fill="#f7edc9" stroke="none"><ellipse cx="425" cy="777" rx="14" ry="10"/><ellipse cx="449" cy="784" rx="11" ry="8"/></g><g fill="#8b8065" stroke="none"><ellipse cx="436" cy="778" rx="4" ry="5"/><ellipse cx="458" cy="785" rx="3" ry="4"/></g>
<g fill="none" opacity=".5"><path d="M42 862 l-3-14 m3 10 7-9 m288 13 -2-14 m2 10 7-6 m654 36 -3-14 m3 8 7-10 m311 5 -3-16 m3 10 7-7"/></g></g>`;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="900" viewBox="0 0 1400 900" role="img" aria-labelledby="sheet-title sheet-desc"><title id="sheet-title">Tian — Little worlds, warm hearts</title><desc id="sheet-desc">Four storybook portraits: Chief the golden sun, Atlas the sage Earth with spectacles, Juno the apricot Saturn and Vega the lavender planet with a rose beret. A quiet farm landscape borders the paper.</desc><defs><filter id="paper"><feTurbulence type="fractalNoise" baseFrequency=".6" numOctaves="3" seed="2"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".10"/></feComponentTransfer><feBlend in2="SourceGraphic" mode="multiply"/></filter><radialGradient id="sunlight" cx=".25" cy=".05" r=".9"><stop stop-color="#fff8e4"/><stop offset="1" stop-color="#f0e8d6"/></radialGradient></defs><rect width="1400" height="900" fill="url(#sunlight)"/><g fill="#78654f" text-anchor="middle"><text x="700" y="82" font-family="Georgia,serif" font-size="14" letter-spacing="5">T I A N  /  THE STORYBOOK EDITION</text><text x="700" y="158" font-family="Georgia,serif" font-size="54">Little worlds, warm hearts.</text><text x="700" y="199" font-family="Georgia,serif" font-style="italic" font-size="19" fill="#9b8770">A small sky full of familiar friends.</text></g><path d="M654 233 Q699 238 746 232" fill="none" stroke="#cbb58e" stroke-width="1.2"/>
${characters.map((c, i) => `<g transform="translate(${40 + i * 340} 283)">${drawing(c)}<text x="160" y="347" text-anchor="middle" font-family="Georgia,serif" font-size="29" fill="#705d4a">${c.name}</text><text x="160" y="375" text-anchor="middle" font-family="Georgia,serif" font-style="italic" font-size="15" fill="#96816b">${c.note}</text></g>`).join('\n')}
${landscape}<rect width="1400" height="900" fill="#f7ecd5" opacity=".22" filter="url(#paper)" pointer-events="none"/><text x="700" y="865" text-anchor="middle" font-family="Georgia,serif" font-size="12" letter-spacing="3" fill="#6c765e">WATERCOLOUR · PENCIL · A LITTLE SUNSHINE</text></svg>`;
writeFileSync(`${output}storybook-sheet.svg`, `${sheet}\n`);
console.log('Wrote four transparent portraits and storybook-sheet.svg.');
