/**
 * Unit tests for novaLite service — detectImageFormat helper
 */

// We need to test detectImageFormat which is not exported,
// so we test it indirectly through module internals
// For now, test the exports that we can mock

jest.mock("../services/bedrock", () => ({
  bedrockClient: { send: jest.fn() },
}));

const { bedrockClient } = require("../services/bedrock");

describe("novaLite - analyzeProduct", () => {
  const { analyzeProduct, classifyOutfit, hasPersonInImage } = require("../services/novaLite");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("analyzeProduct parses clean JSON response", async () => {
    bedrockClient.send.mockResolvedValue({
      output: {
        message: {
          content: [{
            text: JSON.stringify({
              category: "clothing",
              garmentClass: "UPPER_BODY",
              garmentSubClass: "SHORT_SLEEVE_SHIRT",
              color: "blue",
              styleTips: ["Pair with jeans"],
            }),
          }],
        },
      },
    });

    const result = await analyzeProduct("fakebase64", "Blue T-Shirt", "Clothing > Tops");
    expect(result.category).toBe("clothing");
    expect(result.garmentClass).toBe("UPPER_BODY");
    expect(result.color).toBe("blue");
  });

  test("analyzeProduct parses JSON from markdown code block", async () => {
    bedrockClient.send.mockResolvedValue({
      output: {
        message: {
          content: [{
            text: '```json\n{"category":"footwear","garmentClass":"FOOTWEAR","garmentSubClass":"SHOES","color":"white","styleTips":["Great for casual wear"]}\n```',
          }],
        },
      },
    });

    const result = await analyzeProduct("fakebase64", "White Sneakers", "Shoes");
    expect(result.category).toBe("footwear");
    expect(result.garmentClass).toBe("FOOTWEAR");
  });

  test("analyzeProduct throws on unparseable response", async () => {
    bedrockClient.send.mockResolvedValue({
      output: {
        message: {
          content: [{ text: "I cannot analyze this image." }],
        },
      },
    });

    await expect(analyzeProduct("fakebase64", "Unknown", "")).rejects.toThrow("Failed to parse");
  });

  test("classifyOutfit returns parsed outfit classification", async () => {
    bedrockClient.send.mockResolvedValue({
      output: {
        message: {
          content: [{
            text: JSON.stringify({
              currentType: "FULL_BODY",
              fullDescription: "black dress",
              upperDescription: null,
              lowerDescription: null,
            }),
          }],
        },
      },
    });

    const result = await classifyOutfit("fakebase64");
    expect(result.currentType).toBe("FULL_BODY");
    expect(result.fullDescription).toBe("black dress");
  });

  test("classifyOutfit defaults to UPPER_LOWER on parse failure", async () => {
    bedrockClient.send.mockResolvedValue({
      output: {
        message: {
          content: [{ text: "Sorry, I cannot classify this outfit." }],
        },
      },
    });

    const result = await classifyOutfit("fakebase64");
    expect(result.currentType).toBe("UPPER_LOWER");
  });

  test("hasPersonInImage returns parsed result", async () => {
    bedrockClient.send.mockResolvedValue({
      output: {
        message: {
          content: [{
            text: JSON.stringify({ hasPerson: true, garmentDescription: "blue jacket" }),
          }],
        },
      },
    });

    const result = await hasPersonInImage("fakebase64");
    expect(result.hasPerson).toBe(true);
    expect(result.garmentDescription).toBe("blue jacket");
  });

  test("hasPersonInImage defaults to false on parse failure", async () => {
    bedrockClient.send.mockResolvedValue({
      output: {
        message: {
          content: [{ text: "Unable to process." }],
        },
      },
    });

    const result = await hasPersonInImage("fakebase64");
    expect(result.hasPerson).toBe(false);
    expect(result.garmentDescription).toBeNull();
  });
});
