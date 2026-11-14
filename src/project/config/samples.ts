import type { ConfigFile, Profile } from "./types.js";

/** Sample config per profile, written by `imgfit init`. Relative paths only — nothing machine-specific. */
export function sampleConfig(profile: Profile): ConfigFile {
  const base: ConfigFile = {
    $schema: "./imgfit.schema.json",
    schemaVersion: 1,
    profile,
    roots: { input: "images-src", output: "." },
    defaults: { upscale: false, stripMetadata: true, onConflict: "error", jobs: 4 },
    presets: {},
    rules: [],
    budget: { maxFileKB: 1024 },
  };
  switch (profile) {
    case "web":
      return {
        ...base,
        roots: { input: "images-src", output: "public/images" },
        presets: {
          hero: { size: [1920, 1080], mode: "fit", format: "jpg", quality: 85 },
          thumb: { size: [256, 256], mode: "cover", crop: { position: "attention" }, format: "webp", quality: 82 },
          logo: { size: [256, 256], mode: "fit", format: "png" },
        },
        rules: [
          { id: "photos", from: "photos/**/*.{jpg,jpeg,png,webp}", preset: ["hero", "thumb"], to: "{preset}/{dir}/{name}.{ext}" },
          { id: "logos", from: "logos/*.{png,jpg,jpeg}", preset: "logo", to: "logos/{name}.{ext}" },
        ],
      };
    case "unity":
      return {
        ...base,
        roots: { input: "images-src", output: "Assets/Art" },
        presets: {
          "large-alpha": { size: [1024, 1024], mode: "fit", format: "png", png: { compressionLevel: 6, palette: false } },
          icon: { size: [256, 256], mode: "cover", crop: { position: "attention" }, smallInput: "error", format: "png" },
        },
        rules: [
          { id: "sprites", from: "sprites/**/*.{png,jpg,jpeg}", preset: "large-alpha", to: "Sprites/{dir}/{name}.{ext}" },
          { id: "icons", from: "icons/*.{png,jpg,jpeg}", preset: "icon", to: "Icons/{name}.{ext}" },
        ],
      };
    default:
      return {
        ...base,
        presets: {
          large: { size: [2048, 2048], mode: "fit", format: "keep" },
          thumb: { size: [256, 256], mode: "cover", format: "jpg", quality: 85 },
        },
        rules: [{ id: "images", from: "**/*.{jpg,jpeg,png,webp}", preset: ["large", "thumb"], to: "images/{preset}/{dir}/{name}.{ext}" }],
      };
  }
}
