"""Máy chủ giả lập FreeVideo agent API để thử giao diện khi không có GPU.

    python3 dev/mock_server.py            # chạy ở http://127.0.0.1:8188, tạo dev/mock_root/agent/token

Chỉ mô phỏng hình dạng dữ liệu của /freevideo/agent/v1 (jobs, plan, media, library); không tạo video thật.
"""
from email.parser import BytesParser
from email.policy import HTTP
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs, unquote

HERE = Path(__file__).resolve().parent
ROOT = HERE / 'mock_root'
DATA = HERE / 'mock_data'
PREFIX = '/freevideo/agent/v1'
PORT = int(os.environ.get('MOCK_PORT', '8188'))
LOCK = threading.Lock()
JOBS = {}       # id -> row
ORDER = []      # mới nhất trước
LIBRARY = []    # mới nhất trước
PACKS = {'image-h3': 'missing', 'vlm': 'missing'}   # gói mô hình giả lập
CAST = {}       # id -> card
PROJECTS = {}   # id -> project
IMPORTS = {}    # id -> import
DRAMAS = {}     # id -> film


def now():
    return datetime.now(timezone.utc).isoformat()


def prepare():
    (ROOT / 'agent').mkdir(parents=True, exist_ok=True)
    token = ROOT / 'agent' / 'token'
    if not token.exists():
        token.write_text(secrets.token_urlsafe(32))
    (ROOT / 'agent' / 'endpoint.json').write_text(json.dumps({'url': 'http://127.0.0.1:%d' % PORT, 'api': PREFIX}))
    for sub in ('input', 'output', 'samples'):
        (DATA / sub).mkdir(parents=True, exist_ok=True)
    samples = [('sea', 'testsrc2=size=1344x768:rate=24', '16:9'), ('city', 'mandelbrot=size=1344x768:rate=24', '16:9'),
               ('tall', 'testsrc=size=768x1344:rate=24', '9:16')]
    for name, source, _ in samples:
        video = DATA / 'samples' / (name + '.mp4')
        if not video.exists():
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', source, '-f', 'lavfi', '-i', 'sine=frequency=330',
                            '-t', '4', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
                            '-shortest', '-y', str(video)], check=True)
            subprocess.run(['ffmpeg', '-v', 'error', '-i', str(video), '-frames:v', '1', '-vf', 'scale=480:-2', '-y',
                            str(DATA / 'samples' / (name + '.jpg'))], check=True)
    image = DATA / 'samples' / 'image.png'
    if not image.exists():
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'gradients=size=1024x1024:speed=0.02:c0=0x1a73e8:c1=0x34a853:c2=0xfbbc04',
                        '-frames:v', '1', '-y', str(image)], check=True)
    prompts = [
        'integrated_multimodal_description: Live-action, cinematic. A slow tracking shot follows a young woman with a red umbrella through a neon-lit Saigon alley at night after rain.\n\noverall_soundscape: Rain, distant motorbikes.\n\nnon_diegetic_music: Mellow lo-fi piano.',
        'integrated_multimodal_description: Aerial drone shot at golden hour over terraced rice fields in Mu Cang Chai, rising to reveal misty mountains.\n\noverall_soundscape: Wind, birds.\n\nnon_diegetic_music: Warm strings and flute.',
        'integrated_multimodal_description: 3D animated. A small orange cat in an astronaut suit floats inside a cozy spaceship reaching for a cookie.\n\noverall_soundscape: Spaceship hum.\n\nnon_diegetic_music: Playful glockenspiel.',
    ]
    for i in range(7):
        name, _, _ = samples[i % 3]
        add_library(name, prompts[i % 3], preview=(i == 2), when=time.time() - 3600 * (i + 1))


def add_library(sample, prompt, preview=False, when=None, seconds=4.0):
    day = datetime.fromtimestamp(when or time.time()).strftime('%Y-%m-%d')
    run = uuid.uuid4().hex
    identity = day + '/' + run
    width, height = (768, 1344) if sample == 'tall' else (1344, 768)
    item = dict(id=identity, sample=sample, prompt=prompt, preview=preview, width=width, height=height, seconds=seconds,
                created_at=datetime.fromtimestamp(when or time.time(), timezone.utc).isoformat(), seed=secrets.randbelow(2 ** 31))
    LIBRARY.insert(0, item)
    LIBRARY.sort(key=lambda x: x['created_at'], reverse=True)
    return item


