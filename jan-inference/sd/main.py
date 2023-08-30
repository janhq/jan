from fastapi import FastAPI, BackgroundTasks, HTTPException, Form
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import subprocess
import os
from uuid import uuid4
from pydantic import BaseModel
import boto3
from botocore.client import Config

app = FastAPI()

OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "output")
SD_PATH = os.environ.get("SD_PATH", "./sd")
MODEL_DIR = os.environ.get("MODEL_DIR", "./models")
MODEL_NAME = os.environ.get(
    "MODEL_NAME", "v1-5-pruned-emaonly.safetensors.q4_0.bin")

S3_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL", "http://localhost:9000")
S3_PUBLIC_ENDPOINT_URL = os.environ.get(
    "S3_PUBLIC_ENDPOINT_URL", "http://localhost:9000")
S3_ACCESS_KEY_ID = os.environ.get("S3_ACCESS_KEY_ID", "minio")
S3_SECRET_ACCESS_KEY = os.environ.get("S3_SECRET_ACCESS_KEY", "minio123")
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME", "jan")

s3 = boto3.resource('s3',
                    endpoint_url=S3_ENDPOINT_URL,
                    aws_access_key_id=S3_ACCESS_KEY_ID,
                    aws_secret_access_key=S3_SECRET_ACCESS_KEY,
                    config=Config(signature_version='s3v4'),
                    region_name='us-east-1')

s3_bucket = s3.Bucket(S3_BUCKET_NAME)


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
        subprocess.run(command)
    except subprocess.CalledProcessError:
        raise HTTPException(
            status_code=500, detail="Failed to execute the command.")


@app.post("/inferences/txt2img")
async def run_inference(background_tasks: BackgroundTasks, payload: Payload):
    # Generate a unique filename using uuid4()
    filename = f"{uuid4()}.png"

    # We will use background task to run the command so it won't block
    # background_tasks.add_task(run_command, payload, filename)
    run_command(payload, filename)
    s3_bucket.upload_file(f'{os.path.join(OUTPUT_DIR, filename)}', filename)
    # Return the expected path of the output file
    return {"url": f'{S3_PUBLIC_ENDPOINT_URL}/{S3_BUCKET_NAME}/{filename}'}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
