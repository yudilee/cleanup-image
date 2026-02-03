from simple_lama_inpainting import SimpleLama
from PIL import Image
import torch

class InpaintingModel:
    def __init__(self):
        self.device = "cpu"
        if torch.cuda.is_available():
            try:
                # Check for compatibility (latest PyTorch drops support for < 7.0 usually)
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

        print(f"Initializing model on device: {self.device}")
        self.lama = SimpleLama(device=torch.device(self.device))

    def process(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        """
        Process the image with the mask using LaMa.
        """
        result = self.lama(image, mask)
        return result

inpainting_model = InpaintingModel()
