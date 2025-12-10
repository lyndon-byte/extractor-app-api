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

  const imageSchema = {

    "name": "document_type_schema",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "document_type": {
          "type": "string",
          "description":  "A single-word, lowercase label that identifies the document in the image. Examples: 'resume', 'cv'. Select whichever is most accurate." 
        },
        "text": {
          "type": "string",
          "description": "A list of visible text segments extracted from the image. Include only the readable text that appears on the document."
        }
      },
      "required": [
        "document_type",
        "text",
      ],
      "additionalProperties": false,
    }
  }
  
  const textSchema = {

    "name": "document_type_schema",
    "strict": true,
    "schema": {
      "type": "object",
      "properties": {
        "document_type": {
          "type": "string",
          "description":  "A single-word, lowercase label that identifies the document in the image. Examples: 'resume', 'cv'. Select whichever is most accurate." 
        },
      },
      "required": [
        "document_type",
      ],
      "additionalProperties": false,
    }
  }
  


  export { dynamicSchema, imageSchema, textSchema };