from simple_lama_inpainting import SimpleLama
from PIL import Image
import torch

class InpaintingModel:
    def __init__(self):
        self.lama = SimpleLama()
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Model initialized on device: {self.device}")
        
        # Check if it's actually AMD ROCm (often still reports as cuda but we can log details)
        if torch.cuda.is_available():
            print(f"Device Name: {torch.cuda.get_device_name(0)}")

    def process(self, image: Image.Image, mask: Image.Image) -> Image.Image:
        """
        Process the image with the mask using LaMa.
        """
        result = self.lama(image, mask)
        return result

inpainting_model = InpaintingModel()
