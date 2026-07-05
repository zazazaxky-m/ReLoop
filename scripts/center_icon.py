from PIL import Image

def process_image(path, padding_ratio=0.15):
    try:
        img = Image.open(path).convert("RGBA")
    except Exception as e:
        print(f"Failed to open {path}: {e}")
        return
    
    # get bounding box of non-transparent pixels
    bbox = img.getbbox()
    if not bbox:
        print(f"Empty image: {path}")
        return

    # Crop to bounding box
    cropped = img.crop(bbox)
    
    # Target size for the new image (1024x1024 is standard for app icons)
    target_size = 1024
    
    # Calculate how big the cropped image should be
    max_dim = target_size * (1 - padding_ratio * 2)
    
    w, h = cropped.size
    scale = min(max_dim / w, max_dim / h)
    
    new_w = int(w * scale)
    new_h = int(h * scale)
    
    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    new_img = Image.new("RGBA", (target_size, target_size), (255, 255, 255, 0))
    
    offset_x = (target_size - new_w) // 2
    offset_y = (target_size - new_h) // 2
    
    new_img.paste(resized, (offset_x, offset_y), resized)
    
    new_img.save(path)
    print(f"Processed and saved: {path}")

process_image("d:/ReLoop/mobile/assets/icon/app_icon.png")
process_image("d:/ReLoop/mobile/assets/icon/app_icon_foreground.png")
