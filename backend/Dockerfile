# Use a base Python image
FROM python:3.10-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Argument to select device type: 'cuda' (default) or 'rocm'
ARG DEVICE_TYPE=cuda

# Install PyTorch based on DEVICE_TYPE
# Note: For ROCm, we might need a different base image or specific pip index.
# This approach tries to keep it simple within a standard python image.
RUN if [ "$DEVICE_TYPE" = "rocm" ]; then \
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm6.2; \
    else \
    pip install torch torchvision torchaudio; \
    fi

RUN pip install -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
