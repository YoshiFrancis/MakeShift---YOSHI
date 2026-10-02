/** The camera view explicitly registers its video; never select unrelated media. */
let cameraVideo: HTMLVideoElement | null = null;
export function registerCameraVideo(video: HTMLVideoElement | null): () => void {
  cameraVideo = video;
  return () => { if (cameraVideo === video) cameraVideo = null; };
}
export function getCameraVideo(): HTMLVideoElement | null { return cameraVideo; }
