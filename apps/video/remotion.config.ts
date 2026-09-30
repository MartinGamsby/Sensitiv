import { Config } from "@remotion/cli/config";

// Settings for `remotion studio` / `remotion render`. `scripts/render.ts`
// passes the output path and composition; quality lives here.
Config.setEntryPoint("./src/index.ts");
Config.setPublicDir("./public");
// JPEG frames at high quality: the fastest path, and the UI has no alpha.
Config.setVideoImageFormat("jpeg");
Config.setJpegQuality(94);
Config.setCodec("h264");
// Lower is better; 16 keeps small UI text crisp at a reasonable size.
Config.setCrf(16);
Config.setPixelFormat("yuv420p");
Config.setOverwriteOutput(true);
