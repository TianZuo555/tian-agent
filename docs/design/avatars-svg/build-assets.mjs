import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './avatars.js';

const { render, states, stateInfo } = globalThis.TianAvatar;
const characters = [
  { kind: 'sun', accessory: 'none', state: 'thinking', name: 'chief-sun' },
  {
    kind: 'earth',
    accessory: 'glasses',
    state: 'reading',
    name: 'manager-atlas',
  },
  { kind: 'saturn', accessory: 'none', state: 'working', name: 'manager-juno' },
  {
    kind: 'neptune',
    accessory: 'beret',
    state: 'sleeping',
    name: 'manager-vega',
  },
];
const archive = {};
for (const character of characters) {
  await writeFile(
    new URL(`./${character.name}.svg`, import.meta.url),
    render(character),
  );
  for (const state of states) {
    archive[`${character.name}/${state}.svg`] = render({ ...character, state });
  }
}
archive['README.txt'] =
  `Tian SVG avatars: 4 characters x ${states.length} states.\nEach SVG is self-contained, with a transparent background and CSS animations.\nChange --planet-color on the root SVG to recolour its surface and details.\nSystem reduced-motion preferences are respected. Use a modern browser.\n\n${states.map((state) => `${state}: ${stateInfo[state][0]} — ${stateInfo[state][2]}`).join('\n')}\n`;
const result = spawnSync(
  'python3',
  [
    '-c',
    [
      'import json, sys, zipfile, xml.etree.ElementTree as ET',
      'entries = json.load(sys.stdin)',
      'with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as archive:',
      '    for name, content in entries.items():',
      '        if name.endswith(".svg"): ET.fromstring(content)',
      '        archive.writestr(name, content)',
      'print(f"Validated and archived {len(entries)-1} SVG states")',
    ].join('\n'),
    fileURLToPath(new URL('./all-states.zip', import.meta.url)),
  ],
  {
    input: JSON.stringify(archive),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  },
);
if (result.status !== 0)
  throw new Error(result.error?.message || result.stderr);
console.log(result.stdout.trim());
