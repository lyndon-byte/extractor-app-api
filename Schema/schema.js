import { nullable, z } from "zod";

const dynamicSchemaForUpdate = {

    "name": "schema_field_list",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "schema_name": {
          "type": "string",
          "description": "name or title of the data",
        },
        "fields": {
          "type": "array",
          "description": "A list of field definitions describing the desired data structure.",
          "items": {
            "$ref": "#/$defs/schema_field"
          }
        }
      },
      "required": [
        "schema_name",
        "fields"
      ],
      "additionalProperties": false,
      "$defs": {
        "schema_field": {
          "type": "object",
          "properties": {
            "key": {
              "type": "string",
              "description": "The key identifying this field."
            },
            "type": {
              "type": "string",
              "description": "The data type of the field.",
              "enum": [
                "string",
                "array",
                "object"
              ]
            },
            "description": {
              "type": "string",
              "description": "A human-readable description of the field."
            },
            "items": {
              "anyOf": [
                {
                  "$ref": "#/$defs/schema_field"
                },
                {
                  "type": "object",
                  "properties": {
                    "type": {
                      "type": "string",
                      "enum": [
                        "string",
                        "array",
                        "object"
                      ]
                    }
                  },
                  "required": [
                    "type"
                  ],
                  "additionalProperties": false
                }
              ],
              "description": "If the type is 'array', defines the schema of the items."
            },
            "properties": {
              "type": "array",
              "description": "If the type is 'object', a list of sub-field definitions.",
              "items": {
                "$ref": "#/$defs/schema_field"
              }
            }
          },
          "required": [
            "key",
            "type",
            "description",
            "items",
            "properties"
          ],
          "additionalProperties": false
        }
      }
    }
  }

  const dynamicSchema = {

    "name": "schema_field_list",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "folder_name": {
          "type": "string",
          "description": "A sanitized, human-readable folder name that reflects the content category (e.g., 'resumes', 'invoices'). Allowed characters: a–z, A–Z, 0–9, underscores (_), and hyphens (-). No spaces, symbols, or accented characters."
        },
        "accepted_files": {
          "type": "array",
          "description": "List of documents that are allowed and relevant to this data schema.",
          "items": {
            "type": "string",
            "description": "A single document, e.g., 'resume', 'invoice', 'cv'."
           }
        },
        "description": {
          "type": "string",
          "description": "A descriptive summary of the document’s content and intent, optimized for semantic matching against this schema."
        },
        "schema_name": {
          "type": "string",
          "description": "name or title of the data",
        },
        "fields": {
          "type": "array",
          "description": "A list of field definitions describing the desired data structure.",
          "items": {
            "$ref": "#/$defs/schema_field"
          }
        }
      },
      "required": [
        "folder_name",
        "accepted_files",
        "description",
        "schema_name",
        "fields"
      ],
      "additionalProperties": false,
      "$defs": {
        "schema_field": {
          "type": "object",
          "properties": {
            "key": {
              "type": "string",
              "description": "The key identifying this field."
            },
            "type": {
              "type": "string",
              "description": "The data type of the field.",
              "enum": [
                "string",
                "array",
                "object"
              ]
            },
            "description": {
              "type": "string",
              "description": "A human-readable description of the field."
            },
            "items": {
              "anyOf": [
                {
                  "$ref": "#/$defs/schema_field"
                },
                {
                  "type": "object",
                  "properties": {
                    "type": {
                      "type": "string",
                      "enum": [
                        "string",
                        "array",
                        "object"
                      ]
                    }
                  },
                  "required": [
                    "type"
                  ],
                  "additionalProperties": false
                }
              ],
              "description": "If the type is 'array', defines the schema of the items."
            },
            "properties": {
              "type": "array",
              "description": "If the type is 'object', a list of sub-field definitions.",
              "items": {
                "$ref": "#/$defs/schema_field"
              }
            }
          },
          "required": [
            "key",
            "type",
            "description",
            "items",
            "properties"
          ],
          "additionalProperties": false
        }
      }
    }
  }

  const imageSchema = z.object({
    document_type: z.string(),
    text: z.string(),
    schema_id: z.string(),
    schema_found: z.boolean()
  });

  const textSchema = z.object({
    document_type: z.string(),
    schema_id: z.string(),
    schema_found: z.boolean()
  });
  


  const estimationSchema = {

    "name": "weight_and_serving",
    "strict": true,
    "schema": {
      "type": "object",
      "description": "Estimated food identification and serving size analysis based on a single dish image.",
      "properties": {
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
              "servingSizeUnit": {
                "type": "string",
                "description": "Unit of measurement used for the serving size estimate (e.g., g, oz)."
              },
              "servingSize": {
                "type": "number",
                "description": "Estimated numeric quantity of the food in the specified unit, inferred visually from the image."
              },
              "householdServingFullText": {
                "type": "string",
                "description": "Human-readable household serving approximation (e.g., '1 cup', '2 slices', '1 medium piece')."
              }
            },
            "required": [
              "foodName",
              "servingSizeUnit",
              "servingSize",
              "householdServingFullText"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "detectedFoods"
      ],
      "additionalProperties": false
    }
  }

  const estimatedCaloriesSchema = {
    
    "name": "calories",
    "strict": true,
    "schema": {
      "type": "object",
      "description": "Calculated calories for each detected food item based on AI-estimated servings and USDA reference data.",
      "properties": {
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
              "calories": {
                "type": "number",
                "description": "Calculated calories for this food based on the AI-estimated serving and USDA reference data."
              }
            },
            "required": [
              "foodName",
              "calories"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "foods"
      ],
      "additionalProperties": false
    }
  }
  
  export { dynamicSchema, imageSchema, textSchema, dynamicSchemaForUpdate, estimationSchema, estimatedCaloriesSchema };