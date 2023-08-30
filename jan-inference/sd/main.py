from fastapi import FastAPI, BackgroundTasks, HTTPException, Form
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import subprocess
import os
from uuid import uuid4
from pydantic import BaseModel

app = FastAPI()

OUTPUT_DIR = "output"
SD_PATH = os.environ.get("SD_PATH", "./sd")
MODEL_DIR = os.environ.get("MODEL_DIR", "./models")
MODEL_NAME = os.environ.get(
    "MODEL_NAME", "v1-5-pruned-emaonly-ggml-model-q5_0.bin")


class Payload(BaseModel):
    prompt: str
    neg_prompt: str
    seed: int
    steps: int
    width: int
    height: int


# Create the OUTPUT_DIR directory if it does not exist
if not os.path.exists(OUTPUT_DIR):
    os.makedirs(OUTPUT_DIR)

# Create the OUTPUT_DIR directory if it does not exist
if not os.path.exists(MODEL_DIR):
    os.makedirs(MODEL_DIR)

# Serve files from the "files" directory
app.mount("/output", StaticFiles(directory=OUTPUT_DIR), name="output")


def run_command(payload: Payload, filename: str):
    # Construct the command based on your provided example
    command = [SD_PATH,
               "--model", f'{os.path.join(MODEL_DIR, MODEL_NAME)}',
               "--prompt", f'"{payload.prompt}"',
               "--negative-prompt", f'"{payload.neg_prompt}"',
               "--height", str(payload.height),
               "--width", str(payload.width),
               "--steps", str(payload.steps),
               "--seed", str(payload.seed),
               "--mode", 'txt2img',
               "-o", f'{os.path.join(OUTPUT_DIR, filename)}',
               ]

    try:
        subprocess.run(command, timeout=5*60)
    except subprocess.CalledProcessError:
        raise HTTPException(
            status_code=500, detail="Failed to execute the command.")


@app.post("/inferences/txt2img")
async def run_inference(background_tasks: BackgroundTasks, payload: Payload):
    # Generate a unique filename using uuid4()
    filename = f"{uuid4()}.png"

    # We will use background task to run the command so it won't block
    background_tasks.add_task(run_command, payload, filename)

    # Return the expected path of the output file
    return {"url": f'/serve/{filename}'}


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
