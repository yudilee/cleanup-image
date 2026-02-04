#!/bin/bash

# Function to kill all child processes on exit
cleanup() {
    echo "Shutting down..."
    kill $(jobs -p)
    exit
}

trap cleanup SIGINT SIGTERM

echo "Starting Cleanup Image Application..."

# Start Backend
echo "Starting Backend..."
cd backend
# Check if venv exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    ./setup_env.sh
else
    source venv/bin/activate
fi
uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..

# Start Frontend
echo "Starting Frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo "App is running!"
echo "Frontend: http://localhost:3000"
echo "Backend: http://localhost:8000"
echo "Press Ctrl+C to stop."

wait
