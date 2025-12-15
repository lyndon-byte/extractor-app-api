import { nullable, z } from "zod";

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
    schema_id: z.string().optional(nullable()),
    schema_found: z.boolean()
  });

  const textSchema = z.object({
    document_type: z.string(),
    schema_id: z.string().optional(nullable()),
    schema_found: z.boolean()
  });
  

  export { dynamicSchema, imageSchema, textSchema };