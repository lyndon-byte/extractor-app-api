import express from "express";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import crypto from "crypto";
import multer from "multer";
import {estimationSchema, estimatedNutrientsSchema} from "./Schema/schema.js";
import { Server } from "socket.io";
import http from "http"

dotenv.config(); 

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      cb(new Error("Only images are allowed"), false);
    } else {
      cb(null, true);
    }
  }
});

const app = express();

app.use(express.json({
  limit: "50mb"
}));

const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const io = new Server(server, {
  path: "/socket.io",
  cors: { origin: "*" }
});


io.use(async (socket, next) => {

  const token = socket.handshake.auth.token;

  try {

    const user = await verifyToken(token);
    socket.user = user
    next();

  } catch (err) {
    console.error("WebSocket auth failed:", err.message);
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {

    socket.on("subscribe-job", ({ jobId }) => {

      console.log(`Socket joined job ${jobId}`);
      socket.join(jobId);

    });
    
});

server.listen(PORT, () => {
  console.log(`API + Socket running on port ${PORT}`);
});

const webhookDomain =  process.env.WEBHOOK_DOMAIN; 
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function emitProgress(jobId, step, message, percent = null) {
  io.to(jobId).emit("ai-progress", {
    jobId,
    step,
    message,
    percent,
    timestamp: Date.now()
  });
}

async function verifyToken(token) {

  if (!token) {
    throw {
      status: 401,
      error_code: "NO_TOKEN",
      message: "No token provided",
    };
  }

  try {
    const { data } = await axios.get("https://www.kaloreea.io/api/check-account", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

    return data.user;

  } catch (err) {

    if (err.response) {

      const { status, data } = err.response;

      throw {
        status,
        error_code: data.error_code || "UNKNOWN_ERROR",
        message: data.message || "Request failed",
        meta: data,
      };
    }

    throw {
      status: 500,
      error_code: "AUTH_SERVICE_UNAVAILABLE",
      message: "Authentication service unreachable",
    };

  }
}

function auth(req, res, next) {

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error_code: "UNAUTHENTICATED",
      message: "Missing or invalid Authorization header",
    });
  }

  const token = authHeader.split(" ")[1];

  verifyToken(token)
    .then(user => {
      req.user = user; 
      next();
    })
    .catch(err => {
      res.status(err.status || 401).json({
        error_code: err.error_code,
        message: err.message,
      });
    });
}


function calculateTotalCalories(foods) {

  if (!Array.isArray(foods)) return 0;

  return foods
    .filter(food =>
      food?.calories !== undefined &&
      !isNaN(food.calories)
    )
    .reduce((total, food) => total + Number(food.calories), 0);
}

function roundFoodNutrients(foods) {

  if (!Array.isArray(foods)) return [];

  return foods.map(food => {
    const roundedFood = {};

    Object.entries(food).forEach(([key, value]) => {
      if (key !== 'foodName' && !isNaN(value)) {
        roundedFood[key] = Math.round(Number(value));
      } else {
        roundedFood[key] = value;
      }
    });

    return roundedFood;
  });

}

