"""Giả lập trình cài của FreeVideo (chỉ để thử giao diện Max AI, không cài gì thật)."""
import json, sys, time, os, shutil
from pathlib import Path
args = sys.argv[1:]
root = Path(args[args.index('--root') + 1])
def ev(kind, **v): print(json.dumps(dict(event='freevideo_ui', kind=kind, **v)), flush=True)
if '--plan' in args:
    plan = json.load(open(os.path.join(os.path.dirname(__file__), 'fake_plan.json')))
    plan['root'] = str(root)
    print('FreeVideo: preparing…'); print(json.dumps(plan, indent=2)); sys.exit(0)
steps = ['Cài uv/Python và môi trường CUDA', 'Tải mã VDN và Diffusers', 'Tải và kiểm tra mô hình', 'Chuẩn bị bộ nhớ đệm FP8', 'Kiểm tra kernel GPU']
for i, name in enumerate(steps):
    ev('phase', label=name, done=i, total=len(steps))
    ev('task', key=str(i), label=name, detail='', done=0, total=100)
    n = 6 if i == 2 else 2
    for k in range(n):
        time.sleep(0.5)
        if i == 2:
            G = 2**30
            def g(id, total, ready, state, got=0, need=0): return dict(id=id, total_bytes=total, ready_bytes=ready, download_bytes=need, downloaded_bytes=got, state=state, files=10, ready_files=3, bytes_per_second=42_000_000 if state == 'downloading' else None)
            print(json.dumps(dict(event='model_groups', groups=[
                g('video', 21 * G, (k + 1) * 3 * G, 'downloading', (k + 1) * 3 * G, 21 * G), g('text', 15 * G, 0, 'waiting', 0, 15 * G),
                g('decoder', 10 * G, 10 * G, 'ready'), g('sampling', 2 * G, int(0.5 * G), 'verifying')])), flush=True)
            print(json.dumps(dict(event='download_model', file='H:\\MaxAI-Engine\\models\\vdn\\dit-00003.safetensors', name='Video model', bytes=5 * G)), flush=True)
            if os.environ.get('FAKE_FAIL') and k == 3:
                ev('failure', error='RuntimeError: Failed step: models (exit code 1)\nRetained step log: H:\\x\\04-models.log\n\nFull step output:\n{...}\nRuntimeError: Model download paused: qwen3vl_32b.safetensors (xet). x'); sys.exit(1)
            print(json.dumps(dict(event='local_model_progress', phase='download', name='VDN-H3 int8', done_bytes=(k + 1) * 4_000_000_000, total_bytes=24_000_000_000)), flush=True)
        else:
            ev('progress', key=str(i), label=name, detail='%d%%' % ((k + 1) * 100 // n), done=(k + 1) * 100 // n, total=100)
        print('log: step %d.%d' % (i, k), flush=True)
    ev('task_end', key=str(i), label=name, detail='xong', done=100, total=100)
if os.environ.get('FAKE_FAIL'):
    ev('failure', error='Mạng bị ngắt khi tải mô hình. Chạy lại để tải tiếp.'); sys.exit(1)
(root / 'agent').mkdir(parents=True, exist_ok=True)
mock = Path(__file__).parent / 'mock_root' / 'agent' / 'token'
shutil.copy(mock, root / 'agent' / 'token')
(root / 'machine.json').write_text(json.dumps(dict(ready=True, python='python3', gpu_name='NVIDIA GeForce RTX 4070', vram_gib=12, ram_gib=32, prepared_format='int8_convrot')))
ev('phase', label='Hoàn tất', done=len(steps), total=len(steps))
