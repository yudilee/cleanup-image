# Deploying on Windows 11

Since the app is now on GitHub, the first step is to get the code onto your computer.

### 1. Get the Code
1.  Open **Command Prompt** or **PowerShell**.
2.  Clone the repository:
    ```powershell
    git clone https://github.com/yudilee/cleanup-image.git
    cd cleanup-image
    ```

---

## 2. Choose Deployment Method

You have two main options:
1.  **Docker Desktop** (Recommended - Easiest & Most Stable)
2.  **Native Installation** (Requires manually installing Python & Node.js)

### Option 1: Docker Desktop (Recommended)

This method isolates the app and handles dependencies automatically.

**Prerequisites:**
1.  Install **Docker Desktop for Windows**: [Download Here](https://www.docker.com/products/docker-desktop/)
2.  Ensure **WSL 2** is enabled (Docker usually prompts you to do this).

**Steps:**
1.  In your `cleanup-image` folder (from Step 1), run:
    ```powershell
    docker-compose up --build
    ```
2.  Open your browser to [http://localhost:3000](http://localhost:3000).

> [!NOTE]
> GPU Support: Docker Desktop handles NVIDIA GPUs automatically if you have the latest drivers installed.

---

### Option 2: Native Installation

Use this if you don't want to use Docker.

**Prerequisites:**
1.  **Python 3.10+**: [Download Here](https://www.python.org/downloads/) (Add to PATH)
2.  **Node.js 18+ (LTS)**: [Download Here](https://nodejs.org/en/download/)

**Step 1: Backend Setup**
1.  Open **PowerShell** as Administrator.
2.  Navigate to `backend`: `cd backend`
3.  Run the setup script:
    ```powershell
    Set-ExecutionPolicy Unrestricted -Scope Process
    .\setup_windows.ps1
    ```
4.  Start server:
    ```powershell
    .\venv\Scripts\activate
    uvicorn main:app --host 0.0.0.0 --port 8000 --reload
    ```

**Step 2: Frontend Setup**
1.  Open new PowerShell in `frontend`.
2.  Run:
    ```powershell
    npm install
    npm run dev
    ```
3.  Open [http://localhost:3000](http://localhost:3000).

---

## Troubleshooting

- **APT-GET Error 100**: If Docker fails with exit code 100 during build:
    1.  Open Admin PowerShell.
    2.  Run `wsl --shutdown`.
    3.  Restart Docker Desktop.
- **Port Conflicts**: Ensure ports 3000 and 8000 are free.
