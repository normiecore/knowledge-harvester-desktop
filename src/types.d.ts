declare module 'screenshot-desktop' {
  interface ScreenshotOptions {
    format?: 'jpg' | 'png';
    screen?: number;
  }
  function screenshot(options?: ScreenshotOptions): Promise<Buffer>;
  export default screenshot;
}

declare module 'desktop-idle' {
  function getIdleTime(): number;
  export default { getIdleTime };
}