def library_view(item):
    return dict(file='FreeVideo/%s/video.mp4' % item['id'], url=PREFIX + '/library/' + item['id'] + '/file')


def caps():
    with LOCK:
        running = sum(1 for j in JOBS.values() if j['status'] == 'running')
        pending = sum(1 for j in JOBS.values() if j['status'] in ('queued', 'waiting'))
    return dict(api_version=1, freevideo_version='0.5.0 (mock)', ready=True, problem=None, continuation=True,
                features={'enhance': True, 'plan': True, 'takes': True},
                device=dict(backend='cuda', vram_limit_gib=24, ram_limit_gib=64),
                limits=dict(width=[256, 4096, 32], height=[256, 4096, 32], seconds=[1.625, 60], fps=24, takes=8),
                quality={'light': dict(two_pass=False, base_steps=8, refine_steps=0), 'medium': dict(two_pass=True, base_steps=8, refine_steps=3),
                         'high': dict(two_pass=True, base_steps=8, refine_steps=4), 'max': dict(two_pass=True, base_steps=12, refine_steps=6)},
                aspects=['16:9', '1:1', '21:9', '3:4', '4:3', '9:16'], loras=['anime_style_h3.safetensors', 'film_grain_v2.safetensors'],
                vlm=dict(ready=True), queue=dict(running=running, pending=pending, agent_active=running + pending))


ASPECT = {'16:9': (1344, 768), '9:16': (768, 1344), '1:1': (1024, 1024), '4:3': (1152, 864), '3:4': (864, 1152), '21:9': (1536, 640)}
QUALITY_STEPS = {'light': (False, 8), 'medium': (True, 11), 'high': (True, 12), 'max': (True, 18)}


def problem(status, code, message, next_=None, field=None):
    error = dict(code=code, message=message)
    if next_:
        error['next'] = next_
    if field:
        error['details'] = [dict(field=field)]
    return status, dict(error=error)


