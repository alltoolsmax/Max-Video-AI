"""Giả lập ComfyUI cho chế độ nhẹ (kiểm thử giao diện): /system_stats, /prompt, /history, /queue, /interrupt.
Mỗi việc chạy ~6 giây rồi ghi 1 file mp4 (ffmpeg) + ảnh đại diện vào output/."""
import argparse, json, os, subprocess, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument('-s', dest='script'); ap.add_argument('--listen'); ap.add_argument('--port', type=int)
ap.add_argument('--disable-auto-launch', action='store_true'); ap.add_argument('--preview-method'); ap.add_argument('--lowvram', action='store_true')
a = ap.parse_args()
OUT = Path.cwd() / 'output'
JOBS, ORDER, HIST, LOCK = {}, [], {}, threading.Lock()
NEED = {'UNETLoader', 'CLIPLoader', 'VAELoader', 'ModelSamplingSD3', 'CLIPTextEncode', 'Wan22ImageToVideoLatent', 'KSampler', 'VAEDecode', 'CreateVideo', 'SaveVideo', 'ImageFromBatch', 'SaveImage', 'LoadImage',
        'CheckpointLoaderSimple', 'LTXAVTextEncoderLoader', 'LTXVAudioVAELoader', 'LoraLoaderModelOnly', 'LatentUpscaleModelLoader', 'LTXVConditioning', 'ResizeImagesByLongerEdge',
        'LTXVPreprocess', 'EmptyLTXVLatentVideo', 'LTXVImgToVideoInplace', 'LTXVEmptyLatentAudio', 'LTXVConcatAVLatent', 'RandomNoise', 'CFGGuider', 'KSamplerSelect', 'ManualSigmas',
        'SamplerCustomAdvanced', 'LTXVSeparateAVLatent', 'LTXVLatentUpsampler', 'LTXVCropGuides', 'VAEDecodeTiled', 'LTXVAudioVAEDecode', 'EmptyImage', 'ResizeImageMaskNode'}
def find(g, t): return next((k for k, n in g.items() if n['class_type'] == t), None)

def work():
    while True:
        time.sleep(.3)
        with LOCK:
            if not ORDER: continue
            pid = ORDER[0]; j = JOBS[pid]
            if j.get('cancel'):
                ORDER.pop(0); HIST[pid] = dict(status=dict(status_str='error', completed=False, messages=[['execution_interrupted', {}]]), outputs={}); continue
            if time.time() - j['t0'] < 6: continue
            ORDER.pop(0)
        g = j['graph']; run = g[find(g, 'SaveVideo')]['inputs']['filename_prefix']
        if find(g, 'Wan22ImageToVideoLatent'): w, h = g[find(g, 'Wan22ImageToVideoLatent')]['inputs']['width'], g[find(g, 'Wan22ImageToVideoLatent')]['inputs']['height']
        else: w, h = g[find(g, 'EmptyLTXVLatentVideo')]['inputs']['width'] * 2, g[find(g, 'EmptyLTXVLatentVideo')]['inputs']['height'] * 2
        text = next(n['inputs']['text'] for n in g.values() if n['class_type'] == 'CLIPTextEncode')
        sub = os.path.dirname(run); name = os.path.basename(run)
        (OUT / sub).mkdir(parents=True, exist_ok=True)
        if 'oom' in text:
            HIST[pid] = dict(status=dict(status_str='error', completed=False, messages=[['execution_error', {'exception_message': 'CUDA error: out of memory'}]]), outputs={}); continue
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=%dx%d:rate=24' % (w, h), '-t', '2', '-pix_fmt', 'yuv420p', '-y', str(OUT / sub / (name + '_00001_.mp4'))], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=%dx%d' % (w, h), '-frames:v', '1', '-y', str(OUT / sub / (name + '_thumb_00001_.png'))], check=True)
        HIST[pid] = dict(status=dict(status_str='success', completed=True, messages=[]), outputs={
            '58': dict(images=[dict(filename=name + '_00001_.mp4', subfolder=sub, type='output')], animated=[True]),
            '61': dict(images=[dict(filename=name + '_thumb_00001_.png', subfolder=sub, type='output')])})

class H(BaseHTTPRequestHandler):
    def log_message(self, *x): pass
    def js(self, s, v):
        b = json.dumps(v).encode(); self.send_response(s); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == '/system_stats': return self.js(200, dict(system=dict(os='fake')))
        if self.path.startswith('/history/'):
            pid = self.path.split('/')[-1]
            return self.js(200, {pid: HIST[pid]} if pid in HIST else {})
        if self.path == '/queue':
            with LOCK: return self.js(200, dict(queue_running=[[0, p] for p in ORDER[:1]], queue_pending=[[0, p] for p in ORDER[1:]]))
        self.js(404, {})
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
        if self.path == '/prompt':
            g = body.get('prompt') or {}
            bad = [k for k, n in g.items() if n.get('class_type') not in NEED]
            if bad or not find(g, 'SaveVideo'): return self.js(400, dict(error=dict(message='invalid prompt'), node_errors={k: 'unknown' for k in bad}))
            if '56' in g and g['56']['class_type'] == 'LoadImage' and not (Path.cwd() / 'input' / g['56']['inputs']['image']).is_file():
                return self.js(400, dict(error=dict(message='image missing'), node_errors={'56': 'missing'}))
            pid = uuid.uuid4().hex
            with LOCK: JOBS[pid] = dict(graph=g, t0=time.time()); ORDER.append(pid)
            return self.js(200, dict(prompt_id=pid, number=len(ORDER)))
        if self.path == '/queue':
            with LOCK:
                for p in body.get('delete', []):
                    if p in ORDER[1:]: ORDER.remove(p); HIST[p] = dict(status=dict(status_str='error', completed=False, messages=[['execution_interrupted', {}]]), outputs={})
            return self.js(200, {})
        if self.path == '/interrupt':
            with LOCK:
                if ORDER: JOBS[ORDER[0]]['cancel'] = True
            return self.js(200, {})
        self.js(404, {})

threading.Thread(target=work, daemon=True).start()
print('fake ComfyUI on', a.port, flush=True)
ThreadingHTTPServer(('127.0.0.1', a.port), H).serve_forever()