async function enrichFoodsWithCalories(detectedFoods) {

  const API_KEY = process.env.USDA_API_KEY;

  const realFoodData = [];

  for (const food of detectedFoods) {

    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${API_KEY}&query=${encodeURIComponent(food.foodName)}`
    );

    const data = await response.json();

    const usdaFood = data.foods[0];

    let nutrients = [];

    if (Array.isArray(usdaFood.foodNutrients)) {
      nutrients = usdaFood.foodNutrients
        .filter(n => n.nutrientName && typeof n.value === "number")
        .map(n => ({
          nutrientName: n.nutrientName,
          value: n.value,
          unitName: n.unitName || null // optional: include unit
        }));
    }

    realFoodData.push({

      foodName: food.foodName,
      servingSizeUnit: usdaFood.servingSizeUnit,
      servingSize: usdaFood.servingSize,
      householdServingFullText: usdaFood.householdServingFullText,
      nutrients: nutrients

    });
  }

  return JSON.stringify(realFoodData);
}

app.post("/api/analyze-food-image",upload.single('file'),auth,async (req, res) => {
  
  if (!req.file) {
    return res.status(400).json({ message: "No file uploaded" });
  }

  const jobId = crypto.randomUUID();
  const user = req.user;

  res.status(200).json({
    jobId,
    status: "file accepted",
    note: "Processing",

  });

  const fileContent = req.file.buffer.toString("base64");
  const fileExt = req.file.mimetype.split("/")[1];
  const fileData = { fileContent, fileExt, mimeType: req.file.mimetype };

  req.file.buffer = null;

  startAIProcess(user.id, jobId, fileData);

})

async function startAIProcess(userId,jobId,fileData) {

  const { fileContent, fileExt } = fileData;

  try {
    
    emitProgress(jobId, "started", "Job accepted", 5);

    emitProgress(jobId, "analyzing_image", "Analyzing image", 20);

    const response = await openai.responses.parse({

      model: "gpt-4o-2024-08-06",
      input: [
        {
          role: "system",
          content: `

          You are an AI vision-based food analysis assistant.
          
          Your task is to analyze a single image of a prepared dish and identify all visually distinct food items present. For each detected food item, you must estimate its serving size based solely on visual cues from the image.
          
          # Core Responsibilities

          Detect individual food items visible in the dish.
          Treat mixed dishes as separate components when visually distinguishable (e.g., rice and chicken, vegetables and meat).
          Provide reasonable visual estimates, not exact measurements.
          When uncertain, still provide the best plausible estimate based on common portion sizes.
          
          # Output Requirements
          
          You must respond only with JSON that strictly conforms to the provided schema.
          Do not include explanations, commentary, or additional fields.
          Do not include markdown or formatting outside the JSON object.
          Do not guess foods that are not visually present.
          
          # Field Instructions
          
          For each object in detectedFoods:
          
          [foodName]:
          
          Use a common, generic food name.
          
          Avoid brand names or overly specific culinary terms unless visually obvious.
          
          servingSizeUnit
          
          Use standard weight units only (g or oz).
          Use a single unit consistently per food item.
          
          [servingSize]:
          
          Provide a numeric estimate of the food’s weight in the specified unit.
          The value must be a number, not a string.
          
          [householdServingFullText]:
          
          Provide a human-readable serving approximation (e.g., “1 cup”, “2 slices”, “1 medium piece”).
          This value should align logically with the numeric serving size.
          
          # Estimation Guidelines
          
          Base estimates on typical household portions and visual scale references (plates, utensils, bowls).
          Prefer conservative estimates over extreme values.
          If multiple pieces of the same food are present, estimate the total combined serving.
          
          # Constraints
          
          Do not include nutritional data, calories, or macros.
          Do not infer ingredients that cannot be visually confirmed.
          Do not include confidence scores or uncertainty language in the output.
          Do not add or remove schema fields.

          If the image does not primarily contain edible food, you must set:
          - isValidFood = false
          - invalidReason = what was detected instead
                                
          `,
        },
        {
          role: "user",
          content: [
            {type: "input_text", text: "Analyze the image" },
            {
              type: "input_image",
              image_url: `data:image/${fileExt};base64,${fileContent}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "food_weight_and_servings_estimation",
          strict: true,
          schema: estimationSchema.schema 
        }
      }
    });

    const generatedData = response.output_parsed;

    if(!generatedData.isValidFood){

      emitProgress(jobId, "rejected", `${generatedData.invalidReason}`, 100);

      const rejectionPayload = {
        userId,
        jobId,
        fileData,
        isValidFood: false,
        invalidReason: generatedData.invalidReason,
        timestamp: Date.now()
      };

      const rejectionSignature = crypto
        .createHmac("sha256", process.env.SHARED_SECRET)
        .update(JSON.stringify(rejectionPayload))
        .digest("hex");

      await axios.post(`${webhookDomain}/api/receive-estimated-calorie`, rejectionPayload, {
        headers: { "X-Signature": rejectionSignature }
      });

      return;

    }

    emitProgress(jobId, "enriching_foods", "Enriching calorie data", 50);

    const realFoodData = await enrichFoodsWithCalories(generatedData.detectedFoods)

    emitProgress(jobId, "estimating_nutrients", "Estimating nutrients", 75);
    
    const estimatedFoodData = JSON.stringify(generatedData.detectedFoods)

    const estimatedNutrients = await openai.responses.parse({

      model: "gpt-4o-2024-08-06",
      input: [
        {
          role: "system",
          content: `
          
            You are a nutrition calculation assistant.
            
            Your task is to calculate nutrient values for each detected food item based on:
            
            1. The AI-estimated serving sizes and units (from estimatedFoodData).
            2. The reference USDA food data (from realFoodData), which provides nutrient values per standard serving.
            
            For each food item:
            
            - Use the estimated serving size and unit to scale nutrient values from the USDA reference data.
            - Compare the estimated serving size against the USDA standard serving size and weight.
            - Calculate all available nutrients proportionally (e.g., calories, protein, fat, carbohydrates, fiber, sugar, sodium).
            - If a nutrient exists in USDA data but results in zero after calculation, return 0 (not null or omitted).
            - Do not modify the original food name or other metadata.
            
            Your response must strictly follow the provided JSON schema.
            Do not include explanations, commentary, or any extra fields.
        `
        },
        {
          role: "user",
          content: `

            estimated food data: ${estimatedFoodData}
            real USDA food data: ${realFoodData}
            
            Instructions:
            - estimatedFoodData contains AI-estimated servings and units for each food.
            - realFoodData contains USDA reference data including standard serving size and nutrient values.
            - For each food in estimatedFoodData, calculate nutrients using the formula:
            
              calculatedNutrientValue = (estimatedServing / USDAServingSize) * USDANutrientValue
            
            - Apply the formula consistently to all nutrients provided in USDA data.
            - Return the final list of food objects with calculated nutrient values added.
        `
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "nutrients_estimation",
          strict: true,
          schema: estimatedNutrientsSchema.schema 
        }
      }
    });

    const analyzedFileFoodData = estimatedNutrients.output_parsed

    const detectedFoodsWithNutrients = roundFoodNutrients(analyzedFileFoodData.foods)
    const totalCalories = calculateTotalCalories(detectedFoodsWithNutrients)

    const mealData = {
        jobId,
        dish_description: analyzedFileFoodData.dishDescription,
        total_calories: totalCalories,
        detected_foods_with_nutrients: analyzedFileFoodData.foods,
        status: 'complete',
        timestamp: Date.now()
    };

    emitProgress(jobId, "completed", "Analysis complete", 100);

    io.to(jobId).emit("ai-complete", mealData);

    const responseData = {
      userId,
      jobId,
      fileData,
      estimatedNutrients: analyzedFileFoodData,
      isValidFood: true,
      timestamp: Date.now()
   };

    const responseSignature = crypto
      .createHmac("sha256", process.env.SHARED_SECRET)
      .update(JSON.stringify(responseData))
      .digest("hex");

    await axios.post(`${webhookDomain}/api/receive-estimated-calorie`, responseData, {
      headers: { "X-Signature": responseSignature },
    });


  } catch (err) {

    console.error("AI process error:", err);

    io.to(jobId).emit("ai-error", {
      error: err.message || "Unknown AI error",
      jobId,
    });

  }
}