def plan(spec):
    if not isinstance(spec.get('prompt'), str) or not spec['prompt'].strip():
        return problem(422, 'invalid_request', 'prompt is required', 'Write a prompt.', '/prompt')
    width, height = ASPECT.get(spec.get('aspect', '16:9'), (1344, 768))
    seconds = float(spec.get('seconds', 10))
    frames = int(round(seconds * 24 / 8)) * 8 + 1
    two_pass, steps = QUALITY_STEPS.get(spec.get('quality', 'light'), (False, 8))
    if spec.get('preview') and not two_pass:
        return problem(422, 'invalid_request', 'A preview needs a two-pass quality (medium, high or max).',
                       'Choose medium, high or max, or turn preview off.', '/preview')
    warnings = []
    if seconds > 15:
        warnings.append('Longer than 15 s is experimental')
    if (spec.get('media') or {}).get('references'):
        warnings.append('Reference generation is experimental')
    blocks = 1 if seconds <= 20 else int((seconds + 19) // 20)
    estimate = seconds * 9 * (steps / 8) * (1.6 if two_pass else 1) * (width * height) / (1344 * 768)
    return 200, dict(spec=spec, warnings=warnings, geometry=dict(width=width, height=height, frames=frames, seconds=frames / 24, fps=24),
                     sampling=dict(two_pass=two_pass, total_steps=steps), chain_plan=dict(blocks=blocks),
                     estimate=dict(status='ready', seconds=round(estimate)))


def new_job(spec, client):
    identity = 'j' + uuid.uuid4().hex[:12]
    kind = spec.get('kind', 'generate')
    duration = {'generate': 14, 'image': 6, 'enhance': 3}.get(kind, 4)
    if kind == 'generate' and spec.get('preview'):
        duration = 8
    row = dict(id=identity, kind=kind, status='queued', spec=spec, client=client, created_at=now(), started_at=None,
               finished_at=None, duration=duration, t0=None, cancel=False, result=None, error=None)
    with LOCK:
        JOBS[identity] = row
        ORDER.insert(0, identity)
    return row


def view(row, detail=True):
    value = {k: row[k] for k in ('id', 'kind', 'status', 'client', 'created_at', 'started_at', 'finished_at')}
    value['label'] = row['spec'].get('label')
    value['poll_after_ms'] = 500 if row['status'] in ('queued', 'running', 'cancelling') else None
    if row['status'] in ('queued', 'waiting'):
        ahead = [j for j in ORDER if JOBS[j]['status'] in ('running', 'queued') and JOBS[j]['created_at'] < row['created_at']]
        value['progress'] = dict(phase='queued', label='Waiting in the queue', queue_position=len(ahead) + 1)
    elif row['status'] in ('running', 'cancelling'):
        elapsed = time.time() - row['t0']
        fraction = min(.99, elapsed / row['duration'])
        if row['kind'] == 'generate':
            steps = QUALITY_STEPS.get(row['spec'].get('quality', 'light'), (False, 8))[1]
            phase = 'loading' if fraction < .12 else 'sampling' if fraction < .85 else 'decoding'
            value['progress'] = dict(phase=phase, fraction=fraction, remaining_seconds=max(0, row['duration'] - elapsed))
            if phase == 'sampling':
                value['progress']['step'] = dict(done=min(steps, int((fraction - .12) / .73 * steps) + 1), total=steps)
        else:
            value['progress'] = dict(phase='running', fraction=fraction, label='Working')
    elif row['status'] == 'succeeded':
        value['progress'] = dict(phase='complete', fraction=1.)
    if row['result'] is not None:
        value['result'] = row['result']
    if row['error'] is not None:
        value['error'] = row['error']
    if detail:
        value['spec'] = row['spec']
    return value


def worker():
    while True:
        time.sleep(.2)
        with LOCK:
            running = [JOBS[j] for j in ORDER if JOBS[j]['status'] in ('running', 'cancelling')]
            if not running:
                queued = [JOBS[j] for j in reversed(ORDER) if JOBS[j]['status'] == 'queued']
                if queued:
                    row = queued[0]
                    row.update(status='running', started_at=now(), t0=time.time())
                continue
            row = running[0]
            if row['cancel']:
                row.update(status='cancelled', finished_at=now(), error=dict(code='cancelled', message='Cancelled by the user'))
                continue
            if time.time() - row['t0'] < row['duration']:
                continue
            spec = row['spec']
            if row['kind'] == 'generate':
                if 'fail' in str(spec.get('prompt', '')).lower():
                    row.update(status='failed', finished_at=now(), error=dict(code='out_of_memory', message='The GPU ran out of memory.',
                               next='Lower the quality or the length, then resume.'))
                    continue
                sample = 'tall' if spec.get('aspect') == '9:16' else ('sea', 'city')[len(ORDER) % 2]
                item = add_library(sample, spec.get('prompt') if isinstance(spec.get('prompt'), str) else '(refined)', preview=bool(spec.get('preview')))
                row['result'] = dict(video=library_view(item), library_id=item['id'], width=item['width'], height=item['height'],
                                     frames=97, seconds=4.0, seed=spec.get('seed', item['seed']), preview=bool(spec.get('preview')))
            elif row['kind'] == 'image':
                name = uuid.uuid4().hex + '.png'
                shutil.copy(DATA / 'samples' / 'image.png', DATA / 'input' / name)
                relative = 'freevideo/agent/assets/' + name
                row['result'] = dict(file=relative, url=PREFIX + '/media/input/' + relative + '/file', width=1024, height=1024,
                                     thumbnail=PREFIX + '/media/input/' + relative + '/file', seed=secrets.randbelow(2 ** 31))
            elif row['kind'] == 'listen':
                words = ['Xin chào, hôm nay trời mưa to quá.', 'Ừ, mình đợi xe buýt nãy giờ rồi.', 'Đi chung ô với mình nhé?']
                row['result'] = dict(kind='transcribe', language='vi', fps=24, lines=[dict(index=i, text=t, matched=True, start=i * 30 + 6, end=i * 30 + 28,
                                     start_seconds=round((i * 30 + 6) / 24, 3), end_seconds=round((i * 30 + 28) / 24, 3)) for i, t in enumerate(words)])
            elif row['kind'] == 'voice_lines':
                said = ['I have been waiting for the bus.', 'Do you want to share my umbrella?', 'Thank you, that is very kind.']
                row['result'] = dict(lines=[dict(id='l%03d' % (i + 1), start=i * 1.3 + .2, end=i * 1.3 + 1.1, text=t, speaker=i % 2 + 1, words=t.split(), rate=6.5)
                                            for i, t in enumerate(said)], recognition='r' + uuid.uuid4().hex[:12], separated=True, speech=True, source='dialogue')
            elif row['kind'] == 'voice':
                row['result'] = dict(placed=True, failed=0, lines=[], seconds=3.2)
            elif row['kind'] == 'export':
                item = add_library('sea', 'Exported project ' + spec.get('editor_project', ''))
                row['result'] = dict(video=library_view(item), library_id=item['id'], width=item['width'], height=item['height'], seconds=4.0)
            elif row['kind'] == 'vlm':
                sysmsg = spec.get('system', '')
                if '"shots"' in sysmsg:
                    ans = dict(title='Hẹn dưới mưa', style='soft cinematic', shots=[dict(action='Lan stands under a bus stop roof in heavy rain.', seconds=7, camera='wide', cast=['Lan'], lines=[]),
                               dict(action='Minh runs in and smiles at Lan.', seconds=9, camera='medium two-shot', cast=['Lan', 'Minh'], lines=[dict(who='Minh', line='Chào em!')])])
                elif '"prompt"' in sysmsg:
                    ans = dict(prompt='Local AI: cozy cafe interior, warm window light, 35mm film photo.')
                else:
                    ans = dict(lines=['Local AI shot %d: rainy Hoi An street at dusk, lanterns, slow pan.' % (i + 1) for i in range(3)])
                row['result'] = dict(answers=['```json\n' + json.dumps(ans, ensure_ascii=False) + '\n```'])
            elif row['kind'] == 'enhance':
                row['result'] = dict(text='integrated_multimodal_description: [Shot 1] Live-action, cinematic, a medium-wide shot frames '
                                     + spec.get('text', '').strip().split('\n')[0] + ' The camera pushes in slowly with small amplitude; soft '
                                     'practical light shapes the scene.\n\noverall_soundscape: Gentle ambience matching the scene, soft footsteps.'
                                     '\n\nnon_diegetic_music: N/A')
            row.update(status='succeeded', finished_at=now())


class Handler(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def log_message(self, fmt, *args):
        if os.environ.get('MOCK_LOG'):
            super().log_message(fmt, *args)

    def send_json(self, status, value):
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        token = (ROOT / 'agent' / 'token').read_text().strip()
        header = self.headers.get('Authorization', '')
        if header != 'Bearer ' + token:
            self.send_json(*problem(401, 'unauthorized', 'Token missing or incorrect'))
            return False
        return True

    def body(self):
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b''
        return json.loads(raw or b'{}')

    def send_file(self, path, content_type):
        size = path.stat().st_size
        start, end = 0, size - 1
        match = re.match(r'bytes=(\d*)-(\d*)', self.headers.get('Range', ''))
        if match and (match.group(1) or match.group(2)):
            start = int(match.group(1) or 0)
            end = min(size - 1, int(match.group(2))) if match.group(2) else size - 1
            self.send_response(206)
            self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        else:
            self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        with path.open('rb') as stream:
            stream.seek(start)
            self.wfile.write(stream.read(end - start + 1))

    def route(self):
        path = urlsplit(self.path).path
        if not path.startswith(PREFIX):
            return None
        return path[len(PREFIX):]

    def mock_packs(self):
        path = urlsplit(self.path).path
        st = PACKS
        if path == '/freevideo/image-gen':
            return self.send_json(200, dict(token='t', models=[
                dict(id='minimax-h3-image', ready=st['image-h3'] == 'ready', available=True, downloading=st['image-h3'] == 'busy', bytes_needed=16 * 2**30,
                     install=dict(state='running', done=int(time.time() % 60) * 2**28, total=16 * 2**30) if st['image-h3'] == 'busy' else None),
                dict(id='qwen-image-2.1-turbo', ready=True, available=True)], segment=dict(ready=False, install=None)))
        if path == '/freevideo/prompt-vlm':
            return self.send_json(200, dict(token='t', ready=st['vlm'] == 'ready', bytes=5 * 2**30, busy=st['vlm'] == 'busy'))
        if path == '/freevideo/dubbing':
            return self.send_json(200, dict(token='t', ready=False, bytes=3 * 2**30, busy=False))
        if path == '/freevideo/editor/subtitle-pack':
            return self.send_json(200, dict(supported=True, published=True, ready=False, install={}))
        if path == '/freevideo/editor/music-pack':
            return self.send_json(200, dict(ready=False, bytes=2 * 2**30))
        return None

    # ---- Nhân vật, sửa ảnh nhanh, import, dự án dựng, phim Autopilot (giả lập) ----
    def extra(self, method, route, value):
        def copy_image():
            name = uuid.uuid4().hex + '.png'
            shutil.copy(DATA / 'samples' / 'image.png', DATA / 'input' / name)
            rel = 'freevideo/agent/assets/' + name
            return dict(file=rel, url=PREFIX + '/media/input/' + rel + '/file')
        if route == '/cast' and method == 'GET':
            for c in CAST.values():
                if c.get('generating') and time.time() > c['_ready']:
                    c['images'] = c['images'] + [dict(media=copy_image(), by='builtin', label='front', generated=True)]
                    c['generating'] = None
            def row(c):
                pick = next((i for i in c['images'] if i['label'] in ('face', 'front')), c['images'][0] if c['images'] else None)
                return dict(id=c['id'], kind=c['kind'], name=c['name'], description=c['description'], origin='agent', revision=c['revision'],
                            images=len(c['images']), voice=c.get('voice') is not None, generating=c.get('generating') is not None,
                            thumbnail=pick['media'] if pick else None)
            return 200, dict(cards=[row(c) for c in CAST.values()], total=len(CAST))
        if route == '/cast' and method == 'POST':
            cid = 'c' + uuid.uuid4().hex[:12]
            card = dict(id=cid, kind=value.get('kind', 'character'), name=value['name'], description=value.get('description'), revision=1,
                        images=[dict(media=dict(file=i['media']['file'], url=PREFIX + '/media/input/' + i['media']['file'] + '/file'), by='user', label=i.get('label', 'other')) for i in value.get('images', [])],
                        voice=value.get('voice'), generating=None)
            CAST[cid] = card
            return 201, dict(card=card)
        m = re.fullmatch(r'/cast/(c[0-9a-f]{12})(/generate)?', route)
        if m:
            card = CAST.get(m.group(1))
            if not card: return problem(404, 'not_found', 'No such card')
            if m.group(2):
                card['generating'] = dict(job='j' + uuid.uuid4().hex[:12]); card['_ready'] = time.time() + 4
                return 201, dict(job=dict(id=card['generating']['job']))
            if method == 'DELETE':
                CAST.pop(card['id']); return 200, dict(deleted=True)
            if method == 'PATCH':
                card.update({k: v for k, v in value.items() if k in ('name', 'description', 'kind', 'voice')}); card['revision'] += 1
                if 'images' in value:
                    card['images'] = [dict(media=dict(file=i['media']['file'], url=PREFIX + '/media/input/' + i['media']['file'] + '/file'), by='user', label=i.get('label', 'other')) for i in value['images']]
                return 200, dict(card=card)
            return 200, card
        if route == '/media/edit':
            made = copy_image()
            return 201, dict(made, view=made, width=1024, height=1024, document={})
        if route == '/imports' and method == 'GET':
            for i in IMPORTS.values():
                if time.time() > i['_ready']: i.update(state='ready', fraction=1)
            return 200, dict(items=[{k: v for k, v in i.items() if not k.startswith('_')} for i in IMPORTS.values()])
        if route == '/projects' and method == 'POST':
            pid = 'e-' + uuid.uuid4().hex
            PROJECTS[pid] = dict(id=pid, revision=1, name=value['project'].get('name', ''), fps=24, tracks=[dict(id='v1', kind='video', clips=[]), dict(id='a1', kind='audio', clips=[])])
            return 201, dict(project=PROJECTS[pid])
        m = re.fullmatch(r'/projects/(e-[0-9a-f]{32})(/.*)?', route)
        if m:
            pr = PROJECTS.get(m.group(1)); sub = m.group(2) or ''
            if not pr: return problem(404, 'not_found', 'No such project')
            if sub == '': return 200, dict(project=pr)
            if value.get('revision') is not None and sub not in ('/voice/estimate',) and value['revision'] != pr['revision']:
                return problem(409, 'project_changed', 'The project changed')
            if sub == '/operations':
                for op in value['operations']:
                    if op['op'] == 'insert':
                        pr['tracks'][0]['clips'].append(dict(id='v' + uuid.uuid4().hex[:6], start=0, frames=97))
                        pr['tracks'][1]['clips'].append(dict(id='a' + uuid.uuid4().hex[:6], start=0, frames=97))
                pr['revision'] += 1
                return 200, dict(project=pr)
            if sub == '/voice/estimate':
                return 200, dict(seconds=4.2, lines=[dict(id=l['id'], seconds=2.4, available=1.5, overrun=.6 if len(l['text']) > 40 else 0) for l in value['lines'] if l['text'] != l['original_text']])
            kind = {'/listen': 'listen', '/voice/lines': 'voice_lines', '/voice/replace': 'voice', '/export': 'export'}.get(sub)
            if kind:
                row = new_job(dict(value, kind=kind, editor_project=pr['id']), None)
                if kind == 'voice': pr['revision'] += 1
                return 201, dict(job=view(row), jobs=[view(row)])
        if route == '/drama/plan' or (route == '/drama' and method == 'POST'):
            play = value['screenplay']
            if route == '/drama/plan':
                return 200, dict(request=value, preview=dict(shots=[dict(prompt=s.get('action', '')) for s in play['shots']], total=len(play['shots']) * value.get('takes_per_shot', 1)),
                                 estimate=dict(seconds=len(play['shots']) * value.get('takes_per_shot', 1) * 95))
            did = 'd' + uuid.uuid4().hex[:12]
            DRAMAS[did] = dict(id=did, title=play.get('title'), status='running', screenplay=play, created_at=now(), updated_at=now(), decisions=[], outputs=[],
                               _t0=time.time(), _takes=value.get('takes_per_shot', 1))
            return 201, dict(drama=self.drama_view(DRAMAS[did]))
        if route == '/drama' and method == 'GET':
            return 200, dict(items=[dict(id=d['id'], title=d['title'], status=self.drama_view(d)['status'], shots=len(d['screenplay']['shots']), updated_at=d['updated_at']) for d in DRAMAS.values()])
        m = re.fullmatch(r'/drama/(d[0-9a-f]{12})(/cancel)?', route)
        if m:
            d = DRAMAS.get(m.group(1))
            if not d: return problem(404, 'not_found', 'No such film')
            if m.group(2): d['status'] = 'cancelled'
            return 200, dict(drama=self.drama_view(d))
        return None

    def drama_view(self, d):
        el = time.time() - d['_t0']; n = len(d['screenplay']['shots']); k = d['_takes']; shots = []
        sample = LIBRARY[-1]['id'] if LIBRARY else None
        for i in range(n):
            takes = []
            for t in range(k):
                done = el > (i * k + t + 1) * 2
                takes.append(dict(take=t + 1, state='succeeded' if done else ('running' if el > (i * k + t) * 2 else 'queued'), library_id=sample if done else None))
            chosen = 1 if all(t['state'] == 'succeeded' for t in takes) else None
            shots.append(dict(id='shot-%d' % (i + 1), index=i + 1, state='chosen' if chosen else 'running', chosen=chosen, takes=takes))
        status = d['status']
        if status != 'cancelled' and all(s['chosen'] for s in shots):
            status = 'finished'
            if not d['outputs']: d['outputs'].append(dict(library_id=sample, seconds=4))
            d['decisions'] = [dict(action='choose', reason='Bản 1 của cảnh %d rõ mặt, đúng hành động.' % (i + 1)) for i in range(n)]
        return dict(id=d['id'], title=d['title'], status=status, screenplay=d['screenplay'], shots=shots, outputs=d['outputs'], decisions=d['decisions'], updated_at=d['updated_at'])

    def handle_extra(self, method):
        route = self.route()
        if route is None or not self.authorized():
            return route is None and self.send_json(404, {})
        value = self.body() if method in ('POST', 'PATCH') else {}
        answer = self.extra(method, urlsplit(route).path, value or {})
        if answer is None:
            return self.send_json(*problem(404, 'not_found', 'No contract'))
        return self.send_json(*answer)

    def do_PATCH(self):
        return self.handle_extra('PATCH')

    def do_DELETE(self):
        return self.handle_extra('DELETE')

    def do_GET(self):
        if urlsplit(self.path).path == '/gptmock/v1/models':
            if self.headers.get('Authorization') != 'Bearer sk-good':
                return self.send_json(401, dict(error=dict(message='Incorrect API key')))
            return self.send_json(200, dict(data=[dict(id=m) for m in ('gpt-4o-mini', 'gpt-4o', 'gpt-4o-audio-preview', 'text-embedding-3-small')]))
        if urlsplit(self.path).path.startswith('/freevideo/') and not self.path.startswith(PREFIX):
            if self.mock_packs() is None:
                self.send_json(404, {})
            return
        route = self.route()
        if route is None or not self.authorized():
            return route is None and self.send_json(404, {})
        query = {k: v[0] for k, v in parse_qs(urlsplit(self.path).query).items()}
        if route == '':
            return self.send_json(200, caps())
        answer = self.extra('GET', urlsplit(route).path, {})
        if answer is not None:
            return self.send_json(*answer)
        if route == '/jobs':
            with LOCK:
                rows = [JOBS[j] for j in ORDER]
                if query.get('kind'):
                    rows = [r for r in rows if r['kind'] == query['kind']]
                if query.get('status'):
                    rows = [r for r in rows if r['status'] in query['status'].split(',')]
                return self.send_json(200, dict(jobs=[view(r, False) for r in rows[:int(query.get('limit', 50))]]))
        match = re.fullmatch(r'/jobs/(j[0-9a-f]{12})', route)
        if match:
            row = JOBS.get(match.group(1))
            if not row:
                return self.send_json(*problem(404, 'not_found', 'No such job'))
            return self.send_json(200, dict(view(row), job=view(row)))
        if route == '/library':
            items = LIBRARY
            if query.get('query'):
                items = [i for i in items if query['query'].lower() in i['prompt'].lower()]
            start = 0
            if query.get('before'):
                start = next((n + 1 for n, i in enumerate(items) if i['id'] == query['before']), len(items))
            limit = int(query.get('limit', 24))
            page = items[start:start + limit]
            return self.send_json(200, dict(items=[dict(id=i['id'], created_at=i['created_at'], video=library_view(i), width=i['width'],
                height=i['height'], seconds=i['seconds'], preview=i['preview'], prompt=i['prompt'][:600], job=None,
                thumbnail=PREFIX + '/library/' + i['id'] + '/thumbnail') for i in page],
                next=page[-1]['id'] if start + limit < len(items) and page else None))
        match = re.fullmatch(r'/library/(\d{4}-\d{2}-\d{2}/[0-9a-f]{32})(/file|/thumbnail)?', route)
        if match:
            item = next((i for i in LIBRARY if i['id'] == match.group(1)), None)
            if not item:
                return self.send_json(*problem(404, 'not_found', 'Library item does not exist'))
            if match.group(2) == '/file':
                return self.send_file(DATA / 'samples' / (item['sample'] + '.mp4'), 'video/mp4')
            if match.group(2) == '/thumbnail':
                return self.send_file(DATA / 'samples' / (item['sample'] + '.jpg'), 'image/jpeg')
            return self.send_json(200, dict(id=item['id'], video=library_view(item), prompt=item['prompt'], seed=item['seed'],
                geometry=dict(width=item['width'], height=item['height'], frames=97, seconds=4.04, fps=24), preview=item['preview'], sample_seconds=93.4))
        match = re.fullmatch(r'/media/(input|output)/(.+)/file', route)
        if match:
            name = Path(unquote(match.group(2))).name
            target = DATA / 'input' / name
            if not target.is_file():
                return self.send_json(404, {})
            types = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.wav': 'audio/wav'}
            return self.send_file(target, types.get(target.suffix.lower(), 'application/octet-stream'))
        return self.send_json(*problem(404, 'not_found', 'No contract'))

    def do_POST(self):
        path = urlsplit(self.path).path
        if path.startswith('/gptmock/'):
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
            user = body['messages'][-1]['content']; system = body['messages'][0]['content']
            if '"lines"' in system and 'Input lines' in user:
                n = len([l for l in user.splitlines() if l[:1].isdigit()])
                out = dict(lines=['Cinematic detailed prompt number %d, golden light, slow dolly shot, ambient sound.' % (i + 1) for i in range(n)])
            elif '"prompt"' in system:
                out = dict(prompt='A detailed cinematic photo, soft window light, 85mm, shallow depth of field.')
            elif '"shots"' in system:
                out = dict(title='Chuyến xe dưới mưa', style='cinematic, warm film look', shots=[dict(action='Lan waits at a rainy bus stop.', seconds=8, camera='slow push-in', cast=['Lan'], lines=[dict(who='Lan', line='Mưa to quá...')]),
                           dict(action='Minh arrives and opens his umbrella for both.', seconds=10, camera='two-shot', cast=['Lan', 'Minh'], lines=[dict(who='Minh', line='Đi chung ô nhé?')])])
            else:
                out = dict(lines=['Shot %d: Lan walks through Hoi An at dusk, lanterns glowing, cinematic.' % (i + 1) for i in range(4)])
            return self.send_json(200, dict(choices=[dict(message=dict(content=json.dumps(out)))]))
        if path == '/freevideo/library/delete-batch':
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length') or 0)) or b'{}')
            gone = [i for i in body.get('ids', []) if any(x['id'] == i for x in LIBRARY)]
            LIBRARY[:] = [x for x in LIBRARY if x['id'] not in gone]
            return self.send_json(200, dict(batch='b1', undo_seconds=10, deleted=gone, skipped=[]))
        if path.startswith('/freevideo/') and not path.startswith(PREFIX):
            self.rfile.read(int(self.headers.get('Content-Length') or 0))
        if path == '/freevideo/image-gen/pack-install':
            PACKS['image-h3'] = 'busy'; return self.send_json(200, {})
        if path == '/freevideo/prompt-vlm/install':
            PACKS['vlm'] = 'ready'; return self.send_json(200, {})
        route = self.route()
        if route is None or not self.authorized():
            return route is None and self.send_json(404, {})
        client = self.headers.get('X-FreeVideo-Client')
        if route == '/media':
            length = int(self.headers.get('Content-Length') or 0)
            raw = b'Content-Type: ' + self.headers['Content-Type'].encode() + b'\r\n\r\n' + self.rfile.read(length)
            message = BytesParser(policy=HTTP).parsebytes(raw)
            part = next(p for p in message.iter_parts() if p.get_param('name', header='content-disposition') == 'file')
            suffix = Path(part.get_filename()).suffix.lower()
            data = part.get_payload(decode=True)
            name = uuid.uuid4().hex + suffix
            (DATA / 'input' / name).write_bytes(data)
            relative = 'freevideo/agent/assets/' + name
            kind = 'image' if suffix in ('.png', '.jpg', '.jpeg', '.webp', '.bmp') else 'video' if suffix in ('.mp4', '.mov', '.webm', '.mkv') else 'audio'
            return self.send_json(201, dict(file=relative, url=PREFIX + '/media/input/' + relative + '/file', kind=kind, name=name, bytes=len(data)))
        if route == '/imports':
            length = int(self.headers.get('Content-Length') or 0)
            self.rfile.read(length)
            iid = uuid.uuid4().hex[:16]
            IMPORTS[iid] = dict(id=iid, name='video.mp4', kind='video', state='preparing', fraction=.2, frames=97, fps=24, source='import:' + iid,
                                preview=PREFIX + '/library/' + LIBRARY[0]['id'] + '/file', thumbnail=PREFIX + '/library/' + LIBRARY[0]['id'] + '/thumbnail', _ready=time.time() + 2)
            return self.send_json(201, dict(import_={k: v for k, v in IMPORTS[iid].items() if not k.startswith('_')}, **{k: v for k, v in IMPORTS[iid].items() if not k.startswith('_')}))
        value = self.body()
        answer = self.extra('POST', route, value or {})
        if answer is not None:
            return self.send_json(*answer)
        if route == '/plan':
            return self.send_json(*plan(value))
        if route == '/jobs':
            specs = value['jobs'] if 'jobs' in value else [value]
            created = []
            for spec in specs:
                if spec.get('kind', 'generate') == 'generate' and not spec.get('refine_from'):
                    status, answer = plan(spec)
                    if status != 200:
                        return self.send_json(status, answer)
                for _ in range(int(spec.get('takes', 1))):
                    created.append(view(new_job(dict(spec), client)))
            return self.send_json(201, dict(job=created[0], jobs=created))
        match = re.fullmatch(r'/jobs/(j[0-9a-f]{12})/(cancel|resume)', route)
        if match:
            row = JOBS.get(match.group(1))
            if not row:
                return self.send_json(*problem(404, 'not_found', 'No such job'))
            with LOCK:
                if match.group(2) == 'cancel':
                    if row['status'] == 'queued':
                        row.update(status='cancelled', finished_at=now(), error=dict(code='cancelled', message='Cancelled'))
                    else:
                        row['cancel'] = True
                        row['status'] = 'cancelling' if row['status'] == 'running' else row['status']
                else:
                    row.update(status='queued', error=None, finished_at=None, cancel=False)
            return self.send_json(200, dict(view(row), job=view(row)))
        return self.send_json(*problem(404, 'not_found', 'No contract'))


if __name__ == '__main__':
    prepare()
    threading.Thread(target=worker, daemon=True).start()
    print('Mock FreeVideo at http://127.0.0.1:%d  token: %s' % (PORT, ROOT / 'agent' / 'token'))
    ThreadingHTTPServer(('127.0.0.1', PORT), Handler).serve_forever()
