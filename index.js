import express from "express";
import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import crypto from "crypto";
import multer from "multer";
import {estimationSchema, estimatedNutrientsSchema} from "./Schema/schema.js";
import { Server } from "socket.io";
import http from "http"
import jwt from "jsonwebtoken";
import rateLimit from 'express-rate-limit'
import { createClient } from "redis"

const redis = createClient({
   
  url: process.env.REDIS_URL

});

await redis.connect();

const USER_DAILY_LIMIT = process.env.USER_DAILY_LIMIT;

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

app.set('trust proxy', 1); 

app.use(express.json({
  limit: "50mb"
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, 
  message: "Too many requests from this IP, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});


const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const io = new Server(server, {
  path: "/socket.io",
  cors: { origin: "*" }
});


io.use(async (socket, next) => {

  const token = socket.handshake.auth.token;

  try {

    const user = verifyToken(token);
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

function verifyToken(token) {

  if (!token) {
    throw {
      status: 401,
      error_code: "NO_TOKEN",
      message: "No token provided",
    };
  }

  try {

    const payload = jwt.verify(token, process.env.SHARED_SECRET);
    return { id: payload.sub, email: payload.email, ...payload };

  } catch (err) {
    throw {
      status: 401,
      error_code: "INVALID_TOKEN",
      message: err.message || "Invalid or expired token",
    };
  }
}



async function auth(req, res, next) {

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error_code: "UNAUTHENTICATED",
      message: "Missing or invalid Authorization header",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const user = verifyToken(token);
    req.user = user;
    next();
  } catch (err) {
    res.status(err.status || 401).json({
      error_code: err.error_code,
      message: err.message,
    });
  }
}

async function userDailyLimit(req, res, next){

  try {

    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const today = new Date().toISOString().slice(0, 10);
    const key = `rate_limit:${userId}:${today}`;

    const count = await redis.incr(key);

    if (count === 1) {
      await redis.expire(key, 60 * 60 * 24);
    }

    if (count > USER_DAILY_LIMIT) {
      return res.status(429).json({
        error: "Daily request limit reached",
      });
    }

    next();
  } catch (err) {

    res.status(401).json({
      error_code: 'DAILY_SCAN_LIMIT_REACHED',
      message: 'Daily request limit reached',
    });
  }
  
};


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

app.post("/api/analyze-food-image",
  limiter,upload.single('file'),
  auth,
  userDailyLimit,
  async (req, res) => {
  
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
          
          You are a nutrition calculation engine that performs precise portion-based nutrient scaling.

          Your task is to compute nutrient values for each detected food item by scaling USDA reference nutrients to match the AI-estimated household serving.
          
          Each food item includes:
          
          • estimatedFoodData → an AI-estimated household serving (e.g., "3 cups", "1.5 bowls")
          • realFoodData → USDA reference data that represents nutrients for a specific real portion (e.g., nutrients for "1 bowl")
          
          Core rule:
          
          You must treat the USDA portion as the base reference portion and scale all nutrients proportionally to match the AI-estimated serving.
          
          For each food item:
          
          1. Identify the USDA reference portion and its associated nutrient values.
          
          2. Interpret the AI-estimated household serving as a multiple of the USDA reference portion.
          
          3. Compute a scaling factor:
          
             scalingFactor = estimatedServing / USDAReferenceServing
          
          4. Apply proportional scaling to ALL nutrients:
          
             calculatedNutrient = scalingFactor × USDANutrient
          
          5. Calories are critical and must be computed with high numerical accuracy using the same proportional formula.
          
          6. Preserve decimal precision appropriately and avoid unnecessary rounding during intermediate calculations.
          
          7. If a nutrient exists in USDA data and the result of scaling is zero, return 0 (never null or omitted).
          
          8. Do not modify food names, identifiers, or metadata.
          
          9. Do not invent or infer missing nutrients — only scale nutrients present in USDA data.
          
          Your output must strictly match the provided JSON schema.
          Return only structured JSON with no explanations or extra text.
          
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


