/**
 * LivingCanvas brand rasters: favicons, app icons, favicon.ico and the
 * share preview og.jpg, from apps/web/public/brand/{icon,wordmark-light}.svg + the default plan panels.
 * Run after tools/brand/wordmark.py:  node tools/brand/render.mjs   (sharp comes from packages/shared)
 */
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createRequire } from 'node:module';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const sharp = createRequire(path.join(ROOT, 'packages/shared/package.json'))('sharp');
const B = path.join(ROOT, 'apps/web/public/brand'), SRC = path.join(ROOT, 'tools/brand/src');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));

// ── icons ──
const r=(src,n,out)=>sharp(fs.readFileSync(src),{density:Math.max(72,n*72/64*4)}).resize(n,n).png({compressionLevel:9,palette:n<=48}).toFile(out);
await r(`${B}/icon.svg`,16,`${B}/favicon-16.png`);
await r(`${B}/icon.svg`,32,`${B}/favicon-32.png`);
await r(`${B}/icon.svg`,48,`${TMP}/fav48.png`);
await r(`${SRC}/apple-touch.svg`,180,`${B}/apple-touch-icon.png`);
await r(`${B}/icon.svg`,192,`${B}/icon-192.png`);
await r(`${B}/icon.svg`,512,`${B}/icon-512.png`);
await r(`${SRC}/maskable.svg`,512,`${B}/maskable-512.png`);
// favicon.ico with embedded PNGs (16/32/48)
const imgs=[16,32,48].map(n=>[n,fs.readFileSync(n===48?`${TMP}/fav48.png`:`${B}/favicon-${n}.png`)]);
const head=Buffer.alloc(6); head.writeUInt16LE(0,0); head.writeUInt16LE(1,2); head.writeUInt16LE(imgs.length,4);
let off=6+16*imgs.length; const dir=[];
for(const [n,b] of imgs){const e=Buffer.alloc(16); e[0]=n; e[1]=n; e.writeUInt16LE(1,4); e.writeUInt16LE(32,6); e.writeUInt32LE(b.length,8); e.writeUInt32LE(off,12); off+=b.length; dir.push(e);}
fs.writeFileSync(`${ROOT}/apps/web/public/favicon.ico`,Buffer.concat([head,...dir,...imgs.map(i=>i[1])]));

// ── share preview ──
const P=`${ROOT}/apps/web/src/assets/plans/`;
const W=1200,H=630, TW=400, TH=440;
const cw=Math.round(320*TW/TH);
const tiles=await Promise.all([['free',282],['traveler',288],['voyager',261]].map(async([k,cx])=>
  sharp(P+k+'/panel.webp').extract({left:Math.max(0,cx-Math.round(cw/2)),top:0,width:cw,height:320}).resize(TW,TH,{kernel:'lanczos3'}).modulate({brightness:0.96}).toBuffer()));
const wm=fs.readFileSync(`${B}/wordmark-light.svg`,'utf8');
const vb=wm.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
const inner=wm.replace(/^[\s\S]*?<\/style>/,'').replace(/<\/svg>\s*$/,'');
const wmW=520, wmH=wmW*vb[3]/vb[2];
const overlay=`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
<defs>
 <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#0b1220" stop-opacity="0.15"/>
  <stop offset="0.42" stop-color="#0b1220" stop-opacity="0.05"/>
  <stop offset="0.66" stop-color="#0b1220" stop-opacity="0.82"/>
  <stop offset="1" stop-color="#070a14" stop-opacity="1"/>
 </linearGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#fade)"/>
<rect x="399" y="0" width="2" height="${TH}" fill="#0b1220" opacity="0.7"/>
<rect x="799" y="0" width="2" height="${TH}" fill="#0b1220" opacity="0.7"/>
<svg x="${(W-wmW)/2}" y="438" width="${wmW}" height="${wmH}" viewBox="${vb.join(' ')}">
 <style>.ink{fill:#f6efe2}.dot{fill:#f2c27b}</style>${inner}
</svg>
<text x="${W/2}" y="${438+wmH+44}" text-anchor="middle" font-family="Hiragino Sans, PingFang SC, Helvetica Neue, sans-serif" font-size="26" fill="#f6efe2" fill-opacity="0.9" letter-spacing="0.5">Step into living stories  <tspan fill="#f2c27b">·</tspan>  物語の中へ  <tspan fill="#f2c27b">·</tspan>  走进会呼吸的故事</text>
<text x="${W/2}" y="${H-26}" text-anchor="middle" font-family="Menlo, monospace" font-size="17" fill="#f6efe2" fill-opacity="0.55" letter-spacing="2">canvas.worldlines.gg</text>
</svg>`;
await sharp({create:{width:W,height:H,channels:3,background:'#0b1220'}})
 .composite([...tiles.map((t,i)=>({input:t,left:i*TW,top:0})),{input:Buffer.from(overlay),left:0,top:0}])
 .jpeg({quality:84,mozjpeg:true,chromaSubsampling:'4:4:4'}).toFile(`${B}/og.jpg`);
await sharp(`${B}/og.jpg`).resize(512).jpeg({quality:82}).toFile(`${TMP}/og-preview.jpg`);
console.log(fs.statSync(`${B}/og.jpg`).size);
