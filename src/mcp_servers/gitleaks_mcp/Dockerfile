FROM python:3.12-slim

WORKDIR /app

# Install system dependencies and Gitleaks
RUN apt-get update && apt-get install -y \
    gcc \
    git \
    curl \
    && curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.18.1/gitleaks_8.18.1_linux_x64.tar.gz | tar -xz -C /usr/local/bin \
    && chmod +x /usr/local/bin/gitleaks \
    && rm -rf /var/lib/apt/lists/*

# Copy server code
COPY src/mcp-servers/gitleaks-mcp/ /app/server/

# Install Python dependencies
RUN pip install --no-cache-dir \
    boto3>=1.28.0 \
    mcp>=0.1.0

# Expose MCP server port
EXPOSE 8080

# Run MCP server
CMD ["python", "/app/server/server.py"]