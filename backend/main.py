from fastapi import FastAPI, UploadFile, File, Query, BackgroundTasks, HTTPException
import uuid
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from io import BytesIO
from PIL import Image
from model import inpainting_model
from typing import Optional, List
import numpy as np
import cv2
import zipfile

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Quality preset max dimensions
QUALITY_PRESETS = {
    "fast": 512,
    "balanced": 1024,
    "high": 99999,  # Original resolution (no resize)
}

# Lazy load rembg to avoid slow startup
_rembg_session = None

# In-memory job store
# Structure: { job_id: { "status": "processing" | "completed" | "failed", "result": bytes | None, "error": str | None } }
JOBS = {}

def process_inpaint_job(job_id: str, image_pil: Image.Image, mask_pil: Image.Image, max_dim: int, original_size: tuple):
    try:
        # Resize if image exceeds max dimension
        w, h = image_pil.size
        if max(w, h) > max_dim:
            scale = max_dim / max(w, h)
            new_w = int(w * scale)
            new_h = int(h * scale)
            image_pil = image_pil.resize((new_w, new_h), Image.LANCZOS)
            mask_pil = mask_pil.resize((new_w, new_h), Image.NEAREST)

        # Process
        result_pil = inpainting_model.process(image_pil, mask_pil)

        # Resize back to original size if we downscaled
        if result_pil.size != original_size:
            result_pil = result_pil.resize(original_size, Image.LANCZOS)

        # Save result to memory
        output = BytesIO()
        result_pil.save(output, format="PNG")
        output.seek(0)
        
        JOBS[job_id] = {
            "status": "completed",
            "result": output.read(),
            "error": None
        }
    except Exception as e:
        print(f"Job {job_id} failed: {e}")
        JOBS[job_id] = {
            "status": "failed",
            "result": None,
            "error": str(e)
        }

def get_rembg_session():
    global _rembg_session
    if _rembg_session is None:
        from rembg import new_session
        _rembg_session = new_session("isnet-general-use")
    return _rembg_session

@app.get("/")
def read_root():
    return {"status": "ok", "device": inpainting_model.device}

@app.get("/device")
def get_device():
    """Return current device info for frontend display"""
    return JSONResponse({
        "device": inpainting_model.device,
        "device_name": "GPU (CUDA)" if "cuda" in inpainting_model.device else "CPU",
    })

@app.post("/inpaint")
async def inpaint(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    quality: Optional[str] = Query("balanced", description="Quality preset: fast, balanced, high")
):
    # Read image
    image_data = await image.read()
    image_pil = Image.open(BytesIO(image_data)).convert("RGB")
    original_size = image_pil.size

    # Read mask
    mask_data = await mask.read()
    mask_pil = Image.open(BytesIO(mask_data)).convert("L")  # Mask should be grayscale

    # Resize mask to match image size (if they differ)
    if mask_pil.size != image_pil.size:
        # Use Bilinear to output smooth edges, then threshold to binary
        # This prevents blocky 'staircase' edges when upscaling
        mask_pil = mask_pil.resize(image_pil.size, Image.BILINEAR)
        mask_np = np.array(mask_pil)
        mask_np = (mask_np > 127).astype(np.uint8) * 255
        mask_pil = Image.fromarray(mask_np)

    # Apply quality preset - resize if image exceeds max dimension
    max_dim = QUALITY_PRESETS.get(quality, QUALITY_PRESETS["balanced"])
    w, h = image_pil.size
    
    
    # Store job
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {"status": "processing", "result": None, "error": None}
    
    # Run in background
    background_tasks.add_task(process_inpaint_job, job_id, image_pil, mask_pil, max_dim, original_size)

    return {"job_id": job_id, "status": "processing"}

