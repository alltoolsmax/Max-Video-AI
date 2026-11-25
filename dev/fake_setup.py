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
    n = 6 if i == 2 else 3
    for k in range(n):
        time.sleep(0.5)
        if i == 2:
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
