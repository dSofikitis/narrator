# Narrator

Narrator is a lightweight web app for reading text aloud in the browser. The Python backend serves the UI and keeps the setup simple.

## Features
- Paste text or load a local file
- Voice selector with recommended men and women voices when available
- Play, pause, stop, skip back, and skip next by sentence
- Read speed and volume controls

## Run locally (Windows)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
python backend/main.py
```

Open http://127.0.0.1:8000

## Notes
- Voice availability depends on your OS and browser. Windows voices are provided by the system.
- The UI uses the Web Speech API for speech synthesis.
