FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy shared modules first (maintain src directory structure for imports)
COPY src/shared/ /app/src/shared/

# Copy agent code
COPY src/agents/strategist/ /app/agent/

# Install Python dependencies
RUN pip install --no-cache-dir \
    boto3>=1.28.0 \
    redis>=4.5.0

# Set Python path to include shared modules
ENV PYTHONPATH=/app:$PYTHONPATH

# Run agent
CMD ["python", "/app/agent/agent.py"]