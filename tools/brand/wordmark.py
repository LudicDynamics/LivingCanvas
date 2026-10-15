"""LivingCanvas wordmark: Manrope 600 outlined to paths + the gold lantern dot (share-card.ts motif)."""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
# usage: python3 tools/brand/wordmark.py <Manrope[wght].ttf from google/fonts ofl/manrope> apps/web/public/brand
FONT=sys.argv[1]; OUT=sys.argv[2]
f=TTFont(FONT); f=instantiateVariableFont(f,{"wght":600})
gs=f.getGlyphSet(); cmap=f.getBestCmap(); hmtx=f['hmtx']; upm=f['head'].unitsPerEm
text="LivingCanvas"; track=-0.01*upm
# kerning via GPOS is complex; Manrope spacing is fine untracked
x=0; d=[]
asc=f['OS/2'].sCapHeight
for ch in text:
    g=cmap[ord(ch)]; pen=SVGPathPen(gs)
    gs[g].draw(TransformPen(pen,(1,0,0,-1,x,asc)))
    d.append(pen.getCommands()); x+=hmtx[g][0]+track
w=x-track
desc=-f['OS/2'].sTypoDescender
# lantern dot after the mark (share-card motif): gold, at x-height
xh=f['OS/2'].sxHeight
r=0.115*upm; cx=w+0.19*upm; cy=asc-xh*0.86  # sits near the top of the lowercase
W=cx+r+0.02*upm; H=asc+desc*0.92
pad=0.06*upm
vb=f"{-pad:.0f} {-pad:.0f} {W+2*pad:.0f} {H+2*pad:.0f}"
path=" ".join(d)
def svg(fill_css, ink_dark=None, title="LivingCanvas"):
    media = "" if ink_dark is None else f"@media (prefers-color-scheme: dark){{.ink{{fill:{ink_dark}}}}}"
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{(W+2*pad)/(H+2*pad)*40:.0f}" height="40" role="img" aria-label="{title}">
<title>{title}</title>
<style>.ink{{fill:{fill_css}}}.dot{{fill:#f2c27b}}{media}</style>
<path class="ink" d="{path}"/>
<circle class="dot" cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}"/>
</svg>
'''
open(f"{OUT}/wordmark.svg","w").write(svg("#292820","#f6efe2"))
open(f"{OUT}/wordmark-light.svg","w").write(svg("#f6efe2"))
print(vb)
