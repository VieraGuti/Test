FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=10000
RUN pip install --no-cache-dir "websocket-client>=1.8,<2" "streamlink>=8.0,<9"
WORKDIR /app
COPY multi-chat/server.py /app/server.py
EXPOSE 10000
CMD ["python","/app/server.py"]
