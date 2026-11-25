"""Kịch bản thử giao diện với Playwright (cần mock_server.py và harness.js đang chạy)."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/shots')
OUT.mkdir(parents=True, exist_ok=True)
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    page.on('console', lambda m: m.type == 'error' and errors.append(m.text))
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://127.0.0.1:5173/')
    page.wait_for_selector('.page-head h1')
    page.wait_for_timeout(2500)
    page.screenshot(path=str(OUT / '01-video-empty.png'))

    # Gõ prompt bằng gợi ý nhanh, chờ ước tính
    page.click('text=Phố đêm mưa')
    page.wait_for_selector('.estimate', timeout=8000)
    page.screenshot(path=str(OUT / '02-video-filled.png'))

    # Chọn tham chiếu + khung đầu
    page.click('summary:has-text("Ảnh & tham chiếu")')
    page.click('.slot:has-text("Khung hình đầu")')
    page.wait_for_selector('.slot.filled img', timeout=8000)
    page.click('text=Cao')
    page.wait_for_timeout(1200)
    page.screenshot(path=str(OUT / '03-video-media.png'), full_page=False)

    # Tạo video
    page.click('button.btn-hero')
    page.wait_for_selector('.job .progress', timeout=8000)
    page.wait_for_timeout(5000)
    page.screenshot(path=str(OUT / '04-video-running.png'))
    page.wait_for_selector('.job video', timeout=40000)
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / '05-video-done.png'))

    # Chế độ prompt đầy đủ + viết lại bằng AI
    page.click('.tab:has-text("Prompt đầy đủ")')
    page.click('button:has-text("Viết lại bằng AI")')
    page.wait_for_timeout(6000)
    page.screenshot(path=str(OUT / '06-video-raw.png'))

    # Trang Tạo ảnh
    page.click('.nav-item:has-text("Tạo ảnh")')
    page.click('text=Poster sản phẩm')
    page.click('.chip:has-text("2 ảnh")')
    page.click('button.btn-hero')
    page.wait_for_timeout(2500)
    page.screenshot(path=str(OUT / '07-image-running.png'))
    page.wait_for_selector('.job img.result', timeout=40000)
    page.wait_for_timeout(1000)
    page.screenshot(path=str(OUT / '08-image-done.png'))

    # Hàng đợi
    page.click('.nav-item:has-text("Hàng đợi")')
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / '09-queue.png'))
    page.click('table.data tbody tr >> nth=0')
    page.wait_for_selector('.drawer.open', timeout=5000)
    page.wait_for_timeout(1200)
    page.screenshot(path=str(OUT / '10-queue-drawer.png'))
    page.keyboard.press('Escape')

    # Thư viện
    page.click('.nav-item:has-text("Thư viện")')
    page.wait_for_selector('.tile', timeout=8000)
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / '11-library.png'))
    page.click('.tile >> nth=1')
    page.wait_for_selector('.drawer.open .kv', timeout=5000)
    page.wait_for_timeout(800)
    page.screenshot(path=str(OUT / '12-library-drawer.png'))
    page.click('.drawer button:has-text("Làm tiếp")')
    page.wait_for_timeout(1000)
    page.screenshot(path=str(OUT / '13-continue.png'))

    # Cài đặt + tối
    page.click('.nav-item:has-text("Cài đặt")')
    page.wait_for_timeout(1000)
    page.screenshot(path=str(OUT / '14-settings.png'))
    page.click('#theme-btn')
    page.click('.nav-item:has-text("Tạo video")')
    page.wait_for_timeout(1500)
    page.screenshot(path=str(OUT / '15-dark.png'))
    page.click('#theme-btn')
    page.click('.nav-item:has-text("Autopilot")')
    page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / '16-soon.png'))
    browser.close()

print('errors:', errors)
