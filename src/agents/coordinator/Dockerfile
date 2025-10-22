FROM python:3.12-slim

ARG AGENT_NAME=coordinator

WORKDIR /app

RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

COPY src/shared /app/src/shared
COPY src/mcp_servers /app/src/mcp_servers
COPY src/agents/coordinator /app/agent

COPY src/shared/requirements.txt /app/shared-requirements.txt
RUN pip install --no-cache-dir -r /app/shared-requirements.txt
RUN pip install --no-cache-dir mcp>=0.9.0

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app:/app/src

WORKDIR /app/agent

CMD ["python", "agent.py"]
