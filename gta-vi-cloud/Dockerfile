FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 WORKER_ENABLED=false
WORKDIR /srv
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl unzip ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir httpx==0.28.1 pillow==11.3.0 'yt-dlp>=2026.1'
RUN curl -fLsS --retry 3 https://github.com/lay295/TwitchDownloader/releases/download/1.56.5/TwitchDownloaderCLI-1.56.5-Linux-x64.zip -o /tmp/td.zip && mkdir /tmp/td && unzip -q /tmp/td.zip -d /tmp/td && find /tmp/td -type f -name TwitchDownloaderCLI -exec cp {} /usr/local/bin/TwitchDownloaderCLI \; && chmod +x /usr/local/bin/TwitchDownloaderCLI && rm -rf /tmp/td /tmp/td.zip
COPY cloud.py ./cloud.py
COPY video_branding.py ./video_branding.py
COPY shorts_title_policy.py ./shorts_title_policy.py
COPY test_shorts_title_policy.py ./test_shorts_title_policy.py
COPY test_worker_review.py ./test_worker_review.py
COPY test_ai_fallback.py ./test_ai_fallback.py
COPY daily_compilations.py ./daily_compilations.py
COPY daily_runner.py ./daily_runner.py
COPY youtube_long_upload.py ./youtube_long_upload.py
COPY test_daily_compilations.py ./test_daily_compilations.py
RUN python -m py_compile /srv/cloud.py /srv/daily_compilations.py /srv/daily_runner.py /srv/youtube_long_upload.py /srv/video_branding.py /srv/shorts_title_policy.py
RUN python /srv/test_daily_compilations.py && python /srv/test_shorts_title_policy.py && python /srv/test_worker_review.py && python /srv/test_ai_fallback.py
RUN useradd --create-home --uid 10001 worker
USER worker
CMD ["python","cloud.py"]
