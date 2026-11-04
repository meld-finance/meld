# Draws the Meld icon (the logo's two peaks): python3 make-icon.py <out.png> [size] [full]
# Without "full" it's a macOS-style rounded square; with it, a full-bleed square for phones.
import zlib, struct, sys
S=int(sys.argv[2]) if len(sys.argv)>2 else 1024; SS=2; FULL=len(sys.argv)>3
def inside_tri(px,py,a,b,c):
    def s(p1,p2,p3): return (p1[0]-p3[0])*(p2[1]-p3[1])-(p2[0]-p3[0])*(p1[1]-p3[1])
    d1=s((px,py),a,b); d2=s((px,py),b,c); d3=s((px,py),c,a)
    return not(((d1<0) or (d2<0) or (d3<0)) and ((d1>0) or (d2>0) or (d3>0)))
# macOS icon grid: an 824px rounded square centred in 1024.
box0, box1, R = (0, S, 0) if FULL else (S*100/1024, S*924/1024, S*185/1024)
def in_box(x,y):
    if x<box0 or x>box1 or y<box0 or y>box1: return False
    cx=min(max(x,box0+R),box1-R); cy=min(max(y,box0+R),box1-R)
    return (x-cx)**2+(y-cy)**2<=R*R
sc=22*S/1024; ox=S/2-15*sc; oy=S/2-10.5*sc
tri=lambda pts:[(ox+x*sc, oy+y*sc) for x,y in pts]
green=tri([(1,18),(9,4),(17,18)]); blue=tri([(11,18),(19.5,3),(28,18)])
G=(0x2E,0x9E,0x6B); B=(0x25,0x63,0xEB); W=(0xF7,0xF8,0xFA)
rows=bytearray()
for y in range(S):
    rows.append(0)
    for x in range(S):
        r=g=b=a=0.0
        for j in range(SS):
            for i in range(SS):
                px=x+(i+.5)/SS; py=y+(j+.5)/SS
                if not in_box(px,py): continue
                c=W
                if inside_tri(px,py,*green): c=G
                if inside_tri(px,py,*blue): c=tuple(round(0.92*bb+0.08*cc) for bb,cc in zip(B,c))
                r+=c[0]; g+=c[1]; b+=c[2]; a+=1
        n=SS*SS
        if a: rows+=bytes([int(r/a),int(g/a),int(b/a),int(255*a/n)])
        else: rows+=b'\0\0\0\0'
def chunk(t,d): return struct.pack('>I',len(d))+t+d+struct.pack('>I',zlib.crc32(t+d)&0xffffffff)
open(sys.argv[1],'wb').write(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',S,S,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(rows),9))+chunk(b'IEND',b''))
