"""Crop browser-captured app frames and assemble reference/implementation QA sheets.

This only processes screenshots; no generated or painted UI substitutes are used.
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / 'reports/reference-ui/screens'
NAMES = ['home', 'search', 'settings', 'walking', 'summary']
BOXES = [(24,90,232,593),(272,90,479,593),(522,90,729,593),(770,90,975,593),(1010,90,1218,593)]

def main():
    source=Image.open(P / 'reference.png')
    comparison=Image.new('RGB',(1950,1688),'white')
    contact=Image.new('RGB',(1998,884),'#E6E5DF')
    draw=ImageDraw.Draw(contact)
    for i,(name,box) in enumerate(zip(NAMES,BOXES)):
        # Browser pane resized during QA; locate the same 390px frame in each capture.
        browser=Image.open(P / (name+'-full.png'))
        background=browser.getpixel((0,80))
        left=next(x for x in range(browser.width) if sum(abs(a-b) for a,b in zip(browser.getpixel((x,80)),background))>20)
        shot=browser.crop((left,60,left+390,904))
        shot.save(P / (name+'.png'))
        comparison.paste(source.crop(box).resize((390,844)),(i*390,0))
        comparison.paste(shot,(i*390,844))
        contact.paste(shot,(8+i*398,30))
        draw.text((14+i*398,8),f'{i+1}. {name}',fill='#242A32')
    comparison.save(P / 'source-vs-implementation.png')
    contact.save(P / 'five-screens.png')
    print('Saved five 390x844 browser crops, contact sheet and source comparison.')

if __name__=='__main__': main()
