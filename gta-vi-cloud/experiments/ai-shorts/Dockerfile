FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg git ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
# Exact upstream commit: tested application logic, separate from live backend.
RUN git clone --depth 1 https://github.com/Anil-matcha/AI-Youtube-Shorts-Generator.git /app/upstream \
    && git -C /app/upstream checkout 8c9ac3103a137e53669aeebfc2af8dbdd810c35a
RUN pip install --no-cache-dir 'requests>=2.31' 'python-dotenv>=1.0' 'opencv-python-headless==4.13.0.92'
COPY adapter.py test_adapter.py quality_gate.py test_quality_gate.py test_routes.py render_demo.py ./
RUN python -m unittest discover -s /app -p "test_*.py" -v
RUN useradd --create-home --uid 10001 demo && mkdir -p /app/output && chown -R demo:demo /app/output
USER demo
CMD ["python","/app/render_demo.py"]
