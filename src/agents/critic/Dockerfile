FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy shared modules
COPY src/shared/ /app/src/shared/

# Copy agent code
COPY src/agents/critic/ /app/agent/

# Install Python dependencies
COPY src/shared/requirements.txt /app/shared-requirements.txt
RUN pip install --no-cache-dir -r /app/shared-requirements.txt
RUN pip install --no-cache-dir mcp>=0.9.0

# Set Python path to include shared modules
ENV PYTHONPATH=/app:/app/src

# Run agent
CMD ["python", "/app/agent/agent.py"]