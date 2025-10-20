FROM python:3.12-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy shared libraries
COPY src/shared /app/shared

# Copy agent code
COPY src/agents/archaeologist /app/agent

# Install Python dependencies
RUN pip install --no-cache-dir \
    boto3>=1.34.0 \
    redis>=5.0.0 \
    botocore>=1.34.0

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

# Run agent
CMD ["python", "/app/agent/agent.py"]