/**
 * Unit tests for buildSmartPrompt — conflict resolution matrix
 */
const { buildSmartPrompt } = require("../services/gemini");

describe("buildSmartPrompt", () => {
  // ── Footwear ─────────────────────────────────────────
  test("FOOTWEAR prompt keeps all clothing", () => {
    const prompt = buildSmartPrompt("FOOTWEAR", { currentType: "UPPER_LOWER" });
    expect(prompt).toContain("footwear");
    expect(prompt).toContain("Keep ALL clothing");
  });

  // ── Accessories ──────────────────────────────────────
  test("ACCESSORY with EARRINGS subclass", () => {
    const prompt = buildSmartPrompt("ACCESSORY", { garmentSubClass: "EARRINGS" });
    expect(prompt).toContain("earrings");
  });

  test("ACCESSORY with SUNGLASSES subclass", () => {
    const prompt = buildSmartPrompt("ACCESSORY", { garmentSubClass: "SUNGLASSES" });
    expect(prompt).toContain("sunglasses");
  });

  test("ACCESSORY with HAT subclass", () => {
    const prompt = buildSmartPrompt("ACCESSORY", { garmentSubClass: "HAT" });
    expect(prompt).toContain("hat");
  });

  test("ACCESSORY defaults to EARRINGS if no subclass", () => {
    const prompt = buildSmartPrompt("ACCESSORY", {});
    expect(prompt).toContain("earrings");
  });

  // ── Full body garment ────────────────────────────────
  test("FULL_BODY removes all current clothing", () => {
    const prompt = buildSmartPrompt("FULL_BODY", { currentType: "UPPER_LOWER" });
    expect(prompt).toContain("COMPLETELY REMOVE");
    expect(prompt).toContain("dress/jumpsuit");
  });

  // ── Standard: UPPER_BODY on person wearing top+bottom ─
  test("UPPER_BODY on UPPER_LOWER replaces only top", () => {
    const prompt = buildSmartPrompt("UPPER_BODY", { currentType: "UPPER_LOWER" });
    expect(prompt).toContain("REMOVE their current upper body");
    expect(prompt).toContain("Keep the lower body clothing");
  });

  // ── Standard: LOWER_BODY on person wearing top+bottom ─
  test("LOWER_BODY on UPPER_LOWER replaces only bottom", () => {
    const prompt = buildSmartPrompt("LOWER_BODY", { currentType: "UPPER_LOWER" });
    expect(prompt).toContain("REMOVE their current lower body");
    expect(prompt).toContain("Keep the upper body clothing");
  });

  // ── Conflict: UPPER_BODY on person wearing dress ─────
  test("UPPER_BODY on FULL_BODY generates matching bottom", () => {
    const prompt = buildSmartPrompt("UPPER_BODY", {
      currentType: "FULL_BODY",
      fullDescription: "red floral dress",
    });
    expect(prompt).toContain("red floral dress");
    expect(prompt).toContain("Remove the red floral dress");
    expect(prompt).toContain("matching bottom piece");
  });

  // ── Conflict: LOWER_BODY on person wearing dress ─────
  test("LOWER_BODY on FULL_BODY generates matching top", () => {
    const prompt = buildSmartPrompt("LOWER_BODY", {
      currentType: "FULL_BODY",
      fullDescription: "black jumpsuit",
    });
    expect(prompt).toContain("black jumpsuit");
    expect(prompt).toContain("matching top");
  });

  // ── Outerwear cases ──────────────────────────────────
  test("UPPER_BODY on OUTERWEAR removes outerwear first", () => {
    const prompt = buildSmartPrompt("UPPER_BODY", { currentType: "OUTERWEAR" });
    expect(prompt).toContain("remove any outerwear");
  });

  test("LOWER_BODY on OUTERWEAR keeps outerwear", () => {
    const prompt = buildSmartPrompt("LOWER_BODY", { currentType: "OUTERWEAR" });
    expect(prompt).toContain("Keep the upper body clothing and outerwear");
  });

  // ── Framing ──────────────────────────────────────────
  test("half framing adds waist-crop instruction for UPPER_BODY", () => {
    const prompt = buildSmartPrompt("UPPER_BODY", { currentType: "UPPER_LOWER" }, "half");
    expect(prompt).toContain("Crop the output image at the waist");
    expect(prompt).toContain("no legs");
  });

  test("full framing shows head to toe", () => {
    const prompt = buildSmartPrompt("UPPER_BODY", { currentType: "UPPER_LOWER" }, "full");
    expect(prompt).toContain("head to toe");
  });

  test("half framing does NOT apply to FOOTWEAR", () => {
    const prompt = buildSmartPrompt("FOOTWEAR", { currentType: "UPPER_LOWER" }, "half");
    expect(prompt).not.toContain("Crop the output image at the waist");
  });

  // ── Identity preservation ────────────────────────────
  test("all prompts contain identity preservation", () => {
    const types = ["UPPER_BODY", "LOWER_BODY", "FULL_BODY", "FOOTWEAR"];
    for (const type of types) {
      const prompt = buildSmartPrompt(type, { currentType: "UPPER_LOWER" });
      expect(prompt).toContain("EXACT same person");
    }
  });

  // ── Fallback ─────────────────────────────────────────
  test("unknown garmentClass uses generic fallback", () => {
    const prompt = buildSmartPrompt("UNKNOWN_TYPE", { currentType: "UPPER_LOWER" });
    expect(prompt).toContain("virtual try-on system");
  });

  // ── Null/undefined outfitInfo ────────────────────────
  test("handles null outfitInfo gracefully", () => {
    const prompt = buildSmartPrompt("UPPER_BODY", null);
    expect(prompt).toContain("virtual try-on system");
  });
});
