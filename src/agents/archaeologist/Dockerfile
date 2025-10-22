FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy shared libraries
COPY src/shared /app/src/shared

# Copy agent code
COPY src/agents/archaeologist /app/agent

# Install Python dependencies
COPY src/shared/requirements.txt /app/shared-requirements.txt
RUN pip install --no-cache-dir -r /app/shared-requirements.txt
RUN pip install --no-cache-dir mcp>=0.9.0

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app:/app/src

# Run agent
CMD ["python", "/app/agent/agent.py"]