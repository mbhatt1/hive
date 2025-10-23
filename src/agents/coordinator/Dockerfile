FROM python:3.12-slim

ARG AGENT_NAME=coordinator

WORKDIR /app

RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

COPY src/shared /app/src/shared
COPY src/mcp_servers /app/src/mcp_servers
COPY src/agents/coordinator /app/agent

COPY src/shared/requirements.txt /app/shared-requirements.txt
RUN pip install --no-cache-dir -r /app/shared-requirements.txt

COPY src/agents/coordinator/requirements.txt /app/agent-requirements.txt
RUN pip install --no-cache-dir -r /app/agent-requirements.txt

# Install MCP SDK and all MCP server dependencies
RUN pip install --no-cache-dir mcp>=0.9.0
RUN for mcp_dir in /app/src/mcp_servers/*/; do \
    if [ -f "${mcp_dir}requirements.txt" ]; then \
        pip install --no-cache-dir -r "${mcp_dir}requirements.txt"; \
    fi; \
done

# Install security scanning tools
RUN apt-get update && apt-get install -y \
    semgrep \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install gitleaks
RUN curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.18.1/gitleaks_8.18.1_linux_x64.tar.gz | \
    tar -xz -C /usr/local/bin gitleaks

# Install trivy
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin v0.48.0

ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app:/app/src

WORKDIR /app/agent

CMD ["python", "agent.py"]
