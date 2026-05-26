"""Extract a few frames from the user's video so Claude can see the problem."""
import cv2
import os

videos = [
    r"C:\Users\Coen Buijs\Videos\Captures\Coup - Google Chrome 2026-05-25 15-54-26.mp4",
    r"C:\Users\Coen Buijs\Videos\Captures\Coup - Google Chrome 2026-05-25 15-54-00.mp4",
]

os.makedirs("video_frames", exist_ok=True)

for idx, path in enumerate(videos):
    if not os.path.exists(path):
        print(f"skip {path}")
        continue
    cap = cv2.VideoCapture(path)
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    duration = total / fps if fps > 0 else 0
    print(f"video {idx}: {total} frames, {fps:.1f} fps, {duration:.1f}s")
    # Extract 8 evenly-spaced frames
    n_frames = 8
    for i in range(n_frames):
        frame_idx = int(total * i / n_frames)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
        ok, frame = cap.read()
        if ok:
            # Resize to keep files smaller
            h, w = frame.shape[:2]
            if w > 1280:
                scale = 1280 / w
                frame = cv2.resize(frame, (int(w*scale), int(h*scale)))
            out = f"video_frames/v{idx}_f{i:02d}_t{frame_idx/fps:.1f}s.jpg"
            cv2.imwrite(out, frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            print(f"  wrote {out}")
    cap.release()
