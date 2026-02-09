 const estimationSchema = {

    "name": "weight_and_serving",
    "strict": true,
    "schema": {
      "type": "object",
      "description": "Estimated food identification and serving size analysis based on a single dish image.",
      "properties": {
        "isValidFood": {
          "type": "boolean",
          "description": "Indicates whether the uploaded image primarily contains edible food suitable for nutritional analysis. This must be false if the image shows non-food objects (e.g., people, animals, vehicles, scenery, documents, or products) or if no recognizable food is present."
        },
        "invalidReason": {
          "type": "string",
          "description": "If isValidFood is false, this provides a short human-readable explanation of what was detected instead (e.g., 'person', 'car', 'text document', 'blurry image', 'multiple unrelated objects'). Must be null when isValidFood is true."
        },
        "detectedFoods": {
          "type": "array",
          "description": "List of individual food items visually detected in the dish image, with estimated serving sizes.",
          "items": {
            "type": "object",
            "description": "Estimated serving information for a single detected food item.",
            "properties": {
              "foodName": {
                "type": "string",
                "description": "Common name of the detected food item (e.g., egg, fish, chicken breast)."
              },
              "householdServingFullText": {
                "type": "string",
                "description": "Human-readable household serving approximation (e.g., '1 cup', '2 slices', '1 medium piece')."
              }
            },
            "required": [
              "foodName",
              "householdServingFullText"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "isValidFood",
        "invalidReason",
        "detectedFoods"
      ],
      "additionalProperties": false
    }
  }

  const estimatedNutrientsSchema = {
    
    "name": "nutrients",
    "strict": true,
    "schema": {
      "type": "object",
      "description": "Calculated calories for each detected food item based on AI-estimated servings and USDA reference data.",
      "properties": {
        "dishDescription": {
          "type": "string",
          "description": "A short, human-readable description of the overall dish based on the combined detected foods (e.g., 'grilled chicken with rice and vegetables'). This does not need to be an exact dish name."
        },
        "foods": {
          "type": "array",
          "description": "List of individual food items with their calculated calories.",
          "items": {
            "type": "object",
            "description": "Estimated calories for a single food item.",
            "properties": {
              "foodName": {
                "type": "string",
                "description": "Common name of the detected food item (e.g., egg, fish, chicken breast)."
              },
              "protein": {
                "type": "number",
                "description": "Calculated protein in grams (g) for this food based on the AI-estimated serving and USDA reference data."
              },
              "fat": {
                "type": "number",
                "description": "Calculated fat in grams (g) for this food based on the AI-estimated serving and USDA reference data."
              },
              "carbohydrates": {
                "type": "number",
                "description": "Calculated carbohydrates in grams (g) for this food based on the AI-estimated serving and USDA reference data."
              },
              "fiber": {
                "type": "number",
                "description": "Calculated fiber in grams (g) for this food based on the AI-estimated serving and USDA reference data."
              },
              "sugar": {
                "type": "number",
                "description": "Calculated sugar in grams (g) for this food based on the AI-estimated serving and USDA reference data."
              },
              "sodium": {
                "type": "number",
                "description": "Calculated sodium in milligrams (mg) for this food based on the AI-estimated serving and USDA reference data."
              },
              "calories": {
                "type": "number",
                "description": "Calculated calories for this food based on the AI-estimated serving and USDA reference data."
              }
            },
            "required": [
              "foodName",
              "protein",
              "fat",
              "carbohydrates",
              "fiber",
              "sugar",
              "sodium",
              "calories"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "dishDescription",
        "foods"
      ],
      "additionalProperties": false
    }
  }
  
  export { estimationSchema, estimatedNutrientsSchema };