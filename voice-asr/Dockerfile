FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000 STREAM_CHANNEL=thegrefg
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl unzip ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "streamlink>=8.0,<9" "vosk>=0.3.45,<0.4"
RUN mkdir -p /app/model && curl -fsSL --retry 3 --max-time 180 "https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip" -o /tmp/vosk.zip && unzip -q /tmp/vosk.zip -d /app/model/ && rm /tmp/vosk.zip
WORKDIR /app
COPY voice-asr/server.py /app/server.py
EXPOSE 10000
CMD ["python","server.py"]
