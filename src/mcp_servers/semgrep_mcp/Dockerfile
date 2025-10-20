FROM python:3.12-slim

WORKDIR /app

# Install system dependencies and Semgrep
RUN apt-get update && apt-get install -y \
    gcc \
    git \
    curl \
    && pip install --no-cache-dir semgrep>=1.45.0 \
    && rm -rf /var/lib/apt/lists/*

# Copy server code
COPY src/mcp-servers/semgrep-mcp/ /app/server/

# Install Python dependencies
RUN pip install --no-cache-dir \
    boto3>=1.28.0 \
    mcp>=0.1.0

# Expose MCP server port
EXPOSE 8080

# Run MCP server
CMD ["python", "/app/server/server.py"]