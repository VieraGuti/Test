FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=10000 FRAME_SECONDS=4 STREAM_CHANNEL=thegrefg
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg tesseract-ocr tesseract-ocr-eng ca-certificates && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir "streamlink>=8.0,<9" "pillow>=11,<13" "pytesseract>=0.3.13,<0.5"
WORKDIR /app
COPY screen-ocr/server.py /app/server.py
EXPOSE 10000
CMD ["python","server.py"]
