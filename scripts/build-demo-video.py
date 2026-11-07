"""Compose CUA operation captures, Traditional Chinese captions and original music.
Usage: python3 scripts/build-demo-video.py frames.json [output-directory]
Requires Pillow, numpy, ffmpeg. Captures are actual UI states, edited as a walkthrough.
"""
import json,sys,wave,subprocess
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
frames=json.load(open(sys.argv[1])); out=Path(sys.argv[2] if len(sys.argv)>2 else 'output/demo-video');out.mkdir(parents=True,exist_ok=True)
font='/System/Library/Fonts/Supplemental/Arial Unicode.ttf'
head=ImageFont.truetype(font,32); sub=ImageFont.truetype(font,30); small=ImageFont.truetype(font,20)
concat=[]; subtitles=[]; elapsed=0

def stamp(s):
 ms=round(s*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
for i,f in enumerate(frames):
 im=Image.new('RGB',(1600,1060),'#10171c');d=ImageDraw.Draw(im)
 d.rectangle((0,0,7,1060),fill='#ff681b');d.text((35,15),'PISG  /  '+f['chapter'],font=head,fill='white');d.text((1250,25),'50 MW · DIGITAL TWIN',font=small,fill='#ff9b59')
 shot=Image.open(f['path']).convert('RGB')
 # Optional presentation-only title strip; original application data is unchanged.
 if f.get('cover'):
  sd=ImageDraw.Draw(shot);box=f['cover'];sd.rectangle(box,fill='#232d32')
  sd.text((box[0]+18,box[1]+16),'PISG | 專案協同管理',font=ImageFont.truetype(font,18),fill='#ff9b59')
 shot=shot.resize((1600,900),Image.Resampling.LANCZOS);im.paste(shot,(0,70))
 caption=f['caption']; width=d.textlength(caption,font=sub)
 d.text(((1600-width)/2,990),caption,font=sub,fill='white')
 path=out/f'caption-{i:03}.png';im.save(path)
 concat.extend([f"file '{path.resolve()}'",f"duration {f['duration']}"])
 subtitles.append(f"{i+1}\n{stamp(elapsed)} --> {stamp(elapsed+f['duration'])}\n{caption}\n");elapsed+=f['duration']
concat.append(f"file '{path.resolve()}'");(out/'frames.txt').write_text('\n'.join(concat));(out/'PISG-demo.zh-TW.srt').write_text('\n'.join(subtitles))
# Original 112 BPM instrumental: soft kick, hats, bass and major-seventh arpeggios.
sr=44100;n=int(elapsed*sr);music=np.zeros((n,2),dtype=np.float32);rng=np.random.default_rng(50);beat=60/112

def add(start,sound,amp=.15,pan=0):
 a=int(start*sr);b=min(n,a+len(sound));
 if b>a:
  music[a:b,0]+=sound[:b-a]*amp*(1-pan*.4);music[a:b,1]+=sound[:b-a]*amp*(1+pan*.4)
def tone(midi,duration):
 t=np.arange(int(sr*duration))/sr;f=440*2**((midi-69)/12);env=(1-np.exp(-t*80))*np.exp(-t*4/duration)
 return (np.sin(2*np.pi*f*t)+.2*np.sin(2*np.pi*f*2*t))*env
chords=[[48,52,55,59],[55,59,62,66],[57,60,64,67],[53,57,60,64]]
for k in range(int(elapsed/beat)+1):
 t=np.arange(int(sr*.22))/sr;add(k*beat,np.sin(2*np.pi*(47*t+8*(1-np.exp(-t*28))))*np.exp(-t*20),.23)
 chord=chords[(k//8)%4];add(k*beat,tone(chord[0]-12,beat*.85),.13)
 for j in range(2):
  t=np.arange(int(sr*.065))/sr;noise=rng.normal(0,1,len(t));noise=np.diff(noise,prepend=0)*np.exp(-t*85);add((k+j/2)*beat,noise,.018,(-1)**k*.5)
  add((k+j/2)*beat,tone(chord[(k*2+j)%4]+24,beat*.8),.075,(-1)**j*.6)
 if k%2:
  t=np.arange(int(sr*.12))/sr;add(k*beat,rng.normal(0,1,len(t))*np.exp(-t*40),.035)
fade=int(sr*3);music[:fade]*=np.linspace(0,1,fade)[:,None];music[-fade:]*=np.linspace(1,0,fade)[:,None];music=np.tanh(music)*.65
with wave.open(str(out/'PISG-original-tech-music.wav'),'wb') as w:
 w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((music*32767).astype('<i2').tobytes())
subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','warning','-f','concat','-safe','0','-i',str(out/'frames.txt'),'-i',str(out/'PISG-original-tech-music.wav'),'-t',str(elapsed),'-r','25','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart',str(out/'PISG-50MW-PMIS-demo.mp4')],check=True)
print(f'Created {elapsed}s walkthrough; audio peak {np.max(np.abs(music)):.3f}')
