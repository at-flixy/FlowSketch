"""Independent readback/render check. Uses bundled Python, Pillow and Poppler."""
import json, subprocess, sys
from pathlib import Path
from pypdf import PdfReader
from PIL import Image, ImageChops

prefix=Path(sys.argv[1]); poppler=sys.argv[2]
scene=json.loads(prefix.with_suffix('.scene.json').read_text(encoding='utf-8'))
reader=PdfReader(prefix.with_suffix('.pdf'))
page=reader.pages[0]
pdf_bounds=[float(page.mediabox.width),float(page.mediabox.height)]
assert len(reader.pages)==1
assert abs(pdf_bounds[0]-scene['width']*.75)<.01
assert abs(pdf_bounds[1]-scene['height']*.75)<.01
assert not page.get('/Resources',{}).get('/XObject'), 'PDF contains raster XObjects'
pdf_render=prefix.parent/(prefix.name+'.pdf-render')
subprocess.run([poppler,'-r','96','-singlefile','-png',str(prefix.with_suffix('.pdf')),str(pdf_render)],check=True,timeout=60,capture_output=True)
a=Image.open(prefix.with_suffix('.png')).convert('RGB')
b=Image.open(str(pdf_render)+'.png').convert('RGB')
assert a.size==b.size, (a.size,b.size)
# Different raster engines have different AA. Compare dark foreground masks,
# not exact pixel hashes. Each engine rendered the same canonical vector paths.
ma=a.convert('L').point(lambda p:255 if p<180 else 0)
mb=b.convert('L').point(lambda p:255 if p<180 else 0)
intersection=sum(ImageChops.darker(ma,mb).histogram()[1:])
union=sum(ImageChops.lighter(ma,mb).histogram()[1:])
iou=intersection/union if union else 1
assert iou>=.85, f'PDF/PNG geometry foreground IoU={iou}'
diff=ImageChops.difference(a,b)
mean=sum(i*n for band in diff.split() for i,n in enumerate(band.histogram()))/(a.width*a.height*3)
print(json.dumps({'pdfPages':len(reader.pages),'pdfBoundsPt':pdf_bounds,'pngSize':list(a.size),'pdfHasRasterXObjects':False,'darkForegroundIoU':round(iou,6),'meanAbsoluteRgbDifference':round(mean,6),'pdfRendered':str(pdf_render)+'.png','pdfTextPolicy':'glyph outlines, not selectable/searchable'},ensure_ascii=False))
