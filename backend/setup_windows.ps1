# Check for Python
if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
    Write-Host "Python not found! Please install Python 3.10+ from python.org" -ForegroundColor Red
    exit
}

# Create venv if not exists
if (-not (Test-Path "venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv venv
}

# Activate venv
Write-Host "Activating virtual environment..."
& .\venv\Scripts\Activate.ps1

# Check for NVIDIA GPU (simple check using nvidia-smi)
if (Get-Command "nvidia-smi" -ErrorAction SilentlyContinue) {
    Write-Host "NVIDIA GPU detected. Installing PyTorch with CUDA support..." -ForegroundColor Green
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
} else {
    Write-Host "No NVIDIA GPU detected. Installing CPU-only PyTorch..." -ForegroundColor Yellow
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
}

# Install other requirements
Write-Host "Installing requirements..."
pip install -r requirements.txt

Write-Host "Setup complete! Run 'venv\Scripts\python main.py' to start the server." -ForegroundColor Cyan
