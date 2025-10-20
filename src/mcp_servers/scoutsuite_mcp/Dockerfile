FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install ScoutSuite
RUN pip install --no-cache-dir scoutsuite>=5.12.0

# Install AWS SDK
RUN pip install --no-cache-dir boto3>=1.26.0

# Create working directory
WORKDIR /app

# Copy server code
COPY server.py .
COPY requirements.txt .

# Install additional requirements
RUN pip install --no-cache-dir -r requirements.txt

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Run the server
CMD ["python", "server.py"]