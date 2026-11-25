"""Giả lập engine_host.py: báo engine đã mở ở máy chủ giả lập (dev/mock_server.py, cổng 8188)."""
import json, sys, time
def say(kind, **v): print(json.dumps(dict(event='maxai_engine', kind=kind, **v)), flush=True)
say('stage', label='Đang chuẩn bị ComfyUI'); time.sleep(1)
say('stage', label='Đang khởi động engine AI'); time.sleep(1)
say('open', url='http://127.0.0.1:8188', owned=True)
sys.stdin.read()
say('stopped')
