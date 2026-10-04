// Document Picture-in-Picture: the API handle. The float's content is the
// overlay route loaded in an iframe (float-host.tsx), so nothing is copied
// into the window.

type PipApi = {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
};

// null when the browser has no Document Picture-in-Picture.
export function pipApi(): PipApi | null {
  const api = (window as unknown as { documentPictureInPicture?: PipApi })
    .documentPictureInPicture;
  return api && typeof api.requestWindow === "function" ? api : null;
}