@app.get("/jobs/{job_id}")
def get_job_status(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = JOBS[job_id]
    return {"job_id": job_id, "status": job["status"], "error": job["error"]}

@app.get("/results/{job_id}")
def get_job_result(job_id: str):
    if job_id not in JOBS:
        raise HTTPException(status_code=404, detail="Job not found")
    
    job = JOBS[job_id]
    if job["status"] != "completed":
        raise HTTPException(status_code=400, detail="Job not completed")
    
    return StreamingResponse(BytesIO(job["result"]), media_type="image/png")


# ============ PHASE 5: AI FEATURES ============

@app.post("/detect-objects")
async def detect_objects(image: UploadFile = File(...)):
    """
    5.1 AI Object Detection - Uses rembg to detect foreground objects
    Returns a mask where detected objects are white
    """
    from rembg import remove
    
    image_data = await image.read()
    image_pil = Image.open(BytesIO(image_data)).convert("RGB")
    
    # Get the session (lazy loaded)
    session = get_rembg_session()
    
    # Remove background, keeping alpha channel as mask
    result = remove(image_pil, session=session, only_mask=True)
    
    # Convert mask to grayscale
    if result.mode == 'RGBA':
        mask = result.split()[-1]  # Get alpha channel
    else:
        mask = result.convert('L')
    
    output = BytesIO()
    mask.save(output, format="PNG")
    output.seek(0)
    
    return StreamingResponse(output, media_type="image/png")


@app.post("/refine-edges")
async def refine_edges(
    image: UploadFile = File(...),
    mask: UploadFile = File(...),
    threshold1: int = Query(50, description="Canny edge detection threshold 1"),
    threshold2: int = Query(150, description="Canny edge detection threshold 2"),
    dilation: int = Query(2, description="Edge dilation amount")
):
    """
    5.2 Smart Edge Detection - Refines mask by re-segmenting the area using AI
    """
    from rembg import remove
    
    # Read image and mask
    image_data = await image.read()
    image_pil = Image.open(BytesIO(image_data)).convert("RGB")
    image_np = np.array(image_pil)
    
    mask_data = await mask.read()
    mask_pil = Image.open(BytesIO(mask_data)).convert("L")
    mask_np = np.array(mask_pil)
    
    # Resize mask if needed
    if mask_np.shape[:2] != image_np.shape[:2]:
        mask_np = cv2.resize(mask_np, (image_np.shape[1], image_np.shape[0]), interpolation=cv2.INTER_NEAREST)
    
    # Find bounding box of the user's rough mask
    rows = np.any(mask_np > 0, axis=1)
    cols = np.any(mask_np > 0, axis=0)
    
    if not np.any(rows) or not np.any(cols):
        # Empty mask, return original
        output = BytesIO()
        mask_pil.save(output, format="PNG")
        output.seek(0)
        return StreamingResponse(output, media_type="image/png")
        
    y_min, y_max = np.where(rows)[0][[0, -1]]
    x_min, x_max = np.where(cols)[0][[0, -1]]
    
    # Add padding to context
    pad = 50
    h, w = image_np.shape[:2]
    y_min = max(0, y_min - pad)
    y_max = min(h, y_max + pad)
    x_min = max(0, x_min - pad)
    x_max = min(w, x_max + pad)
    
    # Crop the area
    crop = image_pil.crop((x_min, y_min, x_max, y_max))
    
    # Run AI segmentation on the crop
    # This focuses the model on the specific object
    session = get_rembg_session()
    crop_mask = remove(crop, session=session, only_mask=True)
    
    if crop_mask.mode == 'RGBA':
        crop_mask = crop_mask.split()[-1]
    else:
        crop_mask = crop_mask.convert('L')
    
    # Paste back into full size mask
    refined_mask = Image.new("L", (w, h), 0)
    refined_mask.paste(crop_mask, (x_min, y_min))
    
    output = BytesIO()
    refined_mask.save(output, format="PNG")
    output.seek(0)
    
    return StreamingResponse(output, media_type="image/png")


@app.post("/remove-background")
async def remove_background(image: UploadFile = File(...)):
    """
    5.3 Background Replacement - Part 1: Remove background
    Returns image with transparent background
    """
    from rembg import remove
    
    image_data = await image.read()
    image_pil = Image.open(BytesIO(image_data)).convert("RGBA")
    
    session = get_rembg_session()
    result = remove(image_pil, session=session)
    
    output = BytesIO()
    result.save(output, format="PNG")
    output.seek(0)
    
    return StreamingResponse(output, media_type="image/png")


@app.post("/replace-background")
async def replace_background(
    image: UploadFile = File(...),
    background: UploadFile = File(...),
):
    """
    5.3 Background Replacement - Part 2: Replace with new background
    """
    from rembg import remove
    
    # Read foreground image
    image_data = await image.read()
    image_pil = Image.open(BytesIO(image_data)).convert("RGBA")
    
    # Read background image
    bg_data = await background.read()
    bg_pil = Image.open(BytesIO(bg_data)).convert("RGBA")
    
    # Remove background from foreground
    session = get_rembg_session()
    fg_removed = remove(image_pil, session=session)
    
    # Resize background to match foreground if needed
    if bg_pil.size != fg_removed.size:
        bg_pil = bg_pil.resize(fg_removed.size, Image.LANCZOS)
    
    # Composite foreground onto background
    result = Image.alpha_composite(bg_pil, fg_removed)
    
    output = BytesIO()
    result.save(output, format="PNG")
    output.seek(0)
    
    return StreamingResponse(output, media_type="image/png")


@app.post("/auto-mask")
async def auto_mask(
    image: UploadFile = File(...),
    invert: bool = Query(False, description="Invert mask to select background instead")
):
    """
    Auto-generate mask for foreground objects (convenience endpoint)
    """
    from rembg import remove
    
    image_data = await image.read()
    image_pil = Image.open(BytesIO(image_data)).convert("RGB")
    
    session = get_rembg_session()
    mask = remove(image_pil, session=session, only_mask=True)
    
    if mask.mode == 'RGBA':
        mask = mask.split()[-1]
    else:
        mask = mask.convert('L')
    
    if invert:
        mask = Image.eval(mask, lambda x: 255 - x)
    
    output = BytesIO()
    mask.save(output, format="PNG")
    output.seek(0)
    
    return StreamingResponse(output, media_type="image/png")


@app.post("/outpaint")
async def outpaint(
    image: UploadFile = File(...),
    extend_left: int = Query(0, ge=0, le=500, description="Pixels to extend left"),
    extend_right: int = Query(0, ge=0, le=500, description="Pixels to extend right"),
    extend_top: int = Query(0, ge=0, le=500, description="Pixels to extend top"),
    extend_bottom: int = Query(0, ge=0, le=500, description="Pixels to extend bottom")
):
    """
    5.4 Outpainting - Extend image canvas and fill new areas using AI
    """
    import numpy as np
    
    image_data = await image.read()
    image_pil = Image.open(BytesIO(image_data)).convert("RGB")
    
    orig_w, orig_h = image_pil.size
    new_w = orig_w + extend_left + extend_right
    new_h = orig_h + extend_top + extend_bottom
    
    if new_w == orig_w and new_h == orig_h:
        # No extension requested, return original
        output = BytesIO()
        image_pil.save(output, format="PNG")
        output.seek(0)
        return StreamingResponse(output, media_type="image/png")
    
    # Create extended canvas using Mirror Reflection for better context
    # Convert to numpy for cv2
    img_np = np.array(image_pil)
    # RGB <-> BGR? cv2 is BGR usually but if we treat as generic array it's fine 
    # as long as we don't use color-sensitive ops. But simple copyMakeBorder is fine.
    
    # Note: cv2 uses (top, bottom, left, right)
    extended_np = cv2.copyMakeBorder(
        img_np, 
        extend_top, extend_bottom, extend_left, extend_right, 
        cv2.BORDER_REFLECT_101
    )
    
    extended = Image.fromarray(extended_np)
    
    # Create mask where extended areas are white (to be inpainted)
    mask = Image.new("L", (new_w, new_h), 255)
    mask.paste(Image.new("L", (orig_w, orig_h), 0), (extend_left, extend_top))
    
    # Use LaMa to fill the extended areas
    result_pil = inpainting_model.process(extended, mask)
    
    output = BytesIO()
    result_pil.save(output, format="PNG")
    output.seek(0)
    
    return StreamingResponse(output, media_type="image/png")


# ============ PHASE 6: WORKFLOW & EXPORT ============

@app.post("/batch-inpaint")
async def batch_inpaint(
    images: List[UploadFile] = File(...),
    quality: str = Query("balanced", description="Quality preset: fast, balanced, high")
):
    """
    6.1 Batch Processing - Process multiple images with auto-generated masks
    Returns a ZIP file containing all processed images
    """
    from rembg import remove
    
    max_dim = QUALITY_PRESETS.get(quality, 1024)
    session = get_rembg_session()
    
    # Create ZIP in memory
    zip_buffer = BytesIO()
    
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_file:
        for i, image_file in enumerate(images):
            try:
                # Read and process image
                image_data = await image_file.read()
                image_pil = Image.open(BytesIO(image_data)).convert("RGB")
                
                original_size = image_pil.size
                w, h = image_pil.size
                
                # Resize if needed
                if max(w, h) > max_dim:
                    scale = max_dim / max(w, h)
                    new_w = int(w * scale)
                    new_h = int(h * scale)
                    image_pil = image_pil.resize((new_w, new_h), Image.LANCZOS)
                
                # Auto-generate mask using rembg (inverted to mask background)
                mask = remove(image_pil, session=session, only_mask=True)
                if mask.mode == 'RGBA':
                    mask = mask.split()[-1]
                else:
                    mask = mask.convert('L')
                mask = Image.eval(mask, lambda x: 255 - x)  # Invert
                
                # Process with LaMa
                result_pil = inpainting_model.process(image_pil, mask)
                
                # Resize back to original
                if result_pil.size != original_size:
                    result_pil = result_pil.resize(original_size, Image.LANCZOS)
                
                # Save to ZIP
                img_buffer = BytesIO()
                result_pil.save(img_buffer, format="PNG")
                img_buffer.seek(0)
                
                # Use original filename or generate one
                filename = image_file.filename or f"image_{i+1}.png"
                if not filename.lower().endswith('.png'):
                    filename = filename.rsplit('.', 1)[0] + '_cleaned.png'
                else:
                    filename = filename.rsplit('.', 1)[0] + '_cleaned.png'
                
                zip_file.writestr(filename, img_buffer.getvalue())
                
            except Exception as e:
                print(f"Error processing {image_file.filename}: {e}")
                continue
    
    zip_buffer.seek(0)
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={"Content-Disposition": "attachment; filename=cleaned_images.zip"}
    )


