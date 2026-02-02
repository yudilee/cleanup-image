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
ARG LEGACY_GPU=false

# Install PyTorch based on DEVICE_TYPE and LEGACY_GPU
RUN if [ "$DEVICE_TYPE" = "rocm" ]; then \
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm6.2; \
    elif [ "$LEGACY_GPU" = "true" ]; then \
    # For older NVIDIA GPUs (GTX 9xx / Maxwell / Pascal), use CUDA 11.8 which supports sm_50
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118; \
    else \
    # Default: Latest PyTorch (likely CUDA 12.x)
    pip install torch torchvision torchaudio; \
    fi

RUN pip install -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
