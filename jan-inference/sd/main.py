from fastapi import FastAPI, BackgroundTasks, HTTPException, Form
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import subprocess
import os
from uuid import uuid4

app = FastAPI()

OUTPUT_DIR = "output"
SD_PATH = os.environ.get("SD_PATH", "./sd")
MODEL_DIR = os.environ.get("MODEL_DIR", "./models")
BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
MODEL_NAME = os.environ.get(
    "MODEL_NAME", "v1-5-pruned-emaonly-ggml-model-q5_0.bin")

# Create the OUTPUT_DIR directory if it does not exist
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

# Create the OUTPUT_DIR directory if it does not exist
if not os.path.exists(MODEL_DIR):
    os.makedirs(MODEL_DIR)

# Serve files from the "files" directory
app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")


def run_command(prompt: str, filename: str):
    # Construct the command based on your provided example
    command = [SD_PATH,
               "-m", os.path.join(MODEL_DIR, MODEL_NAME),
               "-p", prompt,
               "-o", os.path.join(OUTPUT_DIR, filename)
               ]

    try:
        sub_output = subprocess.run(command, timeout=5*60, capture_output=True,
                                    check=True, encoding="utf-8")
        print(sub_output.stdout)
    except subprocess.CalledProcessError:
        raise HTTPException(
            status_code=500, detail="Failed to execute the command.")


@app.post("/inference/")
async def run_inference(background_tasks: BackgroundTasks, prompt: str = Form()):
    # Generate a unique filename using uuid4()
    filename = f"{uuid4()}.png"

    # We will use background task to run the command so it won't block
    background_tasks.add_task(run_command, prompt, filename)

    # Return the expected path of the output file
    return {"url": f'{BASE_URL}/serve/{filename}'}


@app.get("/serve/{filename}")
async def serve_file(filename: str):
    file_path = os.path.join(OUTPUT_DIR, filename)

    if os.path.exists(file_path):
        return FileResponse(file_path)
    else:
        raise HTTPException(status_code=404, detail="File not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
