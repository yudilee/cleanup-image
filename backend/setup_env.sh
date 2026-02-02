#!/bin/bash

# Create venv if not exists
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

source venv/bin/activate

# Install requirements first (excluding torch to avoid conflict if possible, but simple-lama might pull it)
# We will explicitly install torch based on hardware

if command -v nvidia-smi &> /dev/null; then
    echo "NVIDIA GPU detected. Installing PyTorch with CUDA support..."
    pip install torch torchvision torchaudio
elif command -v rocminfo &> /dev/null; then
    echo "AMD GPU detected. Installing PyTorch with ROCm support..."
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm6.2
else
    echo "No GPU detected or unknown. Installing CPU-only PyTorch..."
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
fi

pip install -r requirements.txt
