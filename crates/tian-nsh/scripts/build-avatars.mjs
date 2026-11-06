import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Bake the browser SVG's CSS into presentation attributes for NSH's resvg.
// Geometry, expressions, accessories, and colours always come from the study.
const source = await readFile(
  new URL('../../../docs/design/avatars-svg/avatars.js', import.meta.url),
  'utf8',
);
const output = new URL('../assets/avatars/', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'tian-avatars-'));
try {
  const page = join(temp, 'avatars.html');
  await writeFile(
    page,
    `<!doctype html><body><script>${source}</script><script>
const entries = {};
const characters = [
  {id:'chief',kind:'sun',accessory:'none'},
  {id:'atlas',kind:'earth',accessory:'glasses'},
  {id:'juno',kind:'saturn',accessory:'none'},
  {id:'vega',kind:'neptune',accessory:'beret'},
];
const canvas = document.createElement('canvas'); canvas.width=canvas.height=1;
const context = canvas.getContext('2d', {willReadFrequently:true});
function colour(value) {
  if (value === 'none' || value.startsWith('url(')) return value;
  context.clearRect(0,0,1,1); context.fillStyle = value; context.fillRect(0,0,1,1);
  const [r,g,b,a] = context.getImageData(0,0,1,1).data;
  return 'rgba('+[r,g,b,a/255].join(',')+')';
}
for (const character of characters) for (const state of TianAvatar.states) {
  const holder = document.createElement('div'); document.body.append(holder);
  holder.innerHTML=TianAvatar.render({...character,state,motion:'reduced'});
  const svg=holder.firstElementChild;
  const nodes = [svg,...svg.querySelectorAll('*')].filter(node=>!['style','title'].includes(node.localName));
  const values=nodes.map(node=>{
    const s=getComputedStyle(node); const attrs={};
    for (const key of ['fill','stroke','stop-color']) attrs[key]=colour(s.getPropertyValue(key));
    for (const key of ['opacity','fill-opacity','stroke-opacity','stroke-width','stroke-linecap','stroke-linejoin']) attrs[key]=s.getPropertyValue(key);
    if (s.transform!=='none') {
      const [x,y]=s.transformOrigin.split(' ').map(parseFloat);
      attrs.transform=new DOMMatrix().translate(x,y).multiply(new DOMMatrix(s.transform)).translate(-x,-y).toString();
    }
    return attrs;
  });
  nodes.forEach((node,i)=>{
    node.removeAttribute('style'); node.removeAttribute('class');
    for(const [key,value] of Object.entries(values[i])) if(value) node.setAttribute(key,value);
  });
  svg.querySelectorAll('style,title').forEach(node=>node.remove());
  entries[character.id+'-'+state+'.svg']=svg.outerHTML;
  holder.remove();
}
document.body.replaceChildren(); const result=document.createElement('pre');
result.textContent=JSON.stringify(entries); document.body.append(result);
</script>`,
  );
  const chrome =
    process.env.TIAN_CHROME ??
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const result = spawnSync(
    chrome,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--use-mock-keychain',
      '--timeout=15000',
      `--user-data-dir=${join(temp, 'profile')}`,
      '--dump-dom',
      `file://${page}`,
    ],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(result.stderr);
  const match = result.stdout.match(/<pre>([\s\S]*?)<\/pre>/);
  if (!match) throw new Error('Chrome did not return baked SVGs');
  const entries = JSON.parse(
    match[1]
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&'),
  );
  await mkdir(output, { recursive: true });
  for (const [name, svg] of Object.entries(entries))
    await writeFile(new URL(name, output), svg + '\n');
  const names = Object.keys(entries).sort();
  const manifest =
    names
      .map((name, i) => `import avatar${i} from './assets/avatars/${name}';`)
      .join('\n') +
    "\n\nexport const avatarSources: Record<string, import('nsh').ImageAsset> = {\n" +
    names.map((name, i) => `  '${name.slice(0, -4)}': avatar${i},`).join('\n') +
    '\n};\n';
  await writeFile(new URL('../avatar-sources.ts', import.meta.url), manifest);
  console.log(`Baked ${Object.keys(entries).length} native SVG identities`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
