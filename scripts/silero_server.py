import sys
import os
import io
import wave
import json
import subprocess
from http.server import HTTPServer, BaseHTTPRequestHandler

def ensure_dependencies():
    missing = []
    try:
        import torch
    except ImportError:
        missing.append('torch')
    try:
        import numpy
    except ImportError:
        missing.append('numpy')

    if missing:
        print(f'[silero] Отсутствуют зависимости: {missing}. Установка через pip...')
        sys.stdout.flush()
        cmd = [sys.executable, '-m', 'pip', 'install'] + missing
        try:
            subprocess.check_call(cmd)
            print('[silero] Зависимости успешно установлены.')
            sys.stdout.flush()
        except Exception as e:
            print(f'[silero] Ошибка установки зависимостей: {e}')
            sys.stdout.flush()
            sys.exit(1)

ensure_dependencies()

import torch
import numpy as np

PORT = int(os.environ.get('SILERO_PORT', 5000))
device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
print(f'[silero] Инициализация на устройстве: {device}...')
sys.stdout.flush()

try:
    model, _ = torch.hub.load(
        repo_or_dir='snakers4/silero-models',
        model='silero_tts',
        language='ru',
        speaker='v4_ru',
        trust_repo=True
    )
    model.to(device)
    print(f'[silero] Модель Silero (v4_ru) успешно загружена на {device}!')
    sys.stdout.flush()
except Exception as e:
    print(f'[silero] Ошибка загрузки модели: {e}')
    sys.stdout.flush()
    sys.exit(1)

SPEAKERS = ['xenia', 'baya', 'kseniya', 'eugene', 'aidar', 'random']

class SileroHandler(BaseHTTPRequestHandler):
    def _set_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path in ['/health', '/']:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            res = {
                'status': 'ok',
                'device': str(device),
                'speakers': SPEAKERS
            }
            self.wfile.write(json.dumps(res).encode('utf-8'))
        elif self.path == '/shutdown':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'ok': True, 'message': 'Shutting down'}).encode('utf-8'))
            import threading
            def _exit():
                import time
                time.sleep(0.3)
                os._exit(0)
            threading.Thread(target=_exit, daemon=True).start()
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path.startswith('/synthesize'):
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(body)

                text = data.get('text', '').strip()
                speaker = data.get('speaker', 'xenia')
                sample_rate = int(data.get('sample_rate', 48000))

                if not text:
                    self.send_response(400)
                    self.end_headers()
                    self.wfile.write(b'Text is empty')
                    return

                if speaker not in SPEAKERS:
                    speaker = 'xenia'

                if sample_rate not in [8000, 24000, 48000]:
                    sample_rate = 48000

                audio = model.apply_tts(
                    text=text,
                    speaker=speaker,
                    sample_rate=sample_rate
                )

                int16_audio = (audio * 32767).clamp(-32768, 32767).to(torch.int16).cpu().numpy().tobytes()
                buf = io.BytesIO()
                with wave.open(buf, 'wb') as wav:
                    wav.setnchannels(1)
                    wav.setsampwidth(2)
                    wav.setframerate(sample_rate)
                    wav.writeframes(int16_audio)

                wav_bytes = buf.getvalue()

                self.send_response(200)
                self.send_header('Content-Type', 'audio/wav')
                self.send_header('Content-Length', str(len(wav_bytes)))
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(wav_bytes)

            except Exception as e:
                print(f'[silero] Ошибка синтеза: {e}')
                sys.stdout.flush()
                self.send_response(500)
                self._set_cors_headers()
                self.end_headers()
                self.wfile.write(str(e).encode('utf-8'))
        elif self.path == '/shutdown':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._set_cors_headers()
            self.end_headers()
            self.wfile.write(json.dumps({'ok': True, 'message': 'Shutting down'}).encode('utf-8'))
            import threading
            def _exit():
                import time
                time.sleep(0.3)
                os._exit(0)
            threading.Thread(target=_exit, daemon=True).start()
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        if ' 200 ' not in format % args:
            sys.stderr.write('[silero] ' + (format % args) + '\n')

if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', PORT), SileroHandler)
    print(f'[silero] Сервер запущен на http://127.0.0.1:{PORT}')
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('[silero] Сервер остановлен.')
        server.server_close()
