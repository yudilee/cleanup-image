from simple_lama_inpainting import SimpleLama
from PIL import Image
import torch
import os

class ModelManager:
    def __init__(self):
        self.device = "cpu"
        self.models = {}
        self.active_model_id = "lama"
        
        # Check for forced CPU mode
        if os.environ.get("FORCE_CPU", "false").lower() == "true":
            print("Force CPU mode enabled. Using CPU.")
            self.device = "cpu"
        elif torch.cuda.is_available():
            try:
                # Check for compatibility
                cap = torch.cuda.get_device_capability()
                major, minor = cap
                if major < 5:
                    print(f"Warning: GPU Compute Capability {major}.{minor} is too old (needs 5.0+). Falling back to CPU.")
                    self.device = "cpu"
                else:
                    self.device = "cuda"
                    print(f"Device Name: {torch.cuda.get_device_name(0)}")
            except Exception as e:
                print(f"Error checking GPU capability: {e}")
                self.device = "cpu"
        
        print(f"Initializing ModelManager on device: {self.device}")
        
        # Initialize Default Model (LaMa)
        # We always want LaMa available as it's fast and lightweight
        self._load_lama()

    def _load_lama(self):
        print("Loading LaMa model...")
        try:
            self.models["lama"] = SimpleLama(device=torch.device(self.device))
        except Exception as e:
             if self.device == "cuda":
                print(f"Error loading LaMa on GPU: {e}. Fallback to CPU.")
                self.models["lama"] = SimpleLama(device=torch.device("cpu"))
             else:
                 raise e

    def _load_sdxl(self):
        """Lazy load SDXL only when requested"""
        if "sdxl" in self.models:
            return

        if self.device == "cpu":
            raise RuntimeError("SDXL requires a GPU (CUDA) to run efficiently. CPU not supported.")

        print("Loading SDXL Inpainting model... (This may take a moment)")
        try:
            from diffusers import AutoPipelineForInpainting
            
            # Load SDXL Inpainting
            # Using 16-bit precision (torch.float16) for T4/Colab compatibility and speed
            pipe = AutoPipelineForInpainting.from_pretrained(
                "diffusers/stable-diffusion-xl-1.0-inpainting-0.1",
                torch_dtype=torch.float16,
                variant="fp16",
                use_safetensors=True
            )
            pipe.to("cuda")
             # Enable optimizations for lower VRAM usage
            # pipe.enable_model_cpu_offload() 
            self.models["sdxl"] = pipe
            print("SDXL Inpainting loaded successfully.")
        except ImportError:
            raise RuntimeError("Diffusers library not installed. Please install 'diffusers', 'transformers', 'accelerate'.")
        except Exception as e:
             print(f"Error loading SDXL: {e}")
             raise e

    def get_available_models(self):
        """Return list of available models based on hardware"""
        models = [
            {"id": "lama", "name": "LaMa (Fast, Cleaning)", "description": "Best for cleaning up small defects and removing objects."}
        ]
        
        # SDXL is available if we have a GPU
        if self.device == "cuda":
            models.append({
                "id": "sdxl", 
                "name": "SDXL (High Quality, Generative)", 
                "description": "Best for large objects and complex background reconstruction. Slower."
            })
            
        return models

    def process(self, image: Image.Image, mask: Image.Image, model_id: str = "lama") -> tuple[Image.Image, str]:
        """
        Process the image with the specified model. Returns (ResultImage, ActualModelID)
        """
        actual_model = model_id
        
        if model_id == "sdxl":
            if self.device != "cuda":
                print("Warning: SDXL requested but running on CPU. Falling back to LaMa.")
                actual_model = "lama"
            else:
                # Lazy load SDXL
                try:
                    self._load_sdxl()
                except Exception as e:
                    print(f"Failed to load SDXL: {e}. Falling back to LaMa.")
                    actual_model = "lama"

        # Dispatch
        if actual_model == "sdxl":
            return self._process_sdxl(image, mask), "sdxl"
        else:
            return self._process_lama(image, mask), "lama"

    def _process_lama(self, image, mask):
        return self.models["lama"](image, mask)

    def _process_sdxl(self, image, mask):
        pipe = self.models["sdxl"]
        
        # SDXL requires inputs to be divisible by 8 usually, pipelines handle it but good to be safe.
        # Also SDXL works best at 1024x1024.
        
        # Generate with high strength to ensure Inpainting respects the mask
        # strength=1.0 means fully denoise the masked area
        result = pipe(
            prompt="high resolution, seamless integration, realistic background, 8k", 
            negative_prompt="artifacts, blur, darkness, low quality, distortion, text, watermark",
            image=image,
            mask_image=mask,
            strength=0.99, 
            guidance_scale=7.5,
            num_inference_steps=25 # Good speed/quality balance for interactive use
        ).images[0]
        
        return result

# Singleton instance
inpainting_model = ModelManager()
